/**
 * End-to-end: the Digest's approve, skip and undo actions run against the REAL job store and its
 * state machine (not a fake that accepts everything). A job found by discovery and shortlisted by
 * the (fake) model can be approved, skipped and restored through the web API.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApplication,
  createWebDependencies,
  type ApplicationOptions,
} from "../src/app/index.js";
import { startWebServer } from "../src/web/index.js";
import { main } from "../src/index.js";
import {
  FIXED_NOW,
  makeDataFolder,
  makeFakeNetwork,
  makeScoringBrain,
  runCli,
  type FakeNetwork,
} from "./helpers.js";

let folder: ReturnType<typeof makeDataFolder>;
let network: FakeNetwork;

beforeEach(() => {
  folder = makeDataFolder();
  network = makeFakeNetwork();
});

afterEach(() => {
  folder.remove();
});

function baseOverrides(extra: ApplicationOptions = {}): ApplicationOptions {
  return {
    directory: folder.directory,
    fetchImpl: network.fetchImpl,
    hostDelayMilliseconds: 0,
    now: () => FIXED_NOW,
    ...extra,
  };
}

describe("web approve, skip and undo against the real state machine", () => {
  it("moves a shortlisted job through approved, back, skipped and back again", async () => {
    await runCli(["init"], baseOverrides());
    await runCli(["boards", "add", "greenhouse", "harborjobs"], baseOverrides());
    await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));

    const application = createApplication(baseOverrides({ brain: makeScoringBrain(85, 85) }));
    const server = await startWebServer(createWebDependencies(application), { port: 0 });
    try {
      const shortlisted = application.jobStore.list({ status: "shortlisted" });
      expect(shortlisted.length).toBeGreaterThan(0);
      const id = shortlisted[0]!.id;
      const post = async (path: string, body: unknown): Promise<Response> =>
        fetch(`${server.url}/api/jobs/${id}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: server.url },
          body: JSON.stringify(body),
        });

      expect((await post("approve", {})).status).toBe(200);
      expect(application.jobStore.get(id)?.status).toBe("approved");
      expect((await post("undo", {})).status).toBe(200);
      expect(application.jobStore.get(id)?.status).toBe("shortlisted");
      expect((await post("skip", { tag: "Wrong location" })).status).toBe(200);
      expect(application.jobStore.get(id)?.status).toBe("skipped");
      expect((await post("undo", {})).status).toBe(200);
      expect(application.jobStore.get(id)?.status).toBe("shortlisted");
    } finally {
      await server.close();
      application.close();
    }
    // Keeps the entry point import used so the test exercises the same wiring as the CLI.
    expect(typeof main).toBe("function");
  });
});
