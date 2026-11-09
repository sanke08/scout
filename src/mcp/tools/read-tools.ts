/**
 * Every read, board and decision tool, in the order the model should meet them.
 *
 * Why it exists: `tools/index.ts` imports one list per owner; this file joins the user, board and
 * job tools. The tools themselves live in `read-user-tools.ts`, `read-board-tools.ts` and
 * `read-job-tools.ts`.
 */
import type { ScoutTool } from "../tool.js";
import { boardTools } from "./read-board-tools.js";
import { jobTools } from "./read-job-tools.js";
import { userTools } from "./read-user-tools.js";

/** Read, board and decision tools. */
export const readTools: ScoutTool[] = [...userTools, ...boardTools, ...jobTools];
