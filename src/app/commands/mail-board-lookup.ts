/**
 * The offline lookup that decides where a job seen in an alert email lives on the company's own
 * board.
 *
 * Why it exists: `resolveToOfficialBoard` needs a function from a company name to a careers
 * address. Scout must not search the web for this, so the only source is the list of boards the
 * user already watches (a board matches by its `--company` name or by its token). A company that is not listed
 * gets no address, and the job stays "platform-only".
 *
 * Example: with a watched board `{ kind: "greenhouse", token: "northwindlabs", company: "Northwind
 * Labs" }`, `lookup("northwind labs")` is `"https://boards.greenhouse.io/northwindlabs"`.
 */
import type { BoardLookup } from "../../tracking/index.js";
import type { BoardEntry, BoardStore } from "../boards-store.js";

/**
 * The public careers address of a board entry. Every kind that can be stored has one, written in
 * the form that discovery's `detectBoard` recognises, so the two always agree.
 * Example: `{ kind: "lever", token: "acme" }` gives `"https://jobs.lever.co/acme"`.
 */
export function careersAddressOf(board: BoardEntry): string {
  switch (board.kind) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${board.token}`;
    case "lever":
      return `https://jobs.lever.co/${board.token}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${board.token}`;
    case "workable":
      return `https://apply.workable.com/${board.token}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${board.token}`;
    case "recruitee":
      return `https://${board.token}.recruitee.com/`;
    case "feed":
    case "other":
      return board.token;
  }
}

/** Lower-cases a company name and keeps only letters and digits, so "Northwind Labs" equals "northwind-labs". */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Makes the lookup from the watched boards. A board matches by its display name or by its token. */
export function createBoardLookup(boardStore: BoardStore): BoardLookup {
  return (companyName) => {
    const wanted = squash(companyName);
    if (wanted === "") return undefined;
    const match = boardStore
      .list()
      .find((board) => squash(board.company ?? "") === wanted || squash(board.token) === wanted);
    return match === undefined ? undefined : careersAddressOf(match);
  };
}
