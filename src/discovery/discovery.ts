/**
 * The `Discovery` implementation: downloads one company's board and returns normalised postings.
 *
 * Downloading is injected (`fetchImpl`), so tests serve saved responses and real runs use the
 * global `fetch` with the limits in `http-fetcher.ts`.
 */
import { ScoutError, createLogger, type Discovery, type Posting } from "../shared/index.js";
import { parseAshby, ashbyUrl } from "./boards/ashby.js";
import { feedHost, parseFeed } from "./boards/feed.js";
import { greenhouseUrl, parseGreenhouse } from "./boards/greenhouse.js";
import { leverUrl, parseLever } from "./boards/lever.js";
import { parseRecruitee, recruiteeUrl } from "./boards/recruitee.js";
import {
  parseSmartRecruiters,
  readSmartRecruitersDescription,
  readSmartRecruitersIds,
  smartRecruitersDetailUrl,
  smartRecruitersUrl,
} from "./boards/smartrecruiters.js";
import { parseWorkable, workableUrl } from "./boards/workable.js";
import { createBoardFetcher, type BoardFetcher, type FetchImplementation } from "./http-fetcher.js";

/** Writes progress lines for the discovery module. */
const log = createLogger("discovery");

/** Settings for `createDiscovery`; every field has a default. */
export interface DiscoveryOptions {
  /** The download function, shaped like the global `fetch`. Defaults to the global `fetch`. */
  fetchImpl?: FetchImplementation;
  /** Clock used to measure the polite gap between requests to one host. Defaults to the real time. */
  now?: () => Date;
  /** Minimum gap between two requests to one host in milliseconds; 0 turns waiting off. */
  hostDelayMilliseconds?: number;
  /** Time limit for one request in milliseconds. */
  timeoutMilliseconds?: number;
  /** Largest accepted response body in bytes. */
  maxBodyBytes?: number;
  /** Waits for the given milliseconds; tests replace it so they never really wait. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Board tokens are plain names; anything else could change which address is fetched. */
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Throws unless `token` is a plain board name. Example: "examplecorp" is fine, "a/../b" is not. */
function assertPlainToken(token: string, kind: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    throw new ScoutError(
      "invalid-input",
      `The ${kind} board token "${token}" is not a plain name (letters, digits, dots, dashes and underscores only).`,
    );
  }
}

/** Throws unless `address` is an http or https address. */
function assertWebAddress(address: string): void {
  const isWebAddress = /^https?:\/\//i.test(address) && URL.canParse(address);
  if (!isWebAddress) {
    throw new ScoutError(
      "invalid-input",
      `The feed address "${address}" is not an http or https address.`,
    );
  }
}

/** Fetches a SmartRecruiters list, then each posting's text, and parses them together. */
async function fetchSmartRecruiters(
  fetcher: BoardFetcher,
  token: string,
  now: Date,
): Promise<Posting[]> {
  const boardName = `smartrecruiters:${token}`;
  const listBody = await fetcher.fetchText(smartRecruitersUrl(token), boardName);
  const descriptions = new Map<string, string>();
  for (const id of readSmartRecruitersIds(listBody, token)) {
    const detailBody = await fetcher.fetchText(smartRecruitersDetailUrl(token, id), boardName);
    descriptions.set(id, readSmartRecruitersDescription(detailBody, token));
  }
  return parseSmartRecruiters(listBody, token, now, descriptions);
}

/**
 * Creates the discovery service.
 *
 * Example: `createDiscovery({ fetchImpl }).fetchBoard({ kind: "greenhouse", token: "examplecorp" }, now)`
 * resolves to the postings of that board, each with `firstSeenAt` and `lastSeenAt` set to `now`.
 * For kind "feed" the token is the feed address. Kind "other" has no public format and fails.
 * Failure: an unknown board is `not-found`, a network problem is `unavailable`, and a
 * malformed or oversize body is `invalid-input`; all as `ScoutError` naming the board.
 */
export function createDiscovery(options: DiscoveryOptions = {}): Discovery {
  const clock = options.now ?? (() => new Date());
  const fetcher = createBoardFetcher({
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.hostDelayMilliseconds !== undefined
      ? { hostDelayMilliseconds: options.hostDelayMilliseconds }
      : {}),
    ...(options.timeoutMilliseconds !== undefined
      ? { timeoutMilliseconds: options.timeoutMilliseconds }
      : {}),
    ...(options.maxBodyBytes !== undefined ? { maxBodyBytes: options.maxBodyBytes } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    clock: () => clock().getTime(),
  });

  return {
    async fetchBoard(board, now) {
      const { kind, token } = board;
      let postings: Posting[];
      if (kind === "feed") {
        assertWebAddress(token);
        postings = parseFeed(await fetcher.fetchText(token, `feed:${feedHost(token)}`), token, now);
      } else if (kind === "other") {
        throw new ScoutError(
          "invalid-input",
          'Boards of kind "other" have no public feed format. Use a known board kind or an RSS feed.',
        );
      } else {
        assertPlainToken(token, kind);
        postings = await fetchKnownBoard(fetcher, kind, token, now);
      }
      log.debug("fetched board", { board: `${kind}:${token}`, jobs: postings.length });
      return postings;
    },
  };
}

/** Fetches and parses one of the six official board kinds. */
async function fetchKnownBoard(
  fetcher: BoardFetcher,
  kind: Exclude<Posting["board"], "feed" | "other">,
  token: string,
  now: Date,
): Promise<Posting[]> {
  const boardName = `${kind}:${token}`;
  switch (kind) {
    case "greenhouse":
      return parseGreenhouse(await fetcher.fetchText(greenhouseUrl(token), boardName), token, now);
    case "lever":
      return parseLever(await fetcher.fetchText(leverUrl(token), boardName), token, now);
    case "ashby":
      return parseAshby(await fetcher.fetchText(ashbyUrl(token), boardName), token, now);
    case "workable":
      return parseWorkable(await fetcher.fetchText(workableUrl(token), boardName), token, now);
    case "recruitee":
      return parseRecruitee(await fetcher.fetchText(recruiteeUrl(token), boardName), token, now);
    case "smartrecruiters":
      return fetchSmartRecruiters(fetcher, token, now);
  }
}
