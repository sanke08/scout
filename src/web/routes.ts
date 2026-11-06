/**
 * The JSON API: one handler per route, plus the table that maps a method and path to a handler.
 * Handlers only parse input, call a store or the resume builder, and shape the reply. They hold no
 * business logic of their own.
 */
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  profileSchema,
  settingsSchema,
  type JobRecord,
  type JobStatus,
} from "../shared/index.js";
import { HttpError, describeValidationError } from "./http-helpers.js";
import {
  SKIP_TAGS,
  emptyBodySchema,
  jobIdSchema,
  resumeBodySchema,
  skipBodySchema,
} from "./schemas.js";
import type { DigestCard, WebDependencies } from "./types.js";

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

/** `GET /api/health`: tells a script or the page that the server is up. */
const health: RouteHandler = () => ({ status: 200, body: { ok: true } });

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
