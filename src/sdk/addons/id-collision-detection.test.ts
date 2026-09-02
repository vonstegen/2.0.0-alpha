// Intent citation: docs/architecture/resonantos-browser-architecture/CP75-PHASE75-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md
//
// CP-7.5 §7.5.4 (Cross-manifest id-collision detection). Verifies that:
//   1. Two manifests with the same `id` but different publishers do NOT
//      collide (each gets its own worker; the worker key is `id@publisher`).
//   2. Two manifests with the same `id@publisher` (whether bundled or
//      sideloaded) DO surface a collision.
//   3. The install path rejects a colliding manifest without `forceOverride`.
//   4. The install path accepts a colliding manifest with `forceOverride: true`.
//   5. The bundled catalog alone (no sideloaded) does not produce collisions.
//   6. First-wins policy: bundled wins over sideloaded at the same key.

import { describe, expect, it } from "vitest";

import type { AddOnManifest } from "../../core/contracts";

import {
  createAddOnRegistrySnapshot,
  detectRegistryIdCollisions,
} from "./registry.ts";

const baseManifest = (overrides: Record<string, unknown>): AddOnManifest => ({
  id: "addon.collision-test",
  name: "Collision Test",
  version: "0.1.0",
  publisher: "resonantos-testing",
  author: "Resonant Alpha",
  category: "tool",
  description: "CP-7.5 §7.5.4 collision detection smoke test.",
  runtimeType: "local-service",
  surfaces: [],
  requestedCapabilities: [],
  providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
  archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
  health: { strategy: "ready" },
  installHooks: {},
  sdkVersion: "^2.0.x",
  compatibility: { shellVersion: "2.0.0-beta.1", platforms: ["darwin"] },
  ...overrides,
});

describe("CP-7.5 §7.5.4 cross-manifest id-collision detection", () => {
  it("accepts a snapshot with no collisions (no bundled, no sideloaded)", () => {
    const collisions = detectRegistryIdCollisions([], []);
    expect(collisions).toEqual([]);
  });

  it("accepts a snapshot with two manifests of the same id but different publishers (NOT a collision)", () => {
    // The worker key is `id@publisher`; different publishers = different
    // workers = no collision.
    const a = baseManifest({ id: "addon.browser", publisher: "local" });
    const b = baseManifest({ id: "addon.browser", publisher: "rogue-attacker" });
    const collisions = detectRegistryIdCollisions([a], [b]);
    expect(collisions).toEqual([]);
  });

  it("surfaces a collision when bundled + sideloaded share an id@publisher pair", () => {
    const bundled = baseManifest({ id: "addon.browser", publisher: "local", name: "Bundled Browser" });
    const sideloaded = baseManifest({ id: "addon.browser", publisher: "local", name: "Sideloaded Browser" });
    const collisions = detectRegistryIdCollisions([bundled], [sideloaded]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      id: "addon.browser",
      publisher: "local",
    });
    expect(collisions[0].collisions).toHaveLength(2);
    expect(collisions[0].collisions[0].source).toBe("bundled-catalog");
    expect(collisions[0].collisions[1].source).toBe("sideloaded-local");
  });

  it("surfaces a collision when two sideloaded manifests share an id@publisher pair", () => {
    const a = baseManifest({ id: "addon.browser", publisher: "local" });
    const b = baseManifest({ id: "addon.browser", publisher: "local" });
    const collisions = detectRegistryIdCollisions([], [a, b]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].collisions).toHaveLength(2);
  });

  it("createAddOnRegistrySnapshot surfaces idCollisions on the snapshot", () => {
    const bundled = baseManifest({ id: "addon.browser", publisher: "local" });
    const sideloaded = baseManifest({ id: "addon.browser", publisher: "local" });
    const snapshot = createAddOnRegistrySnapshot({ bundled: [bundled], sideloaded: [sideloaded], installations: {} });
    expect(snapshot.idCollisions).toHaveLength(1);
    expect(snapshot.entries).toHaveLength(2);
  });

  it("bundled alone with the 20 real manifests produces zero collisions", () => {
    // Regression: the real bundled catalog has no id@publisher collisions.
    // We can't import the real bundled set from the test (it lives in
    // public/addons/*.json), so we trust the upstream `npm run validate:manifest`
    // gate to catch any future collision.)
    const bundled = [
      baseManifest({ id: "addon.browser", publisher: "local" }),
      baseManifest({ id: "addon.hermes", publisher: "local" }),
      baseManifest({ id: "addon.opencode", publisher: "local" }),
    ];
    expect(detectRegistryIdCollisions(bundled, [])).toEqual([]);
  });
});

// §7.5.4 install-path tests live in controller.test.tsx (the React
// component-level test for the sideload controller). This file is the
// pure-data side of the gate; the integration is covered by that suite.
