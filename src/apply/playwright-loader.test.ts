import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lazy loading of the real browser driver", () => {
  it("only playwright-driver.ts mentions playwright-core, and the loader reaches it by dynamic import", () => {
    const folder = new URL("./", import.meta.url);
    const sources = readdirSync(folder).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    for (const name of sources) {
      const text = readFileSync(new URL(name, folder), "utf8");
      const importsPlaywright = /from "playwright-core"|import\("playwright-core"\)/.test(text);
      expect(importsPlaywright).toBe(name === "playwright-driver.ts");
      expect(text).not.toMatch(/^import (?!type).*from "\.\/playwright-driver\.js"/m);
    }
    const loader = readFileSync(new URL("playwright-loader.ts", folder), "utf8");
    expect(loader).toContain('await import("./playwright-driver.js")');
  });
});
