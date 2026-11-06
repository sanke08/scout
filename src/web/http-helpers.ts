/**
 * Small helpers for reading a request and writing a reply with `node:http`: the failure type for
 * a refused request, the JSON body reader with its size cap, and the JSON reply writer.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZodError } from "zod";

/** The largest request body the server accepts: one megabyte. A profile is a few kilobytes. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * A request the server refuses on purpose. `message` is a full sentence the page shows to the user.
 * Example: `new HttpError(404, "No job with that id exists.")`.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Writes a JSON reply with the given status and headers that stop caching and sniffing. */
export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(text);
}

/** Writes the standard error reply: `{ error: "<full sentence>" }`. */
export function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

/**
 * Turns a failed zod parse into one full sentence naming the first problems.
 * Example: a missing `tag` gives "The request was not accepted: tag: Invalid option ...".
 */
export function describeValidationError(error: ZodError): string {
  const problems = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
  return `The request was not accepted: ${problems.join("; ")}.`;
}

/**
 * Reads the whole request body, giving up when it passes the size cap. Bytes past the cap are
 * thrown away as they arrive (never stored) so a huge upload cannot use up memory; the refusal
 * is raised once the upload has ended so the client can still read the reply.
 */
function readBodyText(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(new HttpError(413, "The request body is larger than the 1 MB limit."));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/**
 * Reads a JSON request body. Returns `undefined` for an empty body.
 * Failure: 415 when the content type is not JSON, 413 when too large, 400 when not valid JSON.
 */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  const text = await readBodyText(request);
  if (text.length === 0) return undefined;
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new HttpError(
      415,
      "The request body must be JSON with the content type application/json.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}
