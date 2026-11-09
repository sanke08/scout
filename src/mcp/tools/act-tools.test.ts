/**
 * Tests of the acting tool list as a whole: names, manuals, read-only flags and that no tool leaks
 * a secret or throws past its handler.
 */
import { afterEach, describe, expect, it } from "vitest";
import { actTools, createActTools } from "./act-tools.js";
import { errorOf, makeActWorld, type ActWorld } from "./act-test-helpers.js";

const worlds: ActWorld[] = [];
afterEach(() => {
  while (worlds.length > 0) worlds.pop()?.remove();
});

/** The tools the engineer owns. */
const EXPECTED = [
  "build_resume",
  "get_form",
  "apply_to_job",
  "add_application",
  "update_application_status",
  "log_application_event",
  "set_application_details",
  "find_applications",
  "get_application",
  "read_inbox",
  "write_note",
];

describe("the acting tools", () => {
  it("offer exactly the documented tools, with unique snake_case names and real manuals", () => {
    const names = actTools.map((tool) => tool.name);
    expect(names).toEqual(EXPECTED);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of actTools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(120);
    }
  });

  it("mark only the tools that never change anything as read-only", () => {
    const readOnly = actTools.filter((tool) => tool.readOnly).map((tool) => tool.name);
    expect(readOnly.sort()).toEqual([
      "find_applications",
      "get_application",
      "get_form",
      "read_inbox",
    ]);
  });

  it("turn a failure inside a handler into an error result instead of throwing", async () => {
    const made = makeActWorld({ downloadFails: true });
    worlds.push(made);
    const tools = createActTools({
      apply: {
        readFormPage: async () => {
          throw new Error("secret-path /Users/x");
        },
      },
    });
    const getForm = tools.find((tool) => tool.name === "get_form")!;
    const result = await getForm.handler(getForm.inputSchema.parse({ jobId: "job-1" }), {
      application: made.application,
      assertNotPaused: () => made.application.assertNotPaused(),
      note: () => {},
    });
    expect(errorOf(result)).not.toContain("secret-path");
  });
});
