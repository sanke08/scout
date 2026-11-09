/**
 * Finds the sign-in form on a page with plain, generic rules: one password box, the box where the
 * username or email goes, and the button that sends the form.
 *
 * Why it exists: Scout cannot know every site's markup, so it looks for what every sign-in form
 * has. It is deliberately strict: when anything is unclear (no password box, two boxes that could
 * be the username, a selector that matches more than one element) it answers "not found" and the
 * user signs in by hand. Page HTML is untrusted data; this only reads it.
 *
 * Example: a page with `<form><input type="email" name="session_key"><input type="password"
 * name="session_password"><button type="submit">Sign in</button></form>` gives selectors
 * `input[name="session_key"]`, `input[name="session_password"]` and `button[type="submit"]`.
 */
import * as cheerio from "cheerio";

/** The three things Scout needs to sign in, as CSS selectors that each match exactly one element. */
export interface LoginForm {
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
}

/** Words in a field's name, id, placeholder or autocomplete hint that mean "this is the username". */
const USERNAME_HINT = /user|e-?mail|login|session_key|identifier|account/i;

/** Types of input that can hold a username. An input with no type counts as text. */
const USERNAME_TYPES = ["", "text", "email", "tel"];

/** A selector for one element from its id or name, or `undefined` when it has neither. */
function selectorFromAttributes(element: cheerio.Cheerio<never>, tag: string): string | undefined {
  const quote = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const id = element.attr("id");
  if (id !== undefined && id !== "") return `${tag}[id="${quote(id)}"]`;
  const name = element.attr("name");
  if (name !== undefined && name !== "") return `${tag}[name="${quote(name)}"]`;
  return undefined;
}

/**
 * Reads the page and returns the form, or `undefined` when it is not a plain sign-in form.
 * Example: a page with no password box gives `undefined`.
 */
export function findLoginForm(html: string): LoginForm | undefined {
  const $ = cheerio.load(html);
  const passwords = $('input[type="password"]');
  if (passwords.length !== 1) return undefined;
  const password = passwords.first();
  const form = password.closest("form");
  if (form.length === 0) return undefined;

  const passwordSelector =
    selectorFromAttributes(password as cheerio.Cheerio<never>, "input") ?? 'input[type="password"]';

  const candidates = form
    .find("input")
    .filter((_index, node) => {
      const type = ($(node).attr("type") ?? "").toLowerCase();
      return USERNAME_TYPES.includes(type);
    })
    .toArray();
  const hinted = candidates.filter((node) => {
    const element = $(node);
    const text = [
      element.attr("name"),
      element.attr("id"),
      element.attr("placeholder"),
      element.attr("autocomplete"),
      element.attr("aria-label"),
      element.attr("type"),
    ].join(" ");
    return USERNAME_HINT.test(text);
  });
  const usernameNodes = hinted.length > 0 ? hinted : candidates;
  if (usernameNodes.length !== 1 || usernameNodes[0] === undefined) return undefined;
  const usernameSelector = selectorFromAttributes(
    $(usernameNodes[0]) as cheerio.Cheerio<never>,
    "input",
  );
  if (usernameSelector === undefined) return undefined;

  const submitSelector =
    form.find('button[type="submit"]').length === 1
      ? 'form button[type="submit"]'
      : form.find('input[type="submit"]').length === 1
        ? 'form input[type="submit"]'
        : form.find("button").length === 1
          ? "form button"
          : undefined;
  if (submitSelector === undefined) return undefined;

  // Every selector must match exactly one element on the whole page, or it could hit another form.
  for (const selector of [usernameSelector, passwordSelector, submitSelector]) {
    if ($(selector).length !== 1) return undefined;
  }
  return { usernameSelector, passwordSelector, submitSelector };
}
