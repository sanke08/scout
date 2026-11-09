/**
 * Test of the real spawner's stop: a stop reaches the command AND the programs it started (the
 * tool server runs as the command's child), because the command runs in its own process group.
 * Uses `node` itself as a stand-in for `claude`: no real model, network or account.
 */
import { describe, expect, it } from "vitest";
import { spawnAgentProcess } from "./agent-process.js";

/** True while `processId` is a running process. */
function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

describe("spawnAgentProcess", () => {
  it("stops the command and the program it started, not only the command", async () => {
    // The stand-in starts a child that sleeps, prints its process id, then waits.
    const script = [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });',
      "console.log(child.pid);",
      "setTimeout(() => {}, 60000);",
    ].join("\n");
    const lines: string[] = [];
    const running = spawnAgentProcess({
      command: process.execPath,
      args: ["-e", script],
      input: "",
      onLine: (line) => lines.push(line),
    });
    for (let tries = 0; tries < 200 && lines.length === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const grandchild = Number(lines[0]);
    expect(Number.isInteger(grandchild)).toBe(true);
    expect(isRunning(grandchild)).toBe(true);

    running.kill();
    await running.exited;
    for (let tries = 0; tries < 100 && isRunning(grandchild); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(isRunning(grandchild)).toBe(false);
  }, 15_000);

  it("reports a command that is not found as a failed start", async () => {
    const running = spawnAgentProcess({
      command: "scout-no-such-command",
      args: [],
      input: "",
      onLine: () => {},
    });
    const exit = await running.exited;
    expect(exit.exitCode).toBe(-1);
    expect(exit.errorText).toMatch(/not found/);
  });
});
