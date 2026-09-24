import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Demo-local test config: the repository-level vitest config only includes
// `src/**/*.test.ts`. The SDK demo lives under `examples/`, so it carries its
// own narrow config for its deterministic manifest/round-trip tests.
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
