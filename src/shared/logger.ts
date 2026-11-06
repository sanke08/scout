/**
 * Minimal leveled logger. The level comes from the `SCOUT_LOG` environment variable
 * (`debug`, `info`, `warn`, `error`; default `info`). Output goes to stderr so command output on
 * stdout stays clean.
 *
 * Secrets are never logged: any field whose name looks like a secret is replaced by `[hidden]`.
 *
 * Example: `log.info("fetched board", { board: "greenhouse:acme", jobs: 12 })`.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const SECRET_NAME = /pass(word)?|token|secret|cookie|authorization|api[-_]?key/i;

/** A logger bound to one named part of the system. */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Copies `fields`, replacing the value of any secret-looking key with `[hidden]`. */
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    safe[name] = SECRET_NAME.test(name) ? "[hidden]" : value;
  }
  return safe;
}

function activeLevel(): number {
  const wanted = process.env["SCOUT_LOG"] as Level | undefined;
  const index = wanted ? LEVELS.indexOf(wanted) : -1;
  return index === -1 ? LEVELS.indexOf("info") : index;
}

/** Creates a logger whose lines are tagged with `scope`, for example `"discovery"`. */
export function createLogger(scope: string): Logger {
  const write = (level: Level, message: string, fields?: Record<string, unknown>): void => {
    if (LEVELS.indexOf(level) < activeLevel()) return;
    const line = { time: new Date().toISOString(), level, scope, message, ...redact(fields ?? {}) };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
