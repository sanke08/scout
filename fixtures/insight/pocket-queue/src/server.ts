import express from "express";
import { claimOldest, type QueuedMessage } from "./lease.js";

/** Builds the HTTP server. Queues live in memory only: a restart loses every message. */
export function createServer() {
  const queues = new Map<string, QueuedMessage[]>();
  const app = express();
  app.use(express.json());

  app.post("/queues/:name/messages", (request, response) => {
    const messages = queues.get(request.params.name) ?? [];
    messages.push({
      id: messages.length + 1,
      body: String(request.body?.body ?? ""),
      leasedUntil: undefined,
    });
    queues.set(request.params.name, messages);
    response.status(201).json({ id: messages.length });
  });

  app.post("/queues/:name/claim", (request, response) => {
    const claimed = claimOldest(queues.get(request.params.name) ?? [], Date.now() / 1000);
    response.status(claimed === undefined ? 204 : 200).json(claimed ?? {});
  });

  return app;
}
