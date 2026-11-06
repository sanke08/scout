/**
 * Test builders for the decide module: a fictional profile, settings and postings that tests
 * adjust one field at a time. Everything here is invented; the profile comes from
 * `fixtures/profile.sample.json` (fictional person, example.com address).
 *
 * Example: `makePosting({ seniority: "senior" })` is a valid posting with only seniority changed.
 */
import { readFileSync } from "node:fs";
import {
  DEFAULT_SETTINGS,
  profileSchema,
  type Posting,
  type Preferences,
  type Profile,
  type Settings,
} from "../../src/shared/index.js";

/** The sample profile, optionally with some preferences replaced. */
export function makeProfile(preferences: Partial<Preferences> = {}): Profile {
  const raw = readFileSync(new URL("../profile.sample.json", import.meta.url), "utf8");
  const profile = profileSchema.parse(JSON.parse(raw));
  return { ...profile, preferences: { ...profile.preferences, ...preferences } };
}

/** Default settings, optionally with some fields replaced. */
export function makeSettings(changes: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...changes };
}

/**
 * A posting that passes every hard rule for the sample profile: mid level, remote, no salary,
 * no stated years, no excluded words. Tests change one field to make one rule object.
 */
export function makePosting(changes: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    company: "Northwind Labs",
    title: "Backend Engineer",
    location: "Berlin, Germany",
    remote: "hybrid",
    seniority: "mid",
    skills: ["Node.js", "TypeScript", "PostgreSQL"],
    description: "Build and run services for our booking product with a small team.",
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-05T00:00:00.000Z",
    sources: [{ name: "greenhouse:northwind", url: "https://boards.example.com/northwind/1" }],
    canonicalUrl: "https://boards.example.com/northwind/1",
    board: "greenhouse",
    flags: [],
    ...changes,
  };
}
