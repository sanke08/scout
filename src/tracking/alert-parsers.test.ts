import { describe, expect, it } from "vitest";
import { loadFixtureMessage, makePosting } from "../../fixtures/mail/builders.js";
import { detectAlertPlatform, parseAlertEmail, MAX_JOBS_PER_ALERT } from "./alert-parsers.js";
import { pickMatchingPosting, resolveToOfficialBoard } from "./resolve-board.js";
import type { ParsedMessage } from "./message-types.js";

describe("parseAlertEmail", () => {
  it("reads a LinkedIn-style digest (title, company and location, link)", async () => {
    const postings = parseAlertEmail(await loadFixtureMessage("alert-linkedin"));
    expect(postings).toEqual([
      {
        title: "Backend Engineer",
        company: "Northwind Labs",
        location: "Berlin, Germany",
        url: "https://www.linkedin.example.com/comm/jobs/view/1000000001",
        platform: "linkedin",
      },
      {
        title: "Platform Engineer",
        company: "Lakeside Software",
        location: "Remote",
        url: "https://www.linkedin.example.com/comm/jobs/view/1000000002",
        platform: "linkedin",
      },
      {
        title: "Senior Node.js Developer",
        company: "Harbor Systems",
        location: "Hamburg, Germany",
        url: "https://www.linkedin.example.com/comm/jobs/view/1000000003",
        platform: "linkedin",
      },
    ]);
  });

  it("reads an Indeed-style digest and splits company from location on the last hyphen", async () => {
    const postings = parseAlertEmail(await loadFixtureMessage("alert-indeed"));
    expect(postings.map((posting) => [posting.title, posting.company, posting.location])).toEqual([
      ["Backend Engineer", "Quayside Digital", "Berlin"],
      ["Software Engineer, Payments", "Northwind Labs", "Berlin (Hybrid)"],
      ["Go Developer", "Brightline Talent Ltd", "Remote"],
    ]);
    expect(postings.every((posting) => posting.platform === "indeed")).toBe(true);
  });

  it("reads a Naukri-style HTML digest, taking links from the page's link addresses", async () => {
    const postings = parseAlertEmail(await loadFixtureMessage("alert-naukri"));
    expect(postings).toEqual([
      {
        title: "Backend Developer",
        company: "Quayside Digital",
        location: "Bengaluru",
        url: "https://www.naukri.example.com/job-listings-backend-developer-1100001",
        platform: "naukri",
      },
      {
        title: "Node.js Engineer",
        company: "Lakeside Software",
        location: "Remote",
        url: "https://www.naukri.example.com/job-listings-node-js-engineer-1100002",
        platform: "naukri",
      },
    ]);
  });

  it("does not list search, unsubscribe or manage-alert links as jobs", async () => {
    for (const fixture of ["alert-linkedin", "alert-indeed", "alert-naukri"]) {
      for (const posting of parseAlertEmail(await loadFixtureMessage(fixture))) {
        expect(posting.url).not.toMatch(/search|unsubscribe|alerts/);
      }
    }
  });

  it("returns nothing for a message from an ordinary sender", async () => {
    expect(parseAlertEmail(await loadFixtureMessage("rejection"))).toEqual([]);
    expect(detectAlertPlatform(await loadFixtureMessage("rejection"))).toBeUndefined();
  });

  it("returns nothing, not wrong jobs, when a known platform's text has an unexpected shape", async () => {
    const odd: ParsedMessage = {
      ...(await loadFixtureMessage("alert-linkedin")),
      text: "Hello there.\nSomething new.\nhttps://www.linkedin.example.com/comm/jobs/view/1",
    };
    expect(parseAlertEmail(odd)).toEqual([]);
  });

  it("keeps a link only when it starts with http, and never reads a javascript address", async () => {
    const hostile: ParsedMessage = {
      ...(await loadFixtureMessage("alert-linkedin")),
      text: "Backend Engineer\nNorthwind Labs · Berlin\nView job: javascript:alert(1)/jobs/view/9",
    };
    expect(parseAlertEmail(hostile)).toEqual([]);
  });

  it("caps the number of jobs and the length of fields", async () => {
    const block = (index: number) =>
      `${"T".repeat(500)}\nCompany ${index} · Place\nView job: https://www.linkedin.example.com/comm/jobs/view/${index}\n`;
    const many: ParsedMessage = {
      ...(await loadFixtureMessage("alert-linkedin")),
      text: Array.from({ length: 80 }, (_unused, index) => block(index)).join("\n"),
    };
    const postings = parseAlertEmail(many);
    expect(postings).toHaveLength(MAX_JOBS_PER_ALERT);
    expect(postings.every((posting) => posting.title.length <= 200)).toBe(true);
  });

  it("lists a link that appears twice once", async () => {
    const message = await loadFixtureMessage("alert-linkedin");
    const doubled: ParsedMessage = { ...message, text: `${message.text}\n\n${message.text}` };
    expect(parseAlertEmail(doubled)).toHaveLength(3);
  });
});

describe("resolveToOfficialBoard", () => {
  const partial = {
    title: "Backend Engineer",
    company: "Northwind Labs",
    location: "Berlin",
    url: "https://www.linkedin.example.com/comm/jobs/view/1",
    platform: "linkedin" as const,
  };

  it("finds the company's own board from a careers address", async () => {
    const result = await resolveToOfficialBoard(partial, (company) =>
      company === "Northwind Labs" ? "https://boards.greenhouse.io/northwindlabs" : undefined,
    );
    expect(result).toEqual({
      status: "resolved",
      board: { kind: "greenhouse", token: "northwindlabs" },
      careersUrl: "https://boards.greenhouse.io/northwindlabs",
    });
  });

  it("stays platform-only when the lookup knows no careers page", async () => {
    const result = await resolveToOfficialBoard(partial, async () => undefined);
    expect(result.status).toBe("platform-only");
  });

  it("stays platform-only when the careers page is not a known board", async () => {
    const result = await resolveToOfficialBoard(
      partial,
      () => "https://northwind.example.com/careers",
    );
    expect(result).toMatchObject({ status: "platform-only" });
  });

  it("stays platform-only, without throwing, when the lookup fails", async () => {
    const result = await resolveToOfficialBoard(partial, async () => {
      throw new Error("lookup broke");
    });
    expect(result.status).toBe("platform-only");
  });

  it("never opens the platform link: the lookup receives only the company name", async () => {
    const seen: string[] = [];
    await resolveToOfficialBoard(partial, (company) => {
      seen.push(company);
      return undefined;
    });
    expect(seen).toEqual(["Northwind Labs"]);
  });
});

describe("pickMatchingPosting", () => {
  const partial = {
    title: "Backend Engineer",
    company: "Northwind Labs",
    location: "Berlin",
    url: "https://www.linkedin.example.com/comm/jobs/view/1",
    platform: "linkedin" as const,
  };
  const backend = makePosting({ id: "b", title: "Backend Engineer" });
  const frontend = makePosting({ id: "f", title: "Frontend Engineer" });

  it("picks the posting with the same role", () => {
    expect(pickMatchingPosting(partial, [frontend, backend])?.id).toBe("b");
  });

  it("returns nothing when no posting is the same role", () => {
    expect(pickMatchingPosting(partial, [frontend])).toBeUndefined();
  });

  it("returns nothing when two postings are equally close, instead of guessing", () => {
    const twin = makePosting({ id: "b2", title: "Backend Engineer" });
    expect(pickMatchingPosting(partial, [backend, twin])).toBeUndefined();
  });
});
