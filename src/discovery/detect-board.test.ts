/** Properties of board detection from careers addresses. */
import { describe, expect, it } from "vitest";
import { detectBoard } from "./detect-board.js";

describe("detectBoard", () => {
  it.each([
    ["https://boards.greenhouse.io/examplecorp", { kind: "greenhouse", token: "examplecorp" }],
    [
      "https://boards.greenhouse.io/examplecorp/jobs/123?gh_src=x",
      { kind: "greenhouse", token: "examplecorp" },
    ],
    ["https://job-boards.greenhouse.io/examplecorp", { kind: "greenhouse", token: "examplecorp" }],
    [
      "https://boards.greenhouse.io/embed/job_board?for=examplecorp",
      { kind: "greenhouse", token: "examplecorp" },
    ],
    [
      "https://boards-api.greenhouse.io/v1/boards/examplecorp/jobs",
      { kind: "greenhouse", token: "examplecorp" },
    ],
    ["https://jobs.lever.co/examplecorp/abc-123", { kind: "lever", token: "examplecorp" }],
    [
      "https://api.lever.co/v0/postings/examplecorp?mode=json",
      { kind: "lever", token: "examplecorp" },
    ],
    ["https://jobs.ashbyhq.com/examplecorp", { kind: "ashby", token: "examplecorp" }],
    [
      "https://api.ashbyhq.com/posting-api/job-board/examplecorp",
      { kind: "ashby", token: "examplecorp" },
    ],
    ["https://apply.workable.com/harbor-systems/", { kind: "workable", token: "harbor-systems" }],
    ["https://harbor-systems.workable.com/", { kind: "workable", token: "harbor-systems" }],
    [
      "https://jobs.smartrecruiters.com/HarborSystems/7440001-data-engineer",
      { kind: "smartrecruiters", token: "HarborSystems" },
    ],
    [
      "https://harbor-systems.recruitee.com/o/backend-developer",
      { kind: "recruitee", token: "harbor-systems" },
    ],
    ["jobs.lever.co/examplecorp", { kind: "lever", token: "examplecorp" }],
    ["https://example.com/jobs.rss", { kind: "feed", token: "https://example.com/jobs.rss" }],
    [
      "https://example.com/careers/feed",
      { kind: "feed", token: "https://example.com/careers/feed" },
    ],
  ])("detects %s", (address, expected) => {
    expect(detectBoard(address)).toEqual(expected);
  });

  it.each([
    "https://example.com/careers",
    "https://www.recruitee.com/",
    "https://boards.greenhouse.io/",
    "ftp://jobs.lever.co/examplecorp",
    "not a url at all",
    "",
  ])("returns undefined for %s", (address) => {
    expect(detectBoard(address)).toBeUndefined();
  });
});
