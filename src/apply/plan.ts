/**
 * Turns field mappings into a `FillPlan`: the ordered actions Scout would perform and the list of
 * reasons it must stop first.
 *
 * Why: IDEA 5.10 says "stop if any required field is unknown". The plan makes that visible
 * before any browser opens, so the user sees exactly which questions are waiting for them.
 *
 * Example: for a form whose required "Are you open to relocating?" has no approved answer, the
 * plan has that field in `blockers` with status `needs-you`, and `actions` for everything else.
 * A plan with any blocker is never carried out.
 */
import type { FieldType, FormSnapshot } from "./form-types.js";
import type { FieldMapping, MappingStatus } from "./map-fields.js";

/** What the driver does for one field: type text, choose an option, or attach a file. */
export type FillActionKind = "fill" | "select" | "upload";

/** One step of the fill: set one field to one value. `value` is a file path for `upload`. */
export interface FillAction {
  fieldKey: string;
  label: string;
  type: FieldType;
  kind: FillActionKind;
  selector: string;
  value: string;
}

/** A reason the application cannot go ahead until a person helps. */
export interface Blocker {
  /** The field's key, or `"(form)"` for a problem with the form as a whole. */
  fieldKey: string;
  label: string;
  status: MappingStatus | "missing-file" | "no-submit";
  reason: string;
}

/** An optional field Scout leaves empty, with the reason. Shown to the user, never a blocker. */
export interface LeftBlank {
  fieldKey: string;
  label: string;
  reason: string;
}

/** Everything Scout intends to do for one application. */
export interface FillPlan {
  /** The application page address. */
  url: string;
  /** The form as read; its hash is compared with the live page before anything is filled. */
  snapshot: FormSnapshot;
  /** Fill actions in page order. */
  actions: FillAction[];
  /** Reasons to stop. Empty means the plan is complete. */
  blockers: Blocker[];
  /** Optional fields left empty. */
  leftBlank: LeftBlank[];
}

/** What `planApplication` needs. `resumeFilePath` is the PDF the resume module built. */
export interface PlanInput {
  url: string;
  snapshot: FormSnapshot;
  mappings: FieldMapping[];
  resumeFilePath?: string;
}

/** Which driver action fits a field type. */
function actionKindFor(type: FieldType): FillActionKind {
  if (type === "file") return "upload";
  if (type === "select" || type === "radio" || type === "checkbox") return "select";
  return "fill";
}

/**
 * Builds the plan. A required field that is not ready is a blocker; an optional one is left
 * blank. A form with no submit button is a blocker because Scout could never finish it.
 */
export function planApplication(input: PlanInput): FillPlan {
  const actions: FillAction[] = [];
  const blockers: Blocker[] = [];
  const leftBlank: LeftBlank[] = [];

  for (const mapping of input.mappings) {
    const { field } = mapping;
    let value = mapping.value;
    if (mapping.status === "ready" && mapping.source === "resume") {
      value = input.resumeFilePath;
      if (value === undefined) {
        if (field.required) {
          blockers.push({
            fieldKey: field.key,
            label: field.label,
            status: "missing-file",
            reason: "The form needs a resume file but none was built for this job.",
          });
        } else {
          leftBlank.push({
            fieldKey: field.key,
            label: field.label,
            reason: "No resume file was built.",
          });
        }
        continue;
      }
    }
    if (mapping.status === "ready" && value !== undefined) {
      actions.push({
        fieldKey: field.key,
        label: field.label,
        type: field.type,
        kind: actionKindFor(field.type),
        selector: field.selector,
        value,
      });
    } else if (field.required) {
      blockers.push({
        fieldKey: field.key,
        label: field.label,
        status: mapping.status,
        reason: mapping.reason,
      });
    } else {
      leftBlank.push({ fieldKey: field.key, label: field.label, reason: mapping.reason });
    }
  }

  if (input.snapshot.submit === undefined) {
    blockers.push({
      fieldKey: "(form)",
      label: "Submit button",
      status: "no-submit",
      reason: "No submit button was found on the form, so Scout could not finish it.",
    });
  }
  return { url: input.url, snapshot: input.snapshot, actions, blockers, leftBlank };
}
