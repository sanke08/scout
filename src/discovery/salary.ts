/**
 * Finds a pay range written in posting text, such as "$120,000 - $150,000 per year".
 *
 * Only ranges next to a currency sign or code are read, so phone numbers and years are never
 * mistaken for pay. Hourly and daily rates are not converted and so are left out.
 */
import type { Posting } from "../shared/index.js";

/** The salary part of a posting. */
export type Salary = NonNullable<Posting["salary"]>;

/** Currency signs mapped to their currency code. */
const CURRENCY_BY_SIGN: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR" };

/** A money amount such as `120,000`, `120k`, `60.000` or `95.5k`. */
const AMOUNT = String.raw`\d{1,3}(?:[.,]\d{3})+|\d+(?:\.\d+)?\s?[kK]?|\d+`;

/** A currency marker: a sign, or a three-letter code. */
const CURRENCY = String.raw`[$€£₹]|USD|EUR|GBP|CAD|AUD|INR|CHF`;

/** `<currency> amount - <currency> amount`, the currency being optional on the second amount. */
const RANGE_PATTERN = new RegExp(
  String.raw`(${CURRENCY})\s?(${AMOUNT})\s?(?:-|–|—|to)\s?(?:${CURRENCY})?\s?(${AMOUNT})`,
  "i",
);

/** Reads one amount into a number: "120k" is 120000, "60.000" is 60000, "95.5k" is 95500. */
export function parseAmount(text: string): number {
  const cleaned = text.trim();
  const isThousands = /k$/i.test(cleaned);
  const digits = cleaned.replace(/k$/i, "").trim();
  const usesGroupSeparators = /^\d{1,3}(?:[.,]\d{3})+$/.test(digits);
  const numeric = usesGroupSeparators ? digits.replace(/[.,]/g, "") : digits;
  const value = Number(numeric);
  return isThousands ? value * 1000 : value;
}

/** Turns a matched currency marker into a code such as "USD". */
function currencyCode(marker: string): string {
  return CURRENCY_BY_SIGN[marker] ?? marker.toUpperCase();
}

/**
 * Returns the pay range found in `text`, or undefined when there is none.
 *
 * Example: "Salary: $120,000 - $150,000 per year" gives
 * `{ min: 120000, max: 150000, currency: "USD", period: "year" }`;
 * "€5.000 - €6.000 per month" gives `{ min: 5000, max: 6000, currency: "EUR", period: "month" }`.
 */
export function extractSalary(text: string): Salary | undefined {
  const match = RANGE_PATTERN.exec(text);
  if (!match) return undefined;
  const [, marker, firstAmount, secondAmount] = match;
  if (marker === undefined || firstAmount === undefined || secondAmount === undefined) {
    return undefined;
  }
  const around = text.slice(match.index, match.index + match[0].length + 40);
  if (/\b(per hour|\/ ?h(ou)?r|hourly|per day|daily)\b/i.test(around)) return undefined;
  let min = parseAmount(firstAmount);
  const max = parseAmount(secondAmount);
  if (/k$/i.test(secondAmount.trim()) && !/k$/i.test(firstAmount.trim()) && min < 1000) {
    min *= 1000;
  }
  if (min > max || min < 100) return undefined;
  const period = /\b(per month|\/ ?month|monthly|a month)\b/i.test(around) ? "month" : "year";
  return { min, max, currency: currencyCode(marker), period };
}
