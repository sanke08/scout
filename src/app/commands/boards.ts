/**
 * `scout boards add|remove|list`: manage the company job boards Scout watches.
 *
 * Why it exists: scenario D starts from a list of companies. `add` takes either a board kind and
 * token (`greenhouse examplecorp`) or a careers address (`https://jobs.lever.co/examplecorp`), so
 * the user can paste what they have.
 */
import type { Command } from "commander";
import { detectBoard } from "../../discovery/index.js";
import { boardKindSchema, ScoutError } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import type { BoardEntry } from "../boards-store.js";
import { withApplication } from "./with-application.js";

/** Reads the kind argument and checks it is a known board kind. */
function parseKind(text: string): BoardEntry["kind"] {
  const parsed = boardKindSchema.safeParse(text);
  if (!parsed.success) {
    throw new ScoutError(
      "invalid-input",
      `"${text}" is not a board kind. Use one of: ${boardKindSchema.options.join(", ")}.`,
    );
  }
  return parsed.data;
}

/**
 * Works out the board from the arguments of `boards add`: a careers address alone, or a kind and
 * a token. Example: `["https://jobs.lever.co/acme"]` gives `{ kind: "lever", token: "acme" }`.
 */
function resolveBoard(
  first: string,
  second: string | undefined,
  company: string | undefined,
): BoardEntry {
  const named = company === undefined ? {} : { company };
  if (second === undefined) {
    const detected = detectBoard(first);
    if (detected === undefined) {
      throw new ScoutError(
        "invalid-input",
        `Scout does not recognise "${first}" as a job board address. Give a kind and a token instead, for example: scout boards add greenhouse examplecorp.`,
      );
    }
    return { kind: detected.kind, token: detected.token, ...named };
  }
  return { kind: parseKind(first), token: second, ...named };
}

/** Registers the `boards` command group. */
export function registerBoards(program: Command, overrides: ApplicationOptions): void {
  const boards = program.command("boards").description("Manage the job boards Scout watches.");

  boards
    .command("add <kindOrAddress> [token]")
    .description("Add a board: a kind and token, or a careers address.")
    .option("--company <name>", "a display name for the company")
    .action((first: string, second: string | undefined, options: { company?: string }) =>
      withApplication(overrides, (application) => {
        const result = application.boardStore.add(resolveBoard(first, second, options.company));
        const name = `${result.board.kind}:${result.board.token}`;
        console.log(
          result.added ? `Added board ${name}.` : `Board ${name} was already on your list.`,
        );
      }),
    );

  boards
    .command("remove <kind> <token>")
    .description("Stop watching a board.")
    .action((kind: string, token: string) =>
      withApplication(overrides, (application) => {
        application.boardStore.remove(parseKind(kind), token);
        console.log(`Removed board ${kind}:${token}.`);
      }),
    );

  boards
    .command("list")
    .description("Show the boards Scout watches.")
    .action(() =>
      withApplication(overrides, (application) => {
        const list = application.boardStore.list();
        if (list.length === 0) {
          console.log(
            "You are not watching any boards yet. Add one with: scout boards add greenhouse <token>",
          );
          return;
        }
        for (const board of list) {
          console.log(
            `${board.kind}:${board.token}${board.company === undefined ? "" : `  (${board.company})`}`,
          );
        }
      }),
    );
}
