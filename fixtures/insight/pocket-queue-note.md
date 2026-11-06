# Pocket Queue

## Overview

A small in-memory message queue with an HTTP API, written in TypeScript on Express.

## Verdict

Unfinished. The server and leases work, but there is no acknowledge route, no persistence and no tests.

## Stack

- TypeScript
- Node.js
- Express
- Docker

## Features

- Message leases (built): A claimed message is leased for 30 seconds and goes back to the queue if it is not acknowledged in time.
  Design decisions: Leases expire on the next claim instead of with a background timer, to keep the code small.
  Failure handling: A stalled consumer does not lose the message; it returns to the queue when the lease expires.
- Acknowledge route (described-only): The README describes removing a leased message, but no route for it exists in the code.

## Do not claim

- That it is production ready, deployed, or used by real users: nothing in the repository proves it.
- Anything the README says that the code does not show.
- That it is finished.
- That "Acknowledge route" is complete: it is described-only.
- Use of Kafka: not found in the project's configuration or code.
- The figure millions of messages per second: not found in the project's configuration or code.
- That messages survive a restart: queues live in memory only.

## Numbers

- 30: Lease length in seconds (LEASE_SECONDS in the code).

## Read once

Read from the folder pocket-queue on 2026-11-07.
