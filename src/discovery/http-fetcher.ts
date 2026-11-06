/**
 * Polite, bounded downloading of board responses.
 *
 * Every download identifies Scout honestly, gives up after a timeout, refuses bodies larger than
 * a cap, and waits between two requests to the same host. The real `fetch` is injected so tests
 * can serve saved fixtures instead of touching the network.
 */
import { ScoutError } from "../shared/index.js";

/** Anything shaped like the global `fetch`: tests pass a fake that serves saved fixtures. */
export type FetchImplementation = (url: string, init?: RequestInit) => Promise<Response>;

/** The name Scout gives to every board it contacts. */
export const DEFAULT_USER_AGENT = "scout-job-pipeline (personal use)";

/** How long a board may take to answer before Scout gives up: 20 seconds, in milliseconds. */
export const DEFAULT_TIMEOUT_MILLISECONDS = 20_000;

/** The largest response body Scout accepts: 5 megabytes. */
export const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

/** How long Scout waits between two requests to the same host (in milliseconds). */
export const DEFAULT_HOST_DELAY_MILLISECONDS = 1000;

/** Settings for a `BoardFetcher`; every field has a default. */
export interface BoardFetcherOptions {
  /** The download function; defaults to the global `fetch`. */
  fetchImpl?: FetchImplementation;
  /** Sent as the User-Agent header. */
  userAgent?: string;
  /** Per-request time limit in milliseconds. */
  timeoutMilliseconds?: number;
  /** Largest accepted body in bytes. */
  maxBodyBytes?: number;
  /** Minimum gap between two requests to one host, in milliseconds; 0 turns waiting off. */
  hostDelayMilliseconds?: number;
  /** Clock in milliseconds, used to measure the gap; defaults to `Date.now`. */
  clock?: () => number;
  /** Waits for the given milliseconds; defaults to a timer. Tests replace it. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Downloads one address and returns its body as text. */
export interface BoardFetcher {
  /**
   * Returns the text of `url`.
   * Failure: a missing board (404) gives `ScoutError("not-found")`; other HTTP errors, network
   * errors and timeouts give `ScoutError("unavailable")`; a body over the cap gives
   * `ScoutError("invalid-input")`.
   */
  fetchText(url: string, boardName: string): Promise<string>;
}

/** Waits for a number of milliseconds using a timer. */
function sleepWithTimer(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Throws when a declared or actual body size is over the cap. */
function refuseOversize(boardName: string, maxBodyBytes: number): never {
  throw new ScoutError(
    "invalid-input",
    `The ${boardName} board sent a response larger than ${maxBodyBytes} bytes, so Scout refused to read it.`,
  );
}

/** Reads a response body as text, stopping as soon as it grows past the cap. */
async function readCappedBody(
  response: Response,
  boardName: string,
  maxBodyBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    refuseOversize(boardName, maxBodyBytes);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBodyBytes) {
      await reader.cancel();
      refuseOversize(boardName, maxBodyBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Creates a fetcher with the limits above.
 *
 * Example: `createBoardFetcher({ fetchImpl: fakeFetch, hostDelayMilliseconds: 0 })` reads from
 * `fakeFetch` and never waits.
 */
export function createBoardFetcher(options: BoardFetcherOptions = {}): BoardFetcher {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const hostDelayMilliseconds = options.hostDelayMilliseconds ?? DEFAULT_HOST_DELAY_MILLISECONDS;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? sleepWithTimer;
  const lastRequestByHost = new Map<string, number>();

  /** Waits until the host has had its quiet gap, then records this request's time. */
  async function waitForHost(host: string): Promise<void> {
    const last = lastRequestByHost.get(host);
    if (last !== undefined) {
      const remaining = hostDelayMilliseconds - (clock() - last);
      if (remaining > 0) await sleep(remaining);
    }
    lastRequestByHost.set(host, clock());
  }

  return {
    async fetchText(url, boardName) {
      await waitForHost(new URL(url).host);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            "User-Agent": userAgent,
            Accept: "application/json, application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(timeoutMilliseconds),
        });
      } catch {
        throw new ScoutError(
          "unavailable",
          `Could not reach the ${boardName} board (network error or timeout). Try again later.`,
        );
      }
      if (response.status === 404) {
        throw new ScoutError(
          "not-found",
          `The ${boardName} board does not exist. Check its token.`,
        );
      }
      if (!response.ok) {
        throw new ScoutError(
          "unavailable",
          `The ${boardName} board answered with HTTP ${response.status}. Try again later.`,
        );
      }
      return readCappedBody(response, boardName, maxBodyBytes);
    },
  };
}
