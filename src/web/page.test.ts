/**
 * Tests of the page's own code without a browser: a tiny fake `document` stands in for the real
 * one, so the same modules the browser loads run here. They state the properties that matter:
 * text from the server is never parsed as markup, matched keywords are highlighted, the LaTeX
 * preview reads back structure, the allow-list matches the folder, and Digest keys call the API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATIC_FILES } from "./static-files.js";

/** A stand-in for one DOM node: just enough tree, attribute and event behaviour for the page code. */
class FakeNode {
  tagName = "";
  children: FakeNode[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, ((event: unknown) => void)[]>();
  className = "";
  value = "";
  checked = false;
  selected = false;
  hidden = false;
  private ownText = "";

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text: string) {
    this.children = [];
    this.ownText = text;
  }
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    this.children = this.children.filter((existing) => existing !== child);
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener({ target: this });
  }
  querySelector(selector: string): FakeNode | null {
    const wanted = /^\[([a-z-]+)="([^"]+)"\]$/.exec(selector);
    if (!wanted) return null;
    return this.findAll((node) => node.attributes.get(wanted[1] ?? "") === wanted[2])[0] ?? null;
  }
  findAll(test: (node: FakeNode) => boolean): FakeNode[] {
    const found: FakeNode[] = test(this) ? [this] : [];
    for (const child of this.children) found.push(...child.findAll(test));
    return found;
  }
  /** Every element of the tree, text nodes excluded. */
  get elements(): FakeNode[] {
    return this.findAll((node) => node.tagName !== "#text");
  }
}

/** Fake text node: remembers its text and is never parsed. */
class FakeText extends FakeNode {
  constructor(text: string) {
    super();
    this.tagName = "#text";
    this.textContent = text;
  }
}

/** Removes block and line comments, so a comment that mentions a banned word is not a use of it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Installs the fake `document` the page modules expect. */
function installFakeDocument(): void {
  const fake = {
    createElement: (tag: string): FakeNode => {
      const node = new FakeNode();
      node.tagName = tag;
      return node;
    },
    createTextNode: (text: string): FakeNode => new FakeText(text),
  };
  (globalThis as unknown as { document: unknown }).document = fake;
}

/** Loads one of the page's modules the way the browser would: as an ES module from its file. */
async function loadModule<Shape>(name: string): Promise<Shape> {
  return (await import(new URL(`./public/${name}`, import.meta.url).href)) as Shape;
}

interface DomModule {
  h: (tag: string, attributes?: Record<string, unknown>, ...children: unknown[]) => FakeNode;
  safeHttpUrl: (value: string) => string | null;
  splitTerms: (text: string) => string[];
}
interface HighlightModule {
  splitByKeywords: (text: string, keywords: string[]) => { text: string; match: boolean }[];
  highlightedNodes: (text: string, keywords: string[]) => (string | FakeNode)[];
}
interface TexModule {
  texToLines: (tex: string) => { kind: string; text: string; aside?: string }[];
}

beforeEach(installFakeDocument);
afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("page files", () => {
  it("lists exactly the files that are in public/", () => {
    const inFolder = readdirSync(new URL("./public/", import.meta.url)).sort();
    const listed = [...new Set(STATIC_FILES.map((file) => file.fileName))].sort();
    expect(listed).toEqual(inFolder);
  });

  it("never writes server text as markup", () => {
    const folder = new URL("./public/", import.meta.url);
    for (const name of readdirSync(folder).filter((file) => file.endsWith(".js"))) {
      const code = withoutComments(readFileSync(new URL(name, folder), "utf8"));
      expect(code, name).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,
      );
    }
  });
});

describe("dom helpers", () => {
  it("shows markup-looking text as plain text and creates no element from it", async () => {
    const { h } = await loadModule<DomModule>("dom.js");
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const paragraph = h("p", { class: "title" }, hostile);
    expect(paragraph.children).toHaveLength(1);
    expect(paragraph.children[0]?.tagName).toBe("#text");
    expect(paragraph.textContent).toBe(hostile);
    const viaText = h("span", { text: hostile });
    expect(viaText.children).toHaveLength(0);
    expect(viaText.textContent).toBe(hostile);
    expect(paragraph.elements.map((node) => node.tagName)).toEqual(["p"]);
  });

  it("skips empty children and flattens lists", async () => {
    const { h } = await loadModule<DomModule>("dom.js");
    const list = h("ul", {}, [h("li", {}, "a"), null, false], undefined, "b");
    expect(list.children.map((child) => child.textContent)).toEqual(["a", "b"]);
  });

  it("makes links only from http and https addresses", async () => {
    const { safeHttpUrl } = await loadModule<DomModule>("dom.js");
    expect(safeHttpUrl("https://example.com/job")).toBe("https://example.com/job");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });

  it("splits typed terms on commas and line breaks", async () => {
    const { splitTerms } = await loadModule<DomModule>("dom.js");
    expect(splitTerms(" Node.js, Kafka\n\nGo ,")).toEqual(["Node.js", "Kafka", "Go"]);
  });
});

describe("keyword highlighting", () => {
  it("marks whole-word, case-insensitive matches and keeps all the text", async () => {
    const { splitByKeywords } = await loadModule<HighlightModule>("highlight.js");
    const pieces = splitByKeywords("Built node.js APIs with Go, not Gopher", ["Node.js", "Go"]);
    expect(pieces.filter((piece) => piece.match).map((piece) => piece.text)).toEqual([
      "node.js",
      "Go",
    ]);
    expect(pieces.map((piece) => piece.text).join("")).toBe(
      "Built node.js APIs with Go, not Gopher",
    );
  });

  it("treats keywords as literal text, not patterns", async () => {
    const { splitByKeywords } = await loadModule<HighlightModule>("highlight.js");
    expect(
      splitByKeywords("Wrote C++ and C#", ["C++", "C#"]).filter((piece) => piece.match),
    ).toHaveLength(2);
    expect(() => splitByKeywords("text", ["(", "[a-"])).not.toThrow();
  });

  it("returns the text whole when there is nothing to mark", async () => {
    const { splitByKeywords, highlightedNodes } = await loadModule<HighlightModule>("highlight.js");
    expect(splitByKeywords("plain", [])).toEqual([{ text: "plain", match: false }]);
    expect(splitByKeywords("", ["x"])).toEqual([]);
    const nodes = highlightedNodes("Used Kafka daily", ["Kafka"]);
    expect(nodes).toHaveLength(3);
    expect((nodes[1] as FakeNode).tagName).toBe("mark");
  });
});

describe("resume preview from LaTeX", () => {
  const tex = String.raw`\documentclass{article}
\newcommand{\resumeItem}[1]{\item #1}
\begin{document}
\begin{center}
  {\Huge \scshape Alex Rivera} \\ \vspace{4pt}
  \small Berlin, Germany $|$ \href{mailto:alex.rivera@example.com}{\textcolor{blue}{alex.rivera@example.com}} \\
\end{center}
\section{Summary}
\small{Engineer at R\&D, 50\% faster.}
\section{Experience}
\resumeSubHeadingListStart
\resumeSubheading
{Software Engineer}{Jul 2023 -- Present}
{Harbor Systems}{Berlin, Germany}
\resumeItemListStart
\resumeItem{Built \textbf{booking} flow for 4 engineers % a comment
}
\resumeItem{Used C\# and snake\_case and a back\textbackslash{}slash.}
\resumeItemListEnd
\section{Projects}
\resumeProjectHeading
{\textbf{Team Chat} $|$ \emph{Next.js}}{}
\end{document}
`;

  it("reads sections, entries, bullets and header lines and drops layout commands", async () => {
    const { texToLines } = await loadModule<TexModule>("tex-preview.js");
    const lines = texToLines(tex);
    expect(lines.map((line) => line.kind)).toEqual([
      "text",
      "text",
      "heading",
      "text",
      "heading",
      "entry",
      "entry",
      "bullet",
      "bullet",
      "heading",
      "entry",
    ]);
    expect(lines[0]?.text).toBe("Alex Rivera");
    expect(lines[1]?.text).toBe("Berlin, Germany | alex.rivera@example.com");
    expect(lines[3]?.text).toBe("Engineer at R&D, 50% faster.");
    expect(lines[5]).toMatchObject({ text: "Software Engineer", aside: "Jul 2023 -- Present" });
    expect(lines[7]?.text).toBe("Built booking flow for 4 engineers");
    expect(lines[8]?.text).toBe("Used C# and snake_case and a back\\slash.");
    expect(lines[10]?.text).toBe("Team Chat | Next.js");
    const everything = lines.map((line) => line.text).join(" ");
    expect(everything).not.toMatch(/documentclass|newcommand|a comment|resumeItem/);
  });

  it("reads a source with no document markers and an unbalanced group without failing", async () => {
    const { texToLines } = await loadModule<TexModule>("tex-preview.js");
    expect(texToLines("\\section{Only}")).toEqual([{ kind: "heading", text: "Only" }]);
    expect(() => texToLines("\\resumeItem{never closed")).not.toThrow();
    expect(texToLines("")).toEqual([]);
  });
});

describe("digest view", () => {
  interface Card {
    job: Record<string, unknown>;
    shortlistScore: number;
    fitRating?: number;
    reasons: string[];
    unmet: string[];
    answers: { question: string; answer: string }[];
    resumePreview: string;
  }
  interface DigestModule {
    ageText: (job: { postedAt?: string; firstSeenAt: string }, generatedAt: string) => string;
    createDigestView: (
      root: FakeNode,
      context: unknown,
      onFacts: (facts: unknown) => void,
    ) => {
      load: () => Promise<void>;
      handleKey: (event: { key: string; target: { tagName: string } }) => void;
    };
  }

  function card(id: string, title: string, status = "shortlisted"): Card {
    return {
      job: {
        id,
        title,
        company: "ExampleCorp",
        location: "Remote",
        board: "greenhouse",
        firstSeenAt: "2026-11-05T00:00:00Z",
        canonicalUrl: "javascript:alert(1)",
        status,
      },
      shortlistScore: 80,
      reasons: [`<b>${title}</b> fits`],
      unmet: [],
      answers: [],
      resumePreview: "Alex Rivera",
    };
  }

  /** Runs pending promise callbacks so a click's server call and redraw finish. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** A fake API that records its calls and answers like the server. */
  function fakeApi(cards: Card[]) {
    const calls: string[] = [];
    return {
      calls,
      api: {
        getDigest: async () => ({
          generatedAt: "2026-11-07T09:00:00.000Z",
          mode: "approve",
          automationPaused: false,
          skipTags: ["Wrong location", "Too junior"],
          cards,
          needsYou: [],
          recentlyApplied: [],
        }),
        approveJob: async (id: string) => {
          calls.push(`approve ${id}`);
          return { job: { id, status: "approved" } };
        },
        skipJob: async (id: string, tag: string) => {
          calls.push(`skip ${id} ${tag}`);
          return { job: { id, status: "skipped", statusReason: tag } };
        },
        undoJob: async (id: string) => {
          calls.push(`undo ${id}`);
          return { job: { id, status: "shortlisted" } };
        },
      },
    };
  }

  async function openView(cards: Card[]) {
    const { createDigestView } = await loadModule<DigestModule>("digest-view.js");
    const root = new FakeNode();
    const { api, calls } = fakeApi(cards);
    const errors: string[] = [];
    const view = createDigestView(
      root,
      { api, showError: (message: string) => errors.push(message), clearError: () => undefined },
      () => undefined,
    );
    await view.load();
    return { root, view, calls, errors };
  }

  const key = (name: string) => ({ key: name, target: { tagName: "BODY" } });

  it("describes a posting's age relative to the digest time", async () => {
    const { ageText } = await loadModule<DigestModule>("digest-view.js");
    expect(ageText({ firstSeenAt: "2026-11-05T09:00:00Z" }, "2026-11-07T09:00:00Z")).toBe(
      "first seen 2d ago",
    );
    expect(
      ageText(
        { postedAt: "2026-11-07T01:00:00Z", firstSeenAt: "2026-11-07T01:00:00Z" },
        "2026-11-07T09:00:00Z",
      ),
    ).toBe("posted today");
    expect(ageText({ firstSeenAt: "garbage" }, "2026-11-07T09:00:00Z")).toBe("");
  });

  it("calls the API when keys are pressed: j moves, a approves the current card", async () => {
    const { view, calls } = await openView([card("one", "First"), card("two", "Second")]);
    view.handleKey(key("j"));
    view.handleKey(key("a"));
    await settle();
    expect(calls).toEqual(["approve two"]);
  });

  it("starts a skip with s, then sends the chosen tag", async () => {
    const { root, view, calls } = await openView([card("one", "First")]);
    view.handleKey(key("s"));
    const tag = root.findAll(
      (node) => node.tagName === "button" && node.textContent === "Too junior",
    )[0];
    expect(tag).toBeDefined();
    tag?.click();
    await settle();
    expect(calls).toEqual(["skip one Too junior"]);
    expect(root.textContent).toContain("Skipped · Too junior.");
  });

  it("offers undo after approving and calls the API when it is used", async () => {
    const { root, view, calls } = await openView([card("one", "First")]);
    view.handleKey(key("a"));
    await settle();
    const undo = root.findAll(
      (node) => node.tagName === "button" && node.textContent === "Undo",
    )[0];
    undo?.click();
    await settle();
    expect(calls).toEqual(["approve one", "undo one"]);
  });

  it("ignores a and s on a card that was already decided, and other keys", async () => {
    const { view, calls } = await openView([card("one", "First", "approved")]);
    view.handleKey(key("a"));
    view.handleKey(key("s"));
    view.handleKey(key("x"));
    await settle();
    expect(calls).toEqual([]);
  });

  it("shows server text as text and makes no link from an unsafe address", async () => {
    const { root } = await openView([card("one", "First")]);
    expect(root.textContent).toContain("<b>First</b> fits");
    expect(root.elements.some((node) => node.tagName === "b")).toBe(false);
    expect(root.elements.some((node) => node.tagName === "a")).toBe(false);
  });

  it("shows the server's error sentence when an action fails", async () => {
    const { createDigestView } = await loadModule<DigestModule>("digest-view.js");
    const { api } = fakeApi([card("one", "First")]);
    api.approveJob = async () => {
      throw new Error("That job can no longer be approved.");
    };
    const errors: string[] = [];
    const view = createDigestView(
      new FakeNode(),
      { api, showError: (message: string) => errors.push(message), clearError: () => undefined },
      () => undefined,
    );
    await view.load();
    view.handleKey(key("a"));
    await settle();
    expect(errors).toEqual(["That job can no longer be approved."]);
  });
});
