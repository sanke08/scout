/**
 * Hard rule: salary floor.
 *
 * Why: the user will not take a job that pays less than their floor.
 *
 * What it does: converts both figures to a yearly amount (a monthly figure is multiplied by 12)
 * and compares the best the posting offers (its maximum, or its minimum when there is no
 * maximum) with the floor. It drops only when that best figure is below the floor. It never
 * drops a posting with no salary, with a different currency, or with no stated currency or
 * period; the last two cases are reported as notes because the figure could not be compared.
 *
 * Example: floor 60000 EUR a year; a posting offering up to 3000 EUR a month (36000 a year) is
 * dropped; one offering up to 6000 EUR a month (72000 a year) is kept; one with no salary is kept.
 */
import type { Posting, Profile } from "../shared/index.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** Months in a year, for turning monthly pay into yearly pay. */
const MONTHS_PER_YEAR = 12;

/** Converts an amount to a yearly amount. Example: `toYearly(3000, "month")` is `36000`. */
function toYearly(amount: number, period: "year" | "month"): number {
  return period === "month" ? amount * MONTHS_PER_YEAR : amount;
}

/** Checks the posting's salary against the profile's salary floor. */
export function checkSalary(posting: Posting, profile: Profile): RuleOutcome {
  const floor = profile.preferences.salaryFloor;
  const salary = posting.salary;
  if (floor === undefined || salary === undefined) return NO_OBJECTION;

  const best = salary.max ?? salary.min;
  if (best === undefined) return NO_OBJECTION;

  if (
    salary.currency === undefined ||
    salary.currency.toUpperCase() !== floor.currency.toUpperCase()
  ) {
    return {
      note: `The salary is not in ${floor.currency} (it says ${salary.currency ?? "no currency"}), so it was not compared with your floor.`,
    };
  }
  if (salary.period === undefined) {
    return {
      note: "The salary does not say whether it is per month or per year, so it was not compared with your floor.",
    };
  }

  const offeredYearly = toYearly(best, salary.period);
  const floorYearly = toYearly(floor.amount, floor.period);
  if (offeredYearly >= floorYearly) return NO_OBJECTION;
  return {
    reason: `The salary tops out at ${offeredYearly} ${floor.currency} a year, below your floor of ${floorYearly}.`,
  };
}
