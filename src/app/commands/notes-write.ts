/**
 * `scout notes write|list|draft`: read the user's own projects once and work with the notes.
 *
 * Why they exist: scenario A. A project folder is read one time, a verified note is written, and
 * the notes can be turned into draft profile points. Nothing here saves into the profile: drafts
 * are only printed, every one of them on `hold`, for the user to review and copy by hand.
 *
 * Where notes live: `<data folder>/project-notes`, the same folder as `projectNotesDirectory()`
 * in `src/shared/paths.ts`, but taken from the open application so a test's temporary data folder
 * is respected.
 */
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { draftProfileFromNotes, readRepository, writeProjectNote } from "../../insight/index.js";
import { loadProjectNotes } from "../../profile/index.js";
import { ScoutError } from "../../shared/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** The name of the notes folder inside the data folder (matches `projectNotesDirectory()`). */
const NOTES_FOLDER_NAME = "project-notes";

/** The folder the notes of this application live in. Example: `/data/project-notes`. */
export function notesDirectoryOf(application: Application): string {
  return join(application.directory, NOTES_FOLDER_NAME);
}

/** Prints a titled bullet list, or `none` when the list is empty. */
function printList(title: string, items: readonly string[]): void {
  console.log(`${title}:`);
  if (items.length === 0) {
    console.log("  none");
    return;
  }
  for (const item of items) console.log(`  - ${item}`);
}

/** `scout notes write <repoFolder> [--force]`: reads one project and writes its note. */
async function writeNote(
  application: Application,
  repositoryFolder: string,
  force: boolean,
): Promise<void> {
  const digest = readRepository(resolve(repositoryFolder));
  const written = await writeProjectNote(application.brain(), digest, {
    notesDirectory: notesDirectoryOf(application),
    force,
    now: application.now(),
  });
  if (!written.ok) {
    throw new ScoutError(
      written.reason === "limit-reached" ? "limit-reached" : "unavailable",
      `The model could not write the note for ${digest.name} (${written.reason}): ${written.message} Nothing was written; run the command again later.`,
    );
  }
  console.log(`Wrote the note for ${written.note.title} to ${written.path}`);
  console.log(`Verdict: ${written.note.verdict}`);
  printList("Stack terms dropped (the code does not show them)", written.droppedStackTerms);
  printList("Figures dropped (the code does not show them)", written.droppedFigures);
  printList("Do not claim", written.note.doNotClaim);
  console.log("Read once: run this again with --force only when the project has changed.");
}

/** `scout notes list`: one block per saved note. */
function listNotes(application: Application): void {
  const notes = loadProjectNotes(notesDirectoryOf(application));
  if (notes.length === 0) {
    console.log("No project notes yet. Run `scout notes write <repoFolder>` for each project.");
    return;
  }
  for (const note of notes) {
    console.log(`${note.fileName}: ${note.title}`);
    console.log(`  verdict: ${note.verdict}`);
    console.log(`  stack: ${note.stack.join(", ") || "none"}`);
    console.log(
      `  features: ${note.features.length}, do-not-claim lines: ${note.doNotClaim.length}`,
    );
  }
  console.log(`${notes.length} note(s).`);
}

/** `scout notes draft`: prints hold-status draft points; the profile is never changed. */
function draftFromNotes(application: Application): void {
  const notes = loadProjectNotes(notesDirectoryOf(application));
  if (notes.length === 0) {
    console.log("No project notes yet, so there is nothing to draft. Run `scout notes write`.");
    return;
  }
  for (const draft of draftProfileFromNotes(notes)) {
    console.log(`${draft.entry.title} (${draft.entry.stack}) from ${draft.sourceNote}`);
    console.log(`  verdict: ${draft.verdict}`);
    for (const point of draft.entry.points) console.log(`  [${point.status}] ${point.text}`);
    for (const claim of draft.doNotClaim) console.log(`  do not claim: ${claim}`);
  }
  console.log(
    "These are drafts on hold. Nothing was saved to your profile; review each point, then add the ones you stand behind to profile.json yourself.",
  );
}

/** Registers the `notes` command group. */
export function registerNotes(program: Command, overrides: ApplicationOptions): void {
  const notes = program.command("notes").description("Read your own projects once and keep notes.");

  notes
    .command("write <repoFolder>")
    .description("Read a project folder once and write a verified note about it.")
    .option("--force", "replace an existing note (the project has changed)")
    .action((repositoryFolder: string, options: { force?: boolean }) =>
      withApplication(overrides, (application) =>
        writeNote(application, repositoryFolder, options.force === true),
      ),
    );

  notes
    .command("list")
    .description("List the saved project notes.")
    .action(() => withApplication(overrides, listNotes));

  notes
    .command("draft")
    .description("Print draft profile points (on hold) from the notes; saves nothing.")
    .action(() => withApplication(overrides, draftFromNotes));
}
