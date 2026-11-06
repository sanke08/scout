/**
 * Recruiter contact records and the pure rules for filling them in.
 *
 * Why it exists: a follow-up is better sent to a person. But Scout may only use public
 * professional details (idea 5.13): the person named on the posting, a profile found through
 * public search results, an email that is actually published (with where it was published), a
 * labelled guess, or the firm's public hiring inbox. No paid email finders, no phone numbers,
 * no home addresses.
 *
 * Everything here is data and pure functions. Nothing visits a web page: the caller supplies the
 * search results and published addresses it found.
 *
 * Example: `buildRecruiterContact({ name: "Sam Okafor", firm: "Brightline Talent", ... })` gives a
 * contact whose `linkedinUrl` is set only if a supplied search result mentions both the name and
 * the firm.
 */

/** A search result the caller got from a public web search. Only these three fields are read. */
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** An email address published by the firm or person, with where it was published. */
export interface PublishedEmail {
  address: string;
  /** The page where the address is published, so the user can check it. */
  sourceUrl: string;
}

/** An email address worked out from a naming pattern. It is a guess and is always labelled so. */
export interface GuessedEmail {
  address: string;
  /** The pattern used, for example "first.last". */
  pattern: string;
  /** Always "unverified". */
  label: "unverified";
}

/** What Scout knows about one recruiter. Every field after `firm` is optional and sourced. */
export interface RecruiterContact {
  name: string;
  firm: string;
  /** Set only when a public search result matched both the name and the firm. */
  linkedinUrl?: string;
  /** A work email the person has published, with its source. */
  publishedEmail?: PublishedEmail;
  /** A guess from a naming pattern. Shown to the user as unverified. */
  guessedEmail?: GuessedEmail;
  /** The firm's public hiring inbox (for example careers@), with its source. */
  hiringInbox?: PublishedEmail;
}

/** Inputs for `buildRecruiterContact`. */
export interface RecruiterLookupInput {
  name: string;
  firm: string;
  /** Results from a public web search for the name and firm. */
  searchResults: SearchResult[];
  /** Addresses the caller found published, for the person or the firm. */
  publishedEmails: PublishedEmail[];
  /** The firm's email domain, used for the pattern guess. Example: "brightline-talent.example.com". */
  firmDomain?: string;
}

/** The mailbox names a firm commonly uses for hiring. */
const HIRING_INBOX_NAMES = ["careers", "jobs", "recruiting", "recruitment", "hiring", "talent"];

/** Lower-cases text and keeps only letters and digits separated by single spaces. */
function normalise(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

/** True when every word of `needle` appears in `haystack` as whole words. */
function containsAllWords(haystack: string, needle: string): boolean {
  const wanted = normalise(needle)
    .split(" ")
    .filter((word) => word !== "");
  const available = normalise(haystack).split(" ");
  return wanted.length > 0 && wanted.every((word) => available.includes(word));
}

/** True when `url` is a LinkedIn personal profile address (`linkedin.com/in/...`). */
function isLinkedinProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const onLinkedin = host === "linkedin.com" || host.endsWith(".linkedin.com");
    return onLinkedin && parsed.protocol === "https:" && parsed.pathname.startsWith("/in/");
  } catch {
    return false;
  }
}

/**
 * Picks a profile address from search results, counting a result only when it is a LinkedIn
 * profile page and its title and snippet mention BOTH the full name and the firm.
 * Returns undefined otherwise: a same-name person at another firm is never accepted.
 *
 * Example: a result titled "Sam Okafor - Recruiter - Brightline Talent | LinkedIn" at
 * `https://www.linkedin.com/in/sam-okafor-example` gives that address.
 */
export function pickProfileUrl(
  name: string,
  firm: string,
  searchResults: SearchResult[],
): string | undefined {
  for (const result of searchResults) {
    if (!isLinkedinProfileUrl(result.url)) continue;
    const text = `${result.title} ${result.snippet}`;
    if (containsAllWords(text, name) && containsAllWords(text, firm)) return result.url;
  }
  return undefined;
}

/** True when `address` looks like an email address (one "@", a dot in the domain, no spaces). */
export function isEmailAddress(address: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(address);
}

/**
 * Picks the published address for a person: one whose part before "@" contains the person's first
 * and last name. Addresses without a source address are never accepted.
 */
export function pickPublishedEmail(
  name: string,
  publishedEmails: PublishedEmail[],
): PublishedEmail | undefined {
  const words = normalise(name)
    .split(" ")
    .filter((word) => word !== "");
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined || first === last) return undefined;
  return publishedEmails.find((published) => {
    if (!isEmailAddress(published.address) || published.sourceUrl.trim() === "") return false;
    const local = (published.address.split("@")[0] ?? "").toLowerCase();
    return local.includes(first) && local.includes(last);
  });
}

/**
 * Picks the firm's public hiring inbox from published addresses: one whose part before "@" is a
 * common hiring name such as careers or jobs. Needs a source address, like any published email.
 */
export function pickHiringInbox(publishedEmails: PublishedEmail[]): PublishedEmail | undefined {
  return publishedEmails.find((published) => {
    if (!isEmailAddress(published.address) || published.sourceUrl.trim() === "") return false;
    const local = (published.address.split("@")[0] ?? "").toLowerCase();
    return HIRING_INBOX_NAMES.includes(local);
  });
}

/**
 * Makes the most common pattern guess for a work email: first.last at the firm's domain.
 * Returns undefined when the name has no first and last part or the domain is empty.
 * The result is always labelled "unverified".
 *
 * Example: `guessEmail("Sam Okafor", "brightline-talent.example.com")` gives address
 * "sam.okafor@brightline-talent.example.com".
 */
export function guessEmail(name: string, firmDomain: string): GuessedEmail | undefined {
  const words = normalise(name)
    .split(" ")
    .filter((word) => word !== "");
  const first = words[0];
  const last = words[words.length - 1];
  const domain = firmDomain.trim().toLowerCase();
  if (first === undefined || last === undefined || first === last || domain === "") {
    return undefined;
  }
  const local = `${first}.${last}`.replace(/[^a-z0-9.]/g, "");
  if (local === "" || !isEmailAddress(`${local}@${domain}`)) return undefined;
  return { address: `${local}@${domain}`, pattern: "first.last", label: "unverified" };
}

/**
 * Builds a contact from what the caller found, applying the rules above. Pure: no web access.
 */
export function buildRecruiterContact(input: RecruiterLookupInput): RecruiterContact {
  const contact: RecruiterContact = { name: input.name, firm: input.firm };
  const linkedinUrl = pickProfileUrl(input.name, input.firm, input.searchResults);
  if (linkedinUrl !== undefined) contact.linkedinUrl = linkedinUrl;
  const publishedEmail = pickPublishedEmail(input.name, input.publishedEmails);
  if (publishedEmail !== undefined) contact.publishedEmail = publishedEmail;
  if (publishedEmail === undefined && input.firmDomain !== undefined) {
    const guessed = guessEmail(input.name, input.firmDomain);
    if (guessed !== undefined) contact.guessedEmail = guessed;
  }
  const hiringInbox = pickHiringInbox(input.publishedEmails);
  if (hiringInbox !== undefined) contact.hiringInbox = hiringInbox;
  return contact;
}

/** Where a chosen address came from, from most to least trustworthy. */
export type ContactAddressBasis = "published" | "hiring-inbox" | "guess-unverified";

/**
 * Chooses the address to write to: the person's published email, else the firm's hiring inbox,
 * else the unverified guess. Returns undefined when the contact has none.
 */
export function chooseContactAddress(
  contact: RecruiterContact,
): { address: string; basis: ContactAddressBasis } | undefined {
  if (contact.publishedEmail !== undefined) {
    return { address: contact.publishedEmail.address, basis: "published" };
  }
  if (contact.hiringInbox !== undefined) {
    return { address: contact.hiringInbox.address, basis: "hiring-inbox" };
  }
  if (contact.guessedEmail !== undefined) {
    return { address: contact.guessedEmail.address, basis: "guess-unverified" };
  }
  return undefined;
}
