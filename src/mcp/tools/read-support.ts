/**
 * Small helpers shared by the read tools: safe running, compact job shapes and text limits.
 *
 * Why it exists: every read tool must turn any failure into an error result (never throw past the
 * handler) and keep its JSON short, because the model pays for every token. Doing both in one
 * place keeps the tools themselves short.
 *
 * Example: `guarded(() => ok({ hello: "world" }))` resolves to `{ ok: true, data: { hello: "world" } }`.
 */
import { z } from "zod";
import { ScoutError, type JobRecord, type Posting } from "../../shared/index.js";
import { fail, outside, type ToolResult } from "../tool.js";

/** The longest id the model may pass (posting ids are at most 64 characters). */
export const JOB_ID_SCHEMA = z.string().trim().min(1).max(64);

/** Characters of description shown in a board listing. */
export const DESCRIPTION_PREVIEW_CHARACTERS = 400;

/** The most characters of one posting description `read_posting` returns. */
export const MAXIMUM_DESCRIPTION_CHARACTERS = 20_000;

/**
 * Runs a handler body and turns every failure into an error result.
 * Example: a body that throws `ScoutError("paused", "Automation is paused...")` gives
 * `{ ok: false, error: "Automation is paused..." }`.
 */
export async function guarded(body: () => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ScoutError) return fail(error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Something unexpected went wrong: ${message}`);
  }
}

/** Collapses runs of whitespace and cuts the text to `limit` characters, adding an ellipsis when cut. */
export function shorten(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cleaned = outside(flat, Number.MAX_SAFE_INTEGER);
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit)}…`;
}

/** The longest company, title, location, skill, reason or address handed to the model. */
export const MAXIMUM_OUTSIDE_NAME_CHARACTERS = 200;
export const MAXIMUM_OUTSIDE_REASON_CHARACTERS = 500;
export const MAXIMUM_OUTSIDE_ADDRESS_CHARACTERS = 500;

/** The `outsideFields` paths of a compact job in a list under `jobs` or `postings`. */
export function compactJobFields(listName: string): string[] {
  return ["company", "title", "location", "statusReason"].map((name) => `${listName}[].${name}`);
}

/** Cleans a name-like outside string (company, title, location, skill). */
export function outsideName(text: string): string {
  return outside(text, MAXIMUM_OUTSIDE_NAME_CHARACTERS);
}

/** The compact shape of a job in lists: enough to choose from, no description. */
export interface CompactJob {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: Posting["remote"];
  status: JobRecord["status"];
  statusReason?: string;
  updatedAt: string;
}

/**
 * Shapes a stored job for a list.
 * Example: a record for "Northwind Labs / Backend Engineer" becomes `{ id, company, title, ... }`
 * without its description, sources or skills.
 */
export function compactJob(job: JobRecord): CompactJob {
  return {
    id: job.id,
    company: outsideName(job.company),
    title: outsideName(job.title),
    location: outsideName(job.location),
    remote: job.remote,
    status: job.status,
    ...(job.statusReason === undefined
      ? {}
      : { statusReason: outside(job.statusReason, MAXIMUM_OUTSIDE_REASON_CHARACTERS) }),
    updatedAt: job.updatedAt,
  };
}
