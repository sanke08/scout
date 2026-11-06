/** Properties of canonical addresses and stable posting ids. */
import { describe, expect, it } from "vitest";
import { canonicalizeUrl, postingIdFromUrl } from "./canonical-url.js";

describe("canonicalizeUrl", () => {
  it("removes tracking parameters and fragments but keeps real parameters", () => {
    const address =
      "https://Boards.Greenhouse.io/examplecorp/jobs/1?utm_source=x&UTM_Medium=y&gh_src=abc&lever-source=z&gh_jid=1#apply";
    expect(canonicalizeUrl(address)).toBe(
      "https://boards.greenhouse.io/examplecorp/jobs/1?gh_jid=1",
    );
  });

  it("sorts remaining parameters and drops a trailing slash", () => {
    expect(canonicalizeUrl("https://jobs.example.com/a/?b=2&a=1")).toBe(
      "https://jobs.example.com/a?a=1&b=2",
    );
  });

  it("rejects addresses that are not http or https", () => {
    expect(() => canonicalizeUrl("not a url")).toThrow(/not a valid web address/);
    expect(() => canonicalizeUrl("ftp://example.com/job")).toThrow(/http or https/);
  });
});

describe("postingIdFromUrl", () => {
  it("is 16 lower-case hex characters and stable across calls", () => {
    const id = postingIdFromUrl("https://jobs.example.com/a");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(postingIdFromUrl("https://jobs.example.com/a")).toBe(id);
  });

  it("ignores tracking parameters and fragments", () => {
    expect(postingIdFromUrl("https://jobs.example.com/a?utm_source=news#top")).toBe(
      postingIdFromUrl("https://jobs.example.com/a"),
    );
  });

  it("differs for different jobs", () => {
    expect(postingIdFromUrl("https://jobs.example.com/a")).not.toBe(
      postingIdFromUrl("https://jobs.example.com/b"),
    );
  });
});
