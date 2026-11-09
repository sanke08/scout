/**
 * Read tools about the user: goals, profile facts and settings.
 *
 * Why they exist: the model must know what the user wants (goals, free text), which facts it may
 * state about the user (profile) and what the user's own controls are (settings). All three are
 * read-only and work even while Scout is paused. No contact detail and no secret is ever returned.
 */
import { z } from "zod";
import { createGoalsStore, goalsAreStarter } from "../../agent/goals-store.js";
import { boardKindSchema, type Point, type PointStatus } from "../../shared/index.js";
import { ok, type ScoutTool } from "../tool.js";
import { guarded } from "./read-support.js";

/** The model-facing name of how a point may be used. */
type PointMarking = "allowed" | "held" | "excluded" | "ask-first";

/** Maps the stored point status to a plain marking. `from code` counts as allowed like `confirmed`. */
const MARKING_BY_STATUS: Record<PointStatus, PointMarking> = {
  confirmed: "allowed",
  "from code": "allowed",
  hold: "held",
  excluded: "excluded",
  "ask first": "ask-first",
};

/** One point as the model sees it: its text, its marking and the technologies the user confirms. */
function describePoint(point: Point): { text: string; marking: PointMarking; allowed: string[] } {
  return { text: point.text, marking: MARKING_BY_STATUS[point.status], allowed: point.allowed };
}

/** The tool with no input at all. */
const NO_INPUT = z.object({});

/** `get_goals`: the user's wishes in their own words. */
const getGoals: ScoutTool<typeof NO_INPUT> = {
  name: "get_goals",
  description:
    "Returns the user's goals in their own words: what jobs they want, where, pay, companies or " +
    "industries to avoid, and how Scout should behave. Read this first in every run and let it " +
    "guide what you shortlist, skip or ask the user about. Returns { goals, goalsWritten }. " +
    "goalsWritten is false while the text is still the starter text, which means the user has " +
    "not told you what they want yet: do not shortlist anything then, report it instead.",
  inputSchema: NO_INPUT,
  readOnly: true,
  handler(_input, context) {
    return guarded(() => {
      const goals = createGoalsStore(context.application.directory).load();
      return ok({ goals, goalsWritten: !goalsAreStarter(goals) });
    });
  },
};

/** `get_profile`: the facts the model may use about the user. */
const getProfile: ScoutTool<typeof NO_INPUT> = {
  name: "get_profile",
  description:
    "Returns the facts about the user: name, city, summary, experience, projects with every " +
    "point, skills, education and the approved answers bank. These are the ONLY facts you may " +
    "use in a resume, cover note or form answer: never add a skill, employer, number or claim " +
    "that is not here, and never copy one from a job posting. Each point has a marking: " +
    "'allowed' (use freely), 'ask-first' (never use it silently: flag_for_user to ask), 'held' " +
    "or 'excluded' (never use). neverUsed lists things to keep out of every resume. Contact " +
    "details are deliberately not included. Fails with a clear message when no profile exists.",
  inputSchema: NO_INPUT,
  readOnly: true,
  handler(_input, context) {
    return guarded(() => {
      const profile = context.application.profileStore.load();
      return ok({
        version: profile.version,
        name: profile.identity.name,
        location: profile.identity.location,
        summary: profile.summary.text,
        education: profile.education,
        skills: profile.skills,
        experience: profile.experience.map((entry) => ({
          title: entry.title,
          org: entry.org,
          dates: entry.dates,
          place: entry.place,
          points: entry.points.map(describePoint),
        })),
        projects: profile.projects.map((project) => ({
          title: project.title,
          stack: project.stack,
          ...(project.note === undefined ? {} : { note: project.note }),
          points: project.points.map(describePoint),
        })),
        answersBank: profile.answerBank.map((answer) => ({
          question: answer.question,
          kind: answer.kind,
          answer: answer.answer,
        })),
        neverUsed: profile.neverUsed,
      });
    });
  },
};

/** `get_settings_summary`: the user's own controls, read only. */
const getSettingsSummary: ScoutTool<typeof NO_INPUT> = {
  name: "get_settings_summary",
  description:
    "Returns the user's controls, read only: paused (true means Scout must not fetch, fill or " +
    "submit), applyMode, dailyApplicationLimit, followUpAfterDays, demographicAnswers (what to " +
    "do with demographic questions: 'prefer-not-to-say' or 'ask-each-time') and applyLevels: " +
    "for each job board kind, how far Scout may go: 'prepare' (prepare only), 'fill' (fill the " +
    "form, the user submits) or 'auto' (you may submit). Boards not listed are 'prepare'. Check " +
    "this before any apply step. You cannot change these.",
  inputSchema: NO_INPUT,
  readOnly: true,
  handler(_input, context) {
    return guarded(() => {
      const settings = context.application.settingsStore.load();
      const applyLevels: Record<string, string> = {};
      for (const kind of boardKindSchema.options) {
        applyLevels[kind] = settings.boardLevels[kind] ?? "prepare";
      }
      for (const [name, level] of Object.entries(settings.boardLevels)) {
        applyLevels[name] = level;
      }
      return ok({
        paused: settings.automationPaused,
        applyMode: settings.applyMode,
        dailyApplicationLimit: settings.dailyApplicationLimit,
        followUpAfterDays: settings.followUpAfterDays,
        demographicAnswers: settings.demographicAnswers,
        applyLevels,
      });
    });
  },
};

/** The user tools, in the order the model should meet them. */
export const userTools: ScoutTool[] = [getGoals, getProfile, getSettingsSummary] as ScoutTool[];
