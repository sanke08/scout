import { describe, expect, it } from "vitest";
import { createImapConnector } from "./imap-connection.js";

describe("createImapConnector", () => {
  it("fails with a fixed, secret-free message when the server cannot be reached", async () => {
    // Port 1 on the loopback address refuses at once; nothing leaves this computer.
    const connect = createImapConnector({
      host: "127.0.0.1",
      port: 1,
      user: "alex.rivera@example.com",
      password: "fictional-app-password-for-test",
    });
    const failure = await connect().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ name: "ScoutError", code: "unavailable" });
    const message = (failure as Error).message;
    expect(message).not.toContain("fictional-app-password-for-test");
    expect(message).not.toContain("alex.rivera");
    expect(message).toMatch(/app password/);
  });
});
