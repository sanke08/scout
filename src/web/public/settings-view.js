/* global document, setTimeout, clearTimeout */
/**
 * The Settings view. Every control saves the moment it changes: the page sends the whole settings
 * object to the server, shows "Saved." on success, and puts the control back to the stored value
 * (with the server's sentence in the error banner) on failure.
 */
import { clearChildren, h } from "./dom.js";

/** The job boards offered a level of their own. Boards not listed here are still kept if stored. */
const KNOWN_BOARDS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"];

/** The three levels a board can have, in the order the select shows them. */
const BOARD_LEVELS = [
  ["prepare", "Prepare only"],
  ["fill", "Fill, I submit"],
  ["auto", "Automatic"],
];

/** Text shown when nothing was just saved. */
const IDLE_MESSAGE = "Changes save automatically.";

/** A name and explanation line used by every setting row. */
function labelBlock(id, name, description) {
  return h(
    "div",
    { class: "lbl" },
    h("label", { for: id }, name),
    description && h("p", {}, description),
  );
}

/** A row with a label on the left and a control on the right. */
function row(id, name, description, ...controls) {
  return h(
    "div",
    { class: "set" },
    labelBlock(id, name, description),
    h("div", { class: "ctl" }, controls),
  );
}

/** Creates the Settings view inside `root`; returns `{ load }`. `onChanged` gets each saved settings object. */
export function createSettingsView(root, context, onChanged) {
  const state = { settings: null, defaults: null, message: IDLE_MESSAGE };
  let messageTimer = null;
  /** The last save in flight; the next save waits for it so saves never overtake each other. */
  let queue = Promise.resolve();

  function showMessage(text) {
    state.message = text;
    const element = document.getElementById("savedMessage");
    if (element) element.textContent = text;
  }

  /**
   * Saves the settings that `makeNext` builds from the latest stored copy (read when this save's
   * turn comes, so quick successive changes never overwrite each other). A failure puts the page
   * back to the stored values.
   */
  function save(makeNext) {
    queue = queue.then(async () => {
      try {
        const reply = await context.api.putSettings(makeNext(state.settings));
        state.settings = reply.settings;
        context.clearError();
        showMessage("Saved.");
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => showMessage(IDLE_MESSAGE), 1600);
        onChanged(state.settings);
      } catch (error) {
        context.showError(error.message);
      }
      render();
    });
    return queue;
  }

  /** Saves one changed setting. */
  function change(key, value) {
    return save((latest) => ({ ...latest, [key]: value }));
  }

  /** A switch bound to a yes-or-no setting. */
  function switchFor(key, id) {
    return h("input", {
      id,
      class: "sw",
      type: "checkbox",
      role: "switch",
      checked: state.settings[key],
      on: { change: (event) => change(key, event.target.checked) },
    });
  }

  /** A whole-number input bound to a number setting. An empty or invalid entry is put back. */
  function numberFor(key, id, min, max) {
    return h("input", {
      id,
      type: "number",
      min,
      max,
      value: state.settings[key],
      on: {
        change: (event) => {
          const number = Number(event.target.value);
          if (event.target.value === "" || !Number.isInteger(number)) render();
          else change(key, number);
        },
      },
    });
  }

  /** A select bound to a setting; `options` is a list of `[value, label]`. */
  function selectFor(id, options, current, onPick) {
    return h(
      "select",
      { id, on: { change: (event) => onPick(event.target.value) } },
      options.map(([value, label]) => h("option", { value, selected: value === current }, label)),
    );
  }

  /** The three "when Scout applies" radio rows. */
  function applyModeSection() {
    const modes = [
      [
        "approve",
        "Wait for my approval",
        "Scout fills the form, then waits. Nothing is sent until you approve it in the digest.",
      ],
      [
        "auto",
        "Apply automatically on trusted boards",
        "Scout submits on boards you set to Automatic below. Everything else still waits for you.",
      ],
      [
        "prepare",
        "Prepare only",
        "Scout never submits. It gets everything ready and you apply yourself.",
      ],
    ];
    return h(
      "section",
      {},
      h("h2", {}, "When Scout applies"),
      h(
        "div",
        { class: "group" },
        modes.map(([value, name, description]) =>
          h(
            "label",
            { class: "opt" },
            h("input", {
              type: "radio",
              name: "applyMode",
              value,
              checked: state.settings.applyMode === value,
              on: { change: () => change("applyMode", value) },
            }),
            h("span", {}, h("span", { class: "name" }, name), h("p", {}, description)),
          ),
        ),
      ),
      h(
        "div",
        { class: "group" },
        row(
          "dryRunFirst",
          "Dry run first on new boards",
          "Fill the form and stop before submitting, until the board has a clean record.",
          switchFor("dryRunFirst", "dryRunFirst"),
        ),
        row(
          "dailyApplicationLimit",
          "Daily application limit",
          "Scout stops applying for the day after this many.",
          numberFor("dailyApplicationLimit", "dailyApplicationLimit", 0, 50),
        ),
        row(
          "minimumShortlistScore",
          "Minimum score for the shortlist",
          "Jobs below this score are skipped.",
          h("input", {
            id: "minimumShortlistScore",
            type: "range",
            min: 0,
            max: 100,
            step: 1,
            value: state.settings.minimumShortlistScore,
            on: {
              input: (event) => {
                document.getElementById("minimumValue").textContent = event.target.value;
              },
              change: (event) => change("minimumShortlistScore", Number(event.target.value)),
            },
          }),
          h(
            "span",
            { class: "val", id: "minimumValue" },
            String(state.settings.minimumShortlistScore),
          ),
        ),
      ),
    );
  }

  /** One select per board, using the stored level or "Prepare only" when none is stored. */
  function boardsSection() {
    const boards = [...new Set([...KNOWN_BOARDS, ...Object.keys(state.settings.boardLevels)])];
    return h(
      "section",
      {},
      h("h2", {}, "Job boards"),
      h(
        "div",
        { class: "group" },
        boards.map((board) => {
          const id = `board-${board}`;
          const current = state.settings.boardLevels[board] ?? "prepare";
          const pick = (level) =>
            save((latest) => ({
              ...latest,
              boardLevels: { ...latest.boardLevels, [board]: level },
            }));
          return row(
            id,
            board.charAt(0).toUpperCase() + board.slice(1),
            null,
            selectFor(id, BOARD_LEVELS, current, pick),
          );
        }),
      ),
      h(
        "p",
        { class: "note" },
        'Automatic works only after you choose "Apply automatically on trusted boards" above.',
      ),
    );
  }

  /** The rest of the settings, one section each. */
  function otherSections() {
    return [
      h(
        "section",
        {},
        h("h2", {}, "LinkedIn, Indeed and Naukri"),
        h(
          "div",
          { class: "group" },
          row(
            "readAlertEmails",
            "Read job-alert emails",
            "Scout finds jobs from your alert emails. It never applies on these sites by itself; it opens the page and you submit.",
            switchFor("readAlertEmails", "readAlertEmails"),
          ),
        ),
      ),
      h(
        "section",
        {},
        h("h2", {}, "Model"),
        h(
          "div",
          { class: "group" },
          row(
            "mainEngine",
            "Main engine",
            "Used for scoring and tailoring.",
            selectFor(
              "mainEngine",
              [
                ["claude", "Claude Code"],
                ["codex", "Codex"],
              ],
              state.settings.mainEngine,
              (value) => change("mainEngine", value),
            ),
          ),
          row(
            "switchEngineOnLimit",
            "Switch engine when the limit is reached",
            "Otherwise Scout keeps filtering and waits for the reset.",
            switchFor("switchEngineOnLimit", "switchEngineOnLimit"),
          ),
          row(
            "dailyModelCallBudget",
            "Daily model calls",
            "Scout stays under this number.",
            numberFor("dailyModelCallBudget", "dailyModelCallBudget", 1, 500),
          ),
        ),
      ),
      h(
        "section",
        {},
        h("h2", {}, "Notifications and follow-ups"),
        h(
          "div",
          { class: "group" },
          row(
            "digestTime",
            "Digest time",
            "When the daily list is ready.",
            h("input", {
              id: "digestTime",
              type: "time",
              value: state.settings.digestTime,
              on: {
                change: (event) =>
                  event.target.value ? change("digestTime", event.target.value) : render(),
              },
            }),
          ),
          row(
            "desktopNotification",
            "Desktop notification",
            null,
            switchFor("desktopNotification", "desktopNotification"),
          ),
          row(
            "followUpAfterDays",
            "Draft a follow-up after",
            "Days without a reply. You approve it before it is sent.",
            numberFor("followUpAfterDays", "followUpAfterDays", 1, 60),
            h("span", { class: "val" }, "days"),
          ),
        ),
      ),
      h(
        "section",
        {},
        h("h2", {}, "Form answers"),
        h(
          "div",
          { class: "group" },
          row(
            "demographicAnswers",
            "Demographic and equal-opportunity questions",
            "Scout never guesses these.",
            selectFor(
              "demographicAnswers",
              [
                ["prefer-not-to-say", "Prefer not to say"],
                ["ask-each-time", "Ask me each time"],
              ],
              state.settings.demographicAnswers,
              (value) => change("demographicAnswers", value),
            ),
          ),
        ),
      ),
      h(
        "section",
        {},
        h("h2", {}, "Safety"),
        h(
          "div",
          { class: "group" },
          row(
            "automationPaused",
            "Pause all automation",
            "Stops submitting and form filling now. Finding and scoring jobs continues.",
            switchFor("automationPaused", "automationPaused"),
          ),
          h(
            "div",
            { class: "set" },
            h("div", { class: "lbl" }, h("span", { class: "name" }, "Reset to defaults")),
            h(
              "div",
              { class: "ctl" },
              h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  on: { click: () => save(() => ({ ...state.defaults })) },
                },
                "Reset",
              ),
            ),
          ),
        ),
      ),
    ];
  }

  /** Redraws the whole view from the stored settings. */
  function render() {
    clearChildren(root);
    if (state.settings === null) return;
    root.appendChild(h("p", { class: "savedmsg", id: "savedMessage" }, state.message));
    root.appendChild(applyModeSection());
    root.appendChild(boardsSection());
    for (const section of otherSections()) root.appendChild(section);
  }

  /** Fetches the stored settings and the defaults, then draws. */
  async function load() {
    try {
      const reply = await context.api.getSettings();
      state.settings = reply.settings;
      state.defaults = reply.defaults;
      onChanged(state.settings);
    } catch (error) {
      context.showError(error.message);
    }
    render();
  }

  return { load };
}
