import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import {
  createProcessCommandRunner,
  type CommandResult,
  type CommandRunner,
} from "./command-runner.js";
import { createCredentialVault } from "./credential-vault.js";
import { FAKE_PASSWORD } from "./test-helpers.js";

/** One call the fake runner saw. */
interface Call {
  mode: "interactive" | "captured";
  command: string;
  args: string[];
}

/** A runner that records calls and answers with `answer`; no program is ever started. */
function fakeRunner(answer: Partial<CommandResult> = {}): { runner: CommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const result: CommandResult = { toolMissing: false, exitCode: 0, output: "", ...answer };
  return {
    calls,
    runner: {
      async interactive(command, args) {
        calls.push({ mode: "interactive", command, args: [...args] });
        return { ...result, output: "" };
      },
      async captured(command, args) {
        calls.push({ mode: "captured", command, args: [...args] });
        return result;
      },
    },
  };
}

describe("saving", () => {
  it("on macOS runs the keychain program on the user's terminal, with no password anywhere in the command", async () => {
    const { runner, calls } = fakeRunner();
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    await vault.save("linkedin", "alex@example.com");
    expect(calls).toEqual([
      {
        mode: "interactive",
        command: "security",
        args: [
          "add-generic-password",
          "-U",
          "-s",
          "scout-platform-linkedin",
          "-a",
          "alex@example.com",
        ],
      },
    ]);
    expect(calls[0]?.args).not.toContain("-w");
    expect(calls[0]?.args).not.toContain("-p");
  });

  it("on Linux uses the secret service and again lets the program ask for the password", async () => {
    const { runner, calls } = fakeRunner();
    await createCredentialVault({ runner, operatingSystem: "linux" }).save(
      "indeed",
      "alex@example.com",
    );
    expect(calls[0]?.mode).toBe("interactive");
    expect(calls[0]?.command).toBe("secret-tool");
    expect(calls[0]?.args[0]).toBe("store");
  });

  it("says credentials cannot be saved here, and that manual sign-in works, on any other system", async () => {
    const { runner, calls } = fakeRunner();
    const vault = createCredentialVault({ runner, operatingSystem: "win32" });
    expect(vault.isSupported()).toBe(false);
    await expect(vault.save("linkedin", "alex@example.com")).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringMatching(/cannot be saved.*Manual sign-in still works/s),
    });
    expect(await vault.exists("linkedin", "alex@example.com")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("says the same when the keychain program is not installed", async () => {
    const { runner } = fakeRunner({ toolMissing: true, exitCode: -1 });
    const vault = createCredentialVault({ runner, operatingSystem: "linux" });
    await expect(vault.save("linkedin", "alex@example.com")).rejects.toThrow(
      /Manual sign-in still works/,
    );
  });

  it("reports a failed save without claiming it worked", async () => {
    const { runner } = fakeRunner({ exitCode: 1 });
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    await expect(vault.save("linkedin", "alex@example.com")).rejects.toThrow(/nothing was saved/);
  });

  it("refuses a platform or username that could change the command", async () => {
    const { runner, calls } = fakeRunner();
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    await expect(vault.save("linkedin; rm -rf", "alex@example.com")).rejects.toBeInstanceOf(
      ScoutError,
    );
    await expect(vault.save("linkedin", "alex\n@example.com")).rejects.toBeInstanceOf(ScoutError);
    await expect(vault.save("linkedin", "   ")).rejects.toBeInstanceOf(ScoutError);
    expect(calls).toEqual([]);
  });
});

describe("reading", () => {
  it("captures the password in memory with the macOS read command and drops the line break", async () => {
    const { runner, calls } = fakeRunner({ output: `${FAKE_PASSWORD}\n` });
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    expect(await vault.read("linkedin", "alex@example.com")).toEqual({
      username: "alex@example.com",
      password: FAKE_PASSWORD,
    });
    expect(calls[0]).toEqual({
      mode: "captured",
      command: "security",
      args: [
        "find-generic-password",
        "-s",
        "scout-platform-linkedin",
        "-a",
        "alex@example.com",
        "-w",
      ],
    });
  });

  it("checks existence on macOS without asking the program to print the password", async () => {
    const { runner, calls } = fakeRunner({ output: "" });
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    expect(await vault.exists("linkedin", "alex@example.com")).toBe(true);
    expect(calls[0]?.args).not.toContain("-w");
    expect(calls[0]?.args).not.toContain("-g");
  });

  it("answers undefined for an item that is not there", async () => {
    const { runner } = fakeRunner({ exitCode: 44 });
    const vault = createCredentialVault({ runner, operatingSystem: "darwin" });
    expect(await vault.read("linkedin", "alex@example.com")).toBeUndefined();
    expect(await vault.exists("linkedin", "alex@example.com")).toBe(false);
  });
});

describe("forgetting", () => {
  it("deletes the keychain item and says whether one was there", async () => {
    const found = fakeRunner();
    expect(
      await createCredentialVault({ runner: found.runner, operatingSystem: "darwin" }).forget(
        "linkedin",
        "alex@example.com",
      ),
    ).toBe(true);
    expect(found.calls[0]?.args[0]).toBe("delete-generic-password");
    const missing = fakeRunner({ exitCode: 44 });
    expect(
      await createCredentialVault({ runner: missing.runner, operatingSystem: "darwin" }).forget(
        "linkedin",
      ),
    ).toBe(false);
  });
});

describe("the real runner", () => {
  it("reports a program that does not exist as missing instead of crashing", async () => {
    const runner = createProcessCommandRunner();
    const result = await runner.captured("scout-no-such-program-example", []);
    expect(result.toolMissing).toBe(true);
  });
});
