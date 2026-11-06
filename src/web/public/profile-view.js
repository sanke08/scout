/* global document, navigator, setTimeout, clearTimeout, structuredClone */
/**
 * The Profile view: the whole profile as an editable page, the tailor preview and the resume
 * preview. Edits are saved through the server (`PUT /api/profile`), which bumps the version. The
 * resume is built by the server (`POST /api/resume`); this page only shows what comes back.
 */
import { clearChildren, h, splitTerms } from "./dom.js";
import { highlightedNodes } from "./highlight.js";
import { texToLines } from "./tex-preview.js";

/** Every status a point can have, in the order the select shows them. */
const POINT_STATUSES = ["confirmed", "from code", "ask first", "hold", "excluded"];

/** Statuses a resume may use without asking. */
const USABLE_STATUSES = ["confirmed", "from code"];

/** Text shown when nothing was just saved. */
const IDLE_MESSAGE =
  "Edits save as soon as you press Save or leave a field. Every resume is built from this page.";

/** How long the page waits after typing before it asks the server for a new preview. */
const PREVIEW_DELAY_MS = 400;

/** The contact fields, as `[key, label, required]`. Optional ones are left out of the file when empty. */
const IDENTITY_FIELDS = [
  ["name", "Name", true],
  ["location", "Location", true],
  ["phone", "Phone", false],
  ["email", "Email", false],
  ["github", "GitHub", false],
  ["linkedin", "LinkedIn", false],
  ["portfolio", "Portfolio", false],
];

/** The education fields, as `[key, label, required]`. */
const EDUCATION_FIELDS = [
  ["degree", "Degree", true],
  ["dates", "Dates", true],
  ["school", "Institution", true],
  ["grade", "Grade", false],
];

/** True when a resume may use a point of this status. */
function isUsable(point) {
  return USABLE_STATUSES.includes(point.status);
}

/** Removes keywords that repeat an earlier one when case is ignored. "Go, go" gives "Go". */
function uniqueTerms(terms) {
  const seen = new Set();
  return terms.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A labelled single-line or multi-line input, for the forms. */
function field(id, label, value, multiline) {
  const input = multiline
    ? h("textarea", { class: "fld", id, rows: 3, value })
    : h("input", { class: "fld", id, value });
  return h("div", {}, h("label", { for: id }, label), input);
}

/** Reads the current text of the input with this id, or an empty string when it is not on screen. */
function valueOf(id) {
  const element = document.getElementById(id);
  return element ? element.value : "";
}

/** A button that looks like a link. */
function linkButton(label, onClick) {
  return h("button", { class: "link", type: "button", on: { click: onClick } }, label);
}

/** A copy of `entry` with empty optional text fields removed, so they are not saved as "". */
function withoutBlankOptionals(entry, optionalKeys) {
  const cleaned = { ...entry };
  for (const key of optionalKeys) {
    if (typeof cleaned[key] === "string" && cleaned[key].trim() === "") delete cleaned[key];
  }
  return cleaned;
}

/** Creates the Profile view inside `root`; returns `{ load }`. */
export function createProfileView(root, context) {
  const state = {
    profile: null,
    pending: [],
    /** The form that is open: `{ section, entryIndex, pointIndex, draft, isNew }`. pointIndex -1 means the entry's own details. */
    editing: null,
    armedKey: null,
    keywordsText: "",
    companyText: "",
    message: IDLE_MESSAGE,
    build: null,
    buildKeywords: [],
    buildError: null,
    buildTicket: 0,
  };
  let previewTimer = null;
  let messageTimer = null;
  /** The last save in flight; the next save waits for it so saves never overtake each other. */
  let saveQueue = Promise.resolve();

  /* ---------- saving ---------- */

  function showMessage(text) {
    state.message = text;
    const element = document.getElementById("profileMessage");
    if (element) element.textContent = text;
  }

  /**
   * Sends the whole profile `next` to the server. On success the stored copy replaces the page's
   * copy, the message shows the new version and the preview is refreshed; the form is redrawn when
   * `redraw` is true. Resolves to true on success; on failure the page shows the server's sentence
   * and redraws from the stored copy.
   */
  function saveProfile(next, redraw) {
    const outcome = saveQueue.then(async () => {
      try {
        const reply = await context.api.putProfile(next);
        state.profile = reply.profile;
        context.clearError();
        showMessage(`Saved. Profile version ${reply.version}.`);
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => showMessage(IDLE_MESSAGE), 2400);
        if (redraw) render();
        schedulePreview(0);
        return true;
      } catch (error) {
        context.showError(error.message);
        render();
        return false;
      }
    });
    saveQueue = outcome;
    return outcome;
  }

  /** Saves a change to one simple field (contact, education, summary, skills) without redrawing the form. */
  function saveField(change) {
    const next = structuredClone(state.profile);
    change(next);
    return saveProfile(next, false);
  }

  /* ---------- preview ---------- */

  function schedulePreview(delay) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(requestBuild, delay);
  }

  /** Asks the server to build the resume for the saved profile and the typed keywords. */
  async function requestBuild() {
    state.buildTicket += 1;
    const ticket = state.buildTicket;
    const keywords = uniqueTerms(splitTerms(state.keywordsText));
    try {
      const build = await context.api.buildResume(keywords, state.companyText.trim());
      if (ticket !== state.buildTicket) return;
      state.build = build;
      state.buildKeywords = keywords;
      state.buildError = null;
    } catch (error) {
      if (ticket !== state.buildTicket) return;
      state.buildError = error.message;
    }
    renderResults();
  }

  /** The tailor preview text: how many keywords are supported and which are not. */
  function tailorNode() {
    if (state.buildError) return h("p", { class: "small" }, state.buildError);
    if (state.build === null) return h("p", { class: "small" }, "Building the preview.");
    const build = state.build;
    if (state.buildKeywords.length === 0) {
      return h(
        "p",
        { class: "small" },
        "Add keywords from a job description to see which keywords your profile supports.",
      );
    }
    return h(
      "div",
      {},
      h(
        "p",
        { class: "small" },
        `${build.matchedKeywords.length} of ${state.buildKeywords.length} keywords are supported by your profile.`,
        build.notInProfile.length > 0 &&
          ` Not in your profile, so not added: ${build.notInProfile.join(", ")}.`,
      ),
      h(
        "div",
        { class: "matched" },
        build.matchedKeywords.map((keyword) => h("mark", {}, keyword)),
      ),
      h("p", { class: "small" }, `Projects shown: ${build.projectsShown.join(", ") || "none"}.`),
      build.projectsLeftOut.length > 0 &&
        h("p", { class: "small" }, `Left out for this job: ${build.projectsLeftOut.join(", ")}.`),
    );
  }

  /** The preview sheet drawn from the resume's LaTeX, with matched keywords highlighted. */
  function sheetNode(texSource, keywords) {
    const sheet = h("div", { class: "sheet" });
    let list = null;
    let seenHeading = false;
    let headerLines = 0;
    let previousWasPrimaryEntry = false;
    for (const line of texToLines(texSource)) {
      const wasPrimary = previousWasPrimaryEntry;
      previousWasPrimaryEntry = false;
      if (line.kind === "heading") {
        list = null;
        seenHeading = true;
        sheet.appendChild(h("div", { class: "s-h" }, line.text));
      } else if (line.kind === "bullet") {
        if (list === null) {
          list = h("ul", {});
          sheet.appendChild(list);
        }
        list.appendChild(h("li", {}, highlightedNodes(line.text, keywords)));
      } else if (line.kind === "entry") {
        list = null;
        previousWasPrimaryEntry = !wasPrimary;
        sheet.appendChild(
          h(
            "div",
            { class: wasPrimary ? "s-e s-i" : "s-e" },
            h(wasPrimary ? "span" : "b", {}, highlightedNodes(line.text, keywords)),
            h("span", {}, line.aside),
          ),
        );
      } else if (!seenHeading) {
        sheet.appendChild(h("div", { class: headerLines === 0 ? "s-name" : "s-c" }, line.text));
        headerLines += 1;
      } else {
        sheet.appendChild(h("p", {}, highlightedNodes(line.text, keywords)));
      }
    }
    return sheet;
  }

  /** Copies the LaTeX to the clipboard, or selects it when the browser refuses. */
  function copyTex() {
    const area = document.getElementById("texOutput");
    const message = document.getElementById("copyMessage");
    const selectInstead = () => {
      area.focus();
      area.select();
      message.textContent = "Selected. Press copy on your keyboard.";
    };
    if (!navigator.clipboard) return selectInstead();
    return navigator.clipboard.writeText(area.value).then(() => {
      message.textContent = "Copied.";
    }, selectInstead);
  }

  /** The resume box: length estimate, preview sheet, LaTeX source and copy button. */
  function resumeNode() {
    if (state.buildError) return h("p", { class: "small" }, state.buildError);
    if (state.build === null) return h("p", { class: "small" }, "Building the resume.");
    const build = state.build;
    const fits = build.estimatedLines <= build.lineLimit;
    return h(
      "div",
      {},
      h(
        "p",
        { class: "small" },
        `Estimated length ${build.estimatedLines} of about ${build.lineLimit} lines, so it ` +
          (fits ? "fits on one page" : "may run past one page: shorten a point or drop a project") +
          ". This is an estimate. The real check is the page count after compiling.",
      ),
      sheetNode(build.texSource, build.matchedKeywords),
      h(
        "div",
        {},
        h("label", { class: "small", for: "texOutput" }, "LaTeX source"),
        h("textarea", {
          class: "fld mono",
          id: "texOutput",
          rows: 12,
          readonly: true,
          value: build.texSource,
        }),
      ),
      h(
        "div",
        { class: "fbtns note-gap" },
        h("button", { class: "btn primary", type: "button", on: { click: copyTex } }, "Copy LaTeX"),
        h("span", { class: "small", id: "copyMessage" }),
      ),
      h(
        "p",
        { class: "small" },
        "Compile with pdflatex twice, then check that the file has 1 page. If it has 2, cut the weakest project or shorten bullets.",
      ),
    );
  }

  /** Redraws only the two preview boxes, so typing in the keyword box is never interrupted. */
  function renderResults() {
    const tailor = document.getElementById("tailorOutput");
    const resume = document.getElementById("resumeOutput");
    const fileName = document.getElementById("fileName");
    if (tailor) {
      clearChildren(tailor);
      tailor.appendChild(tailorNode());
    }
    if (resume) {
      clearChildren(resume);
      resume.appendChild(resumeNode());
    }
    if (fileName) fileName.textContent = state.build ? `${state.build.fileStem}.tex` : "";
  }

  /* ---------- editing forms ---------- */

  /** Copies the form's current text into the open draft, so a redraw does not lose it. */
  function syncDraft() {
    const editing = state.editing;
    if (!editing) return;
    const draft = editing.draft;
    if (editing.pointIndex === -1) {
      draft.title = valueOf("head-title");
      if (editing.section === "experience") {
        draft.org = valueOf("head-org");
        draft.dates = valueOf("head-dates");
        draft.place = valueOf("head-place");
      } else {
        draft.stack = valueOf("head-stack");
        draft.link = valueOf("head-link");
        draft.live = valueOf("head-live");
        draft.note = valueOf("head-note");
      }
    } else {
      draft.text = valueOf("point-text").trim();
      draft.allowed = splitTerms(valueOf("point-terms"));
      draft.status = valueOf("point-status") || draft.status;
      draft.variants = draft.variants.map((_variant, index) => ({
        text: valueOf(`variant-text-${index}`).trim(),
        keys: splitTerms(valueOf(`variant-keys-${index}`)),
      }));
    }
  }

  function startEditing(section, entryIndex, pointIndex, draft, isNew) {
    state.editing = { section, entryIndex, pointIndex, draft, isNew };
    state.armedKey = null;
    render();
  }

  function editPoint(section, entryIndex, pointIndex) {
    const point = state.profile[section][entryIndex].points[pointIndex];
    startEditing(section, entryIndex, pointIndex, structuredClone(point), false);
  }

  function editHead(section, entryIndex) {
    const draft = structuredClone(state.profile[section][entryIndex]);
    delete draft.points;
    startEditing(section, entryIndex, -1, draft, false);
  }

  function addPoint(section, entryIndex) {
    const count = state.profile[section][entryIndex].points.length;
    startEditing(
      section,
      entryIndex,
      count,
      { text: "", allowed: [], variants: [], status: "confirmed" },
      true,
    );
  }

  function addEntry(section) {
    const blank =
      section === "experience"
        ? { title: "", org: "", dates: "", place: "" }
        : { title: "", stack: "", link: "", live: "", note: "" };
    startEditing(section, state.profile[section].length, -1, blank, true);
  }

  function cancelEditing() {
    state.editing = null;
    state.armedKey = null;
    render();
  }

  /** Checks the open draft, writes it into a copy of the profile and saves. */
  async function saveEditing() {
    syncDraft();
    const { section, entryIndex, pointIndex, draft, isNew } = state.editing;
    const next = structuredClone(state.profile);
    if (pointIndex === -1) {
      if (draft.title.trim() === "") {
        context.showError("An entry needs a title before it can be saved.");
        return;
      }
      const cleaned = withoutBlankOptionals(draft, ["link", "live", "note"]);
      if (isNew) next[section].push({ ...cleaned, points: [] });
      else {
        const target = next[section][entryIndex];
        for (const key of ["link", "live", "note"]) delete target[key];
        Object.assign(target, cleaned);
      }
    } else {
      if (draft.text === "") {
        context.showError("A point needs wording before it can be saved.");
        return;
      }
      const cleaned = {
        ...draft,
        variants: draft.variants.filter((variant) => variant.text !== ""),
      };
      if (isNew) next[section][entryIndex].points.push(cleaned);
      else next[section][entryIndex].points[pointIndex] = cleaned;
    }
    if (await saveProfile(next, false)) {
      state.editing = null;
      state.armedKey = null;
      render();
    }
  }

  /** Two-step delete: the first click arms the button, the second removes the point or entry. */
  async function deleteTarget(section, entryIndex, pointIndex) {
    const key = `${section}${entryIndex}-${pointIndex}`;
    if (state.armedKey !== key) {
      syncDraft();
      state.armedKey = key;
      render();
      return;
    }
    const next = structuredClone(state.profile);
    if (pointIndex === -1) next[section].splice(entryIndex, 1);
    else next[section][entryIndex].points.splice(pointIndex, 1);
    state.editing = null;
    state.armedKey = null;
    await saveProfile(next, true);
  }

  function addVariant() {
    syncDraft();
    state.editing.draft.variants.push({ text: "", keys: [] });
    render();
  }

  function removeVariant(index) {
    syncDraft();
    state.editing.draft.variants.splice(index, 1);
    render();
  }

  /** The buttons at the bottom of an open form: Save, Cancel and the two-step delete. */
  function formButtons(section, entryIndex, pointIndex, deleteLabels) {
    const key = `${section}${entryIndex}-${pointIndex}`;
    const armed = state.armedKey === key;
    return h(
      "div",
      { class: "fbtns" },
      h("button", { class: "btn primary", type: "button", on: { click: saveEditing } }, "Save"),
      h("button", { class: "btn", type: "button", on: { click: cancelEditing } }, "Cancel"),
      h("span", { class: "grow" }),
      !state.editing.isNew &&
        linkButton(armed ? deleteLabels[1] : deleteLabels[0], () =>
          deleteTarget(section, entryIndex, pointIndex),
        ),
    );
  }

  /** The form for one point: wording, terms, status and alternate wordings. */
  function pointForm(section, entryIndex, pointIndex) {
    const draft = state.editing.draft;
    return h(
      "div",
      { class: "form" },
      field("point-text", "Wording", draft.text, true),
      field(
        "point-terms",
        "Terms you can truthfully use here (comma separated)",
        draft.allowed.join(", "),
        false,
      ),
      h(
        "div",
        {},
        h("label", { for: "point-status" }, "Status"),
        h(
          "select",
          { class: "fld", id: "point-status" },
          POINT_STATUSES.map((status) =>
            h("option", { value: status, selected: draft.status === status }, status),
          ),
        ),
        h("p", { class: "small" }, "Only confirmed and from code points are used in resumes."),
      ),
      draft.variants.map((variant, index) =>
        h(
          "div",
          { class: "vrow" },
          field(`variant-text-${index}`, "Alternate wording", variant.text, true),
          field(
            `variant-keys-${index}`,
            "Use when the job mentions (comma separated)",
            variant.keys.join(", "),
            false,
          ),
          h(
            "div",
            {},
            linkButton("Remove this wording", () => removeVariant(index)),
          ),
        ),
      ),
      h("div", {}, linkButton("Add alternate wording", addVariant)),
      formButtons(section, entryIndex, pointIndex, ["Delete point", "Click again to delete"]),
    );
  }

  /** The form for an entry's own details (title, company or stack, dates, links). */
  function headForm(section, entryIndex) {
    const draft = state.editing.draft;
    const fields =
      section === "experience"
        ? [
            field("head-title", "Title", draft.title, false),
            field("head-org", "Company", draft.org, false),
            field("head-dates", "Dates", draft.dates, false),
            field("head-place", "Location", draft.place, false),
          ]
        : [
            field("head-title", "Name", draft.title, false),
            field("head-stack", "Stack", draft.stack, false),
            field("head-link", "Code link (optional)", draft.link ?? "", false),
            field("head-live", "Live link (optional)", draft.live ?? "", false),
            field(
              "head-note",
              "Status note, e.g. In development (optional)",
              draft.note ?? "",
              false,
            ),
          ];
    return h(
      "div",
      { class: "form" },
      fields,
      formButtons(section, entryIndex, -1, ["Remove this entry", "Click again to remove"]),
    );
  }

  /** One point, shown read-only with its status, terms and alternate wording count. */
  function pointView(section, entryIndex, pointIndex, point) {
    const variantCount = point.variants.length;
    return h(
      "div",
      { class: isUsable(point) ? "pt" : "pt off" },
      h(
        "div",
        {},
        h("p", { class: "pt-text" }, point.text || "(empty point)"),
        h(
          "div",
          { class: "pt-meta" },
          h("span", { class: "chip" }, point.status),
          point.allowed.length > 0 && h("span", {}, `Terms: ${point.allowed.join(", ")}`),
          variantCount > 0 &&
            h("span", {}, `${variantCount} alternate wording${variantCount > 1 ? "s" : ""}`),
        ),
      ),
      h(
        "div",
        {},
        linkButton("Edit", () => editPoint(section, entryIndex, pointIndex)),
      ),
    );
  }

  /** True when the open form belongs to this entry and this point (or its details when -1). */
  function isEditing(section, entryIndex, pointIndex) {
    const editing = state.editing;
    return (
      editing &&
      editing.section === section &&
      editing.entryIndex === entryIndex &&
      editing.pointIndex === pointIndex
    );
  }

  /** One job or project with its points and the add and edit buttons. */
  function entryNode(section, entryIndex, entry) {
    const stored = state.profile[section][entryIndex] !== undefined;
    const head = isEditing(section, entryIndex, -1)
      ? headForm(section, entryIndex)
      : h(
          "div",
          { class: "ehead" },
          h(
            "div",
            {},
            h(
              "p",
              { class: "title" },
              section === "experience" ? `${entry.title} · ${entry.org}` : entry.title,
            ),
            h(
              "p",
              { class: "meta" },
              section === "experience"
                ? `${entry.dates} · ${entry.place}`
                : [entry.stack, entry.link].filter(Boolean).join(" · "),
            ),
          ),
          linkButton("Edit details", () => editHead(section, entryIndex)),
        );
    const points = (entry.points ?? []).map((point, pointIndex) =>
      isEditing(section, entryIndex, pointIndex)
        ? pointForm(section, entryIndex, pointIndex)
        : pointView(section, entryIndex, pointIndex, point),
    );
    const newPointForm =
      stored && isEditing(section, entryIndex, (entry.points ?? []).length)
        ? pointForm(section, entryIndex, entry.points.length)
        : null;
    return h(
      "div",
      { class: "entry" },
      head,
      points,
      newPointForm,
      stored &&
        h(
          "div",
          { class: "addrow" },
          linkButton("Add a point", () => addPoint(section, entryIndex)),
        ),
    );
  }

  /** The Experience or Projects section, including a blank entry while a new one is being added. */
  function entriesSection(section, title, addLabel) {
    const entries = state.profile[section].map((entry, index) => entryNode(section, index, entry));
    if (isEditing(section, state.profile[section].length, -1)) {
      entries.push(entryNode(section, state.profile[section].length, { title: "", points: [] }));
    }
    return h(
      "section",
      {},
      h("h2", {}, title),
      h("div", { class: "elist" }, entries),
      h(
        "button",
        { class: "btn", type: "button", on: { click: () => addEntry(section) } },
        addLabel,
      ),
    );
  }

  /* ---------- page sections ---------- */

  /** A labelled input saved when the user leaves it. */
  function savedField(id, label, value, onChange) {
    return h(
      "div",
      { class: "kv" },
      h("label", { class: "small", for: id }, label),
      h("input", {
        class: "fld",
        id,
        value,
        on: { change: (event) => onChange(event.target.value) },
      }),
    );
  }

  function previewSections() {
    return [
      h(
        "section",
        {},
        h("h2", {}, "Tailor preview"),
        h(
          "div",
          { class: "pbox" },
          h(
            "label",
            { class: "small", for: "keywordsInput" },
            "Keywords from a job description, separated by commas. Wording changes only when a point lists that term as true.",
          ),
          h("textarea", {
            class: "fld",
            id: "keywordsInput",
            rows: 2,
            value: state.keywordsText,
            on: {
              input: (event) => {
                state.keywordsText = event.target.value;
                schedulePreview(PREVIEW_DELAY_MS);
              },
            },
          }),
          h("div", { class: "pv", id: "tailorOutput" }),
        ),
      ),
      h(
        "section",
        {},
        h("h2", {}, "Resume for this job"),
        h(
          "div",
          { class: "pbox" },
          h("label", { class: "small", for: "companyInput" }, "Company, for the file name"),
          h("input", {
            class: "fld",
            id: "companyInput",
            placeholder: "Company",
            value: state.companyText,
            on: {
              input: (event) => {
                state.companyText = event.target.value;
                schedulePreview(PREVIEW_DELAY_MS);
              },
            },
          }),
          h("p", { class: "small" }, "File: ", h("span", { id: "fileName" })),
          h("div", { id: "resumeOutput" }),
        ),
      ),
    ];
  }

  function contactSection() {
    return h(
      "section",
      {},
      h("h2", {}, "Contact"),
      IDENTITY_FIELDS.map(([key, label, required]) =>
        savedField(`identity-${key}`, label, state.profile.identity[key] ?? "", (value) =>
          saveField((next) => {
            if (value.trim() === "" && !required) delete next.identity[key];
            else next.identity[key] = value;
          }),
        ),
      ),
    );
  }

  function summarySection() {
    return h(
      "section",
      {},
      h("h2", {}, "Summary"),
      h("textarea", {
        class: "fld",
        rows: 3,
        "aria-label": "Summary",
        value: state.profile.summary.text,
        on: { change: (event) => saveField((next) => (next.summary.text = event.target.value)) },
      }),
    );
  }

  function skillsSection() {
    return h(
      "section",
      {},
      h("h2", {}, "Technical skills"),
      state.profile.skills.map((row, index) =>
        h(
          "div",
          { class: "kv" },
          h("input", {
            class: "fld",
            "aria-label": "Skill row name",
            value: row.label,
            on: {
              change: (event) =>
                saveField((next) => (next.skills[index].label = event.target.value)),
            },
          }),
          h("input", {
            class: "fld",
            "aria-label": "Skills in this row, comma separated",
            value: row.items.join(", "),
            on: {
              change: (event) =>
                saveField((next) => (next.skills[index].items = splitTerms(event.target.value))),
            },
          }),
        ),
      ),
    );
  }

  function educationSection() {
    return h(
      "section",
      {},
      h("h2", {}, "Education"),
      EDUCATION_FIELDS.map(([key, label, required]) =>
        savedField(`education-${key}`, label, state.profile.education[key] ?? "", (value) =>
          saveField((next) => {
            if (value.trim() === "" && !required) delete next.education[key];
            else next.education[key] = value;
          }),
        ),
      ),
    );
  }

  /** Model proposals waiting for approval. Read-only: nothing here changes the profile. */
  function pendingSection() {
    if (state.pending.length === 0) return null;
    return h(
      "section",
      {},
      h("h2", {}, `Pending proposals · ${state.pending.length}`),
      h("p", { class: "small" }, "These change nothing until you approve them."),
      h(
        "ul",
        { class: "small" },
        state.pending.map((proposal) => h("li", {}, `${proposal.target}: ${proposal.text}`)),
      ),
    );
  }

  /** Redraws the whole view from the stored profile and the open form. */
  function render() {
    clearChildren(root);
    if (state.profile === null) return;
    root.appendChild(h("p", { class: "savedmsg", id: "profileMessage" }, state.message));
    const pending = pendingSection();
    if (pending) root.appendChild(pending);
    for (const section of previewSections()) root.appendChild(section);
    root.appendChild(contactSection());
    root.appendChild(summarySection());
    root.appendChild(skillsSection());
    root.appendChild(entriesSection("experience", "Experience", "Add experience"));
    root.appendChild(entriesSection("projects", "Projects", "Add project"));
    root.appendChild(educationSection());
    root.appendChild(
      h(
        "section",
        {},
        h("h2", {}, "Never used"),
        h(
          "ul",
          { class: "small" },
          state.profile.neverUsed.map((item) => h("li", {}, item)),
        ),
      ),
    );
    renderResults();
  }

  /** Fetches the stored profile, draws it and asks for the preview. */
  async function load() {
    try {
      const reply = await context.api.getProfile();
      state.profile = reply.profile;
      state.pending = reply.pendingProposals ?? [];
      state.editing = null;
      state.armedKey = null;
      showMessage(`Profile version ${reply.profile.version}.`);
    } catch (error) {
      context.showError(error.message);
    }
    render();
    schedulePreview(0);
  }

  return { load };
}
