/**
 * The shape of the profile: the single source of truth about the user (Scout idea document, 5.1).
 *
 * Every experience point and project point is stored once. A resume never contains text that is
 * not one of these points or one of their approved alternate wordings.
 *
 * The schemas below are the only definition of these shapes. Other modules import the inferred
 * types (`Profile`, `Point`, ...) and the schemas (`profileSchema`) for validation.
 */
import { z } from "zod";

/**
 * How sure a point is.
 * - `confirmed`: the user states it.
 * - `from code`: read from the user's own project and checked at a recorded date (a dated
 *   snapshot, not a current test result).
 * - `ask first`: a fact the user flagged before; never used silently, offered for a yes or no.
 * - `hold`: unresolved or unmeasured; never used automatically.
 * - `excluded`: never used anywhere; kept only as a record.
 */
export const pointStatusSchema = z.enum([
  "confirmed",
  "from code",
  "ask first",
  "hold",
  "excluded",
]);
/** The TypeScript type of one validated point status, inferred from its schema. */
export type PointStatus = z.infer<typeof pointStatusSchema>;

/** Statuses a resume may use without asking. */
export const USABLE_POINT_STATUSES: readonly PointStatus[] = ["confirmed", "from code"];

/**
 * An approved alternate wording of a point. `keys` are the job terms that trigger it.
 * An alternate wording may only use terms from its point's own `allowed` list.
 */
export const variantSchema = z.object({
  text: z.string(),
  keys: z.array(z.string()),
});
/** The TypeScript type of one validated variant, inferred from its schema. */
export type Variant = z.infer<typeof variantSchema>;

/** One experience or project statement, stored once. */
export const pointSchema = z.object({
  text: z.string(),
  /** Technologies and skills the user confirms are true for this point, e.g. "Kafka". */
  allowed: z.array(z.string()),
  variants: z.array(variantSchema),
  status: pointStatusSchema,
});
/** The TypeScript type of one validated point, inferred from its schema. */
export type Point = z.infer<typeof pointSchema>;

/** One job in the work history. */
export const experienceEntrySchema = z.object({
  title: z.string(),
  org: z.string(),
  /** Free text such as "Feb 2026 – Present". */
  dates: z.string(),
  place: z.string(),
  points: z.array(pointSchema),
});
/** The TypeScript type of one validated experience entry, inferred from its schema. */
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;

/** One personal or open-source project. */
export const projectEntrySchema = z.object({
  title: z.string(),
  stack: z.string(),
  link: z.string().optional(),
  live: z.string().optional(),
  /** Optional short status note such as "In development". */
  note: z.string().optional(),
  points: z.array(pointSchema),
});
/** The TypeScript type of one validated project entry, inferred from its schema. */
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

/** One row of technical skills, e.g. label "Languages", items ["TypeScript", "Go"]. */
export const skillRowSchema = z.object({
  label: z.string(),
  items: z.array(z.string()),
});
/** The TypeScript type of one validated skill row, inferred from its schema. */
export type SkillRow = z.infer<typeof skillRowSchema>;

/** The schema that checks one identity. Use it to validate data from files, the web page or a model. */
export const identitySchema = z.object({
  name: z.string(),
  location: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  github: z.string().optional(),
  linkedin: z.string().optional(),
  portfolio: z.string().optional(),
});
/** The TypeScript type of one validated identity, inferred from its schema. */
export type Identity = z.infer<typeof identitySchema>;

/** The schema that checks one education. Use it to validate data from files, the web page or a model. */
export const educationSchema = z.object({
  degree: z.string(),
  dates: z.string(),
  school: z.string(),
  grade: z.string().optional(),
});
/** The TypeScript type of one validated education, inferred from its schema. */
export type Education = z.infer<typeof educationSchema>;

/** What the user wants and will not accept; used by the hard-rule filters. */
export const preferencesSchema = z.object({
  targetRoles: z.array(z.string()),
  /** Cities or regions the user accepts, e.g. "Bangalore", "Remote (India)". */
  locations: z.array(z.string()),
  acceptsRemote: z.boolean(),
  salaryFloor: z
    .object({ amount: z.number(), currency: z.string(), period: z.enum(["year", "month"]) })
    .optional(),
  noticePeriodDays: z.number().optional(),
  workAuthorization: z.array(z.string()),
  dealbreakers: z.array(z.string()),
  excludedCompanies: z.array(z.string()),
  excludedIndustries: z.array(z.string()),
  /** Seniority levels the user will consider, e.g. ["intern", "junior", "mid"]. */
  seniority: z.array(z.enum(["intern", "junior", "mid", "senior", "lead"])),
  /** Months of full-time and internship work, kept apart and never double counted. */
  experienceMonths: z.object({ fullTime: z.number(), internship: z.number() }),
});
/** The TypeScript type of one validated preferences, inferred from its schema. */
export type Preferences = z.infer<typeof preferencesSchema>;

/** Kinds of recurring form question. Legal, demographic and salary are never guessed. */
export const answerKindSchema = z.enum([
  "factual",
  "personal",
  "motivational",
  "legal",
  "demographic",
  "salary",
]);
/** The TypeScript type of one validated answer kind, inferred from its schema. */
export type AnswerKind = z.infer<typeof answerKindSchema>;

/** An approved answer to a recurring form question. Only approved entries are used silently. */
export const answerEntrySchema = z.object({
  question: z.string(),
  kind: answerKindSchema,
  answer: z.string(),
  /** ISO date (YYYY-MM-DD) the user approved this answer. */
  approvedOn: z.string(),
});
/** The TypeScript type of one validated answer entry, inferred from its schema. */
export type AnswerEntry = z.infer<typeof answerEntrySchema>;

/** The whole profile. `version` goes up by one on every saved change. */
export const profileSchema = z.object({
  /** Version of this file format; bump with an upgrade rule when the shape changes. */
  schemaVersion: z.literal(1),
  /** Increases on every saved change; applications record the version they used. */
  version: z.number().int().nonnegative(),
  identity: identitySchema,
  education: educationSchema,
  summary: z.object({ text: z.string(), variants: z.array(variantSchema) }),
  skills: z.array(skillRowSchema),
  experience: z.array(experienceEntrySchema),
  projects: z.array(projectEntrySchema),
  preferences: preferencesSchema,
  answerBank: z.array(answerEntrySchema),
  /** Items kept out of every resume, shown on the Profile view as a locked list. */
  neverUsed: z.array(z.string()),
});
/** The TypeScript type of one validated profile, inferred from its schema. */
export type Profile = z.infer<typeof profileSchema>;
