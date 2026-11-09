/**
 * Tests of the page's own code without a browser: a tiny fake `document` stands in for the real
 * one, so the same modules the browser loads run here. They state the properties that matter:
 * text from the server is never parsed as markup, matched keywords are highlighted, the LaTeX
 * preview reads back structure, the allow-list matches the folder, and Digest keys call the API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/index.js";
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
  fire(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
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

describe("applications view", () => {
  interface Entry {
    id: string;
    company: string;
    title: string;
    link: string;
    status: string;
    jobNumber: string;
    appliedAt: string;
    followUpDue: boolean;
    details: Record<string, string>;
    events: { id: number; at: string; kind: string; summary: string; contact?: string }[];
    allowedStatuses: string[];
  }
  interface ApplicationsModule {
    createApplicationsView: (
      root: FakeNode,
      context: unknown,
      onDueCount: (count: number) => void,
    ) => { load: () => Promise<void>; refreshDueCount: () => Promise<void> };
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function entry(company: string, link = "https://careers.example.com/jobs/NW-1"): Entry {
    return {
      id: "abc123",
      company,
      title: "Platform Engineer",
      link,
      status: "applied",
      jobNumber: "NW-1",
      appliedAt: "2026-11-02T12:00:00.000Z",
      followUpDue: true,
      details: {
        recruiterName: "Alex Rivera",
        recruiterPhone: "+1 555 0100",
        nextStep: "Call back",
      },
      events: [
        { id: 1, at: "2026-11-02T12:00:00.000Z", kind: "applied", summary: "Applied." },
        {
          id: 2,
          at: "2026-11-03T12:00:00.000Z",
          kind: "call",
          summary: "Phone screen",
          contact: "Alex",
        },
      ],
      allowedStatuses: ["interviewing", "rejected"],
    };
  }

  async function openView(item: Entry) {
    const { createApplicationsView } = await loadModule<ApplicationsModule>("applications-view.js");
    const calls: { name: string; args: unknown[] }[] = [];
    const record =
      (name: string, result: unknown) =>
      async (...args: unknown[]) => {
        calls.push({ name, args });
        if (result instanceof Error) throw result;
        return result;
      };
    const api = {
      getApplications: record("getApplications", { applications: [item], dueCount: 1 }),
      getApplication: record("getApplication", item),
      addApplication: record("addApplication", item),
      putApplicationDetails: record("putApplicationDetails", item),
      reportApplicationStatus: record("reportApplicationStatus", {
        ...item,
        status: "rejected",
        allowedStatuses: [],
      }),
      addApplicationEvent: record("addApplicationEvent", item.events[1]),
    };
    const errors: string[] = [];
    const dueCounts: number[] = [];
    const root = new FakeNode();
    const view = createApplicationsView(
      root,
      { api, showError: (message: string) => errors.push(message), clearError: () => undefined },
      (count) => dueCounts.push(count),
    );
    await view.load();
    return { root, view, calls, errors, dueCounts, api };
  }

  const byId = (root: FakeNode, id: string): FakeNode =>
    root.findAll((node) => node.attributes.get("id") === id)[0]!;
  const byLabel = (root: FakeNode, label: string): FakeNode =>
    root.findAll((node) => node.attributes.get("aria-label") === label)[0]!;
  const submit = (form: FakeNode): void => form.fire("submit", { preventDefault: () => undefined });

  it("lists applications and reports how many next steps are due", async () => {
    const { root, dueCounts } = await openView(entry("Northwind"));
    expect(root.textContent).toContain("Northwind");
    expect(root.textContent).toContain("Alex Rivera");
    expect(root.textContent).toContain("2026-11-02");
    expect(dueCounts).toEqual([1]);
  });

  it("shows a company name that looks like markup as plain text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { root, calls } = await openView(entry(hostile));
    expect(root.textContent).toContain(hostile);
    expect(root.elements.some((node) => node.tagName === "img")).toBe(false);
    root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    expect(calls.map((call) => call.name)).toContain("getApplication");
    expect(root.elements.some((node) => node.tagName === "img")).toBe(false);
    expect(root.textContent).toContain(hostile);
  });

  it("opens a panel offering only the allowed statuses, and makes links only for http addresses", async () => {
    const safe = await openView(entry("Northwind"));
    safe.root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    const options = byId(safe.root, "apps-s-status").children.map((node) => node.textContent);
    expect(options).toEqual(["interviewing", "rejected"]);
    const anchors = safe.root.elements.filter((node) => node.tagName === "a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.attributes.get("rel")).toBe("noopener noreferrer");
    expect(anchors[0]!.attributes.get("target")).toBe("_blank");
    expect(safe.root.textContent).toContain("Phone screen");
    expect(safe.root.textContent).toContain("Call");

    const unsafe = await openView(entry("Northwind", "javascript:alert(1)"));
    unsafe.root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    expect(unsafe.root.elements.some((node) => node.tagName === "a")).toBe(false);
  });

  it("sends the reported status and shows the server's sentence when it is refused", async () => {
    const view = await openView(entry("Northwind"));
    view.root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    byId(view.root, "apps-s-status").value = "rejected";
    byId(view.root, "apps-s-note").value = "Email from Alex";
    submit(byLabel(view.root, "Report status"));
    await settle();
    const sent = view.calls.find((call) => call.name === "reportApplicationStatus");
    expect(sent?.args).toEqual(["abc123", { status: "rejected", note: "Email from Alex" }]);
    expect(view.root.textContent).toContain("Status is now rejected.");

    const refused = await openView(entry("Northwind"));
    refused.api.reportApplicationStatus = async () => {
      throw new Error("An application that is applied cannot be moved to offer.");
    };
    refused.root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    submit(byLabel(refused.root, "Report status"));
    await settle();
    expect(refused.root.textContent).toContain("cannot be moved to offer");
  });

  it("saves details and logs an entry through the API", async () => {
    const view = await openView(entry("Northwind"));
    view.root.findAll((node) => node.attributes.has("data-id"))[0]!.click();
    await settle();
    byId(view.root, "apps-d-recruiterEmail").value = " alex@example.com ";
    submit(byLabel(view.root, "Recruiter and next step"));
    await settle();
    const saved = view.calls.find((call) => call.name === "putApplicationDetails");
    expect((saved?.args[1] as Record<string, string>).recruiterEmail).toBe("alex@example.com");

    byId(view.root, "apps-l-kind").value = "email";
    byId(view.root, "apps-l-summary").value = "Sent my availability";
    submit(byLabel(view.root, "Log a call, email or note"));
    await settle();
    const logged = view.calls.find((call) => call.name === "addApplicationEvent");
    expect(logged?.args[1]).toEqual({ kind: "email", summary: "Sent my availability" });
  });

  it("adds an application made outside Scout with only the fields that were filled", async () => {
    const view = await openView(entry("Northwind"));
    const addButton = view.root.elements.find(
      (node) => node.tagName === "button" && node.textContent === "Add application",
    )!;
    addButton.click();
    byId(view.root, "apps-a-company").value = "Contoso";
    byId(view.root, "apps-a-title").value = "Backend Engineer";
    byId(view.root, "apps-a-recruiterName").value = "Alex Rivera";
    submit(byLabel(view.root, "Add an application"));
    await settle();
    const added = view.calls.find((call) => call.name === "addApplication");
    expect(added?.args[0]).toEqual({
      company: "Contoso",
      title: "Backend Engineer",
      details: { recruiterName: "Alex Rivera" },
    });
  });
});

describe("instant saves", () => {
  interface SettingsModule {
    createSettingsView: (
      root: FakeNode,
      context: unknown,
      onChanged: (settings: unknown) => void,
    ) => { load: () => Promise<void> };
  }

  it("never lets a quick second change overwrite the first", async () => {
    const { createSettingsView } = await loadModule<SettingsModule>("settings-view.js");
    const stored = { ...DEFAULT_SETTINGS };
    const sent: Record<string, unknown>[] = [];
    const api = {
      getSettings: async () => ({ settings: { ...stored }, defaults: { ...DEFAULT_SETTINGS } }),
      putSettings: async (settings: Record<string, unknown>) => {
        sent.push(settings);
        await new Promise((resolve) => setTimeout(resolve, 5));
        Object.assign(stored, settings);
        return { settings: { ...stored } };
      },
    };
    const root = new FakeNode();
    const view = createSettingsView(
      root,
      { api, showError: () => undefined, clearError: () => undefined },
      () => undefined,
    );
    await view.load();
    const pick = (id: string) => root.findAll((node) => node.attributes.get("id") === id)[0];
    pick("automationPaused")?.fire("change", { target: { checked: true } });
    pick("readAlertEmails")?.fire("change", { target: { checked: true } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ automationPaused: true, readAlertEmails: true });
  });
});

describe("pause control", () => {
  interface PauseModule {
    createPauseControl: (
      root: FakeNode,
      context: unknown,
      onChanged: (settings: unknown) => void,
    ) => { load: () => Promise<void>; sync: (paused: boolean) => void };
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const button = (root: FakeNode, text: string): FakeNode | undefined =>
    root.findAll((node) => node.tagName === "button" && node.textContent === text)[0];

  async function open() {
    const { createPauseControl } = await loadModule<PauseModule>("pause-control.js");
    const stored = { ...DEFAULT_SETTINGS, mainEngine: "codex" };
    const sent: Record<string, unknown>[] = [];
    const api = {
      getSettings: async () => ({ settings: { ...stored } }),
      putSettings: async (settings: Record<string, unknown>) => {
        sent.push(settings);
        Object.assign(stored, settings);
        return { settings: { ...stored } };
      },
    };
    const changed: unknown[] = [];
    const root = new FakeNode();
    const control = createPauseControl(
      root,
      { api, showError: () => undefined, clearError: () => undefined },
      (settings) => changed.push(settings),
    );
    await control.load();
    return { root, control, sent, changed };
  }

  it("pauses with one click, keeping every other setting", async () => {
    const { root, sent, changed } = await open();
    button(root, "Pause automation")?.click();
    await settle();
    expect(sent).toEqual([{ ...DEFAULT_SETTINGS, mainEngine: "codex", automationPaused: true }]);
    expect(changed).toHaveLength(1);
    expect(button(root, "Resume automation")).toBeDefined();
  });

  it("asks once before resuming and changes nothing until it is confirmed", async () => {
    const { root, control, sent } = await open();
    control.sync(true);
    button(root, "Resume automation")?.click();
    expect(sent).toEqual([]);
    expect(root.textContent).toContain("Let Scout fill forms and submit again?");
    button(root, "Cancel")?.click();
    expect(sent).toEqual([]);
    button(root, "Resume automation")?.click();
    button(root, "Yes, resume")?.click();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ automationPaused: false });
    expect(button(root, "Pause automation")).toBeDefined();
  });
});

describe("control view", () => {
  interface ControlModule {
    createControlView: (
      root: FakeNode,
      context: unknown,
      onPaused: (paused: boolean) => void,
    ) => { load: () => Promise<void> };
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const NO_RUN = { running: null, last: null, lastByName: {} };

  function platform(name: string, known = true) {
    return {
      name,
      known,
      login: "manual",
      level: "prepare",
      credentialsSaved: "no",
      lastSignInAt: null,
    };
  }

  /** A fake API with state the test can change, recording every call. */
  function fakeApi(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const data = {
      health: {
        ok: true,
        report: {
          automationPaused: false,
          heartbeatStale: false,
          lastRunAt: "2026-11-09T08:00:00.000Z",
          queueSizes: { found: 3, approved: 1, applied: 0 },
          modelCallsToday: 7,
          modelCallBudget: 40,
          watchedBoards: 2,
          needsYou: [
            { id: "n1", company: "ExampleCorp", title: "Role", reason: "A code is needed" },
          ],
        },
        approved: [{ id: "job-9", company: "ExampleCorp", title: "Backend Engineer" }],
        modelName: "Sonnet 5.5",
      } as Record<string, unknown>,
      actions: { ...NO_RUN } as Record<string, unknown>,
      platforms: {
        platforms: [platform("indeed"), platform("linkedin"), platform("naukri")],
        keychainAvailable: true,
        warning: "Automating these sites may break their terms and risk the account.",
      },
    };
    const api = {
      getHealth: async () => data.health,
      getActions: async () => {
        calls.push("getActions");
        return data.actions;
      },
      startAction: async (name: string) => {
        calls.push(`start ${name}`);
        data.actions = {
          running: { name, startedAt: "2026-11-09T09:00:00.000Z" },
          last: null,
          lastByName: {},
        };
        return data.actions;
      },
      getPlatforms: async () => data.platforms,
      putPlatform: async (name: string, body: Record<string, unknown>) => {
        calls.push(`put ${name} ${JSON.stringify(body)}`);
        return data.platforms;
      },
      ...overrides,
    };
    return { api, calls, data };
  }

  async function open(fake = fakeApi()) {
    const { createControlView } = await loadModule<ControlModule>("control-view.js");
    const errors: string[] = [];
    const paused: boolean[] = [];
    const root = new FakeNode();
    const view = createControlView(
      root,
      {
        api: fake.api,
        showError: (message: string) => errors.push(message),
        clearError: () => undefined,
      },
      (value) => paused.push(value),
    );
    await view.load();
    return { root, view, errors, paused, ...fake };
  }

  const byId = (root: FakeNode, id: string): FakeNode =>
    root.findAll((node) => node.attributes.get("id") === id)[0]!;

  it("shows the status, the one-line model, and the approved job with its terminal command", async () => {
    const { root, paused } = await open();
    expect(root.textContent).toContain("Running");
    expect(root.textContent).toContain("found 3");
    expect(root.textContent).not.toContain("applied 0");
    expect(root.textContent).toContain("ExampleCorp, Role: A code is needed");
    expect(root.textContent).toContain("Model: Sonnet 5.5. Model calls today: 7 of 40.");
    expect(root.textContent).toContain("scout apply job-9");
    expect(paused).toEqual([false]);
  });

  it("disables both actions while one runs and polls only until it finishes", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeApi();
      const { root } = await open(fake);
      expect(byId(root, "action-discover").attributes.has("disabled")).toBe(false);
      byId(root, "action-discover").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.calls).toContain("start discover");
      expect(byId(root, "action-discover").attributes.has("disabled")).toBe(true);
      expect(byId(root, "action-inbox").attributes.has("disabled")).toBe(true);

      const before = fake.calls.filter((call) => call === "getActions").length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(fake.calls.filter((call) => call === "getActions").length).toBe(before + 1);

      fake.data.actions = {
        running: null,
        last: null,
        lastByName: {
          discover: {
            name: "discover",
            ok: false,
            summary: "There is no profile yet.",
            startedAt: "2026-11-09T09:00:00.000Z",
            finishedAt: "2026-11-09T09:00:05.000Z",
          },
        },
      };
      await vi.advanceTimersByTimeAsync(2000);
      expect(root.textContent).toContain("Failed");
      expect(root.textContent).toContain("There is no profile yet.");
      expect(byId(root, "action-discover").attributes.has("disabled")).toBe(false);
      const after = fake.calls.filter((call) => call === "getActions").length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(fake.calls.filter((call) => call === "getActions").length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns the inbox button off while paused and shows a refusal sentence", async () => {
    const fake = fakeApi();
    (fake.data.health["report"] as Record<string, unknown>)["automationPaused"] = true;
    const { root } = await open(fake);
    expect(byId(root, "action-inbox").attributes.has("disabled")).toBe(true);
    expect(root.textContent).toContain("Reading mail is off while automation is paused.");

    const refused = fakeApi({
      startAction: async () => {
        throw new Error("Another action is still running. Wait for it to finish.");
      },
    });
    const view = await open(refused);
    byId(view.root, "action-discover").click();
    await settle();
    expect(view.errors).toEqual(["Another action is still running. Wait for it to finish."]);
  });

  it("saves a safe platform change at once", async () => {
    const { root, calls } = await open();
    byId(root, "level-indeed").fire("change", { target: { value: "fill" } });
    await settle();
    expect(calls).toContain('put indeed {"level":"fill"}');
  });

  it("holds a risky change until the platform name is typed, then sends it with the name", async () => {
    const { root, calls } = await open();
    byId(root, "level-linkedin").fire("change", { target: { value: "auto" } });
    expect(calls.some((call) => call.startsWith("put"))).toBe(false);
    expect(root.textContent).toContain("Automating these sites may break their terms");
    const save = root.querySelector('[data-save="linkedin"]')!;
    expect(save.attributes.has("disabled")).toBe(true);

    // In a browser the `disabled` property also drives the attribute; the fake only stores the property.
    const isDisabled = (): unknown => (save as unknown as { disabled: unknown }).disabled;
    byId(root, "confirm-linkedin").fire("input", { target: { value: "link" } });
    expect(isDisabled()).toBe(true);
    byId(root, "confirm-linkedin").fire("input", { target: { value: " LinkedIn " } });
    expect(isDisabled()).toBe(false);

    const form = root.findAll((node) => node.tagName === "form")[0]!;
    form.fire("submit", { preventDefault: () => undefined });
    await settle();
    expect(calls).toContain('put linkedin {"level":"auto","confirm":" LinkedIn "}');
  });

  it("asks for the name before saved sign-in too, and shows both sign-in commands", async () => {
    const { root, calls } = await open();
    byId(root, "login-naukri").fire("change", { target: { value: "saved" } });
    expect(calls.some((call) => call.startsWith("put"))).toBe(false);
    expect(root.textContent).toContain("scout login naukri");
    expect(root.textContent).toContain("scout login naukri --save");
  });

  it("has no password field and shows hostile server text as plain text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const fake = fakeApi();
    const report = fake.data.health["report"] as Record<string, unknown>;
    report["needsYou"] = [{ id: "n1", company: hostile, title: hostile, reason: hostile }];
    fake.data.health["approved"] = [{ id: "a b; rm -rf", company: hostile, title: hostile }];
    fake.data.platforms.platforms = [platform(hostile, false)];
    const { root } = await open(fake);
    expect(root.textContent).toContain(hostile);
    expect(root.elements.some((node) => node.tagName === "img")).toBe(false);
    expect(root.elements.some((node) => node.attributes.get("type") === "password")).toBe(false);
    expect(root.textContent).not.toContain("scout apply a b");
  });

  it("leaves out a section the server does not provide", async () => {
    const fake = fakeApi({
      getActions: async () => {
        throw new Error("Actions are not enabled.");
      },
      getPlatforms: async () => {
        throw new Error("Platform settings are not enabled.");
      },
    });
    const { root, errors } = await open(fake);
    expect(errors).toEqual([]);
    expect(root.textContent).not.toContain("Find jobs now");
    expect(root.textContent).not.toContain("Platforms");
  });
});
