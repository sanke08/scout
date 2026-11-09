/* global fetch, URLSearchParams */
/**
 * The page's only way to talk to the server: one function per API route. Data always comes from
 * the server; nothing is kept in the browser's own storage.
 */

/**
 * Sends one request and returns the parsed JSON reply.
 * Failure: throws an Error whose message is the server's full-sentence error, or a plain sentence
 * when the server could not be reached or sent something unreadable.
 * Example: `await request("GET", "/api/health")` is `{ ok: true }`.
 */
export async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Scout could not be reached. Check that it is still running, then reload.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Scout could not complete that request (status ${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

/** One function per route; the server's README lists the same routes. */
export const api = {
  getHealth: () => request("GET", "/api/health"),
  getAgent: () => request("GET", "/api/agent"),
  startAgent: (task, instruction) =>
    request("POST", "/api/agent/start", instruction ? { task, instruction } : { task }),
  stopAgent: () => request("POST", "/api/agent/stop"),
  getGoals: () => request("GET", "/api/goals"),
  putGoals: (text) => request("PUT", "/api/goals", { text }),
  getPlatforms: () => request("GET", "/api/platforms"),
  putPlatform: (name, body) => request("PUT", `/api/platforms/${encodeURIComponent(name)}`, body),
  getDigest: () => request("GET", "/api/digest"),
  getProfile: () => request("GET", "/api/profile"),
  putProfile: (profile) => request("PUT", "/api/profile", profile),
  getSettings: () => request("GET", "/api/settings"),
  putSettings: (settings) => request("PUT", "/api/settings", settings),
  approveJob: (id) => request("POST", `/api/jobs/${encodeURIComponent(id)}/approve`),
  skipJob: (id, tag) => request("POST", `/api/jobs/${encodeURIComponent(id)}/skip`, { tag }),
  undoJob: (id) => request("POST", `/api/jobs/${encodeURIComponent(id)}/undo`),
  getApplications: ({ search, statuses, dueOnly }) => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (statuses.length > 0) query.set("status", statuses.join(","));
    if (dueOnly) query.set("due", "1");
    const text = query.toString();
    return request("GET", text === "" ? "/api/applications" : `/api/applications?${text}`);
  },
  getApplication: (id) => request("GET", `/api/applications/${encodeURIComponent(id)}`),
  addApplication: (body) => request("POST", "/api/applications", body),
  putApplicationDetails: (id, details) =>
    request("PUT", `/api/applications/${encodeURIComponent(id)}/details`, details),
  reportApplicationStatus: (id, body) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/status`, body),
  addApplicationEvent: (id, body) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/events`, body),
  buildResume: (keywords, company) =>
    request("POST", "/api/resume", company ? { keywords, company } : { keywords }),
};
