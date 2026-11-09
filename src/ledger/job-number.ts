/**
 * Works out a company's own job id from a posting address.
 *
 * Why it exists: recruiters say "the job number is 4412345", not Scout's id. Most posting
 * addresses contain it, so Scout fills it in and the user can correct it.
 *
 * Example: `jobNumberFromLink("https://boards.greenhouse.io/acme/jobs/4412345")` is `"4412345"`;
 * `jobNumberFromLink("https://careers.example.com/about")` is `""`.
 */

/** Query parameter names that carry a job id, in the order they are tried. */
const ID_PARAMETERS = ["gh_jid", "jobid", "job_id", "jid", "reqid", "req_id", "requisition", "id"];

/** A path piece that looks like an id: has a digit and is at least five characters. */
function looksLikeId(piece: string): boolean {
  return piece.length >= 5 && /\d/.test(piece) && /^[A-Za-z0-9_-]+$/.test(piece);
}

/** The id at the front of a piece like `7463521-backend-engineer`, or the piece itself. */
function idFromPiece(piece: string): string {
  const leading = /^(\d{5,})-/.exec(piece);
  return leading?.[1] ?? piece;
}

/**
 * Returns the job id found in `link`, or an empty string when there is none.
 * Failure: a text that is not an address gives an empty string.
 */
export function jobNumberFromLink(link: string): string {
  let address: URL;
  try {
    address = new URL(link);
  } catch {
    return "";
  }
  for (const name of ID_PARAMETERS) {
    for (const [key, value] of address.searchParams) {
      if (key.toLowerCase() === name && value.length > 0 && value.length <= 120) return value;
    }
  }
  const pieces = address.pathname.split("/").filter((piece) => piece.length > 0);
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index] ?? "";
    if (looksLikeId(piece)) return idFromPiece(piece);
  }
  return "";
}
