/** Properties of skill extraction from the built-in vocabulary. */
import { describe, expect, it } from "vitest";
import { extractSkills } from "./skills.js";

describe("extractSkills", () => {
  it("returns canonical names in order of appearance, each once", () => {
    expect(extractSkills("We use NodeJS, TypeScript and Postgres. More Node.js later.")).toEqual([
      "Node.js",
      "TypeScript",
      "PostgreSQL",
    ]);
  });

  it("does not find Java inside JavaScript", () => {
    expect(extractSkills("We write JavaScript every day")).toEqual(["JavaScript"]);
  });

  it("finds names with symbols", () => {
    expect(extractSkills("C++, C# and .NET")).toEqual(["C++", "C#", ".NET"]);
  });

  it("only reports what the text names", () => {
    expect(extractSkills("We value kindness and curiosity.")).toEqual([]);
  });
});
