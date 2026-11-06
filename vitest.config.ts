import { defineConfig } from "vitest/config";

/** Tests live next to the code as `*.test.ts`; end-to-end tests live in `test/`. None may use the network. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
