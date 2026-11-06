/**
 * The shapes that describe one saved application form.
 *
 * A `FormSnapshot` is the whole form written down as plain data before anything is filled. It
 * lets Scout map every field first, compare today's form with the one it saw last time (the
 * `hash`), and keep the form as evidence.
 *
 * Example: a form with a required "Email" box and a "Submit Application" button becomes
 * `{ fields: [{ key: "email", label: "Email", type: "email", required: true, ... }],
 * submit: { label: "Submit Application", selector: "#submit_app" }, hash: "9f2c..." }`.
 */

/** Every kind of form control Scout understands. Anything else is not filled. */
export const FIELD_TYPES = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
] as const;

/** One kind of form control, for example `"select"`. */
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * One question or box on the form.
 *
 * `selector` is how a browser driver finds the control again (a CSS selector, for example
 * `[name="email"]`). For a radio group or a checkbox group it matches every control of the group;
 * the driver picks one by its option text.
 */
export interface FormField {
  /** Stable identifier: the control's `name`, or its `id` when it has no name. */
  key: string;
  /** The question as a person reads it, with whitespace tidied and any trailing `*` removed. */
  label: string;
  /** The `name` attribute, or an empty string when the control has none. */
  name: string;
  type: FieldType;
  /** True when the form marks the field as required (attribute, aria flag or a `*` in the label). */
  required: boolean;
  /** For select, radio and checkbox groups: the choices as people read them. Otherwise empty. */
  options: string[];
  /** CSS selector that finds the control (or the group of controls) in the page. */
  selector: string;
  /** For file inputs: the `accept` list, such as `".pdf,.doc"`. Absent when the form says nothing. */
  accept?: string;
}

/** The control that sends the application. Scout only presses it when every rule allows it. */
export interface SubmitControl {
  /** The text on the button, for example `"Submit Application"`. */
  label: string;
  /** CSS selector that finds the button in the page. */
  selector: string;
}

/**
 * The whole form as data.
 *
 * `hash` is the shape hash: it changes when a field is added, removed, renamed, retyped, made
 * required or given different options, or when the submit button changes. It does not change
 * when only the page around the form changes.
 */
export interface FormSnapshot {
  fields: FormField[];
  /** Absent when no submit button could be found (the plan treats that as a blocker). */
  submit: SubmitControl | undefined;
  /** First 16 hex characters of a SHA-256 over the shape; see `FormSnapshot` above. */
  hash: string;
}
