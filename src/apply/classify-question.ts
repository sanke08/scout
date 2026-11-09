/**
 * Sorts a form question into one of Scout's six kinds with plain keyword rules.
 *
 * Why: the kind decides what Scout may do. Factual questions can be answered from the profile;
 * motivational ones need a drafted answer a person approves; legal, demographic, salary and
 * personal ones are never guessed (IDEA section 5.10), and the autopilot model can never answer
 * them: they go to the owner, or to an answer the owner approved in the answer bank.
 *
 * What counts as never-guess: age, date of birth, caste, category, religion, gender, marital
 * status (demographic or personal); nationality and identity numbers such as Aadhaar, PAN, SSN or
 * passport (personal); salary, CTC, LPA, package and remuneration, current or expected (salary);
 * notice period and joining time (personal). The words are matched in English and in a few
 * languages that are easy to add to (German, French, Hindi).
 *
 * Example: `classifyQuestion("Are you authorised to work in the EU?")` is `"legal"`;
 * `classifyQuestion("Why do you want to work here?")` is `"motivational"`;
 * `classifyQuestion("Geburtsdatum")` is `"personal"`;
 * `classifyQuestion("How did you hear about us?")` is `"factual"`.
 * The rules run in a fixed order (demographic, legal, salary, motivational, personal, factual)
 * and the first match wins, so a question that fits two kinds gets the more careful one.
 */
import type { AnswerKind } from "../shared/index.js";
import type { FormField } from "./form-types.js";

/** One rule: a kind and the pattern that, when it matches the question, selects that kind. */
interface KindRule {
  kind: AnswerKind;
  pattern: RegExp;
}

/**
 * Builds a whole-word pattern from alternatives. The edges are letters, digits and combining marks
 * of any script, so Hindi and German words match as whole words (plain `\b` only knows A to Z).
 * Inside `alternatives`, `\p{L}*` lets a word continue (`ethnic\p{L}*`).
 */
function words(alternatives: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${alternatives})(?![\\p{L}\\p{N}\\p{M}])`, "iu");
}

/** The ordered rules. Order matters: earlier rules are the more careful kinds. */
const KIND_RULES: readonly KindRule[] = [
  {
    kind: "demographic",
    pattern: words(
      [
        // English
        "gender",
        "sex",
        "race",
        "racial",
        "ethnic\\p{L}*",
        "hispanic",
        "latino",
        "veteran",
        "disabilit\\p{L}*",
        "disabled",
        "sexual orientation",
        "pronouns?",
        "transgender",
        "lgbt\\p{L}*",
        "religio\\p{L}*",
        "marital",
        "marriage status",
        "caste",
        "castes",
        "(?:reservation|social|community|candidate) category",
        "age",
        "age group",
        // German
        "geschlecht",
        "alter",
        "familienstand",
        "konfession",
        "behinderung",
        // French
        "sexe",
        "[ée]tat civil",
        "situation (?:familiale|matrimoniale)",
        "statut matrimonial",
        "handicap",
        "[âa]ge",
        // Hindi
        "लिंग",
        "धर्म",
        "जाति",
        "वैवाहिक(?: स्थिति)?",
        "उम्र",
      ].join("|"),
    ),
  },
  // A form whose whole question is just "Category" asks for the caste or reservation category.
  { kind: "demographic", pattern: /^\s*category\s*[*:?]*\s*$/iu },
  {
    kind: "legal",
    pattern: words(
      [
        "authori[sz]ed",
        "authori[sz]ation",
        "visa",
        "sponsor\\p{L}*",
        "legally",
        "right to work",
        "work permit",
        "citizen\\p{L}*",
        "criminal",
        "convicted",
        "felony",
        "background check",
        "non-?compete",
        "export control",
        "security clearance",
        "privacy",
        "consent",
        "i agree",
        "i certify",
        "terms",
        "gdpr",
        "data processing",
      ].join("|"),
    ),
  },
  {
    kind: "salary",
    pattern: words(
      [
        // English: pay in every common wording, current or expected
        "salary",
        "salaries",
        "compensation",
        "remuneration",
        "pay expectations?",
        "desired pay",
        "hourly rate",
        "day rate",
        "stipend",
        "ctc",
        "lpa",
        "(?:expected|current|present|desired|annual|total|last drawn|fixed|variable|existing|offered)\\s+(?:package|pay|salary|income|earnings?|compensation|remuneration|ctc)",
        "(?:package|pay|salary|income) (?:expectations?|details)",
        "last drawn",
        // German
        "gehalt\\p{L}*",
        "verg[üu]tung\\p{L}*",
        "gehaltsvorstellung\\p{L}*",
        "gehaltswunsch",
        // French
        "salaire\\p{L}*",
        "r[ée]mun[ée]ration\\p{L}*",
        "pr[ée]tentions salariales",
        // Hindi
        "वेतन",
        "सैलरी",
        "पैकेज",
      ].join("|"),
    ),
  },
  {
    kind: "motivational",
    pattern: words(
      [
        "why (?:do|are|would|did)",
        "describe a time",
        "tell us about",
        "tell us why",
        "what excites",
        "what motivates",
        "motivat\\p{L}*",
        "cover letter",
        "interested in",
        "passionate",
        "proudest",
        "biggest challenge",
        "greatest strength",
        "about yourself",
      ].join("|"),
    ),
  },
  {
    kind: "personal",
    pattern: words(
      [
        "relocat\\p{L}*",
        "willing to",
        "open to",
        "comfortable (?:with|working)",
        "start date",
        "earliest start",
        "available to start",
        "travel",
        "commute",
        "work on-?site",
        "in-?office",
        // Notice period and joining time, in every common wording
        "notice",
        "notice period",
        "serving notice",
        "last working day",
        "lwd",
        "how (?:soon|early|quickly) can you (?:join|start)",
        "joining (?:time|date)",
        "time to join",
        "k[üu]ndigungsfrist",
        "pr[ée]avis",
        "नोटिस",
        // Date and place of birth, nationality
        "date of birth",
        "birth ?date",
        "birthday",
        "dob",
        "d\\.o\\.b\\.?",
        "year of birth",
        "birth year",
        "place of birth",
        "nationality",
        "geburtsdatum",
        "geburtstag",
        "geburtsort",
        "nationalit[äée]t",
        "staatsangeh[öo]rigkeit",
        "date de naissance",
        "lieu de naissance",
        "जन्म ?तिथि",
        "जन्मतिथि",
        "राष्ट्रीयता",
        // Identity numbers
        "aadhaar",
        "aadhar",
        "adhaar",
        "pan (?:card|number|no|id)",
        "ssn",
        "social security(?: number)?",
        "passport",
        "passeport",
        "reisepass",
        "national (?:id|identity)",
        "tax (?:id|identification|number)",
        "steuer-?(?:id|nummer)",
        "nino",
        "national insurance",
        "driver'?s licen[cs]e",
        "personalausweis",
        "आधार",
        "पासपोर्ट",
      ].join("|"),
    ),
  },
  // A form whose whole question is just "PAN" asks for the tax number.
  { kind: "personal", pattern: /^\s*pan\s*[*:?#]*\s*$/iu },
];

/** Words in a choice's options that show what the question is, when its label says nothing. */
const OPTION_RULES: readonly KindRule[] = [
  {
    kind: "demographic",
    pattern: words(
      "male|female|non-?binary|married|divorced|widowed|obc|scheduled caste|scheduled tribe|sc/st",
    ),
  },
];

/** Decides the kind of one question. Anything no rule matches is `"factual"`. */
export function classifyQuestion(question: string): AnswerKind {
  const text = question.normalize("NFC");
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return "factual";
}

/** A field's code name made readable: `candidate[date_of_birth]` becomes `candidate date of birth`. */
function readableName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Decides the kind of one form field, from everything that says what it asks: its label, then its
 * code name, then (for a select, radio or tick-box group) its choices. A choice group goes through
 * exactly the same rules as a text box, so a select named `gender` is never left to the model just
 * because its label says "Please choose". The first part that is not plainly factual decides.
 * Example: a select labelled "Select one" named `candidate[date_of_birth]` is `"personal"`.
 */
export function classifyField(field: Pick<FormField, "label" | "name" | "options">): AnswerKind {
  const fromLabel = classifyQuestion(field.label);
  if (fromLabel !== "factual") return fromLabel;
  const fromName = classifyQuestion(readableName(field.name));
  if (fromName !== "factual") return fromName;
  if (field.options.length > 0) {
    const joined = field.options.join(" / ").normalize("NFC");
    const fromOptions = classifyQuestion(joined);
    if (fromOptions !== "factual") return fromOptions;
    for (const rule of OPTION_RULES) {
      if (rule.pattern.test(joined)) return rule.kind;
    }
  }
  return "factual";
}
