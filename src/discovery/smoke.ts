/**
 * Live smoke check for the board parsers: fetches a few real public job boards and prints what
 * Scout understood. It needs the internet, so it is not part of `npm test`.
 *
 * Run: `npm run smoke:discovery`. Pass `kind:token` pairs to try other boards, for example
 * `npm run smoke:discovery -- greenhouse:gitlab lever:examplecorp`.
 *
 * A line that says FAIL means the real feed differs from what the parser expects (or the token
 * does not exist): open the fixture for that board and compare.
 */
import { createDiscovery } from "./discovery.js";
import { boardKindSchema, type BoardKind } from "../shared/index.js";

/** Boards tried when no arguments are given. All are public, as of the date this was written. */
const DEFAULT_BOARDS: string[] = [
  "greenhouse:gitlab",
  "ashby:ramp",
  "smartrecruiters:smartrecruiters",
];

/** Splits "kind:token" and checks the kind. Example: "lever:acme" gives { kind: "lever", token: "acme" }. */
function parseBoardArgument(argument: string): { kind: BoardKind; token: string } {
  const [kind, token] = argument.split(":");
  const parsed = boardKindSchema.safeParse(kind);
  if (!parsed.success || !token) {
    throw new Error(`Use kind:token, for example greenhouse:gitlab. Got "${argument}".`);
  }
  return { kind: parsed.data, token };
}

const arguments_ = process.argv.slice(2);
const discovery = createDiscovery({});
for (const argument of arguments_.length > 0 ? arguments_ : DEFAULT_BOARDS) {
  const board = parseBoardArgument(argument);
  try {
    const postings = await discovery.fetchBoard(board, new Date());
    const first = postings[0];
    const sample = first
      ? ` | ${first.title} | ${first.location} | ${first.remote} | ${first.seniority}`
      : "";
    console.log(`OK   ${argument}: ${postings.length} postings${sample}`);
  } catch (error) {
    console.log(`FAIL ${argument}: ${(error as Error).message}`);
  }
}
