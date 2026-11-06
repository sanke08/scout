/** How long a claimed message stays leased before it returns to the queue. */
export const LEASE_SECONDS = 30;

/** A message waiting in a queue. */
export interface QueuedMessage {
  id: number;
  body: string;
  leasedUntil: number | undefined;
}

/** Returns expired leases to the queue so a stalled consumer does not lose work. */
export function releaseExpiredLeases(messages: QueuedMessage[], nowSeconds: number): void {
  for (const message of messages) {
    if (message.leasedUntil !== undefined && message.leasedUntil <= nowSeconds) {
      message.leasedUntil = undefined;
    }
  }
}

/** Claims the oldest message that is not leased and leases it for LEASE_SECONDS. */
export function claimOldest(
  messages: QueuedMessage[],
  nowSeconds: number,
): QueuedMessage | undefined {
  releaseExpiredLeases(messages, nowSeconds);
  const next = messages.find((message) => message.leasedUntil === undefined);
  if (next !== undefined) {
    next.leasedUntil = nowSeconds + LEASE_SECONDS;
  }
  return next;
}
