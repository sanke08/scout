/**
 * Turns verified project notes into draft project entries for the user to review.
 *
 * Why: scenario A drafts the profile from the notes. This module only drafts: it returns the
 * drafts and never saves them, so nothing reaches a resume until the user reviews each point and
 * changes its status.
 */
import { draftPointsFromNote, type ProjectNote } from "../profile/index.js";
import { ScoutError, type ProjectEntry } from "../shared/index.js";

/**
 * One drafted project.
 * - `entry`: a profile project entry; every point has status `hold` and `allowed` terms taken
 *   only from the note's stack.
 * - `verdict`: the note's verdict text, to show next to the draft.
 * - `doNotClaim`: the note's do-not-claim list, to show next to the draft.
 * - `sourceNote`: the note's file name.
 */
export interface DraftProject {
  entry: ProjectEntry;
  verdict: string;
  doNotClaim: string[];
  sourceNote: string;
}

/**
 * Drafts one project entry per note, in the order given.
 *
 * Each point comes from `draftPointsFromNote`, so its status is `hold`; this function checks
 * that again and fails loudly rather than return a usable point. The result is not saved
 * anywhere: the caller shows it to the user.
 *
 * Example: one note with stack ["Go"] and two features gives one `DraftProject` with two `hold`
 * points.
 */
export function draftProfileFromNotes(notes: readonly ProjectNote[]): DraftProject[] {
  return notes.map((note) => {
    const points = draftPointsFromNote(note);
    if (points.some((point) => point.status !== "hold")) {
      throw new ScoutError(
        "unsafe",
        `A drafted point from the note ${note.fileName} was not on hold. Drafts must never be usable before the user reviews them, so Scout stopped.`,
      );
    }
    return {
      entry: { title: note.title, stack: note.stack.join(", "), points },
      verdict: note.verdict,
      doNotClaim: note.doNotClaim,
      sourceNote: note.fileName,
    };
  });
}
