import { describe, expect, it } from "vitest";
import { emailHtmlToText } from "./html-to-text.js";

describe("emailHtmlToText", () => {
  it("keeps the words and the link address of a link, and puts blocks on separate lines", () => {
    const text = emailHtmlToText(
      '<p>Backend Engineer</p><a href="https://example.com/j/1">View job</a>',
    );
    expect(text).toBe("Backend Engineer\nView job <https://example.com/j/1>");
  });

  it("drops scripts, styles and the head, and ignores non-web link addresses", () => {
    const text = emailHtmlToText(
      '<html><head><title>T</title><style>p{}</style></head><body><script>x()</script><a href="javascript:evil()">click</a></body></html>',
    );
    expect(text).toBe("click");
  });

  it("returns plain text unchanged apart from trimming", () => {
    expect(emailHtmlToText("  just words  ")).toBe("just words");
  });
});
