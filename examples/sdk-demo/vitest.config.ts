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
    // Phase 1.5 Step A: surface the terminal-host driver selector to vitest
    // tests via `import.meta.env.RESONANT_TERMINAL_DRIVER`. Default
    // "in-memory" so CI without iTerm2 stays green. Phase 2 lifecycle tests
    // skip themselves when this is "in-memory"; the live runtime (browser-
    // first/host/terminal-host-service.mjs) reads `process.env` directly
    // (see examples/sdk-demo/terminal-host/driver.ts).
    env: {
      RESONANT_TERMINAL_DRIVER: process.env.RESONANT_TERMINAL_DRIVER ?? "in-memory",
    },
  },
});
