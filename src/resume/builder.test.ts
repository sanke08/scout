import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { profileSchema } from "../shared/index.js";
import type { Point, Profile, ProjectEntry } from "../shared/index.js";
import { createResumeBuilder } from "./builder.js";
import { LATEX_PREAMBLE } from "./preamble.js";

function loadProfile(fileName: string): Profile {
  const url = new URL(`../../fixtures/${fileName}`, import.meta.url);
  return profileSchema.parse(JSON.parse(readFileSync(url, "utf8")));
}

const sample = loadProfile("profile.sample.json");
const large = loadProfile("resume/large-profile.json");
const builder = createResumeBuilder();

function point(text: string, allowed: string[] = [], status: Point["status"] = "from code"): Point {
  return { text, allowed, variants: [], status };
}

function project(title: string, pointCount: number, text = "Built a small tool."): ProjectEntry {
  const points = Array.from({ length: pointCount }, (_, index) => point(`${text} Part ${index}.`));
  return { title, stack: "Go", points };
}

describe("build", () => {
  it("is deterministic", () => {
    const keywords = ["TypeScript", "Redis", "Kubernetes"];
    expect(builder.build(sample, keywords, { company: "Example Corp" })).toEqual(
      builder.build(sample, keywords, { company: "Example Corp" }),
    );
  });

  it("starts with the fixed preamble and ends with the end of the document", () => {
    const { texSource } = builder.build(sample, ["go"]);
    expect(texSource.startsWith(`${LATEX_PREAMBLE}\n`)).toBe(true);
    expect(texSource.endsWith("\\end{document}\n")).toBe(true);
    expect(texSource.split("\\begin{document}")).toHaveLength(2);
  });

  it("never adds a keyword the profile does not hold", () => {
    const result = builder.build(sample, ["Kubernetes", "Kafka"]);
    expect(result.texSource.toLowerCase()).not.toContain("kubernetes");
    expect(result.notInProfile).toEqual(["kubernetes"]);
    expect(result.matchedKeywords).toEqual(["kafka"]);
  });

  it("never uses held, excluded or ask-first points, nor lets them support a keyword", () => {
    const profile: Profile = {
      ...sample,
      experience: [
        {
          title: "Engineer",
          org: "Org",
          dates: "2023",
          place: "Berlin",
          points: [
            point("First usable point.", [], "confirmed"),
            point("HELD-TEXT with Zookeeper.", ["zookeeper"], "hold"),
            point("EXCLUDED-TEXT with Zookeeper.", ["zookeeper"], "excluded"),
            point("ASK-TEXT with Zookeeper.", ["zookeeper"], "ask first"),
          ],
        },
      ],
    };
    const result = builder.build(profile, ["zookeeper"]);
    for (const hidden of ["HELD-TEXT", "EXCLUDED-TEXT", "ASK-TEXT"]) {
      expect(result.texSource).not.toContain(hidden);
    }
    expect(result.notInProfile).toEqual(["zookeeper"]);
  });

  it("uses the stored wording when there are no keywords", () => {
    const { texSource } = builder.build(sample, []);
    expect(texSource).toContain(sample.summary.text);
    expect(texSource).toContain(
      "Built the booking flow for a travel platform used by partner hotels, as one",
    );
    expect(texSource).not.toContain("with React, Node.js and REST APIs");
  });

  it("uses an alternate wording when the job keywords match its keys", () => {
    const { texSource } = builder.build(sample, ["REST APIs", "Node.js"]);
    expect(texSource).toContain("with React, Node.js and REST APIs");
  });

  it("puts the Languages row first whatever the keywords", () => {
    const { texSource } = builder.build(sample, ["kafka", "redis"]);
    const languages = texSource.indexOf("\\textbf{Languages}");
    const data = texSource.indexOf("\\textbf{Data \\& Messaging}");
    expect(languages).toBeGreaterThan(-1);
    expect(data).toBeGreaterThan(languages);
    expect(texSource.indexOf("\\textbf{Frontend}")).toBeGreaterThan(data);
  });

  it("keeps jobs in stored order and drops none", () => {
    const { texSource } = builder.build(large, ["playwright"]);
    const positions = ["Software Engineer", "Web Developer Intern", "Junior Web Developer"].map(
      (title) => texSource.indexOf(`{${title}}`),
    );
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("shows at most four points per job and keeps each job's headline", () => {
    const { texSource } = builder.build(large, ["observability"]);
    expect(texSource).toContain("Built the booking flow");
    const jobSection = texSource.slice(
      texSource.indexOf("\\section{Experience}"),
      texSource.indexOf("\\section{Projects}"),
    );
    const firstJobBullets = jobSection
      .split("\\resumeSubheading")[1]
      ?.split("\\resumeItem{").length;
    expect((firstJobBullets ?? 0) - 1).toBeLessThanOrEqual(4);
  });

  it("ranks the most relevant project first", () => {
    const result = builder.build(sample, ["rate limiting", "circuit breaker"]);
    expect(result.projectsShown[0]).toBe("Rate-Limited Gateway");
  });

  it("builds the file stem from the name and the company", () => {
    expect(builder.build(sample, [], { company: "Example Corp." }).fileStem).toBe(
      "Alex_Rivera_ExampleCorp",
    );
    expect(builder.build(sample, []).fileStem).toBe("Alex_Rivera_Company");
    expect(builder.build(sample, [], { company: "!!!" }).fileStem).toBe("Alex_Rivera_Company");
  });

  it("reports the line limit and an estimate that fits for the sample", () => {
    const result = builder.build(sample, ["go"]);
    expect(result.lineLimit).toBe(76.5);
    expect(result.estimatedLines).toBeLessThanOrEqual(result.lineLimit);
  });
});

describe("page fit", () => {
  it("works with fewer than three projects", () => {
    const profile: Profile = { ...sample, projects: sample.projects.slice(0, 2) };
    const result = builder.build(profile, []);
    expect(result.projectsShown).toHaveLength(2);
    expect(result.projectsLeftOut).toEqual([]);
  });

  it("works with no projects and still gives a complete document", () => {
    const result = builder.build({ ...sample, projects: [] }, []);
    expect(result.projectsShown).toEqual([]);
    expect(result.texSource).not.toContain("\\section{Projects}");
    expect(result.texSource).toContain("\\section{Education}");
  });

  it("works with empty experience and leaves no empty list behind", () => {
    const result = builder.build({ ...sample, experience: [] }, ["go"]);
    expect(result.texSource).not.toContain("\\section{Experience}");
    expect(result.texSource).toContain("\\section{Projects}");
  });

  it("leaves out the item list of an entry with no usable point", () => {
    const profile: Profile = {
      ...sample,
      experience: [
        { title: "T", org: "O", dates: "D", place: "P", points: [point("h", [], "hold")] },
      ],
    };
    const source = builder.build(profile, []).texSource;
    expect(source).toContain("{T}{D}");
    const experience = source.slice(
      source.indexOf("\\section{Experience}"),
      source.indexOf("\\section{Projects}"),
    );
    expect(experience).not.toContain("\\resumeItemListStart");
  });

  it("shows between three and five projects and keeps every shown estimate within the limit", () => {
    const profile: Profile = {
      ...sample,
      projects: ["A", "B", "C", "D", "E", "F"].map((title) => project(title, 3)),
    };
    const result = builder.build(profile, []);
    expect(result.projectsShown.length).toBeGreaterThanOrEqual(3);
    expect(result.projectsShown.length).toBeLessThanOrEqual(5);
    expect(result.projectsShown.length + result.projectsLeftOut.length).toBe(6);
    if (result.projectsShown.length > 3) {
      expect(result.estimatedLines).toBeLessThanOrEqual(result.lineLimit);
    }
  });

  it("shows five projects when the page has room", () => {
    const profile: Profile = {
      ...sample,
      projects: ["A", "B", "C", "D", "E", "F"].map((title) => project(title, 1)),
    };
    expect(builder.build(profile, []).projectsShown).toHaveLength(5);
  });

  it("leaves projects out when the page is full, but always shows three", () => {
    const longText = "Built a long and detailed description of work that fills lines. ".repeat(4);
    const profile: Profile = {
      ...sample,
      projects: ["A", "B", "C", "D", "E"].map((title) => project(title, 3, longText)),
    };
    const result = builder.build(profile, []);
    expect(result.projectsShown.length).toBeGreaterThanOrEqual(3);
    expect(result.projectsLeftOut.length).toBeGreaterThan(0);
  });
});

describe("LaTeX output", () => {
  it("escapes every special character in profile text", () => {
    const profile: Profile = {
      ...sample,
      identity: { ...sample.identity, name: "Alex & Co_Rivera" },
      summary: { text: "100% of #1 {x} ~ ^ $ \\ \u2013 \u2014 \u201Cq\u201D", variants: [] },
    };
    const { texSource } = builder.build(profile, []);
    expect(texSource).toContain("Alex \\& Co\\_Rivera");
    expect(texSource).toContain(
      '100\\% of \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{} \\$ \\textbackslash{} -- --- "q"',
    );
  });

  it("drops missing contact fields together with their separators", () => {
    const profile: Profile = {
      ...sample,
      identity: { name: "Alex Rivera", location: "Berlin", email: "a_b@example.com" },
    };
    const { texSource } = builder.build(profile, []);
    expect(texSource).toContain("\\small Berlin $|$ \\href{mailto:a_b@example.com}");
    const heading = texSource.slice(0, texSource.indexOf("\\end{center}"));
    expect(heading).not.toContain("github");
    expect(heading).not.toMatch(/\$\|\$\s*\\\\/);
  });

  it("shows links without protocol or www and keeps the real address", () => {
    const { texSource } = builder.build(sample, []);
    expect(texSource).toContain(
      "\\href{https://www.linkedin.com/in/example-alex}{\\textcolor{blue}{linkedin.com/in/example-alex}}",
    );
    expect(texSource).toContain("\\href{https://github.com/example-alex}");
  });

  it("escapes percent and hash in project links", () => {
    const profile: Profile = {
      ...sample,
      projects: [{ ...project("P", 1), link: "example.com/a%20b#c" }],
    };
    expect(builder.build(profile, []).texSource).toContain("https://example.com/a\\%20b\\#c");
  });
});
