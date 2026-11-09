/* global setTimeout, clearTimeout */
/**
 * The Applications view: every application in one table, found by company, role, recruiter, phone,
 * job id or notes. A row opens a panel with the recruiter's details, the next step, a control to
 * report a new status, a form to log a call or email, and the history. A second form adds an
 * application made outside Scout. All data comes from the server and goes into the page as text.
 */
import { clearChildren, h, safeHttpUrl } from "./dom.js";

/** The statuses offered in the filter: the ones an application can have once it was sent. */
const FILTER_STATUSES = [
  "applied",
  "unverified",
  "contacted",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

/** The history kinds the user may add by hand, with their labels. */
const LOG_KINDS = [
  ["call", "Call"],
  ["email", "Email"],
  ["message", "Message"],
  ["interview", "Interview"],
  ["follow-up", "Follow-up"],
  ["note", "Note"],
];

/** Labels for every history kind, including the two Scout writes itself. */
const KIND_LABELS = {
  applied: "Applied",
  status: "Status change",
  ...Object.fromEntries(LOG_KINDS),
};

/** How long to wait after the last keystroke before searching, in milliseconds. */
const SEARCH_PAUSE_MILLISECONDS = 250;

/** The recruiter and job fields of the details form: key, label, input type and autocomplete hint. */
const DETAIL_FIELDS = [
  ["recruiterName", "Recruiter name", "text"],
  ["recruiterFirm", "Recruiter firm", "text"],
  ["recruiterEmail", "Recruiter email", "text"],
  ["recruiterPhone", "Recruiter phone", "tel"],
  ["recruiterLinkedin", "Recruiter LinkedIn", "text"],
  ["externalJobId", "Company job ID", "text"],
  ["appliedVia", "Applied via", "text"],
];

/** The date part of an ISO time. Example: "2026-11-07T10:00:00.000Z" gives "2026-11-07"; "" gives "". */
export function dayOf(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

/** Puts focus on an element when it can take it. */
function focusElement(element) {
  if (element && typeof element.focus === "function") element.focus();
}

/**
 * Builds a labelled field. Returns `{ wrap, input }`: put `wrap` in the form, read `input.value`.
 * `options`: `{ type, value, tag, rows, required, autocomplete }`.
 */
function field(id, label, options = {}) {
  const tag = options.tag ?? "input";
  const input = h(tag, {
    id,
    class: "fld",
    type: tag === "input" ? (options.type ?? "text") : null,
    rows: options.rows,
    value: options.value ?? "",
    required: options.required ? true : null,
    autocomplete: options.autocomplete ?? "off",
  });
  return { wrap: h("div", {}, h("label", { for: id }, label), input), input };
}

/** Builds a labelled drop-down from `[value, label]` pairs. Returns `{ wrap, input }`. */
function selectField(id, label, choices) {
  const input = h(
    "select",
    { id, class: "fld" },
    choices.map(([value, text]) => h("option", { value }, text)),
  );
  return { wrap: h("div", {}, h("label", { for: id }, label), input), input };
}

/** Shows `text` in a status line element; an error also gets the alert role so it is announced. */
function say(element, text, isError) {
  element.textContent = text;
  element.setAttribute("role", isError ? "alert" : "status");
}

/**
 * Creates the Applications view inside `root`. `onDueCount(count)` receives how many next steps
 * are due after every list load, so the page can show it beside the tab name.
 * Returns `{ load, refreshDueCount }`.
 */
export function createApplicationsView(root, context, onDueCount) {
  const filters = { search: "", status: "", dueOnly: false };
  const state = { entries: [], detail: null };
  let listTicket = 0;
  let searchTimer;

  const listPane = h("div", {});
  const detailPane = h("div", { hidden: true });
  const addPane = h("div", { hidden: true });
  root.appendChild(listPane);
  root.appendChild(detailPane);
  root.appendChild(addPane);

  /** Shows one of the three panes and hides the others. */
  function showPane(name) {
    listPane.hidden = name !== "list";
    detailPane.hidden = name !== "detail";
    addPane.hidden = name !== "add";
  }

  // ---- The list -------------------------------------------------------------------------------

  const tableHolder = h("div", { "aria-live": "polite" });
  const searchField = field("apps-search", "Search", { type: "search" });
  searchField.input.setAttribute("placeholder", "Company, role, recruiter, phone, job ID, notes");
  const statusFilter = selectField("apps-status", "Status", [
    ["", "All statuses"],
    ...FILTER_STATUSES.map((status) => [status, status]),
  ]);
  const dueToggle = h("input", { id: "apps-due", type: "checkbox", class: "apps-check" });
  const addButton = h("button", { type: "button", class: "btn primary" }, "Add application");

  searchField.input.addEventListener("input", () => {
    filters.search = searchField.input.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refreshList(), SEARCH_PAUSE_MILLISECONDS);
  });
  statusFilter.input.addEventListener("change", () => {
    filters.status = statusFilter.input.value;
    void refreshList();
  });
  dueToggle.addEventListener("change", () => {
    filters.dueOnly = dueToggle.checked;
    void refreshList();
  });
  addButton.addEventListener("click", openAddForm);

  listPane.appendChild(
    h(
      "div",
      { class: "apps-toolbar" },
      h("div", { class: "apps-search" }, searchField.wrap),
      statusFilter.wrap,
      h("div", { class: "apps-due" }, dueToggle, h("label", { for: "apps-due" }, "Due only")),
      addButton,
    ),
  );
  listPane.appendChild(tableHolder);

  /** Fetches the list with the current filters and draws it; a slower, older answer is ignored. */
  async function refreshList() {
    listTicket += 1;
    const ticket = listTicket;
    try {
      const reply = await context.api.getApplications({
        search: filters.search,
        statuses: filters.status === "" ? [] : [filters.status],
        dueOnly: filters.dueOnly,
      });
      if (ticket !== listTicket) return;
      state.entries = reply.applications;
      onDueCount(reply.dueCount);
      drawTable();
      context.clearError();
    } catch (error) {
      if (ticket === listTicket) context.showError(error.message);
    }
  }

  /** Asks only for the due count, for the badge, without drawing anything. */
  async function refreshDueCount() {
    try {
      const reply = await context.api.getApplications({ search: "", statuses: [], dueOnly: true });
      onDueCount(reply.dueCount);
    } catch {
      onDueCount(0);
    }
  }

  /** The text of the "Next step" cell: the step, its date, and a bold "Due" when it has come. */
  function nextStepCell(entry) {
    const step = entry.details.nextStep ?? "";
    const date = entry.details.nextStepDate ?? "";
    if (step === "" && date === "") return "";
    return [
      entry.followUpDue ? h("b", {}, "Due ") : null,
      step,
      date === "" ? null : h("span", { class: "small" }, ` ${date}`),
    ];
  }

  /** The text of the "Recruiter" cell: name and phone. */
  function recruiterCell(entry) {
    const { recruiterName, recruiterPhone } = entry.details;
    return [
      recruiterName ?? "",
      recruiterPhone ? h("div", { class: "small" }, recruiterPhone) : null,
    ];
  }

  /** One table row; clicking it, or pressing the company button, opens the panel. */
  function rowOf(entry) {
    const open = h(
      "button",
      {
        type: "button",
        class: "apps-open",
        "data-open": entry.id,
        "aria-label": `Open ${entry.company}, ${entry.title}`,
      },
      entry.company,
    );
    return h(
      "tr",
      { class: "apps-row", "data-id": entry.id, on: { click: () => void openDetail(entry.id) } },
      h("td", { class: "mono-cell" }, dayOf(entry.appliedAt)),
      h("th", { scope: "row" }, open),
      h("td", {}, entry.title),
      h("td", { class: "mono-cell apps-job" }, entry.jobNumber),
      h("td", {}, entry.status),
      h("td", { class: "apps-recruiter" }, recruiterCell(entry)),
      h("td", { class: "apps-next" }, nextStepCell(entry)),
    );
  }

  /** Draws the table, or a sentence saying why there is none. */
  function drawTable() {
    clearChildren(tableHolder);
    if (state.entries.length === 0) {
      const filtered = filters.search !== "" || filters.status !== "" || filters.dueOnly;
      tableHolder.appendChild(
        h(
          "p",
          { class: "note" },
          filtered
            ? "No application matches. Clear the search or the filters."
            : "No applications yet. Add one that you made outside Scout, or approve jobs in the Digest.",
        ),
      );
      return;
    }
    const headings = ["Applied", "Company", "Role", "Job ID", "Status", "Recruiter", "Next step"];
    tableHolder.appendChild(
      h(
        "div",
        { class: "apps-wrap" },
        h(
          "table",
          { class: "apps-table" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              headings.map((name) => h("th", { scope: "col" }, name)),
            ),
          ),
          h(
            "tbody",
            {},
            state.entries.map((entry) => rowOf(entry)),
          ),
        ),
      ),
    );
  }

  // ---- The detail panel -----------------------------------------------------------------------

  /** Opens the panel for one application; a failure is shown in the page banner. */
  async function openDetail(id) {
    try {
      state.detail = await context.api.getApplication(id);
    } catch (error) {
      context.showError(error.message);
      return;
    }
    context.clearError();
    drawDetail();
    showPane("detail");
    focusElement(detailPane.querySelector('[data-role="title"]'));
  }

  /** Re-reads the open application so the history order, status and due flag are the server's. */
  async function reloadDetail() {
    state.detail = await context.api.getApplication(state.detail.id);
  }

  /** Back to the list, refreshed, with focus on the row that was open. */
  function closeDetail() {
    const id = state.detail?.id;
    state.detail = null;
    showPane("list");
    void refreshList().then(() => {
      focusElement(tableHolder.querySelector(`[data-open="${id}"]`));
    });
  }

  const headerBox = h("div", {});
  const statusBox = h("div", {});
  const historyBox = h("div", {});

  /** The facts at the top of the panel: title, status, dates, job id and the posting link. */
  function drawHeader() {
    const detail = state.detail;
    clearChildren(headerBox);
    const address = safeHttpUrl(detail.link);
    const facts = [
      ["Status", detail.statusReason ? `${detail.status} (${detail.statusReason})` : detail.status],
      ["Applied", dayOf(detail.appliedAt)],
      ["Location", detail.location],
      ["Job ID", detail.jobNumber],
      ["Board", detail.board],
    ];
    headerBox.appendChild(
      h("h2", { class: "apps-title", tabindex: "-1", "data-role": "title" }, detail.company),
    );
    headerBox.appendChild(h("p", { class: "title" }, detail.title));
    if (detail.followUpDue) {
      headerBox.appendChild(
        h("p", { class: "note" }, h("b", {}, "Next step is due."), " ", dueText(detail)),
      );
    }
    headerBox.appendChild(
      h(
        "dl",
        { class: "qa apps-facts" },
        facts
          .filter(([, value]) => value)
          .flatMap(([name, value]) => [h("dt", {}, name), h("dd", {}, value)]),
        address
          ? [
              h("dt", {}, "Link"),
              h(
                "dd",
                {},
                h("a", { href: address, target: "_blank", rel: "noopener noreferrer" }, address),
              ),
            ]
          : null,
      ),
    );
  }

  /** The next step and its date, for the due notice. */
  function dueText(detail) {
    const { nextStep, nextStepDate } = detail.details;
    return [nextStep ?? "", nextStepDate ? ` (${nextStepDate})` : ""].join("");
  }

  /** The details form: recruiter, job id, applied via, next step. Saves with one button. */
  function buildDetailsForm() {
    const detail = state.detail;
    const prefix = "apps-d-";
    const fields = DETAIL_FIELDS.map(([key, label, type]) =>
      field(prefix + key, label, { type, value: detail.details[key] ?? "" }),
    );
    const nextStep = field(`${prefix}nextStep`, "Next step", {
      value: detail.details.nextStep ?? "",
    });
    const nextDate = field(`${prefix}nextStepDate`, "Next step date", {
      type: "date",
      value: detail.details.nextStepDate ?? "",
    });
    const message = h("p", { class: "small", tabindex: "-1" });
    const save = h("button", { type: "submit", class: "btn primary" }, "Save details");
    const form = h(
      "form",
      {
        class: "form",
        "aria-label": "Recruiter and next step",
        on: {
          submit: async (event) => {
            event.preventDefault();
            const body = {};
            DETAIL_FIELDS.forEach(([key], index) => {
              body[key] = fields[index].input.value.trim();
            });
            body.nextStep = nextStep.input.value.trim();
            body.nextStepDate = nextDate.input.value.trim();
            save.disabled = true;
            try {
              state.detail = await context.api.putApplicationDetails(detail.id, body);
              drawHeader();
              say(message, "Saved.", false);
            } catch (error) {
              say(message, error.message, true);
            } finally {
              save.disabled = false;
              focusElement(message);
            }
          },
        },
      },
      h("h3", {}, "Recruiter and next step"),
      fields.map((item) => item.wrap),
      nextStep.wrap,
      nextDate.wrap,
      h("div", { class: "fbtns" }, save, message),
    );
    return form;
  }

  /** The "Report status" control: only the moves the server says are allowed right now. */
  function drawStatusForm(announcement) {
    const detail = state.detail;
    clearChildren(statusBox);
    if (detail.allowedStatuses.length === 0) {
      statusBox.appendChild(h("h3", {}, "Report status"));
      const final = h(
        "p",
        { class: "note", tabindex: "-1" },
        `${announcement === undefined ? "" : `${announcement} `}This application is ${detail.status}. No further status can be reported.`,
      );
      statusBox.appendChild(final);
      if (announcement !== undefined) focusElement(final);
      return;
    }
    const choice = selectField(
      "apps-s-status",
      "New status",
      detail.allowedStatuses.map((status) => [status, status]),
    );
    const note = field("apps-s-note", "Note (optional)");
    const date = field("apps-s-date", "Date (optional)", { type: "date" });
    const message = h("p", { class: "small", tabindex: "-1" });
    const send = h("button", { type: "submit", class: "btn primary" }, "Report status");
    if (announcement !== undefined) say(message, announcement, false);
    statusBox.appendChild(
      h(
        "form",
        {
          class: "form",
          "aria-label": "Report status",
          on: {
            submit: async (event) => {
              event.preventDefault();
              const body = { status: choice.input.value };
              if (note.input.value.trim() !== "") body.note = note.input.value.trim();
              if (date.input.value !== "") body.at = date.input.value;
              send.disabled = true;
              try {
                state.detail = await context.api.reportApplicationStatus(detail.id, body);
                drawHeader();
                drawHistory();
                drawStatusForm(`Status is now ${state.detail.status}.`);
                void refreshDueCount();
              } catch (error) {
                say(message, error.message, true);
                send.disabled = false;
                focusElement(message);
              }
            },
          },
        },
        h("h3", {}, "Report status"),
        choice.wrap,
        note.wrap,
        date.wrap,
        h("div", { class: "fbtns" }, send, message),
      ),
    );
    if (announcement !== undefined) focusElement(message);
  }

  /** The form that logs a call, email, message, interview, follow-up or note. */
  function buildLogForm() {
    const kind = selectField("apps-l-kind", "Kind", LOG_KINDS);
    const summary = field("apps-l-summary", "What happened", { required: true });
    const contact = field("apps-l-contact", "Who (optional)");
    const date = field("apps-l-date", "Date (optional)", { type: "date" });
    const more = field("apps-l-detail", "More detail (optional)", { tag: "textarea", rows: 3 });
    const message = h("p", { class: "small", tabindex: "-1" });
    const save = h("button", { type: "submit", class: "btn primary" }, "Add to history");
    return h(
      "form",
      {
        class: "form",
        "aria-label": "Log a call, email or note",
        on: {
          submit: async (event) => {
            event.preventDefault();
            const body = { kind: kind.input.value, summary: summary.input.value.trim() };
            if (contact.input.value.trim() !== "") body.contact = contact.input.value.trim();
            if (date.input.value !== "") body.at = date.input.value;
            if (more.input.value.trim() !== "") body.detail = more.input.value.trim();
            save.disabled = true;
            try {
              await context.api.addApplicationEvent(state.detail.id, body);
              await reloadDetail();
              drawHeader();
              drawHistory();
              summary.input.value = "";
              contact.input.value = "";
              date.input.value = "";
              more.input.value = "";
              say(message, "Added to the history.", false);
            } catch (error) {
              say(message, error.message, true);
            } finally {
              save.disabled = false;
              focusElement(message);
            }
          },
        },
      },
      h("h3", {}, "Log a call, email or note"),
      kind.wrap,
      summary.wrap,
      contact.wrap,
      date.wrap,
      more.wrap,
      h("div", { class: "fbtns" }, save, message),
    );
  }

  /** The history, oldest first so the newest entry is last, each with its kind named in words. */
  function drawHistory() {
    clearChildren(historyBox);
    historyBox.appendChild(h("h3", {}, "History"));
    const events = state.detail.events;
    if (events.length === 0) {
      historyBox.appendChild(h("p", { class: "note" }, "Nothing recorded yet."));
      return;
    }
    historyBox.appendChild(
      h(
        "ol",
        { class: "apps-history" },
        events.map((event) =>
          h(
            "li",
            { "data-kind": event.kind },
            h(
              "p",
              { class: "apps-event-head" },
              h("span", { class: "mono-cell" }, dayOf(event.at)),
              " ",
              h("span", { class: "chip" }, KIND_LABELS[event.kind] ?? event.kind),
              event.contact ? h("span", { class: "small" }, ` with ${event.contact}`) : null,
            ),
            h("p", { class: "apps-event-summary" }, event.summary),
            event.detail ? h("p", { class: "small apps-event-detail" }, event.detail) : null,
          ),
        ),
      ),
    );
  }

  /** Builds the whole panel for `state.detail`. Form fields start from the saved values. */
  function drawDetail() {
    clearChildren(detailPane);
    const back = h(
      "button",
      { type: "button", class: "link", on: { click: closeDetail } },
      "Back to applications",
    );
    drawHeader();
    drawStatusForm();
    drawHistory();
    detailPane.appendChild(h("div", { class: "addrow" }, back));
    detailPane.appendChild(headerBox);
    detailPane.appendChild(buildDetailsForm());
    detailPane.appendChild(statusBox);
    detailPane.appendChild(buildLogForm());
    detailPane.appendChild(historyBox);
  }

  // ---- The add form ---------------------------------------------------------------------------

  /** Shows an empty form for an application made outside Scout. */
  function openAddForm() {
    clearChildren(addPane);
    const company = field("apps-a-company", "Company", { required: true });
    const title = field("apps-a-title", "Role", { required: true });
    const link = field("apps-a-link", "Link to the posting", { type: "url" });
    const date = field("apps-a-date", "Date applied", { type: "date" });
    const recruiter = DETAIL_FIELDS.slice(0, 5).map(([key, label, type]) =>
      field(`apps-a-${key}`, label, { type }),
    );
    const message = h("p", { class: "small", tabindex: "-1" });
    const save = h("button", { type: "submit", class: "btn primary" }, "Add application");
    const cancel = h(
      "button",
      { type: "button", class: "btn", on: { click: leaveAddForm } },
      "Cancel",
    );
    addPane.appendChild(
      h(
        "form",
        {
          class: "form",
          "aria-label": "Add an application",
          on: {
            submit: async (event) => {
              event.preventDefault();
              const body = { company: company.input.value.trim(), title: title.input.value.trim() };
              if (link.input.value.trim() !== "") body.link = link.input.value.trim();
              if (date.input.value !== "") body.appliedOn = date.input.value;
              const details = {};
              DETAIL_FIELDS.slice(0, 5).forEach(([key], index) => {
                const value = recruiter[index].input.value.trim();
                if (value !== "") details[key] = value;
              });
              if (Object.keys(details).length > 0) body.details = details;
              save.disabled = true;
              try {
                const created = await context.api.addApplication(body);
                void refreshDueCount();
                await openDetail(created.id);
              } catch (error) {
                say(message, error.message, true);
                focusElement(message);
              } finally {
                save.disabled = false;
              }
            },
          },
        },
        h("h2", {}, "Add an application made outside Scout"),
        company.wrap,
        title.wrap,
        link.wrap,
        date.wrap,
        recruiter.map((item) => item.wrap),
        h("div", { class: "fbtns" }, save, cancel, message),
      ),
    );
    showPane("add");
    focusElement(company.input);
  }

  /** Leaves the add form without saving and puts focus back on the button that opened it. */
  function leaveAddForm() {
    showPane("list");
    focusElement(addButton);
  }

  return {
    /** Called each time the tab is shown: reloads the list (the open panel stays as it was). */
    load: () => refreshList(),
    refreshDueCount,
  };
}
