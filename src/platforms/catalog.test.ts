import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import {
  KNOWN_PLATFORMS,
  findKnownPlatform,
  hostBelongsToPlatform,
  normalisePlatformName,
  platformForUrl,
} from "./catalog.js";

describe("platformForUrl", () => {
  it("maps every sub-domain of a known platform to its name", () => {
    expect(platformForUrl("https://www.linkedin.com/jobs/view/123")).toBe("linkedin");
    expect(platformForUrl("https://in.linkedin.com/jobs/1")).toBe("linkedin");
    expect(platformForUrl("https://secure.indeed.com/auth")).toBe("indeed");
    expect(platformForUrl("https://www.naukri.com/job-listings-1")).toBe("naukri");
  });

  it("names an unknown host by its registrable domain", () => {
    expect(platformForUrl("https://example.com/jobs/1")).toBe("example");
    expect(platformForUrl("https://careers.example.com/jobs/1")).toBe("example");
    expect(platformForUrl("https://jobs.example.co.uk/apply")).toBe("example");
  });

  it("does not take a look-alike host for a known platform", () => {
    expect(platformForUrl("https://linkedin.com.example.net/login")).toBe("example");
    expect(platformForUrl("https://notlinkedin.com/login")).toBe("notlinkedin");
  });

  it("refuses text that is not a web address", () => {
    expect(() => platformForUrl("not a url")).toThrow(ScoutError);
  });
});

describe("hostBelongsToPlatform", () => {
  const linkedin = findKnownPlatform("linkedin")!;
  it("accepts the domain and its sub-domains only", () => {
    expect(hostBelongsToPlatform("linkedin.com", linkedin)).toBe(true);
    expect(hostBelongsToPlatform("WWW.LinkedIn.com", linkedin)).toBe(true);
    expect(hostBelongsToPlatform("linkedin.com.evil.example", linkedin)).toBe(false);
    expect(hostBelongsToPlatform("evillinkedin.com", linkedin)).toBe(false);
  });
});

describe("the catalog", () => {
  it("keeps every login address on the platform's own domain over https", () => {
    for (const platform of KNOWN_PLATFORMS) {
      const url = new URL(platform.loginUrl);
      expect(url.protocol).toBe("https:");
      expect(hostBelongsToPlatform(url.hostname, platform)).toBe(true);
    }
  });

  it("normalises a typed name and rejects symbols", () => {
    expect(normalisePlatformName(" LinkedIn ")).toBe("linkedin");
    expect(() => normalisePlatformName("linked in; rm")).toThrow(ScoutError);
  });
});
