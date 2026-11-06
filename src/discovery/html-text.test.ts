/** Properties of HTML to text conversion: markup goes, words stay. */
import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text.js";

describe("htmlToText", () => {
  it("keeps every word and puts blocks and list items on their own lines", () => {
    const text = htmlToText(
      "<p>Build <b>APIs</b> &amp; services</p><ul><li>Node.js</li><li>SQL</li></ul>",
    );
    expect(text).toBe("Build APIs & services\n- Node.js\n- SQL");
  });

  it("reads escaped HTML (as Greenhouse sends it) like real HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &lt;em&gt;team&lt;/em&gt;&lt;/p&gt;")).toBe("Hello team");
  });

  it("removes scripts and styles but keeps hidden text, so it can be inspected", () => {
    const text = htmlToText(
      '<p>Visible</p><script>alert(1)</script><span style="display:none">hidden words</span>',
    );
    expect(text).not.toContain("alert");
    expect(text).toContain("hidden words");
  });

  it("returns plain text unchanged apart from trimming", () => {
    expect(htmlToText("  Just text.  ")).toBe("Just text.");
  });
});
