/**
 * The local web server: `node:http` bound to 127.0.0.1 only. It refuses requests that did not come
 * from the user's own browser pointed at this address (DNS-rebinding and cross-site defence),
 * serves the page, and runs the JSON API from `routes.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createLogger } from "../shared/index.js";
import { HttpError, readJsonBody, sendError, sendJson } from "./http-helpers.js";
import { describeFailure, matchRoute } from "./routes.js";
import { findPublicDirectory, loadStaticFiles, type LoadedStaticFile } from "./static-files.js";
import type { RunningWebServer, WebDependencies, WebServerOptions } from "./types.js";

const log = createLogger("web");

/** Methods that change something. They need a same-origin check and a JSON body. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Rules the browser enforces for the page: scripts and connections only from this server, fonts
 * and the font stylesheet only from Google Fonts, no framing, no plugins.
 */
const PAGE_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** The Host values this server answers to once its port is known, e.g. `127.0.0.1:4173`. */
function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/**
 * Refuses a request whose Host header is not this server's own address. A page on another website
 * that tricks the browser into reaching 127.0.0.1 still sends its own name as Host, so it fails here.
 */
function checkHost(request: IncomingMessage, hosts: Set<string>): void {
  const host = (request.headers.host ?? "").toLowerCase();
  if (!hosts.has(host)) {
    throw new HttpError(
      403,
      "This server only answers requests addressed to 127.0.0.1 or localhost on its own port.",
    );
  }
}

/**
 * Refuses a change request that comes from another website: when an Origin header is present it
 * must be this server's own origin.
 */
function checkOrigin(request: IncomingMessage, hosts: Set<string>): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  const ownOrigins = [...hosts].map((host) => `http://${host}`);
  if (!ownOrigins.includes(origin.toLowerCase())) {
    throw new HttpError(
      403,
      "Requests that change data must come from this page, not another site.",
    );
  }
}

/** Sends one of the preloaded page files. */
function sendStaticFile(response: ServerResponse, file: LoadedStaticFile): void {
  response.writeHead(200, {
    "Content-Type": file.contentType,
    "Content-Length": file.body.length,
    ...PAGE_SECURITY_HEADERS,
  });
  response.end(file.body);
}

/** Runs the API route that matches the request, reading the body first for change requests. */
async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  dependencies: WebDependencies,
  hosts: Set<string>,
): Promise<void> {
  const method = request.method ?? "GET";
  const match = matchRoute(method, path);
  if (match.kind === "none") throw new HttpError(404, "There is no API route at that address.");
  if (match.kind === "wrong-method") {
    sendJson(
      response,
      405,
      { error: "That method is not allowed on this route." },
      {
        Allow: match.allowed.join(", "),
      },
    );
    return;
  }
  let body: unknown;
  if (WRITE_METHODS.has(method)) {
    checkOrigin(request, hosts);
    body = await readJsonBody(request);
  }
  const reply = await match.handler({ dependencies, body, params: match.params });
  sendJson(response, reply.status, reply.body);
}

/** Handles one request end to end and turns every failure into a JSON error reply. */
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: WebDependencies,
  files: Map<string, LoadedStaticFile>,
  hosts: Set<string>,
): Promise<void> {
  try {
    checkHost(request, hosts);
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path.startsWith("/api/")) {
      await handleApi(request, response, path, dependencies, hosts);
      return;
    }
    if (request.method !== "GET") throw new HttpError(405, "Pages can only be read with GET.");
    const file = files.get(path);
    if (file === undefined) throw new HttpError(404, "There is no page at that address.");
    sendStaticFile(response, file);
  } catch (error) {
    const failure = describeFailure(error);
    if (failure) {
      sendError(response, failure.status, failure.message);
      return;
    }
    log.error("unexpected failure while handling a request", {
      method: request.method,
      error: error instanceof Error ? error.message : String(error),
    });
    sendError(response, 500, "Scout hit an unexpected problem. Check the terminal for details.");
  }
}

/**
 * Starts the server on 127.0.0.1 and resolves once it is listening.
 * Example: `const server = await startWebServer(dependencies, { port: 0 })` then open `server.url`.
 * Failure: rejects when the port is taken or the page files are missing.
 */
export async function startWebServer(
  dependencies: WebDependencies,
  options: WebServerOptions = {},
): Promise<RunningWebServer> {
  const files = loadStaticFiles(findPublicDirectory());
  let hosts = new Set<string>();
  let port = 0;
  const server = createServer((request, response) => {
    void handleRequest(request, response, dependencies, files, hosts);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      port = (server.address() as AddressInfo).port;
      hosts = allowedHosts(port);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
