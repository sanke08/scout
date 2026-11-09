import { describe, expect, it } from "vitest";
import { jobNumberFromLink } from "./job-number.js";

describe("jobNumberFromLink", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/4412345", "4412345"],
    ["https://acme.com/careers?gh_jid=998877", "998877"],
    [
      "https://jobs.lever.co/acme/5f0e8c2a-1b2c-4d3e-9f10-aabbccddeeff",
      "5f0e8c2a-1b2c-4d3e-9f10-aabbccddeeff",
    ],
    ["https://jobs.smartrecruiters.com/Acme/743999812345-backend-engineer", "743999812345"],
    ["https://careers.example.com/jobs/view?jobId=REQ-1234", "REQ-1234"],
    ["https://careers.example.com/about", ""],
    ["not a link", ""],
  ])("%s gives %s", (link, expected) => {
    expect(jobNumberFromLink(link)).toBe(expected);
  });
});
