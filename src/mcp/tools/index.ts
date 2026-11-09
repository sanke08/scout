/** The registry of every tool Scout offers to the model. */
import type { ScoutTool } from "../tool.js";
import { actTools } from "./act-tools.js";
import { readTools } from "./read-tools.js";

/** Every tool, read tools first. Names must be unique. */
export const ALL_TOOLS: readonly ScoutTool[] = [...readTools, ...actTools];
