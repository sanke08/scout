/** Properties of salary extraction from text. */
import { describe, expect, it } from "vitest";
import { extractSalary, parseAmount } from "./salary.js";

describe("parseAmount", () => {
  it("reads plain, grouped, thousands and European forms", () => {
    expect(parseAmount("120000")).toBe(120000);
    expect(parseAmount("120,000")).toBe(120000);
    expect(parseAmount("60.000")).toBe(60000);
    expect(parseAmount("95.5k")).toBe(95500);
  });
});

describe("extractSalary", () => {
  it("reads a yearly range with signs", () => {
    expect(extractSalary("Salary: $120,000 - $150,000 per year")).toEqual({
      min: 120000,
      max: 150000,
      currency: "USD",
      period: "year",
    });
  });

  it("reads euro ranges and a monthly period", () => {
    expect(extractSalary("€5.000 - €6.000 per month")).toEqual({
      min: 5000,
      max: 6000,
      currency: "EUR",
      period: "month",
    });
  });

  it("reads shorthand and currency codes", () => {
    expect(extractSalary("GBP 70k to 85k")).toEqual({
      min: 70000,
      max: 85000,
      currency: "GBP",
      period: "year",
    });
    expect(extractSalary("$90k-$110k")?.min).toBe(90000);
  });

  it("ignores hourly rates, years and plain numbers", () => {
    expect(extractSalary("$40 - $60 per hour")).toBeUndefined();
    expect(extractSalary("Experience from 2020 to 2024")).toBeUndefined();
    expect(extractSalary("Call 555 - 0100")).toBeUndefined();
  });
});
