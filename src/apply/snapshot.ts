/**
 * Reads a saved application-form page (HTML) into a `FormSnapshot`.
 *
 * Why: before Scout fills anything it must know every field, whether it is required and what
 * choices it offers. The page is untrusted text from the internet, so it is only parsed, never
 * run, and its size is capped.
 *
 * Example: `snapshotForm('<form><label for="email">Email *</label><input id="email" name="email"
 * type="email"></form>')` returns one required `email` field and no submit control.
 * Failure: a page with no usable fields, a page over the size cap, or a required field that has
 * neither a name nor an id (Scout could not find it again) throws a `ScoutError`.
 */
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { ScoutError } from "../shared/index.js";
import { FIELD_TYPES, type FieldType, type FormField, type FormSnapshot } from "./form-types.js";
import type { SubmitControl } from "./form-types.js";

/** The largest page Scout will parse (5 MiB). A bigger page is refused as suspicious. */
export const MAXIMUM_FORM_HTML_BYTES = 5 * 1024 * 1024;

/** Input types that are never fields a person fills (buttons, hidden values, images). */
const IGNORED_INPUT_TYPES = ["hidden", "submit", "button", "image", "reset"];

/** Collapses runs of whitespace to one space and trims the ends. Example: `" a \n b "` gives `"a b"`. */
export function tidyText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Removes a trailing required marker such as `*` or `(required)` from a label. */
function stripRequiredMarker(label: string): string {
  return tidyText(label.replace(/\(required\)/gi, "").replace(/[*✱]+/g, ""));
}

/** True when the label text itself carries a required marker. */
function labelMarksRequired(label: string): boolean {
  return /[*✱]/.test(label) || /\(required\)/i.test(label);
}

/** True when the element, or any element around it, is hidden from people. Honeypots are hidden. */
function isHidden($: CheerioAPI, element: Cheerio<Element>): boolean {
  const chain = element.add(element.parents());
  let hidden = false;
  chain.each((_index, node) => {
    const candidate = $(node);
    const style = (candidate.attr("style") ?? "").replace(/\s+/g, "").toLowerCase();
    if (
      candidate.attr("hidden") !== undefined ||
      candidate.attr("aria-hidden") === "true" ||
      style.includes("display:none")
    ) {
      hidden = true;
    }
  });
  return hidden;
}

/** The text of the first label that names `control`, from `for`, a wrapping label or aria. */
function labelTextFor($: CheerioAPI, control: Cheerio<Element>): string {
  const id = control.attr("id");
  if (id) {
    const explicit = $("label")
      .filter((_index, node) => $(node).attr("for") === id)
      .first();
    if (explicit.length > 0) return tidyText(explicit.text());
  }
  const wrapping = control.closest("label");
  if (wrapping.length > 0) return tidyText(wrapping.text());
  const aria = control.attr("aria-label");
  if (aria) return tidyText(aria);
  const labelledBy = control.attr("aria-labelledby");
  if (labelledBy) {
    const target = $(`[id="${labelledBy}"]`).first();
    if (target.length > 0) return tidyText(target.text());
  }
  return tidyText(control.attr("placeholder") ?? "");
}

/** The question text for a group of radios or checkboxes: the fieldset legend, else the first label. */
function groupLabelFor($: CheerioAPI, controls: Cheerio<Element>[]): string {
  const first = controls[0];
  if (first === undefined) return "";
  const legend = first.closest("fieldset").find("legend").first();
  if (legend.length > 0) return tidyText(legend.text());
  return labelTextFor($, first);
}

/** The CSS selector that finds a control again: by name, else by id. */
function selectorFor(name: string, id: string): string {
  if (name !== "") return `[name="${name.replace(/"/g, '\\"')}"]`;
  return `#${id}`;
}

/** Maps an HTML control to one of Scout's field types, or `undefined` when it is not fillable. */
function fieldTypeOf(tagName: string, inputType: string): FieldType | undefined {
  if (tagName === "textarea") return "textarea";
  if (tagName === "select") return "select";
  const type = inputType === "" ? "text" : inputType;
  return (FIELD_TYPES as readonly string[]).includes(type) ? (type as FieldType) : undefined;
}

/** Reads the choices of a `<select>`, skipping the empty placeholder option. */
function selectOptions($: CheerioAPI, control: Cheerio<Element>): string[] {
  const options: string[] = [];
  control.find("option").each((_index, node) => {
    const option = $(node);
    if ((option.attr("value") ?? option.text()).trim() === "") return;
    options.push(tidyText(option.text()));
  });
  return options;
}

/** The text a person reads next to one radio or checkbox. */
function choiceLabel($: CheerioAPI, control: Cheerio<Element>): string {
  const text = labelTextFor($, control);
  return text !== "" ? text : (control.attr("value") ?? "");
}

/** Finds the submit button: the first submit control whose text says submit, apply or send. */
function findSubmit($: CheerioAPI, root: Cheerio<AnyNode>): SubmitControl | undefined {
  const candidates: SubmitControl[] = [];
  root.find("button, input[type=submit]").each((_index, node) => {
    const button = $(node);
    const type = (button.attr("type") ?? (node.tagName === "button" ? "submit" : "")).toLowerCase();
    if (type !== "submit") return;
    const label = tidyText(node.tagName === "input" ? (button.attr("value") ?? "") : button.text());
    const id = button.attr("id");
    const selector = id ? `#${id}` : `${node.tagName}[type="submit"]`;
    candidates.push({ label, selector });
  });
  const wanted = candidates.find((candidate) => /submit|apply|send/i.test(candidate.label));
  return wanted ?? candidates[0];
}

/** Computes the shape hash described on `FormSnapshot`. */
export function computeShapeHash(fields: FormField[], submit: SubmitControl | undefined): string {
  const shape = {
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label.toLowerCase(),
      type: field.type,
      required: field.required,
      options: field.options.map((option) => option.toLowerCase()),
    })),
    submit: submit === undefined ? null : [submit.label.toLowerCase(), submit.selector],
  };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

/**
 * Parses an application-form page into a `FormSnapshot`.
 * Example: a Greenhouse-style page with eleven visible controls gives eleven fields in page order.
 */
export function snapshotForm(html: string): FormSnapshot {
  if (Buffer.byteLength(html, "utf8") > MAXIMUM_FORM_HTML_BYTES) {
    throw new ScoutError(
      "invalid-input",
      "The application page is larger than 5 MiB, so Scout will not read it. Open it by hand instead.",
    );
  }
  const $ = cheerio.load(html);
  const forms = $("form").filter(
    (_index, node) => $(node).find("input, select, textarea").length > 0,
  );
  const root: Cheerio<AnyNode> = forms.length > 0 ? forms.first() : $("body");

  const fields: FormField[] = [];
  const seenGroups = new Map<string, Cheerio<Element>[]>();
  const groupOrder: string[] = [];
  const groupIndexes = new Map<string, number>();

  root.find("input, select, textarea").each((_index, node) => {
    const control = $(node);
    const inputType = (control.attr("type") ?? "").toLowerCase();
    if (node.tagName === "input" && IGNORED_INPUT_TYPES.includes(inputType)) return;
    if (isHidden($, control)) return;
    const type = fieldTypeOf(node.tagName, inputType);
    if (type === undefined) return;

    const name = control.attr("name") ?? "";
    const id = control.attr("id") ?? "";
    const required =
      control.attr("required") !== undefined || control.attr("aria-required") === "true";
    if (name === "" && id === "") {
      if (required) {
        throw new ScoutError(
          "unavailable",
          "The form has a required field with no name or id, so Scout cannot find it again. Fill this application by hand.",
        );
      }
      return;
    }

    if (type === "radio" || type === "checkbox") {
      const groupKey = `${type}:${name !== "" ? name : id}`;
      const members = seenGroups.get(groupKey) ?? [];
      members.push(control);
      seenGroups.set(groupKey, members);
      if (members.length === 1) {
        groupOrder.push(groupKey);
        groupIndexes.set(groupKey, fields.length);
        fields.push({
          key: name !== "" ? name : id,
          label: "",
          name,
          type,
          required,
          options: [],
          selector: selectorFor(name, id),
        });
      }
      return;
    }

    const rawLabel = labelTextFor($, control);
    const field: FormField = {
      key: name !== "" ? name : id,
      label: stripRequiredMarker(rawLabel) || (name !== "" ? name : id),
      name,
      type,
      required: required || labelMarksRequired(rawLabel),
      options: type === "select" ? selectOptions($, control) : [],
      selector: selectorFor(name, id),
    };
    const accept = control.attr("accept");
    if (type === "file" && accept !== undefined) field.accept = accept;
    fields.push(field);
  });

  for (const groupKey of groupOrder) {
    const members = seenGroups.get(groupKey) ?? [];
    const index = groupIndexes.get(groupKey);
    const field = index === undefined ? undefined : fields[index];
    if (field === undefined) continue;
    const rawLabel =
      members.length === 1 && field.type === "checkbox"
        ? labelTextFor($, members[0] as Cheerio<Element>)
        : groupLabelFor($, members);
    field.label = stripRequiredMarker(rawLabel) || field.key;
    field.required =
      members.some(
        (member) =>
          member.attr("required") !== undefined || member.attr("aria-required") === "true",
      ) || labelMarksRequired(rawLabel);
    field.options =
      members.length === 1 && field.type === "checkbox"
        ? []
        : members.map((member) => stripRequiredMarker(choiceLabel($, member)));
  }

  if (fields.length === 0) {
    throw new ScoutError(
      "invalid-input",
      "No form fields were found on this page, so Scout cannot read the application. Check that the page is the application form.",
    );
  }
  const submit = findSubmit($, root);
  return { fields, submit, hash: computeShapeHash(fields, submit) };
}
