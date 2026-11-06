/** Public surface of the resume module. Other modules import only from here. */
export { createResumeBuilder } from "./builder.js";
export { compileResume, runProcess } from "./compile.js";
export type { CompiledResume, ProcessResult, ProcessRunner } from "./compile.js";
export { estimateLines, LINE_LIMIT } from "./estimate.js";
export { LATEX_PREAMBLE } from "./preamble.js";
