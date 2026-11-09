/**
 * The JSON API: one handler per route, plus the table that maps a method and path to a handler.
 * Handlers only parse input, call a store or the resume builder, and shape the reply. They hold no
 * business logic of their own.
 */
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  JOB_STATUSES,
  ScoutError,
  profileSchema,
  settingsSchema,
  type JobRecord,
  type JobStatus,
} from "../shared/index.js";
import { applicationDetailsSchema, manualApplicationSchema, type Ledger } from "../ledger/index.js";
import {
  AUTOMATION_WARNING,
  KNOWN_PLATFORMS,
  applyPlatformChoice,
  assertSavedLoginPossible,
  confirmationMatches,
  describePlatformChoice,
  isRiskyPlatformChoice,
  latestSignIn,
  normalisePlatformName,
  type PlatformChoice,
} from "../platforms/index.js";
import { HttpError, describeValidationError } from "./http-helpers.js";
import {
  SKIP_TAGS,
  emptyBodySchema,
  jobIdSchema,
  pageEventBodySchema,
  platformBodySchema,
  resumeBodySchema,
  skipBodySchema,
  statusBodySchema,
} from "./schemas.js";
import type { ActionRunner } from "./action-runner.js";
import type { DigestCard, PlatformControl, WebDependencies } from "./types.js";

/** What a handler returns: the status and the JSON body to send. */
export interface RouteReply {
  status: number;
  body: unknown;
}

/** Everything a handler may use: the injected dependencies, the parsed body and the path pieces. */
interface RouteContext {
  dependencies: WebDependencies;
  /** The parsed JSON body, or `undefined` when the request had none. */
  body: unknown;
  /** Named pieces of the path, e.g. `{ id: "abc" }` for `/api/jobs/abc/approve`. */
  params: Record<string, string>;
  /** The query string of the address, e.g. `search=alex` for `/api/applications?search=alex`. */
  query: URLSearchParams;
}

type RouteHandler = (context: RouteContext) => Promise<RouteReply> | RouteReply;

/** One entry of the route table: method, path pattern (`:name` marks a variable piece) and handler. */
interface Route {
  method: "GET" | "PUT" | "POST";
  pattern: string;
  handler: RouteHandler;
}

/** Statuses that count as "applied or later" for the Recently applied list. */
const RECENT_STATUSES: JobStatus[] = [
  "applied",
  "contacted",
  "interviewing",
  "offer",
  "rejected",
  "unverified",
];

/** How many recently applied jobs the Digest lists. */
const RECENT_LIMIT = 10;

/**
 * Checks `input` against `schema` and returns the parsed value.
 * Failure: a 400 `HttpError` whose message names the first problems.
 */
function parseInput<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, describeValidationError(result.error));
  return result.data;
}

/** Reads the `:id` piece of the path and validates it. */
function jobIdOf(context: RouteContext): string {
  return parseInput(jobIdSchema, context.params["id"]);
}

/** The small, page-safe view of a job: no description text, no raw posting. */
function jobView(job: JobRecord): Record<string, unknown> {
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    location: job.location,
    remote: job.remote,
    board: job.board,
    canonicalUrl: job.canonicalUrl,
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    sources: job.sources,
    status: job.status,
    statusReason: job.statusReason,
    updatedAt: job.updatedAt,
  };
}

/** The page-safe view of a Digest card: the job is trimmed, everything else passes through. */
function cardView(card: DigestCard): Record<string, unknown> {
  return {
    job: jobView(card.job),
    shortlistScore: card.shortlistScore,
    fitRating: card.fitRating,
    reasons: card.reasons,
    unmet: card.unmet,
    answers: card.answers,
    resumePreview: card.resumePreview,
  };
}

/**
 * `GET /api/health`: tells a script or the page that the server is up. When the server was given a
 * health report it also carries `report` (queue sizes, jobs that need the owner, model calls today)
 * and `approved` (jobs approved and waiting for `scout apply`), plus the model name when known.
 */
const health: RouteHandler = ({ dependencies }) => {
  if (dependencies.healthReport === undefined) return { status: 200, body: { ok: true } };
  const approved = dependencies.jobStore.list({ status: "approved" }).map(jobView);
  return {
    status: 200,
    body: {
      ok: true,
      report: dependencies.healthReport(),
      approved,
      modelName: dependencies.modelName,
    },
  };
};

/** `GET /api/profile`: the profile, plus pending model proposals when there are any. */
const getProfile: RouteHandler = ({ dependencies }) => {
  const profile = dependencies.profileStore.load();
  const pendingProposals = dependencies.pendingProposals?.();
  return { status: 200, body: { profile, pendingProposals } };
};

/** `PUT /api/profile`: validates the whole profile, saves it through the store, returns the saved copy. */
const putProfile: RouteHandler = ({ dependencies, body }) => {
  const profile = parseInput(profileSchema, body);
  const saved = dependencies.profileStore.save(profile);
  return { status: 200, body: { profile: saved, version: saved.version } };
};

/** `GET /api/settings`: current settings and the defaults (for the Reset button). */
const getSettings: RouteHandler = ({ dependencies }) => ({
  status: 200,
  body: { settings: dependencies.settingsStore.load(), defaults: DEFAULT_SETTINGS },
});

/** `PUT /api/settings`: validates the whole settings object, saves it, returns the saved copy. */
const putSettings: RouteHandler = ({ dependencies, body }) => {
  const settings = parseInput(settingsSchema, body);
  return { status: 200, body: { settings: dependencies.settingsStore.save(settings) } };
};

/** `GET /api/digest`: the status line facts, the cards, the needs-you list and recent applications. */
const getDigest: RouteHandler = async ({ dependencies }) => {
  const now = dependencies.now ?? (() => new Date());
  const settings = dependencies.settingsStore.load();
  const cards = await dependencies.digestProvider();
  const needsYou = dependencies.jobStore.list({ status: "needs-you" });
  const recent = dependencies.jobStore.list({ status: RECENT_STATUSES, limit: RECENT_LIMIT });
  return {
    status: 200,
    body: {
      generatedAt: now().toISOString(),
      mode: settings.applyMode,
      automationPaused: settings.automationPaused,
      skipTags: SKIP_TAGS,
      cards: cards.map(cardView),
      needsYou: needsYou.map(jobView),
      recentlyApplied: recent.map(jobView),
    },
  };
};

/** Moves a job to a new status through the store and returns its page-safe view. */
function moveJob(context: RouteContext, to: JobStatus, reason: string): RouteReply {
  const id = jobIdOf(context);
  const { jobStore } = context.dependencies;
  if (jobStore.get(id) === undefined) {
    throw new HttpError(404, "No job with that id exists. Reload the page to see current jobs.");
  }
  return { status: 200, body: { job: jobView(jobStore.transition(id, to, reason)) } };
}

/** `POST /api/jobs/:id/approve`: the user approved the job; it becomes `approved`. */
const approveJob: RouteHandler = (context) => {
  parseInput(emptyBodySchema, context.body);
  return moveJob(context, "approved", "Approved in the digest.");
};

/** `POST /api/jobs/:id/skip`: the user skipped the job; the tag is the recorded reason. */
const skipJob: RouteHandler = (context) => {
  const { tag } = parseInput(skipBodySchema, context.body);
  return moveJob(context, "skipped", tag);
};

/** `POST /api/jobs/:id/undo`: puts an approved or skipped job back to `shortlisted`. */
const undoJob: RouteHandler = (context) => {
  parseInput(emptyBodySchema, context.body);
  return moveJob(context, "shortlisted", "Undone in the digest.");
};

/** `POST /api/resume`: builds the resume for the saved profile and the given keywords. */
const buildResume: RouteHandler = ({ dependencies, body }) => {
  const { keywords, company } = parseInput(resumeBodySchema, body);
  const profile = dependencies.profileStore.load();
  const options = company ? { company } : undefined;
  return { status: 200, body: dependencies.resumeBuilder.build(profile, keywords, options) };
};

/** The ledger behind the Applications routes. Failure: 404 when this server was started without one. */
function ledgerOf(context: RouteContext): Ledger {
  const { ledger } = context.dependencies;
  if (ledger === undefined) throw new HttpError(404, "Applications are not enabled.");
  return ledger;
}

/** `GET /api/applications?search=&status=a,b&due=1`: the matching applications and how many are due. */
const listApplications: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  const statuses = parseInput(
    z.array(z.enum(JOB_STATUSES)),
    (context.query.get("status") ?? "").split(",").filter((word) => word.length > 0),
  );
  const applications = ledger.list({
    search: context.query.get("search") ?? "",
    dueOnly: context.query.get("due") === "1",
    ...(statuses.length > 0 ? { statuses } : {}),
  });
  return { status: 200, body: { applications, dueCount: ledger.due().length } };
};

/** `GET /api/applications/:id`: one application with its history and the statuses it may move to. */
const getApplication: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  const detail = ledger.get(jobIdOf(context));
  if (detail === undefined) {
    throw new HttpError(404, "No application with that id is in the ledger. Reload the page.");
  }
  return { status: 200, body: detail };
};

/** `POST /api/applications`: records an application made outside Scout. */
const addApplication: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  return { status: 201, body: ledger.addManual(parseInput(manualApplicationSchema, context.body)) };
};

/** `PUT /api/applications/:id/details`: saves the recruiter, job id, next step and similar fields. */
const putApplicationDetails: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  const patch = parseInput(applicationDetailsSchema, context.body);
  return { status: 200, body: ledger.saveDetails(jobIdOf(context), patch) };
};

/** `POST /api/applications/:id/status`: reports a new status; the ledger refuses impossible moves. */
const reportApplicationStatus: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  const { status, note, at } = parseInput(statusBodySchema, context.body);
  return { status: 200, body: ledger.setStatus(jobIdOf(context), status, note, at) };
};

/** `POST /api/applications/:id/events`: adds a call, email, message, interview, follow-up or note. */
const addApplicationEvent: RouteHandler = (context) => {
  const ledger = ledgerOf(context);
  const input = parseInput(pageEventBodySchema, context.body);
  return { status: 201, body: ledger.addEvent(jobIdOf(context), input) };
};

/** The action runner behind the Control tab. Failure: 404 when this server was started without one. */
function runnerOf(context: RouteContext): ActionRunner {
  const { actions } = context.dependencies;
  if (actions === undefined) throw new HttpError(404, "Actions are not enabled.");
  return actions;
}

/** `GET /api/actions`: what is running and the last result of each action. */
const getActions: RouteHandler = (context) => ({
  status: 200,
  body: runnerOf(context).state(),
});

/**
 * `POST /api/actions/:name`: starts `discover` or `inbox` in the background. 202 when started, 409
 * while another action runs or when the kill switch blocks the inbox, 404 for an unknown name.
 */
const startAction: RouteHandler = (context) => {
  const runner = runnerOf(context);
  parseInput(emptyBodySchema, context.body);
  return { status: 202, body: runner.start(context.params["name"] ?? "") };
};

/** The platform settings behind the Control tab. Failure: 404 when this server was started without them. */
function platformsOf(context: RouteContext): PlatformControl {
  const { platforms } = context.dependencies;
  if (platforms === undefined) throw new HttpError(404, "Platform settings are not enabled.");
  return platforms;
}

/** The page's view of every platform: its settings, whether credentials are saved and the last sign-in. */
async function platformsView(context: RouteContext): Promise<Record<string, unknown>> {
  const control = platformsOf(context);
  const settings = context.dependencies.settingsStore.load();
  const sessions = control.sessions.list();
  const names = new Set<string>(KNOWN_PLATFORMS.map((platform) => platform.name));
  for (const name of Object.keys(settings.platformLogins)) names.add(name);
  for (const name of Object.keys(sessions)) names.add(name);
  const keychainAvailable = control.vault.isSupported();
  const platforms: Record<string, unknown>[] = [];
  for (const name of [...names].sort()) {
    const session = sessions[name];
    let credentialsSaved: "yes" | "no" | "no-keychain" | "unknown" = "no";
    if (!keychainAvailable) credentialsSaved = "no-keychain";
    else if (session?.username !== undefined) {
      try {
        credentialsSaved = (await control.vault.exists(name, session.username)) ? "yes" : "no";
      } catch {
        credentialsSaved = "unknown";
      }
    }
    platforms.push({
      name,
      known: KNOWN_PLATFORMS.some((platform) => platform.name === name),
      login: settings.platformLogins[name] ?? "manual",
      level: settings.boardLevels[name] ?? "prepare",
      credentialsSaved,
      lastSignInAt: latestSignIn(session) ?? null,
    });
  }
  return { platforms, keychainAvailable, warning: AUTOMATION_WARNING };
}

/** `GET /api/platforms`: every platform with its login way, apply level, credentials flag and last sign-in. */
const getPlatforms: RouteHandler = async (context) => ({
  status: 200,
  body: await platformsView(context),
});

/**
 * `PUT /api/platforms/:name`: changes the login way and/or apply level of one platform. Saved
 * sign-in or an automatic level on linkedin, indeed or naukri also needs `confirm` to be the
 * platform name; without it the answer is 400 and nothing changes.
 */
const putPlatform: RouteHandler = async (context) => {
  const control = platformsOf(context);
  const platform = normalisePlatformName(context.params["name"] ?? "");
  const body = parseInput(platformBodySchema, context.body);
  const choice: PlatformChoice = {};
  if (body.login !== undefined) choice.login = body.login;
  if (body.level !== undefined) choice.level = body.level;
  assertSavedLoginPossible(platform, choice, control.vault);
  if (isRiskyPlatformChoice(platform, choice) && !confirmationMatches(platform, body.confirm)) {
    throw new HttpError(
      400,
      `Type the platform name (${platform}) to confirm this change. ${AUTOMATION_WARNING}`,
    );
  }
  const { settingsStore } = context.dependencies;
  settingsStore.save(applyPlatformChoice(settingsStore.load(), platform, choice));
  control.recordChange?.(describePlatformChoice(platform, choice));
  return { status: 200, body: await platformsView(context) };
};

/** Every route of the API. The README documents the same table. */
export const ROUTES: readonly Route[] = [
  { method: "GET", pattern: "/api/health", handler: health },
  { method: "GET", pattern: "/api/profile", handler: getProfile },
  { method: "PUT", pattern: "/api/profile", handler: putProfile },
  { method: "GET", pattern: "/api/settings", handler: getSettings },
  { method: "PUT", pattern: "/api/settings", handler: putSettings },
  { method: "GET", pattern: "/api/digest", handler: getDigest },
  { method: "POST", pattern: "/api/jobs/:id/approve", handler: approveJob },
  { method: "POST", pattern: "/api/jobs/:id/skip", handler: skipJob },
  { method: "POST", pattern: "/api/jobs/:id/undo", handler: undoJob },
  { method: "POST", pattern: "/api/resume", handler: buildResume },
  { method: "GET", pattern: "/api/actions", handler: getActions },
  { method: "POST", pattern: "/api/actions/:name", handler: startAction },
  { method: "GET", pattern: "/api/platforms", handler: getPlatforms },
  { method: "PUT", pattern: "/api/platforms/:name", handler: putPlatform },
  { method: "GET", pattern: "/api/applications", handler: listApplications },
  { method: "POST", pattern: "/api/applications", handler: addApplication },
  { method: "GET", pattern: "/api/applications/:id", handler: getApplication },
  { method: "PUT", pattern: "/api/applications/:id/details", handler: putApplicationDetails },
  { method: "POST", pattern: "/api/applications/:id/status", handler: reportApplicationStatus },
  { method: "POST", pattern: "/api/applications/:id/events", handler: addApplicationEvent },
];

/** Returns the named pieces when `path` fits `pattern`, or `undefined` when it does not. */
function matchPattern(pattern: string, path: string): Record<string, string> | undefined {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] ?? "";
    const actual = pathParts[index] ?? "";
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

/** The result of looking a request up in the route table. */
export type RouteMatch =
  | { kind: "found"; handler: RouteHandler; params: Record<string, string> }
  | { kind: "wrong-method"; allowed: string[] }
  | { kind: "none" };

/**
 * Finds the route for a method and path.
 * Example: `matchRoute("GET", "/api/health")` is found; `matchRoute("POST", "/api/health")` is
 * `wrong-method` with `allowed: ["GET"]`.
 */
export function matchRoute(method: string, path: string): RouteMatch {
  const allowed: string[] = [];
  for (const route of ROUTES) {
    let params: Record<string, string> | undefined;
    try {
      params = matchPattern(route.pattern, path);
    } catch {
      return { kind: "none" };
    }
    if (params === undefined) continue;
    if (route.method === method) return { kind: "found", handler: route.handler, params };
    allowed.push(route.method);
  }
  return allowed.length > 0 ? { kind: "wrong-method", allowed } : { kind: "none" };
}

/** Maps a failure to the status and sentence the client sees. Unknown failures reveal nothing. */
export function describeFailure(error: unknown): { status: number; message: string } | undefined {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  if (error instanceof ScoutError) {
    const statusByCode: Record<ScoutError["code"], number> = {
      "invalid-input": 400,
      "not-found": 404,
      "illegal-transition": 409,
      "limit-reached": 429,
      unavailable: 503,
      paused: 409,
      unsafe: 403,
    };
    return { status: statusByCode[error.code], message: error.message };
  }
  return undefined;
}
