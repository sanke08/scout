/**
 * The one error model and exit-code convention.
 *
 * Throw `ScoutError` for every failure a user can act on. The message is a full sentence that
 * says what went wrong and what to do. The command-line entry point turns `exitCode` into the
 * process exit code.
 *
 * Example: `throw new ScoutError("not-found", "No job with id abc exists. Run `scout jobs`.")`.
 */

/** Every kind of failure Scout reports on purpose. */
export type ErrorCode =
  | "invalid-input"
  | "not-found"
  | "illegal-transition"
  | "limit-reached"
  | "unavailable"
  | "paused"
  | "unsafe";

/** Exit code per error kind. 0 is success; 1 is an unexpected crash. */
export const EXIT_CODES: Record<ErrorCode, number> = {
  "invalid-input": 2,
  "not-found": 3,
  "illegal-transition": 4,
  "limit-reached": 5,
  unavailable: 6,
  paused: 7,
  unsafe: 8,
};

/** A failure Scout reports to the user. Never put secrets in the message. */
export class ScoutError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ScoutError";
    this.code = code;
  }

  /** The process exit code for this error. */
  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}
