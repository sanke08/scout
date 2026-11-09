/**
 * The platforms Scout knows how to sign in to, and the rule that tells which platform a posting
 * address belongs to.
 *
 * Why it exists: signing in needs the platform's own login page and its own domain (Scout types a
 * saved password only on that domain), and every command needs one name for "the site this job is
 * on". All of it is plain text work with no network, so it is easy to test.
 *
 * Example: `platformForUrl("https://www.linkedin.com/jobs/view/123")` is `"linkedin"`;
 * `platformForUrl("https://jobs.example.com/apply/9")` is `"example"`.
 */
import { ScoutError } from "../shared/index.js";

/** One platform Scout can open the sign-in page of. */
export interface KnownPlatform {
  /** Lower-case name used in settings and on the command line, for example `linkedin`. */
  name: string;
  /** The page where a person signs in. Always https and always on one of `domains`. */
  loginUrl: string;
  /** The registrable domains that belong to the platform. A host matches when it is one of them or a sub-domain. */
  domains: readonly string[];
}

/** The platforms with a known sign-in page. Everything else is an unknown platform with manual sign-in only. */
export const KNOWN_PLATFORMS: readonly KnownPlatform[] = [
  { name: "linkedin", loginUrl: "https://www.linkedin.com/login", domains: ["linkedin.com"] },
  { name: "indeed", loginUrl: "https://secure.indeed.com/auth", domains: ["indeed.com"] },
  { name: "naukri", loginUrl: "https://www.naukri.com/nlogin/login", domains: ["naukri.com"] },
];

/**
 * Endings that take two labels (`co.uk`), so the name of `jobs.example.co.uk` is `example` and not
 * `co`. A short list on purpose: a missing ending only gives a less pretty name, never a wrong
 * safety decision, because the safety check uses the known domains above.
 */
const TWO_PART_ENDINGS: readonly string[] = [
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "co.nz",
  "co.in",
  "co.jp",
  "com.br",
  "co.za",
  "com.sg",
];

/** The rule for a platform name typed by a person or stored in settings: lower-case letters, digits and dashes. */
const PLATFORM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Checks and normalises a platform name from the command line.
 * Example: `" LinkedIn "` gives `"linkedin"`. Failure: a name with spaces or symbols gives
 * `ScoutError("invalid-input")`.
 */
export function normalisePlatformName(text: string): string {
  const name = text.trim().toLowerCase();
  if (!PLATFORM_NAME_PATTERN.test(name)) {
    throw new ScoutError(
      "invalid-input",
      `"${text}" is not a platform name. Use letters, digits and dashes only, for example linkedin.`,
    );
  }
  return name;
}

/** The known platform with this name, or `undefined` for any other name. */
export function findKnownPlatform(name: string): KnownPlatform | undefined {
  return KNOWN_PLATFORMS.find((platform) => platform.name === name);
}

/** True when `hostname` is `domain` or a sub-domain of it. Example: `www.linkedin.com` and `linkedin.com`. */
function hostIsOnDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * True when `hostname` belongs to the known platform's own domains. This is the check that stops
 * a saved password from being typed on another site.
 * Example: `hostBelongsToPlatform("www.linkedin.com", linkedin)` is true; `"linkedin.com.evil.net"` is false.
 */
export function hostBelongsToPlatform(hostname: string, platform: KnownPlatform): boolean {
  const lower = hostname.toLowerCase();
  return platform.domains.some((domain) => hostIsOnDomain(lower, domain));
}

/** The name of an unknown host: its registrable domain without the ending. Example: `jobs.example.co.uk` gives `example`. */
function registrableName(hostname: string): string {
  const labels = hostname.split(".").filter((label) => label !== "");
  if (labels.length <= 1) return labels[0] ?? hostname;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_ENDINGS.includes(lastTwo) && labels.length >= 3) {
    return labels[labels.length - 3] ?? hostname;
  }
  return labels[labels.length - 2] ?? hostname;
}

/**
 * Maps a posting address to a platform name, by host name only.
 * Example: `https://in.linkedin.com/jobs/1` gives `linkedin`; `https://example.com/jobs` gives `example`.
 * Failure: text that is not a web address gives `ScoutError("invalid-input")`.
 */
export function platformForUrl(address: string): string {
  let hostname: string;
  try {
    hostname = new URL(address).hostname.toLowerCase();
  } catch {
    throw new ScoutError(
      "invalid-input",
      `"${address}" is not a web address, so Scout cannot tell which platform it belongs to.`,
    );
  }
  for (const platform of KNOWN_PLATFORMS) {
    if (hostBelongsToPlatform(hostname, platform)) return platform.name;
  }
  return registrableName(hostname);
}
