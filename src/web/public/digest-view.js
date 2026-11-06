/**
 * The Digest view: the status facts, the "needs you" block, today's shortlist cards with approve,
 * skip (with a tag) and undo, and the recently applied list. Keys: j and k move, a approves, s
 * starts a skip, Enter opens the details. Every action goes through the server; the card shows
 * the status the server returns.
 */
import { clearChildren, h, safeHttpUrl } from "./dom.js";

/** Milliseconds in one day, for card ages. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Says how old a posting is, relative to `generatedAt`.
 * Example: posted two days before gives "posted 2d ago"; no date at all gives "".
 */
export function ageText(job, generatedAt) {
  const label = job.postedAt ? "posted" : "first seen";
  const when = Date.parse(job.postedAt ?? job.firstSeenAt);
  const now = Date.parse(generatedAt);
  if (Number.isNaN(when) || Number.isNaN(now)) return "";
  const days = Math.floor((now - when) / DAY_MS);
  return days <= 0 ? `${label} today` : `${label} ${days}d ago`;
}

/** True while a card still waits for a decision (it is neither approved nor skipped). */
function isWaiting(card) {
  return card.job.status !== "approved" && card.job.status !== "skipped";
}

/**
 * Creates the Digest view inside `root`. `onFacts` receives `{ generatedAt, mode,
 * automationPaused }` after every load so the page can show the status line.
 * Returns `{ load, handleKey }`.
 */
export function createDigestView(root, context, onFacts) {
  const state = {
    cards: [],
    needsYou: [],
    recent: [],
    skipTags: [],
    generatedAt: new Date().toISOString(),
    current: 0,
    loaded: false,
  };
  /** Per-card screen state, by job id: `open` (details shown), `skipping` (tags shown), `busy`. */
  const screenState = new Map();

  /** The screen state of one card, created on first use. */
  function screenOf(card) {
    if (!screenState.has(card.job.id)) {
      screenState.set(card.job.id, { open: false, skipping: false, busy: false });
    }
    return screenState.get(card.job.id);
  }

  /** Runs one server call for a card, then shows what the server says the job's status now is. */
  async function runAction(card, call, afterwards) {
    const screen = screenOf(card);
    if (screen.busy) return;
    screen.busy = true;
    try {
      const reply = await call();
      card.job = { ...card.job, ...reply.job };
      afterwards(screen);
      context.clearError();
    } catch (error) {
      context.showError(error.message);
    } finally {
      screen.busy = false;
      render();
    }
  }

  function approve(card) {
    void runAction(
      card,
      () => context.api.approveJob(card.job.id),
      (screen) => {
        screen.open = false;
        screen.skipping = false;
      },
    );
  }

  function skip(card, tag) {
    void runAction(
      card,
      () => context.api.skipJob(card.job.id, tag),
      (screen) => {
        screen.open = false;
        screen.skipping = false;
      },
    );
  }

  function undo(card) {
    void runAction(
      card,
      () => context.api.undoJob(card.job.id),
      (screen) => {
        screen.skipping = false;
      },
    );
  }

  /** The Approve and Skip buttons, or the state text with Undo. */
  function actionsOf(card) {
    const status = card.job.status;
    if (status === "approved") {
      return h(
        "span",
        { class: "state" },
        "Approved. ",
        linkButton("Undo", () => undo(card)),
      );
    }
    if (status === "skipped") {
      const reason = card.job.statusReason ? ` · ${card.job.statusReason}` : "";
      return h(
        "span",
        { class: "state" },
        `Skipped${reason}. `,
        linkButton("Undo", () => undo(card)),
      );
    }
    return h(
      "div",
      { class: "actions" },
      h(
        "button",
        { class: "btn primary", type: "button", on: { click: () => approve(card) } },
        "Approve",
      ),
      h("button", { class: "btn", type: "button", on: { click: () => startSkip(card) } }, "Skip"),
    );
  }

  /** A button that looks like a link. */
  function linkButton(label, onClick) {
    return h("button", { class: "link", type: "button", on: { click: onClick } }, label);
  }

  function startSkip(card) {
    const screen = screenOf(card);
    screen.skipping = true;
    screen.open = true;
    state.current = state.cards.indexOf(card);
    render();
  }

  function toggleDetails(card) {
    const screen = screenOf(card);
    screen.open = !screen.open;
    state.current = state.cards.indexOf(card);
    render();
  }

  /** The expandable part of a card: reasons, gaps, answers, resume text, skip tags. */
  function detailsOf(card) {
    const screen = screenOf(card);
    const postingUrl = safeHttpUrl(card.job.canonicalUrl);
    return h(
      "div",
      { class: "detail", hidden: !screen.open },
      h("h3", {}, "Meets"),
      h(
        "ul",
        {},
        card.reasons.map((reason) => h("li", {}, reason)),
      ),
      h("h3", {}, "Gaps"),
      h(
        "ul",
        {},
        card.unmet.length > 0
          ? card.unmet.map((gap) => h("li", {}, gap))
          : [h("li", {}, "No unmet requirements listed.")],
      ),
      h("h3", {}, "Will be sent"),
      h(
        "dl",
        { class: "qa" },
        card.answers.map((entry) => [h("dt", {}, entry.question), h("dd", {}, entry.answer)]),
      ),
      h("h3", {}, "Resume"),
      h("pre", { class: "sheet-text" }, card.resumePreview),
      postingUrl &&
        h(
          "p",
          { class: "small" },
          h(
            "a",
            { href: postingUrl, rel: "noreferrer noopener", target: "_blank" },
            "Open the posting",
          ),
        ),
      screen.skipping &&
        h(
          "div",
          { class: "tags" },
          state.skipTags.map((tag) =>
            h(
              "button",
              { class: "tag", type: "button", on: { click: () => skip(card, tag) } },
              tag,
            ),
          ),
        ),
    );
  }

  /** One card of the shortlist. */
  function cardRow(card, index) {
    const screen = screenOf(card);
    const meta = [card.job.location, ageText(card.job, state.generatedAt), card.job.board]
      .filter(Boolean)
      .join(" · ");
    const fit = card.fitRating === undefined ? "" : ` Fit ${card.fitRating}/10.`;
    return h(
      "div",
      {
        class: "job",
        "data-state":
          card.job.status === "approved" || card.job.status === "skipped" ? card.job.status : "",
        "aria-current": index === state.current ? "true" : null,
      },
      h(
        "div",
        { class: "row" },
        h("span", { class: "score" }, String(card.shortlistScore)),
        h(
          "div",
          {},
          h("p", { class: "title" }, `${card.job.title} · ${card.job.company}`),
          h("p", { class: "meta" }, meta + fit),
          h(
            "p",
            { class: "why" },
            `${card.reasons[0] ?? ""} `,
            linkButton(screen.open ? "Hide details" : "Details", () => toggleDetails(card)),
          ),
        ),
        actionsOf(card),
      ),
      detailsOf(card),
    );
  }

  /** The "needs you" block: jobs a person has to act on, with the reason Scout gave. */
  function needsYouSection() {
    const items = state.needsYou.map((job) =>
      h(
        "div",
        { class: "attn" },
        h("p", { class: "src" }, `${job.company} · ${job.title}`),
        h("p", {}, job.statusReason ?? "This job needs your attention."),
        h(
          "div",
          { class: "fbtns" },
          h(
            "button",
            { class: "btn", type: "button", on: { click: () => dismissNeedsYou(job) } },
            "Skip job",
          ),
        ),
      ),
    );
    return h(
      "section",
      {},
      h("h2", {}, `Needs you · ${state.needsYou.length}`),
      items.length > 0 ? items : h("p", { class: "state" }, "Nothing needs you right now."),
    );
  }

  /** Skips a needs-you job with the tag "Not interested". */
  async function dismissNeedsYou(job) {
    try {
      await context.api.skipJob(job.id, "Not interested");
      state.needsYou = state.needsYou.filter((entry) => entry.id !== job.id);
      context.clearError();
    } catch (error) {
      context.showError(error.message);
    }
    render();
  }

  /** The recently applied list. */
  function recentSection() {
    const rows = state.recent.map((job) =>
      h(
        "div",
        { class: "done" },
        h("p", { class: "t" }, `${job.company} · ${job.title}`),
        h("span", { class: "s" }, job.status),
        h(
          "p",
          { class: "m" },
          `${job.board} · updated ${new Date(job.updatedAt).toLocaleDateString()}`,
        ),
      ),
    );
    return h(
      "section",
      {},
      h("h2", {}, "Recently applied"),
      rows.length > 0 ? h("div", {}, rows) : h("p", { class: "state" }, "No applications yet."),
    );
  }

  /** Redraws the whole view from `state`. */
  function render() {
    clearChildren(root);
    const waiting = state.cards.filter(isWaiting).length;
    root.appendChild(needsYouSection());
    root.appendChild(
      h(
        "section",
        {},
        h("h2", {}, `Today's shortlist · ${waiting} to review`),
        h(
          "div",
          { class: "list" },
          state.cards.length > 0
            ? state.cards.map(cardRow)
            : [
                h(
                  "p",
                  { class: "state note-gap" },
                  state.loaded ? "No jobs are waiting for review." : "Loading.",
                ),
              ],
        ),
        h(
          "p",
          { class: "hint" },
          h("kbd", {}, "j"),
          " ",
          h("kbd", {}, "k"),
          " move   ",
          h("kbd", {}, "a"),
          " approve   ",
          h("kbd", {}, "s"),
          " skip   ",
          h("kbd", {}, "Enter"),
          " details",
        ),
      ),
    );
    root.appendChild(recentSection());
  }

  /** Fetches today's digest and redraws. */
  async function load() {
    try {
      const digest = await context.api.getDigest();
      state.cards = digest.cards;
      state.needsYou = digest.needsYou;
      state.recent = digest.recentlyApplied;
      state.skipTags = digest.skipTags;
      state.generatedAt = digest.generatedAt;
      state.current = Math.min(state.current, Math.max(0, state.cards.length - 1));
      state.loaded = true;
      onFacts(digest);
    } catch (error) {
      context.showError(error.message);
    }
    render();
  }

  /** Handles j, k, a, s and Enter. Other keys are ignored. */
  function handleKey(event) {
    const card = state.cards[state.current];
    if (event.key === "j" && state.current < state.cards.length - 1) state.current += 1;
    else if (event.key === "k" && state.current > 0) state.current -= 1;
    else if (event.key === "a" && card && isWaiting(card)) return approve(card);
    else if (event.key === "s" && card && isWaiting(card)) return startSkip(card);
    else if (event.key === "Enter" && card && !["BUTTON", "A"].includes(event.target.tagName)) {
      return toggleDetails(card);
    } else return undefined;
    render();
    const marked = root.querySelector('[aria-current="true"]');
    if (marked && marked.scrollIntoView) marked.scrollIntoView({ block: "nearest" });
    return undefined;
  }

  render();
  return { load, handleKey };
}
