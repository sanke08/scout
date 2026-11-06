import { describe, expect, it } from "vitest";
import type { Point, ProjectEntry, SkillRow } from "../shared/index.js";
import { orderSkillRows, rankProjects, selectPoints } from "./selection.js";

function point(text: string, allowed: string[] = [], status: Point["status"] = "confirmed"): Point {
  return { text, allowed, variants: [], status };
}

describe("selectPoints", () => {
  const points = [
    point("headline with nothing"),
    point("second", ["kafka"]),
    point("third", ["kafka", "redis"]),
    point("fourth", ["redis"]),
  ];

  it("keeps the first usable point even when later ones match better", () => {
    const chosen = selectPoints(points, 3, ["kafka", "redis"]);
    expect(chosen.map((entry) => entry.storedIndex)).toEqual([0, 1, 2]);
  });

  it("returns the chosen points in stored order", () => {
    const chosen = selectPoints(points, 2, ["redis"]);
    expect(chosen.map((entry) => entry.storedIndex)).toEqual([0, 2]);
  });

  it("never uses held, excluded or ask-first points", () => {
    const mixed = [
      point("held", ["kafka"], "hold"),
      point("excluded", ["kafka"], "excluded"),
      point("ask", ["kafka"], "ask first"),
      point("usable", [], "from code"),
    ];
    const chosen = selectPoints(mixed, 4, ["kafka"]);
    expect(chosen.map((entry) => entry.wording.text)).toEqual(["usable"]);
  });

  it("makes the first usable point the headline when earlier ones are unusable", () => {
    const mixed = [point("held", [], "hold"), point("first usable"), point("later", ["kafka"])];
    const chosen = selectPoints(mixed, 1, ["kafka"]);
    expect(chosen.map((entry) => entry.wording.text)).toEqual(["first usable"]);
  });

  it("gives an empty list when nothing is usable", () => {
    expect(selectPoints([point("x", [], "hold")], 3, [])).toEqual([]);
  });
});

describe("rankProjects", () => {
  function project(title: string, allowed: string[]): ProjectEntry {
    return { title, stack: "", points: [point("p1", allowed), point("p2", allowed)] };
  }

  it("puts the most relevant project first and keeps stored order on ties", () => {
    const ranked = rankProjects([project("A", []), project("B", ["go"]), project("C", [])], 3, [
      "go",
    ]);
    expect(ranked.map((entry) => entry.project.title)).toEqual(["B", "A", "C"]);
  });
});

describe("orderSkillRows", () => {
  const rows: SkillRow[] = [
    { label: "Frontend", items: ["React", "Next.js"] },
    { label: "Data", items: ["PostgreSQL", "Kafka", "Redis"] },
    { label: "Languages", items: ["TypeScript", "Go"] },
  ];

  it("always puts the Languages row first", () => {
    expect(orderSkillRows(rows, ["kafka", "redis"])[0]?.label).toBe("Languages");
  });

  it("orders other rows by matched items and items matched first", () => {
    const ordered = orderSkillRows(rows, ["kafka", "redis"]);
    expect(ordered.map((row) => row.label)).toEqual(["Languages", "Data", "Frontend"]);
    expect(ordered[1]?.items).toEqual(["Kafka", "Redis", "PostgreSQL"]);
  });

  it("keeps the stored order when no keywords are given", () => {
    const ordered = orderSkillRows(rows, []);
    expect(ordered.map((row) => row.label)).toEqual(["Languages", "Frontend", "Data"]);
    expect(ordered[2]?.items).toEqual(["PostgreSQL", "Kafka", "Redis"]);
  });
});
