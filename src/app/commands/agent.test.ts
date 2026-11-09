/** Tests for `scout agent` with a fake `claude`: goals, run, status and the refusal to start without goals. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantToolUse,
  fakeClaude,
  successResult,
  type FakeClaudeScript,
} from "../../agent/fake-claude.js";
import { registerAgent } from "./agent.js";

let directory: string;
let printed: string[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "scout-agent-cli-"));
  printed = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    printed.push(parts.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

/** Runs `scout <words>` through the agent commands with a fake `claude`. */
async function run(words: string[], script: FakeClaudeScript = { lines: [] }): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerAgent(
    program,
    { directory },
    { spawner: fakeClaude(script).spawner, mcpLaunch: { command: "node", args: ["x", "mcp"] } },
  );
  await program.parseAsync(["node", "scout", ...words]);
}

describe("scout agent", () => {
  it("shows the starter goals, saves new ones from text or a file, and shows them back", async () => {
    await run(["agent", "goals"]);
    expect(printed.join("\n")).toContain("starter goals");
    await run(["agent", "goals", "--set", "Platform roles in Berlin."]);
    const file = join(directory, "mine.txt");
    writeFileSync(file, "Backend roles, remote.");
    await run(["agent", "goals", "--edit", file]);
    printed.length = 0;
    await run(["agent", "goals"]);
    expect(printed.join("\n")).toContain("Backend roles, remote.");
    expect(printed.join("\n")).not.toContain("starter goals");
  });

  it("refuses to run before goals are written, with a message that says what to do", async () => {
    await expect(run(["agent", "run", "hunt"])).rejects.toThrowError(/goals first/i);
  });

  it("refuses a custom run without an instruction and an unknown kind of run", async () => {
    await run(["agent", "goals", "--set", "Backend roles."]);
    await expect(run(["agent", "run", "custom"])).rejects.toThrowError(/instruction/);
    await expect(run(["agent", "run", "dance"])).rejects.toThrowError(/not a kind of run/);
  });

  it("prints the live log, the result, and remembers it for `status`", async () => {
    await run(["agent", "goals", "--set", "Backend roles."]);
    await run(["agent", "run"], {
      lines: [assistantToolUse("get_profile"), successResult("Nothing new today.")],
    });
    expect(printed.join("\n")).toContain("tool: get_profile");
    expect(printed.join("\n")).toContain("Nothing new today.");
    printed.length = 0;
    await run(["agent", "status"]);
    expect(printed.join("\n")).toContain("hunt, done");
  });

  it("fails with a non-zero error when the run fails", async () => {
    await run(["agent", "goals", "--set", "Backend roles."]);
    await expect(
      run(["agent", "run", "inbox"], { lines: [], cannotStart: "claude was not found" }),
    ).rejects.toMatchObject({ exitCode: 6 });
  });
});
