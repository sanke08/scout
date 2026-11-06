import { describe, expect, it, vi } from "vitest";
import { buildProgram, readVersion } from "./index.js";

describe("scout version", () => {
  it("prints the version from package.json", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    await buildProgram().parseAsync(["node", "scout", "version"]);
    spy.mockRestore();
    expect(lines).toEqual([readVersion()]);
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
