import { describe, expect, it } from "vitest";
import { authoredByUser, parseCommitLine } from "./authored-commits.js";

/** Builds one log line in the documented tab-separated format. */
function line(hash: string, name: string, email: string, subject: string): string {
  return [hash, name, email, subject].join("\t");
}

const lines = [
  line("a1", "Alex Rivera", "alex.rivera@example.com", "Add booking retries"),
  line("b2", "Sam Lee", "sam.lee@example.com", "Rewrite the payment module"),
  line("c3", "A. Rivera", "alex.personal@example.com", "Fix typo"),
  line("d4", "Alex Rivera", "someone.else@example.com", "A different Alex Rivera"),
  "",
  "not a log line",
  line("e5", "Alex Rivera", "ALEX.RIVERA@EXAMPLE.COM", "Subject\twith a tab"),
];

describe("authoredByUser", () => {
  it("returns only the commits written by the user's identities", () => {
    const authored = authoredByUser(lines, [
      { name: "Alex Rivera", email: "alex.rivera@example.com" },
      { email: "alex.personal@example.com" },
    ]);
    expect(authored.map((commit) => commit.hash)).toEqual(["a1", "c3", "e5"]);
  });

  it("never returns a teammate's commit", () => {
    const authored = authoredByUser(lines, [
      { name: "Alex Rivera", email: "alex.rivera@example.com" },
    ]);
    expect(authored.map((commit) => commit.authorName)).not.toContain("Sam Lee");
    expect(authored.map((commit) => commit.hash)).not.toContain("d4");
  });

  it("matches by name only when the identity has no email", () => {
    const authored = authoredByUser(lines, [{ name: "alex  rivera" }]);
    expect(authored.map((commit) => commit.hash)).toEqual(["a1", "d4", "e5"]);
  });

  it("returns nothing for an identity with neither name nor email, and for no identities", () => {
    expect(authoredByUser(lines, [{}, { name: " ", email: "" }])).toEqual([]);
    expect(authoredByUser(lines, [])).toEqual([]);
  });

  it("ignores blank and malformed lines instead of counting them", () => {
    expect(parseCommitLine("")).toBeUndefined();
    expect(parseCommitLine("not a log line")).toBeUndefined();
    expect(parseCommitLine("a1\tAlex\talex@example.com")).toBeUndefined();
    expect(parseCommitLine("a1\tAlex\t<alex@example.com>\tHello")?.authorEmail).toBe(
      "alex@example.com",
    );
  });

  it("keeps a subject that itself contains tabs", () => {
    const commit = authoredByUser(lines, [{ email: "alex.rivera@example.com" }]).find(
      (candidate) => candidate.hash === "e5",
    );
    expect(commit?.subject).toBe("Subject\twith a tab");
  });
});
