/**
 * Looks at a page's text for the things Scout must never handle: bot checks, sign-in walls,
 * one-time codes, assessments, and closed jobs. Also recognises a real confirmation message.
 *
 * Why: IDEA 5.10 says a sign-in wall, a one-time code or a CAPTCHA means "stop and mark needs
 * you; never solved, never bypassed". Page text is untrusted data: this only reads it, it never
 * follows anything it says.
 *
 * Example: `detectPageBlocker("Please verify you are human", "")` is `{ kind: "captcha", ... }`;
 * `looksLikeConfirmation("Thank you for applying!")` is `true`.
 */

/** The kinds of page Scout stops at. `closed` ends the job; the others hand it to the user. */
export type PageBlockerKind = "captcha" | "login" | "one-time-code" | "assessment" | "closed";

/** A detected blocker, with a full-sentence reason that can be shown to the user. */
export interface PageBlocker {
  kind: PageBlockerKind;
  reason: string;
}

/** A pattern on page text or HTML, the kind it signals and the sentence to report. */
interface BlockerRule {
  kind: PageBlockerKind;
  textPattern: RegExp;
  htmlPattern?: RegExp;
  reason: string;
}

/** The rules, checked in order. A closed job is checked first because it needs no help from the user. */
const BLOCKER_RULES: readonly BlockerRule[] = [
  {
    kind: "closed",
    textPattern:
      /no longer accepting applications|position (has been |is )?filled|(job|position|posting) (is )?(closed|no longer available|has expired)|this job has expired|applications are closed/i,
    reason: "The page says this job no longer accepts applications.",
  },
  {
    kind: "captcha",
    textPattern:
      /captcha|verify (that )?you are (a )?human|are you a robot|not a robot|security check|unusual traffic/i,
    htmlPattern: /g-recaptcha|h-captcha|cf-turnstile|data-sitekey/i,
    reason:
      "The page shows a bot check (CAPTCHA). Scout never solves these, so please complete this application yourself.",
  },
  {
    kind: "one-time-code",
    textPattern:
      /one-?time (code|password|passcode)|verification code|enter the (\d-?digit |security )?code|\d-digit code|code (we|was) (just )?sent/i,
    reason:
      "The page asks for a one-time code. Scout cannot read your email or phone for it, so please finish this application yourself.",
  },
  {
    kind: "login",
    textPattern:
      /(please )?(sign|log) ?in to (continue|apply|your account)|create an account to apply|sign in with (google|linkedin)|you must be (signed|logged) in/i,
    htmlPattern: /<input[^>]*type=["']?password/i,
    reason:
      "The page needs you to sign in. Scout never types a password, so please sign in and finish this application yourself.",
  },
  {
    kind: "assessment",
    textPattern:
      /take-?home (test|assignment|assessment)|coding (assessment|challenge|test)|video interview|hackerrank|codility|complete (an|the) assessment/i,
    reason: "The page asks for an assessment or a video interview. Scout hands these to you.",
  },
];

/** Returns the first blocker found in the page text or HTML, or `undefined` for a normal form. */
export function detectPageBlocker(text: string, html: string): PageBlocker | undefined {
  for (const rule of BLOCKER_RULES) {
    if (rule.textPattern.test(text)) return { kind: rule.kind, reason: rule.reason };
    if (rule.htmlPattern !== undefined && rule.htmlPattern.test(html)) {
      return { kind: rule.kind, reason: rule.reason };
    }
  }
  return undefined;
}

/** Patterns of real confirmation messages. A bare "thank you" is not enough. */
const CONFIRMATION_PATTERN =
  /thank you for (applying|your application|submitting)|application (has been |was )?(received|submitted|sent)|we(?:'ve| have) received your application|successfully submitted|your application is in/i;

/** True when the text after a submit is a real confirmation of the application. */
export function looksLikeConfirmation(text: string): boolean {
  return CONFIRMATION_PATTERN.test(text);
}
