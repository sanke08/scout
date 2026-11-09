/**
 * Serves the page. Only a fixed allow-list of files from `public/` can ever be returned: each is
 * read once at start-up and kept in memory, and the request path is looked up in a map. Because
 * the path is never joined onto a folder, directory traversal is impossible by construction.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One file the server may serve: its URL path, its name inside `public/` and its content type. */
interface StaticFileEntry {
  urlPath: string;
  fileName: string;
  contentType: string;
}

/** A file loaded into memory, ready to send. */
export interface LoadedStaticFile {
  contentType: string;
  body: Buffer;
}

const HTML = "text/html; charset=utf-8";
const CSS = "text/css; charset=utf-8";
const JAVASCRIPT = "text/javascript; charset=utf-8";

/**
 * Every file the server can serve. Adding a file to `public/` means adding a line here; a test
 * fails when the folder and this list disagree.
 */
export const STATIC_FILES: readonly StaticFileEntry[] = [
  { urlPath: "/", fileName: "index.html", contentType: HTML },
  { urlPath: "/index.html", fileName: "index.html", contentType: HTML },
  { urlPath: "/styles.css", fileName: "styles.css", contentType: CSS },
  { urlPath: "/app.js", fileName: "app.js", contentType: JAVASCRIPT },
  { urlPath: "/api-client.js", fileName: "api-client.js", contentType: JAVASCRIPT },
  { urlPath: "/dom.js", fileName: "dom.js", contentType: JAVASCRIPT },
  { urlPath: "/highlight.js", fileName: "highlight.js", contentType: JAVASCRIPT },
  { urlPath: "/tex-preview.js", fileName: "tex-preview.js", contentType: JAVASCRIPT },
  { urlPath: "/digest-view.js", fileName: "digest-view.js", contentType: JAVASCRIPT },
  { urlPath: "/profile-view.js", fileName: "profile-view.js", contentType: JAVASCRIPT },
  { urlPath: "/applications-view.js", fileName: "applications-view.js", contentType: JAVASCRIPT },
  { urlPath: "/control-view.js", fileName: "control-view.js", contentType: JAVASCRIPT },
  { urlPath: "/pause-control.js", fileName: "pause-control.js", contentType: JAVASCRIPT },
  { urlPath: "/settings-view.js", fileName: "settings-view.js", contentType: JAVASCRIPT },
];

/**
 * Finds the `public/` folder: next to this module when running from source, or in the source tree
 * when running the compiled output (the build copies only TypeScript output).
 * Failure: throws when neither exists, because the server cannot show a page without it.
 */
export function findPublicDirectory(): string {
  const candidates = [
    fileURLToPath(new URL("./public", import.meta.url)),
    fileURLToPath(new URL("../../src/web/public", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  throw new Error("The web page files were not found: expected src/web/public/index.html.");
}

/**
 * Reads every allow-listed file into a map keyed by URL path.
 * Example: `loadStaticFiles(dir).get("/")` is the index page.
 */
export function loadStaticFiles(publicDirectory: string): Map<string, LoadedStaticFile> {
  const files = new Map<string, LoadedStaticFile>();
  for (const entry of STATIC_FILES) {
    files.set(entry.urlPath, {
      contentType: entry.contentType,
      body: readFileSync(join(publicDirectory, entry.fileName)),
    });
  }
  return files;
}
