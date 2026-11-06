import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { renderLaunchAgentPlist } from "./launch-agent.js";

const base = {
  label: "com.example.scout",
  programArguments: ["/usr/local/bin/node", "/opt/scout/dist/index.js", "run"],
  workingDirectory: "/opt/scout",
  logDirectory: "/opt/scout/logs",
};

describe("renderLaunchAgentPlist", () => {
  it("is well-formed XML with RunAtLoad and KeepAlive and the arguments in order", () => {
    const xml = renderLaunchAgentPlist(base);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(xml).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(xml.indexOf("/usr/local/bin/node")).toBeLessThan(
      xml.indexOf("/opt/scout/dist/index.js"),
    );
    expect(xml).not.toContain("StartInterval");
    expect(xml).toContain("/opt/scout/logs/scout.err.log");
  });

  it("adds StartInterval only when asked", () => {
    const xml = renderLaunchAgentPlist({ ...base, startIntervalSeconds: 900 });
    expect(xml).toContain("<key>StartInterval</key>\n  <integer>900</integer>");
    expect(XMLValidator.validate(xml)).toBe(true);
  });

  it("escapes special characters so arguments cannot break out of the XML", () => {
    const hostile = `</string><key>Evil</key><string>x & "y" 'z'`;
    const xml = renderLaunchAgentPlist({
      ...base,
      programArguments: [...base.programArguments, hostile],
    });
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).not.toContain("<key>Evil</key>");
    expect(xml).toContain("&lt;/string&gt;&lt;key&gt;Evil&lt;/key&gt;");
    expect(xml).toContain("&amp; &quot;y&quot; &apos;z&apos;");
  });

  it("refuses bad labels, relative paths, empty arguments, control characters and bad intervals", () => {
    expect(() => renderLaunchAgentPlist({ ...base, label: "bad label<" })).toThrow(/label/);
    expect(() => renderLaunchAgentPlist({ ...base, programArguments: [] })).toThrow(/at least one/);
    expect(() => renderLaunchAgentPlist({ ...base, programArguments: ["node"] })).toThrow(
      /absolute/,
    );
    expect(() =>
      renderLaunchAgentPlist({ ...base, programArguments: ["/bin/node", "a\u0001b"] }),
    ).toThrow(/control/);
    expect(() => renderLaunchAgentPlist({ ...base, workingDirectory: "relative" })).toThrow(
      /absolute/,
    );
    expect(() => renderLaunchAgentPlist({ ...base, startIntervalSeconds: 0 })).toThrow(/interval/);
  });
});
