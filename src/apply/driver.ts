/**
 * The one way Scout touches a web page: a small interface a real browser and a test fake both
 * implement.
 *
 * Why: everything that decides what to do (mapping, planning, the level rules, the submit
 * marker) is plain code tested without a browser. Only this thin interface needs a browser.
 * Selectors are the CSS selectors found in the `FormSnapshot`.
 *
 * Example: `await driver.open(url); await driver.fill('[name="email"]', "alex@example.com");
 * const seen = await driver.readValue('[name="email"]');`.
 * A method that cannot do its job (selector not found, page closed) rejects with an error; the
 * caller treats that as "stop and ask the user", never as "try again with the submit".
 */
export interface BrowserDriver {
  /** Opens the application page and waits until it is usable. */
  open(url: string): Promise<void>;
  /**
   * The address the page is on now, after any redirects. Scout reads it before typing a saved
   * password, so a sign-in page that sent the browser to another site never receives one.
   */
  currentUrl(): Promise<string>;
  /** The visible text of the whole page. Used to detect CAPTCHAs, sign-in walls and closed jobs. */
  pageText(): Promise<string>;
  /** The page's HTML, read into a `FormSnapshot`. */
  pageHtml(): Promise<string>;
  /** Types `value` into a text, email, phone, link or text-area field, replacing what is there. */
  fill(selector: string, value: string): Promise<void>;
  /**
   * Chooses an option. For a drop-down or a radio group `value` is the option's text. For a
   * single tick box `value` is `"true"` (ticked) or `"false"` (not ticked).
   */
  select(selector: string, value: string): Promise<void>;
  /** Attaches the file at `filePath` to a file input. */
  upload(selector: string, filePath: string): Promise<void>;
  /**
   * Reads back what the page now holds for a field: the text, the chosen option's text,
   * `"true"` or `"false"` for a single tick box, or the attached file's name.
   */
  readValue(selector: string): Promise<string>;
  /** A picture of the whole page as PNG bytes. */
  screenshot(): Promise<Uint8Array>;
  /** Presses the submit control. Called only after every safety rule allowed it. */
  submit(selector: string): Promise<void>;
  /** The visible text of the page after the submit, used to look for a confirmation. */
  readConfirmation(): Promise<string>;
  /** Closes the page and the browser. Safe to call twice. */
  close(): Promise<void>;
}
