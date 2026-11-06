import { createServer } from "./server.js";

/** Starts the queue server on Node.js, listening on port 8080. */
const server = createServer();
server.listen(8080);
