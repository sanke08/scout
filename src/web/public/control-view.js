/* global setTimeout, clearTimeout */
/**
 * The Control tab: what Scout is doing now, buttons to run "Find jobs now" and "Read inbox now",
 * the model in use, how each platform signs in, and the jobs approved and waiting for the terminal.
 *
 * What it never does: send a password (there is no password field; saving one needs the terminal's
 * keychain prompt), or submit an application (that stays `scout apply <id>` in the terminal).
 * Every word from the server goes into the page as text.
 */
import { clearChildren, h } from "./dom.js";

/** How often the page asks the server about a running action, in milliseconds. */
const POLL_MILLISECONDS = 2000;

/** The two actions, with the words shown for each. */
const ACTIONS = [
  [
    "discover",
    "Find jobs now",
    "Reads your watched boards, applies your rules and shortlists the best.",
  ],
  [
    "inbox",
    "Read inbox now",
    "Reads your mailbox (read-only) and updates the status of applications that got a reply.",
  ],
];

/** Labels for the login ways and apply levels. */
const LOGIN_WAYS = [
  ["manual", "I sign in myself"],
  ["saved", "Use saved credentials"],
];
const LEVELS = [
  ["prepare", "Prepare only"],
  ["fill", "Fill, I submit"],
  ["auto", "Automatic"],
];

/** What "credentials saved" says for each answer the server can give. */
const CREDENTIAL_TEXT = {
  yes: "yes",
  no: "no",
  "no-keychain": "no keychain on this computer",
  unknown: "could not check",
};

/** A job id that is safe to place in a terminal command. */
const SAFE_COMMAND_PART = /^[A-Za-z0-9_-]{1,128}$/;

/** Formats an ISO time for the owner, or says "never". */
function whenText(iso) {
  if (!iso) return "never";
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? "never" : time.toLocaleString();
}

/** True when the platform needs the name typed before this change is saved. */
function needsConfirmation(platform, change) {
  return platform.known && (change.login === "saved" || change.level === "auto");
}

/** Creates the Control view inside `root`; returns `{ load }`. `onPausedFacts(paused)` follows the health report. */
export function createControlView(root, context, onPausedFacts) {
  const state = {
    health: null,
    actions: null,
    platforms: null,
    /** A risky change waiting for the typed name: `{ name, change }`. */
    pending: null,
    typed: "",
    copied: "",
    loaded: false,
  };
  let pollTimer = null;

  /** A line of terminal text with a Copy button. */
  function commandRow(command, label) {
    return h(
      "div",
      { class: "cmd" },
      h("code", {}, command),
      h(
        "button",
        {
          class: "link",
          type: "button",
          "aria-label": `Copy ${label}`,
          on: { click: () => void copy(command) },
        },
        state.copied === command ? "Copied" : "Copy",
      ),
    );
  }

  /** Puts text on the clipboard when the browser allows it; otherwise the text stays selectable. */
  async function copy(text) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      state.copied = text;
    } catch {
      context.showError("Scout could not copy that. Select the command and copy it by hand.");
      return;
    }
    render();
  }

  /** The status block: automation, boards, last activity, jobs by status and what needs the owner. */
  function statusSection() {
    const report = state.health?.report;
    if (!report) return null;
    const queues = Object.entries(report.queueSizes ?? {}).filter(([, count]) => count > 0);
    return h(
      "section",
      { id: "controlStatus" },
      h("h2", {}, "Status"),
      h(
        "div",
        { class: "group" },
        h(
          "div",
          { class: "set" },
          h("div", { class: "lbl" }, h("span", { class: "name" }, "Automation")),
          h("div", { class: "ctl" }, report.automationPaused ? "Paused" : "Running"),
        ),
        h(
          "div",
          { class: "set" },
          h(
            "div",
            { class: "lbl" },
            h("span", { class: "name" }, "Last activity"),
            report.heartbeatStale &&
              h("p", {}, "Scout has not done anything for over a day. Run Find jobs now."),
          ),
          h("div", { class: "ctl" }, whenText(report.lastRunAt)),
        ),
        report.watchedBoards !== undefined &&
          h(
            "div",
            { class: "set" },
            h("div", { class: "lbl" }, h("span", { class: "name" }, "Boards watched")),
            h("div", { class: "ctl" }, String(report.watchedBoards)),
          ),
        h(
          "div",
          { class: "set" },
          h("div", { class: "lbl" }, h("span", { class: "name" }, "Jobs by status")),
          h(
            "div",
            { class: "ctl tags" },
            queues.length === 0
              ? "none yet"
              : queues.map(([status, count]) => h("span", { class: "tag" }, `${status} ${count}`)),
          ),
        ),
      ),
      report.needsYou.length > 0 &&
        h(
          "div",
          { class: "attn note-gap" },
          h("p", {}, h("b", {}, "Needs you")),
          report.needsYou.map((job) =>
            h("p", { class: "small" }, `${job.company}, ${job.title}: ${job.reason}`),
          ),
        ),
    );
  }

  /** One action row: name, description, last result and the button. */
  function actionRow([name, label, description], busyName) {
    const last = state.actions.lastByName[name];
    const paused = name === "inbox" && state.health?.report?.automationPaused === true;
    const running = busyName === name;
    return h(
      "div",
      { class: "set", "data-action": name },
      h(
        "div",
        { class: "lbl" },
        h("span", { class: "name" }, label),
        h("p", {}, description),
        paused && h("p", {}, "Reading mail is off while automation is paused."),
        running && h("p", { role: "status" }, "Running. This page checks every 2 seconds."),
        !running &&
          last &&
          h(
            "p",
            { class: last.ok ? "" : "failed" },
            `${last.ok ? "Finished" : "Failed"} ${whenText(last.finishedAt)}: ${last.summary}`,
          ),
      ),
      h(
        "div",
        { class: "ctl" },
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            id: `action-${name}`,
            disabled: state.actions.running !== null || paused,
            on: { click: () => void startAction(name) },
          },
          running ? "Running…" : label,
        ),
      ),
    );
  }

  /** The two action rows; absent when the server has no action runner. */
  function actionsSection() {
    if (state.actions === null) return null;
    const busyName = state.actions.running?.name ?? null;
    return h(
      "section",
      { id: "controlActions" },
      h("h2", {}, "Actions"),
      h(
        "div",
        { class: "group" },
        ACTIONS.map((action) => actionRow(action, busyName)),
      ),
      h("p", { class: "note" }, "Only one action runs at a time."),
    );
  }

  /** One read-only line: the model and the calls used today. */
  function modelSection() {
    const report = state.health?.report;
    if (!report) return null;
    const name = state.health.modelName;
    return h(
      "section",
      { id: "controlModel" },
      h("h2", {}, "AI model"),
      h(
        "p",
        { class: "small" },
        `${name ? `Model: ${name}. ` : ""}Model calls today: ${report.modelCallsToday} of ${report.modelCallBudget}.`,
      ),
    );
  }

  /** Saves a platform change; a risky one carries the typed name. */
  async function savePlatform(name, change, confirm) {
    try {
      const body = confirm === undefined ? change : { ...change, confirm };
      state.platforms = await context.api.putPlatform(name, body);
      context.clearError();
    } catch (error) {
      context.showError(error.message);
    }
    state.pending = null;
    state.typed = "";
    render();
  }

  /** Called when a select changes: saves at once, or asks for the typed name first. */
  function choose(platform, change) {
    if (needsConfirmation(platform, change)) {
      state.pending = { name: platform.name, change };
      state.typed = "";
      render();
      return;
    }
    state.pending = null;
    void savePlatform(platform.name, change);
  }

  /** A select of `[value, label]` options. */
  function selectFor(id, label, options, current, onPick) {
    return h(
      "div",
      { class: "pf" },
      h("label", { for: id }, label),
      h(
        "select",
        { id, class: "fld", on: { change: (event) => onPick(event.target.value) } },
        options.map(([value, text]) => h("option", { value, selected: value === current }, text)),
      ),
    );
  }

  /** The warning, the typed-name box and the save button for a risky change. */
  function confirmBox(platform) {
    const confirmId = `confirm-${platform.name}`;
    const matches = state.typed.trim().toLowerCase() === platform.name;
    return h(
      "div",
      {
        class: "attn note-gap",
        role: "group",
        "aria-label": `Confirm change for ${platform.name}`,
      },
      h("p", {}, state.platforms.warning),
      h("label", { for: confirmId, class: "small" }, `Type ${platform.name} to confirm`),
      h(
        "form",
        {
          on: {
            submit: (event) => {
              event.preventDefault();
              if (state.typed.trim().toLowerCase() === platform.name)
                void savePlatform(platform.name, state.pending.change, state.typed);
            },
          },
        },
        h("input", {
          id: confirmId,
          type: "text",
          autocomplete: "off",
          value: state.typed,
          on: {
            input: (event) => {
              state.typed = event.target.value;
              const button = root.querySelector(`[data-save="${platform.name}"]`);
              if (button) button.disabled = state.typed.trim().toLowerCase() !== platform.name;
            },
          },
        }),
        h(
          "button",
          { class: "btn primary", type: "submit", "data-save": platform.name, disabled: !matches },
          "Save change",
        ),
        h(
          "button",
          {
            class: "btn",
            type: "button",
            on: {
              click: () => {
                state.pending = null;
                state.typed = "";
                render();
              },
            },
          },
          "Cancel",
        ),
      ),
    );
  }

  /** One platform: its two selects, read-only facts and the sign-in commands. */
  function platformBlock(platform) {
    const pending = state.pending?.name === platform.name ? state.pending.change : null;
    const login = pending?.login ?? platform.login;
    const level = pending?.level ?? platform.level;
    const title = platform.name.charAt(0).toUpperCase() + platform.name.slice(1);
    return h(
      "div",
      { class: "plat", "data-platform": platform.name },
      h("p", { class: "title" }, title),
      h(
        "div",
        { class: "pfrow" },
        selectFor(`login-${platform.name}`, "Login way", LOGIN_WAYS, login, (value) =>
          choose(platform, { login: value }),
        ),
        selectFor(`level-${platform.name}`, "Apply level", LEVELS, level, (value) =>
          choose(platform, { level: value }),
        ),
      ),
      h(
        "p",
        { class: "meta" },
        `Credentials saved: ${CREDENTIAL_TEXT[platform.credentialsSaved] ?? "no"}. Last sign-in: ${whenText(platform.lastSignInAt)}.`,
      ),
      pending && confirmBox(platform),
      commandRow(`scout login ${platform.name}`, `sign-in command for ${platform.name}`),
      platform.known &&
        commandRow(
          `scout login ${platform.name} --save`,
          `sign-in and save command for ${platform.name}`,
        ),
    );
  }

  /** The platform list; absent when the server has no platform settings. */
  function platformsSection() {
    if (state.platforms === null) return null;
    return h(
      "section",
      { id: "controlPlatforms" },
      h("h2", {}, "Platforms"),
      h(
        "p",
        { class: "note" },
        "Sign in from the terminal with the commands below. Adding --save stores your password in the computer's keychain, which asks for it in the terminal. This page never sees or stores a password.",
      ),
      h("div", { class: "group" }, state.platforms.platforms.map(platformBlock)),
    );
  }

  /** The approved jobs and the terminal command that applies to each. */
  function approvedSection() {
    const approved = state.health?.approved;
    if (!approved) return null;
    return h(
      "section",
      { id: "controlApproved" },
      h("h2", {}, "Approved and waiting"),
      approved.length === 0
        ? h("p", { class: "note" }, "Nothing is waiting. Approved jobs appear here.")
        : h(
            "div",
            { class: "group" },
            approved.map((job) =>
              h(
                "div",
                { class: "plat" },
                h("p", { class: "title" }, `${job.company}, ${job.title}`),
                SAFE_COMMAND_PART.test(job.id)
                  ? commandRow(`scout apply ${job.id}`, `apply command for ${job.company}`)
                  : h(
                      "p",
                      { class: "meta" },
                      "Run scout apply with this job's id from the terminal.",
                    ),
              ),
            ),
          ),
      h(
        "p",
        { class: "note" },
        "Applying stays in the terminal: it asks you to type yes before anything is sent.",
      ),
    );
  }

  /** Redraws the whole tab from the stored facts. */
  function render() {
    clearChildren(root);
    if (!state.loaded) return;
    for (const section of [
      statusSection(),
      actionsSection(),
      modelSection(),
      platformsSection(),
      approvedSection(),
    ]) {
      if (section) root.appendChild(section);
    }
  }

  /** Reads one thing; a 404 (feature not enabled here) is not an error to show. */
  async function tryLoad(call) {
    try {
      return await call();
    } catch (error) {
      if (!/not enabled/.test(error.message)) context.showError(error.message);
      return null;
    }
  }

  /** Keeps asking the server while an action runs, and stops when it is done. */
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (state.actions?.running == null) return;
    pollTimer = setTimeout(() => void poll(), POLL_MILLISECONDS);
  }

  /** One poll: refresh the actions, and the health facts when the action has finished. */
  async function poll() {
    pollTimer = null;
    const actions = await tryLoad(() => context.api.getActions());
    if (actions !== null) state.actions = actions;
    if (state.actions?.running == null) {
      const health = await tryLoad(() => context.api.getHealth());
      if (health !== null) state.health = health;
    }
    render();
    schedulePoll();
  }

  /** Starts an action; a refusal (another one running, paused, missing mail settings) shows its sentence. */
  async function startAction(name) {
    try {
      state.actions = await context.api.startAction(name);
      context.clearError();
    } catch (error) {
      context.showError(error.message);
      const actions = await tryLoad(() => context.api.getActions());
      if (actions !== null) state.actions = actions;
    }
    render();
    schedulePoll();
  }

  /** Fetches everything the tab shows, then draws. */
  async function load() {
    const [health, actions, platforms] = await Promise.all([
      tryLoad(() => context.api.getHealth()),
      tryLoad(() => context.api.getActions()),
      tryLoad(() => context.api.getPlatforms()),
    ]);
    state.health = health;
    state.actions = actions;
    state.platforms = platforms;
    state.loaded = true;
    if (health?.report) onPausedFacts(health.report.automationPaused);
    render();
    schedulePoll();
  }

  return { load };
}
