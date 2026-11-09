/* global setTimeout, clearTimeout */
/**
 * The Control tab, the home of autopilot: Start and Stop, the live log of what the model is doing,
 * the goals the model reads, Status, the platforms and the jobs approved and waiting for the terminal.
 *
 * What it never does: send a password (there is no password field; saving one needs the terminal's
 * keychain prompt), or submit an application by itself. Every word from the server, including the
 * model's own log lines, goes into the page as text.
 */
import { appendChildren, clearChildren, h } from "./dom.js";

/** How often the page asks the server about a running autopilot, in milliseconds. */
const POLL_MILLISECONDS = 2000;

/** How close to the bottom (in pixels) the log counts as "following the newest line". */
const FOLLOW_TOLERANCE = 24;

/** The kinds of pass the owner can start: `[task, label]`. */
const TASKS = [
  ["hunt", "Find and shortlist jobs"],
  ["inbox", "Read my inbox"],
  ["followups", "Draft follow-ups"],
  ["custom", "Custom (write it in the note)"],
];

/** The word shown before each kind of log line, so the difference is never only colour or style. */
const EVENT_LABELS = { text: "model", tool: "tool", result: "result", system: "system" };

/** Words for how a run ended. */
const OUTCOME_LABELS = { done: "Finished", stopped: "Stopped", failed: "Failed" };

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

/** Creates the Control view inside `root`; returns `{ load, refreshAfterPause }`. `onPausedFacts(paused)` follows the health report. */
export function createControlView(root, context, onPausedFacts) {
  const state = {
    health: null,
    /** The autopilot state from the server, or null when autopilot is not enabled. */
    agent: null,
    /** The goals from the server (`{ text, written }`), or null when not enabled. */
    goals: null,
    /** What the owner has typed and not yet started or saved. */
    task: "hunt",
    instruction: "",
    goalsDraft: "",
    goalsMessage: "",
    starting: false,
    platforms: null,
    /** A risky change waiting for the typed name: `{ name, change }`. */
    pending: null,
    typed: "",
    copied: "",
    loaded: false,
  };
  let pollTimer = null;
  /** True while the log follows its newest line; false once the owner scrolls up. */
  let followLog = true;
  /** What the start box and the log showed last, so a poll redraws only what changed. */
  let boxSignature = "";
  let logSignature = "";
  /** The two parts that change while a run goes. They live for the whole life of the view. */
  const autopilotBox = h("div", { id: "autopilotBox" });
  const logList = h("div", {
    id: "autopilotLog",
    class: "log",
    role: "log",
    "aria-label": "What autopilot is doing",
    tabindex: "0",
    on: {
      scroll: () => {
        const distance = logList.scrollHeight - logList.scrollTop - logList.clientHeight;
        if (Number.isFinite(distance)) followLog = distance < FOLLOW_TOLERANCE;
      },
    },
  });

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
              h("p", {}, "Scout has not done anything for over a day. Start autopilot."),
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

  /** True while the pause switch is on (read from the health report). */
  function isPaused() {
    return state.health?.report?.automationPaused === true;
  }

  /** True when the owner has written goals of their own; true when this server has no goals store. */
  function goalsWritten() {
    return state.goals === null || state.goals.written;
  }

  /** The reason Start is off, or null when it can be pressed. */
  function startBlocker() {
    if (state.agent.running) return "Autopilot is running. Press Stop to end it.";
    if (state.starting) return "Starting.";
    if (isPaused()) return "Automation is paused. Press Resume automation at the top to start.";
    if (!goalsWritten()) return "Write your goals below and save them first.";
    if (state.task === "custom" && state.instruction.trim() === "")
      return "A custom pass needs a note: say what you want done.";
    return null;
  }

  /** How long a finished run took, e.g. "4 min 10 s". */
  function durationText(result) {
    const seconds = Math.round(
      (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000,
    );
    if (!Number.isFinite(seconds) || seconds < 0) return "unknown time";
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }

  /** The last finished run: how it ended, the model's own summary, and the counts. */
  function lastResultBlock() {
    const last = state.agent.last;
    if (!last) return h("p", { class: "note" }, "No run has finished yet.");
    return h(
      "div",
      { class: "note-gap", id: "autopilotLast" },
      h(
        "p",
        { class: last.outcome === "failed" ? "title failed" : "title" },
        `${OUTCOME_LABELS[last.outcome] ?? last.outcome} ${whenText(last.finishedAt)}`,
      ),
      h("p", {}, last.summary),
      h(
        "p",
        { class: "meta" },
        `${last.task}, ${last.toolCalls} tool calls, ${last.turns} turns, ${durationText(last)}.`,
      ),
    );
  }

  /** Starts a run with the chosen task and note; a refusal shows its sentence. */
  async function startAutopilot() {
    state.starting = true;
    drawAutopilotBox(true);
    try {
      state.agent = await context.api.startAgent(state.task, state.instruction.trim());
      context.clearError();
    } catch (error) {
      context.showError(error.message);
      const agent = await tryLoad(() => context.api.getAgent());
      if (agent !== null) state.agent = agent;
    }
    state.starting = false;
    drawAutopilot(true);
    schedulePoll();
  }

  /** Stops the run; the sentence of a refusal, if any, is shown. */
  async function stopAutopilot() {
    try {
      state.agent = await context.api.stopAgent();
      context.clearError();
    } catch (error) {
      context.showError(error.message);
    }
    drawAutopilot(true);
    schedulePoll();
  }

  /** The start controls: the big button, Stop, the reason, the kind of pass, the note and the last result. */
  function drawAutopilotBox(force) {
    const blocker = startBlocker();
    const signature = JSON.stringify([
      state.agent.running,
      state.agent.task,
      state.starting,
      blocker,
      state.agent.last?.finishedAt,
    ]);
    if (!force && signature === boxSignature) return;
    boxSignature = signature;
    clearChildren(autopilotBox);
    const running = state.agent.running;
    const runningText = `Running: ${state.agent.task ?? "a pass"}${
      state.agent.startedAt ? `, started ${whenText(state.agent.startedAt)}` : ""
    }. This page checks every 2 seconds.`;
    appendChildren(autopilotBox, [
      h(
        "div",
        { class: "start-row" },
        h(
          "button",
          {
            class: "btn primary big",
            type: "button",
            id: "autopilotStart",
            disabled: blocker !== null,
            "aria-describedby": "autopilotReason",
            on: { click: () => void startAutopilot() },
          },
          running ? "Autopilot is running" : "Start autopilot",
        ),
        h(
          "button",
          {
            class: "btn big",
            type: "button",
            id: "autopilotStop",
            disabled: !running,
            on: { click: () => void stopAutopilot() },
          },
          "Stop",
        ),
      ),
      h(
        "p",
        { class: "note", id: "autopilotReason", role: "status" },
        running
          ? runningText
          : (blocker ?? "Ready. Scout's model decides the steps and uses Scout's tools."),
      ),
      h(
        "div",
        { class: "pf start-options" },
        h("label", { for: "autopilotTask" }, "What should it do?"),
        h(
          "select",
          {
            id: "autopilotTask",
            class: "fld",
            disabled: running,
            on: {
              change: (event) => {
                state.task = event.target.value;
                drawAutopilotBox(true);
              },
            },
          },
          TASKS.map(([value, label]) =>
            h("option", { value, selected: value === state.task }, label),
          ),
        ),
        h("label", { for: "autopilotNote" }, "Note for the model (optional)"),
        h("textarea", {
          id: "autopilotNote",
          class: "fld",
          rows: "2",
          maxlength: "2000",
          placeholder: "For example: only remote roles today.",
          disabled: running,
          value: state.instruction,
          on: {
            input: (event) => {
              state.instruction = event.target.value;
              const start = autopilotBox.querySelector('[id="autopilotStart"]');
              if (start && state.task === "custom") start.disabled = startBlocker() !== null;
            },
          },
        }),
      ),
      lastResultBlock(),
    ]);
  }

  /** One line of the log. The model's words are shown as text, never as markup. */
  function eventRow(event) {
    const kind = EVENT_LABELS[event.kind] ? event.kind : "system";
    const time = new Date(event.at);
    return h(
      "div",
      { class: `ev ev-${kind}` },
      h("span", { class: "when" }, Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString()),
      h("span", { class: "kind" }, EVENT_LABELS[kind]),
      h("span", { class: "what" }, event.summary),
    );
  }

  /** The live log: newest at the bottom; follows it unless the owner scrolled up. */
  function drawLog(force) {
    const events = state.agent.events;
    const signature = JSON.stringify([events.length, events[0]?.at, events.at(-1)?.at]);
    if (!force && signature === logSignature) return;
    logSignature = signature;
    const keepTop = logList.scrollTop;
    clearChildren(logList);
    if (events.length === 0) {
      logList.appendChild(
        h("p", { class: "meta" }, "Nothing yet. The log fills in while autopilot runs."),
      );
    }
    for (const event of events) logList.appendChild(eventRow(event));
    logList.scrollTop = followLog ? logList.scrollHeight : keepTop;
  }

  /** Redraws the start box and the log (both only when they changed, unless forced). */
  function drawAutopilot(force = false) {
    if (state.agent === null) return;
    drawAutopilotBox(force);
    drawLog(force);
  }

  /** The Autopilot section; absent when the server has no autopilot. */
  function autopilotSection() {
    if (state.agent === null) return null;
    drawAutopilot(true);
    return h(
      "section",
      { id: "controlAutopilot" },
      h("h2", {}, "Autopilot"),
      h(
        "p",
        { class: "note" },
        "Press Start and Scout's model does the whole job hunt with Scout's tools. You can watch it below and press Stop or Pause at any time.",
      ),
      autopilotBox,
      h("h3", { class: "sub" }, "Live log"),
      logList,
    );
  }

  /** Saves the goals text; the server's sentence is shown when it refuses. */
  async function saveGoals() {
    try {
      state.goals = await context.api.putGoals(state.goalsDraft);
      state.goalsDraft = state.goals.text;
      state.goalsMessage = state.goals.written
        ? "Saved. Scout's model reads this at the start of every run."
        : "Saved, but this is still the starter text. Replace it with your own words.";
      context.clearError();
    } catch (error) {
      state.goalsMessage = "";
      context.showError(error.message);
    }
    render();
  }

  /** The goals editor; absent when the server has no goals store. */
  function goalsSection() {
    if (state.goals === null) return null;
    return h(
      "section",
      { id: "controlGoals" },
      h("h2", {}, "Goals"),
      h(
        "p",
        { class: "note" },
        "Write what you want in your own words; Scout's model reads this every run.",
      ),
      h("label", { for: "goalsText", class: "small" }, "Your goals"),
      h("textarea", {
        id: "goalsText",
        class: "fld goals",
        rows: "10",
        value: state.goalsDraft,
        on: {
          input: (event) => {
            state.goalsDraft = event.target.value;
          },
        },
      }),
      h(
        "div",
        { class: "start-row" },
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            id: "goalsSave",
            on: { click: () => void saveGoals() },
          },
          "Save goals",
        ),
      ),
      h(
        "p",
        { class: "note", id: "goalsMessage", role: "status" },
        state.goalsMessage ||
          "The model decides what to look for and what to skip from this text. Scout applies no filter rules of its own.",
      ),
    );
  }

  /** One read-only line: the model and how many turns the last run used. */
  function modelSection() {
    if (state.agent === null) return null;
    const name = state.health?.modelName ?? "Sonnet 5.5";
    const last = state.agent.last;
    return h(
      "section",
      { id: "controlModel" },
      h("h2", {}, "AI model"),
      h(
        "p",
        { class: "small" },
        `Model: ${name} (your own Claude login).${last ? ` Last run used ${last.turns} turns.` : ""}`,
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
      autopilotSection(),
      goalsSection(),
      statusSection(),
      modelSection(),
      platformsSection(),
      approvedSection(),
    ]) {
      if (section) root.appendChild(section);
    }
    if (followLog) logList.scrollTop = logList.scrollHeight;
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

  /** Keeps asking the server while autopilot runs, and stops when it is done. */
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!state.agent?.running) return;
    pollTimer = setTimeout(() => void poll(), POLL_MILLISECONDS);
  }

  /** One poll: refresh the autopilot state, and the health facts once the run has finished. */
  async function poll() {
    pollTimer = null;
    const agent = await tryLoad(() => context.api.getAgent());
    if (agent !== null) state.agent = agent;
    if (state.agent?.running) {
      drawAutopilot();
    } else {
      const health = await tryLoad(() => context.api.getHealth());
      if (health !== null) state.health = health;
      render();
    }
    schedulePoll();
  }

  /**
   * Called when the pause switch changed elsewhere (the header button or Settings). Pausing stops a
   * running autopilot on the server, so the page asks again at once and shows the stop.
   */
  async function refreshAfterPause(paused) {
    if (!state.loaded) return;
    if (state.health?.report) state.health.report.automationPaused = paused;
    const agent = await tryLoad(() => context.api.getAgent());
    if (agent !== null) state.agent = agent;
    render();
    schedulePoll();
  }

  /** Fetches everything the tab shows, then draws. */
  async function load() {
    const [health, agent, goals, platforms] = await Promise.all([
      tryLoad(() => context.api.getHealth()),
      tryLoad(() => context.api.getAgent()),
      tryLoad(() => context.api.getGoals()),
      tryLoad(() => context.api.getPlatforms()),
    ]);
    state.health = health;
    state.agent = agent;
    state.platforms = platforms;
    const untouched = state.goals === null || state.goalsDraft === state.goals.text;
    if (goals !== null && untouched) state.goalsDraft = goals.text;
    state.goals = goals;
    state.loaded = true;
    if (health?.report) onPausedFacts(health.report.automationPaused);
    render();
    schedulePoll();
  }

  return { load, refreshAfterPause };
}
