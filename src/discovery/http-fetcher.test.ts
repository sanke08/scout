/** Properties of the board fetcher: identifies itself, is bounded, polite, and fails clearly. */
import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import {
  DEFAULT_USER_AGENT,
  createBoardFetcher,
  type FetchImplementation,
} from "./http-fetcher.js";

/** Builds a fake `fetch` that answers every request with the given response and records calls. */
function fakeFetch(makeResponse: () => Response): {
  fetchImpl: FetchImplementation;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchImplementation = async (url, init) => {
    calls.push(init ? { url, init } : { url });
    return makeResponse();
  };
  return { fetchImpl, calls };
}

/** Runs a promise and returns the `ScoutError` it rejects with. */
async function rejection(promise: Promise<unknown>): Promise<ScoutError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ScoutError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("createBoardFetcher", () => {
  it("returns the body and sends the identifying User-Agent", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response("hello"));
    const fetcher = createBoardFetcher({ fetchImpl, hostDelayMilliseconds: 0 });
    expect(await fetcher.fetchText("https://api.example.com/a", "test")).toBe("hello");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).toBe("scout-job-pipeline (personal use)");
  });

  it("rejects a body over the cap, declared or streamed", async () => {
    const declared = fakeFetch(() => new Response("x", { headers: { "content-length": "9000" } }));
    const streamed = fakeFetch(() => new Response("y".repeat(9000)));
    for (const { fetchImpl } of [declared, streamed]) {
      const fetcher = createBoardFetcher({
        fetchImpl,
        maxBodyBytes: 1000,
        hostDelayMilliseconds: 0,
      });
      const error = await rejection(fetcher.fetchText("https://api.example.com/a", "test"));
      expect(error.code).toBe("invalid-input");
      expect(error.message).toMatch(/larger than 1000 bytes/);
    }
  });

  it("maps 404 to not-found and other failures to unavailable", async () => {
    const missing = createBoardFetcher({
      fetchImpl: fakeFetch(() => new Response("", { status: 404 })).fetchImpl,
      hostDelayMilliseconds: 0,
    });
    expect((await rejection(missing.fetchText("https://api.example.com/a", "test"))).code).toBe(
      "not-found",
    );
    const broken = createBoardFetcher({
      fetchImpl: fakeFetch(() => new Response("", { status: 503 })).fetchImpl,
      hostDelayMilliseconds: 0,
    });
    expect((await rejection(broken.fetchText("https://api.example.com/a", "test"))).code).toBe(
      "unavailable",
    );
    const offline = createBoardFetcher({
      fetchImpl: async () => {
        throw new Error("network down");
      },
      hostDelayMilliseconds: 0,
    });
    expect((await rejection(offline.fetchText("https://api.example.com/a", "test"))).code).toBe(
      "unavailable",
    );
  });

  it("waits between two requests to the same host but not between different hosts", async () => {
    let time = 1000;
    const waits: number[] = [];
    const { fetchImpl } = fakeFetch(() => new Response("ok"));
    const fetcher = createBoardFetcher({
      fetchImpl,
      hostDelayMilliseconds: 500,
      clock: () => time,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        time += milliseconds;
      },
    });
    await fetcher.fetchText("https://a.example.com/1", "test");
    await fetcher.fetchText("https://b.example.com/1", "test");
    await fetcher.fetchText("https://a.example.com/2", "test");
    expect(waits).toEqual([500]);
  });
});
