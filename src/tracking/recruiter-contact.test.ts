import { describe, expect, it } from "vitest";
import {
  buildRecruiterContact,
  chooseContactAddress,
  guessEmail,
  isEmailAddress,
  pickHiringInbox,
  pickProfileUrl,
  pickPublishedEmail,
  type SearchResult,
} from "./recruiter-contact.js";

const goodResult: SearchResult = {
  title: "Sam Okafor - Recruiter - Brightline Talent | LinkedIn",
  snippet: "Recruiter at Brightline Talent. Berlin.",
  url: "https://www.linkedin.com/in/sam-okafor-example",
};

describe("pickProfileUrl", () => {
  it("accepts a profile when the name and the firm both match", () => {
    expect(pickProfileUrl("Sam Okafor", "Brightline Talent", [goodResult])).toBe(goodResult.url);
  });

  it("rejects a same-name person at another firm", () => {
    const other: SearchResult = {
      ...goodResult,
      title: "Sam Okafor - Engineer - Other Corp | LinkedIn",
      snippet: "Engineer at Other Corp.",
    };
    expect(pickProfileUrl("Sam Okafor", "Brightline Talent", [other])).toBeUndefined();
  });

  it("rejects the right firm with a different person", () => {
    const other: SearchResult = {
      ...goodResult,
      title: "Sam Jones - Recruiter - Brightline Talent | LinkedIn",
    };
    expect(pickProfileUrl("Sam Okafor", "Brightline Talent", [other])).toBeUndefined();
  });

  it("rejects results that are not LinkedIn profile pages", () => {
    const wrongPath: SearchResult = {
      ...goodResult,
      url: "https://www.linkedin.com/company/brightline",
    };
    const wrongHost: SearchResult = {
      ...goodResult,
      url: "https://linkedin.com.evil.example.com/in/sam",
    };
    const plainHttp: SearchResult = { ...goodResult, url: "http://www.linkedin.com/in/sam" };
    expect(
      pickProfileUrl("Sam Okafor", "Brightline Talent", [wrongPath, wrongHost, plainHttp]),
    ).toBeUndefined();
  });

  it("returns nothing for no results", () => {
    expect(pickProfileUrl("Sam Okafor", "Brightline Talent", [])).toBeUndefined();
  });
});

describe("email helpers", () => {
  it("accepts a published address only with a source and the person's first and last name", () => {
    const published = {
      address: "sam.okafor@brightline-talent.example.com",
      sourceUrl: "https://brightline-talent.example.com/team",
    };
    expect(pickPublishedEmail("Sam Okafor", [published])).toEqual(published);
    expect(pickPublishedEmail("Sam Okafor", [{ ...published, sourceUrl: "" }])).toBeUndefined();
    expect(
      pickPublishedEmail("Sam Okafor", [
        { ...published, address: "sam@brightline-talent.example.com" },
      ]),
    ).toBeUndefined();
    expect(pickPublishedEmail("Sam", [published])).toBeUndefined();
  });

  it("finds the public hiring inbox only when it has a source", () => {
    const inbox = {
      address: "careers@brightline-talent.example.com",
      sourceUrl: "https://brightline-talent.example.com/contact",
    };
    expect(
      pickHiringInbox([{ address: "info@brightline-talent.example.com", sourceUrl: "x" }, inbox]),
    ).toEqual(inbox);
    expect(pickHiringInbox([{ ...inbox, sourceUrl: " " }])).toBeUndefined();
  });

  it("labels a pattern guess unverified", () => {
    expect(guessEmail("Sam Okafor", "brightline-talent.example.com")).toEqual({
      address: "sam.okafor@brightline-talent.example.com",
      pattern: "first.last",
      label: "unverified",
    });
    expect(guessEmail("Sam", "brightline-talent.example.com")).toBeUndefined();
    expect(guessEmail("Sam Okafor", "")).toBeUndefined();
  });

  it("recognises address shapes", () => {
    expect(isEmailAddress("a@example.com")).toBe(true);
    expect(isEmailAddress("a@example")).toBe(false);
    expect(isEmailAddress("a b@example.com")).toBe(false);
  });
});

describe("buildRecruiterContact and chooseContactAddress", () => {
  const inbox = {
    address: "careers@brightline-talent.example.com",
    sourceUrl: "https://brightline-talent.example.com/contact",
  };
  const base = {
    name: "Sam Okafor",
    firm: "Brightline Talent",
    firmDomain: "brightline-talent.example.com",
  };

  it("prefers a published personal email over the inbox and the guess", () => {
    const published = {
      address: "sam.okafor@brightline-talent.example.com",
      sourceUrl: "https://brightline-talent.example.com/team",
    };
    const contact = buildRecruiterContact({
      ...base,
      searchResults: [goodResult],
      publishedEmails: [published, inbox],
    });
    expect(contact.linkedinUrl).toBe(goodResult.url);
    expect(contact.guessedEmail).toBeUndefined();
    expect(chooseContactAddress(contact)).toEqual({
      address: published.address,
      basis: "published",
    });
  });

  it("falls back to the hiring inbox, then to a labelled guess", () => {
    const withInbox = buildRecruiterContact({
      ...base,
      searchResults: [],
      publishedEmails: [inbox],
    });
    expect(chooseContactAddress(withInbox)).toEqual({
      address: inbox.address,
      basis: "hiring-inbox",
    });
    const guessOnly = buildRecruiterContact({ ...base, searchResults: [], publishedEmails: [] });
    expect(chooseContactAddress(guessOnly)).toEqual({
      address: "sam.okafor@brightline-talent.example.com",
      basis: "guess-unverified",
    });
    expect(guessOnly.guessedEmail?.label).toBe("unverified");
  });

  it("has no address and no profile when nothing is known, and never invents a phone number", () => {
    const contact = buildRecruiterContact({
      name: "Sam Okafor",
      firm: "Brightline Talent",
      searchResults: [],
      publishedEmails: [],
    });
    expect(chooseContactAddress(contact)).toBeUndefined();
    expect(contact.linkedinUrl).toBeUndefined();
    expect(Object.keys(contact).sort()).toEqual(["firm", "name"]);
  });
});
