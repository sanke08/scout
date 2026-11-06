/**
 * The claim check: finds every factual claim in model-written text and says which ones the profile
 * does not back (idea document 5.7, scenario F). It uses plain pattern matching and no model, so
 * the same text always gives the same answer.
 *
 * What counts as a claim: a technology or other capitalised name, a figure with a unit or a
 * percentage, a team size, a role word such as "led" or "senior", and a year.
 * Anything not found in the allowed terms or the known facts is unsupported.
 */

/** The kinds of claim the check looks for. */
export type ClaimKind = "term" | "number" | "team-size" | "role" | "year";

/** One claim found in a text. Example: `{ kind: "team-size", text: "team of eight" }`. */
export interface Claim {
  kind: ClaimKind;
  /** The words as they appear in the text. */
  text: string;
}

/** A claim the profile does not back, with a sentence saying why. */
export interface UnsupportedClaim extends Claim {
  reason: string;
}

/** What the text may claim. */
export interface ClaimSupport {
  /** Terms the user confirms are true for this point. Example: ["Kafka", "Go"]. */
  allowedTerms: string[];
  /** Facts the profile states. Example: ["Mentored two juniors"]. */
  knownFacts: string[];
}

/** The answer of `checkClaims`. An empty `unsupported` list means the text may be shown for approval. */
export interface ClaimCheckResult {
  supported: Claim[];
  unsupported: UnsupportedClaim[];
}

/** A claim with its place in the text, used to avoid reporting the same words twice. */
interface Candidate extends Claim {
  start: number;
  end: number;
}

/** Technology names that count as claims even when written in lower case. */
const KNOWN_TECHNOLOGIES = new Set([
  "typescript",
  "javascript",
  "python",
  "java",
  "kotlin",
  "scala",
  "haskell",
  "ruby",
  "rails",
  "php",
  "laravel",
  "django",
  "nodejs",
  "node",
  "kafka",
  "rabbitmq",
  "kubernetes",
  "k8s",
  "docker",
  "terraform",
  "ansible",
  "jenkins",
  "redis",
  "postgres",
  "postgresql",
  "mysql",
  "mongodb",
  "sqlite",
  "elasticsearch",
  "graphql",
  "grpc",
  "angular",
  "redux",
  "nextjs",
  "webpack",
  "vite",
  "jest",
  "vitest",
  "playwright",
  "selenium",
  "aws",
  "gcp",
  "azure",
  "nginx",
  "linux",
  "git",
  "flink",
  "hadoop",
  "airflow",
  "tensorflow",
  "pytorch",
  "pandas",
  "numpy",
  "prometheus",
  "grafana",
  "datadog",
  "android",
  "ios",
  "swiftui",
  "html",
  "css",
  "sql",
  "nosql",
]);

/** Capitalised words that are not claims. Example: "I", and "API" which is too general to police. */
const IGNORED_WORDS = new Set(["i", "api", "apis"]);

/** Words after a number that do not make it a figure. Example: "5 and 6" is not a claim. */
const FUNCTION_WORDS = "and|or|to|of|in|the|a|an|for|with|on|at|by|from|as|is|was|are|that|which";

/** Number words and their digits, so "two" and "2" count as the same figure. */
const NUMBER_WORDS: Record<string, string> = {
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};

const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");

/** Role words grouped by meaning: any word of a group in the profile supports the whole group. */
const ROLE_GROUPS: string[][] = [
  ["led", "lead", "leads", "leading"],
  ["managed", "manage", "manages", "managing", "manager"],
  ["senior"],
  ["principal"],
  ["director"],
  ["head"],
];

const TEAM_SIZE_PATTERNS = [
  new RegExp(`\\bteam of (?:\\d+|${NUMBER_WORD_PATTERN})\\b`, "gi"),
  new RegExp(`\\b(?:\\d+|${NUMBER_WORD_PATTERN})[- ]person team\\b`, "gi"),
];
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const NUMBER_PATTERNS = [
  /\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand)|[kKmMbB]\b)?/g,
  new RegExp(
    `\\d[\\d,]*(?:\\.\\d+)?(?:\\s?%|\\s?percent\\b|[a-zA-Z]+\\b|\\s(?!(?:${FUNCTION_WORDS})\\b)[a-zA-Z]+\\b)`,
    "g",
  ),
  new RegExp(`\\b(?:${NUMBER_WORD_PATTERN})\\s(?!(?:${FUNCTION_WORDS})\\b)[a-zA-Z]+\\b`, "gi"),
];
const ROLE_PATTERN =
  /\b(?:led|lead|leads|leading|managed|manages|managing|manager|senior|principal|director|head of)\b/gi;
const WORD_PATTERN = /[A-Za-z][A-Za-z0-9+#.]*/g;

/** Finds every match of the patterns as candidates of one kind. */
function findMatches(text: string, kind: ClaimKind, patterns: RegExp[]): Candidate[] {
  const found: Candidate[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      found.push({ kind, text: match[0], start, end: start + match[0].length });
    }
  }
  return found;
}

/** True when `start` begins a sentence or a bullet, so a capital letter there means nothing. */
function startsSentence(text: string, start: number): boolean {
  const before = text.slice(0, start);
  const stripped = before.replace(/[\s\-*•–—"'(]+$/, "");
  return stripped === "" || /[.!?:;]$/.test(stripped) || /\n[\s\-*•]*$/.test(before);
}

/** A word written like a technology name: a capital inside it, a digit, or a symbol such as "+" or "." */
function looksLikeTechnologyName(word: string): boolean {
  return /[A-Z]/.test(word.slice(1)) || /[0-9+#.]/.test(word);
}

/** Finds technology and name claims (see `KNOWN_TECHNOLOGIES` and capitalised words). */
function findTerms(text: string): Candidate[] {
  const found: Candidate[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0].replace(/\.+$/, "");
    const start = match.index ?? 0;
    const lower = word.toLowerCase();
    if (IGNORED_WORDS.has(lower)) continue;
    const capitalised = /^[A-Z]/.test(word);
    const isClaim =
      KNOWN_TECHNOLOGIES.has(lower) ||
      looksLikeTechnologyName(word) ||
      (capitalised && !startsSentence(text, start));
    if (isClaim) found.push({ kind: "term", text: word, start, end: start + word.length });
  }
  return found;
}

/** Keeps candidates in the given priority order, dropping any that overlap one already kept. */
function dropOverlaps(candidates: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = kept.some(
      (other) => candidate.start < other.end && other.start < candidate.end,
    );
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

/**
 * Lists the claims in `text`, in the order they appear.
 * Example: "Led a team of eight in 2024 on Kafka" gives role "Led", team-size "team of eight",
 * year "2024" and term "Kafka". A repeated claim is listed once.
 */
export function extractClaims(text: string): Claim[] {
  const candidates = dropOverlaps([
    ...findMatches(text, "team-size", TEAM_SIZE_PATTERNS),
    ...findMatches(text, "year", [YEAR_PATTERN]),
    ...findMatches(text, "number", NUMBER_PATTERNS),
    ...findMatches(text, "role", [ROLE_PATTERN]),
    ...findTerms(text),
  ]).sort((first, second) => first.start - second.start);

  const seen = new Set<string>();
  const claims: Claim[] = [];
  for (const { kind, text: claimText } of candidates) {
    const identity = `${kind}:${claimText.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    claims.push({ kind, text: claimText });
  }
  return claims;
}

/**
 * Rewrites text into a plain form so equal facts compare equal: lower case, number words as digits,
 * no thousands commas, "percent" as "%", "8-person team" as "team of 8".
 * Example: "Team of Eight, 40 percent" becomes "team of 8, 40%".
 */
function normaliseForMatching(text: string): string {
  let plain = text.toLowerCase();
  plain = plain.replace(
    new RegExp(`\\b(${NUMBER_WORD_PATTERN})\\b`, "g"),
    (word) => NUMBER_WORDS[word]!,
  );
  plain = plain.replace(/(\d),(?=\d{3}\b)/g, "$1");
  plain = plain.replace(/\s*percent\b/g, "%").replace(/\s+%/g, "%");
  plain = plain.replace(/(\d+)[- ]person team/g, "team of $1");
  return plain.replace(/\s+/g, " ");
}

/** True when `needle` appears in `haystack` as whole words (a plural "s" is allowed). */
function containsAsWords(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}s?(?![a-z0-9])`).test(haystack);
}

/** The lower-case words of some text, in the same way the term claims are cut out. */
function wordsOf(text: string): string[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) =>
    match[0].replace(/\.+$/, "").toLowerCase(),
  );
}

/** The sentence explaining why a claim is unsupported. */
function explainUnsupported(claim: Claim): string {
  const names: Record<ClaimKind, string> = {
    term: "The term",
    number: "The figure",
    "team-size": "The team size",
    role: "The role word",
    year: "The year",
  };
  return `${names[claim.kind]} "${claim.text}" is not backed by the allowed terms or the known facts.`;
}

/**
 * Checks every claim in `text` against `support`.
 *
 * Example (scenario F): with known fact "Mentored two juniors", the text "Led a team of eight" has
 * unsupported claims "Led" (role) and "team of eight" (team-size). The text "Mentored two juniors"
 * has none.
 * A term is supported when it is one of the words of an allowed term or known fact. A figure, team
 * size or year is supported when the same figure appears in an allowed term or known fact. A role
 * word is supported when the same kind of role word appears there.
 */
export function checkClaims(text: string, support: ClaimSupport): ClaimCheckResult {
  const supportTexts = [...support.allowedTerms, ...support.knownFacts];
  const supportWords = new Set(supportTexts.flatMap(wordsOf));
  const supportPlain = normaliseForMatching(supportTexts.join("\n"));

  const isSupported = (claim: Claim): boolean => {
    if (claim.kind === "term") return supportWords.has(claim.text.toLowerCase());
    if (claim.kind === "role") {
      const group = ROLE_GROUPS.find((words) =>
        words.includes(claim.text.toLowerCase().split(" ")[0]!),
      );
      return group !== undefined && group.some((word) => supportWords.has(word));
    }
    return containsAsWords(supportPlain, normaliseForMatching(claim.text));
  };

  const result: ClaimCheckResult = { supported: [], unsupported: [] };
  for (const claim of extractClaims(text)) {
    if (isSupported(claim)) result.supported.push(claim);
    else result.unsupported.push({ ...claim, reason: explainUnsupported(claim) });
  }
  return result;
}

/** At most this many claims are quoted back to the model. */
const MAXIMUM_QUOTED_CLAIMS = 10;

/**
 * Writes the correction sent back to the model after a failed claim check.
 * Example: for unsupported "team of eight" it returns a paragraph that names "team of eight" and
 * tells the model to remove it and add nothing new.
 * Only the short claim texts found by the check are quoted, never the whole model reply.
 */
export function claimRetryInstructions(unsupported: UnsupportedClaim[]): string {
  const quoted = unsupported
    .slice(0, MAXIMUM_QUOTED_CLAIMS)
    .map((claim) => `"${claim.text}" (${claim.kind})`)
    .join(", ");
  return [
    `Your previous wording was rejected because it makes claims the profile does not support: ${quoted}.`,
    "Write the wording again using only the original point and the allowed terms.",
    "Remove each unsupported claim. Do not add any new technology, number, team size, job title or year.",
  ].join(" ");
}
