/** Properties of remote type and seniority detection. */
import { describe, expect, it } from "vitest";
import { detectRemote, detectSeniority } from "./classify.js";

describe("detectRemote", () => {
  it("trusts the employer's own hint first", () => {
    expect(detectRemote("Berlin", "Engineer", "", "remote")).toBe("remote");
    expect(detectRemote("Remote", "Engineer", "", "hybrid")).toBe("hybrid");
  });

  it("reads the location and title", () => {
    expect(detectRemote("Remote - Europe", "Engineer", "")).toBe("remote");
    expect(detectRemote("Berlin (Hybrid)", "Engineer", "")).toBe("hybrid");
    expect(detectRemote("Berlin", "Engineer (On-site)", "")).toBe("onsite");
  });

  it("reads clear phrases in the description but not passing mentions", () => {
    expect(detectRemote("Berlin", "Engineer", "This is a remote position.")).toBe("remote");
    expect(detectRemote("Berlin", "Engineer", "You will support remote teams.")).toBe("unknown");
    expect(detectRemote("Berlin", "Engineer", "Hybrid, three days in the office.")).toBe("hybrid");
  });

  it("says unknown when nothing is said", () => {
    expect(detectRemote("Berlin", "Engineer", "Build things.")).toBe("unknown");
  });
});

describe("detectSeniority", () => {
  it.each([
    ["Software Engineering Intern", "intern"],
    ["Senior Backend Engineer", "senior"],
    ["Sr. Backend Engineer", "senior"],
    ["Staff Platform Engineer", "lead"],
    ["Lead Data Engineer", "lead"],
    ["Junior QA Engineer", "junior"],
    ["Software Engineer II", "mid"],
    ["Product Manager", "unknown"],
    ["Software Engineer", "unknown"],
  ])("reads %s as %s", (title, expected) => {
    expect(detectSeniority(title)).toBe(expected);
  });
});
