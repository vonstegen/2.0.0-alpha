// CP-BR9: reviewed seed for the two production terminal add-ons.
//
// CP-BR7 registered the Ghostty and iTerm2 runtime factories; CP-BR8 proved
// the lifecycle with fixtures. The gap: the two terminal add-ons were never
// installed into the host registry, so neither the CP-BR4 reconciler nor the
// CP-BR5 projection could see them (`registry.snapshot().installations` is
// the only authority either one reads).
//
// This module is the single reviewed pairing of:
//   - the canonical bundled catalog manifests
//     (`public/addons/terminal-host-{ghostty,iterm2}.json` — the same files
//     the shell loads, so the host registry and the UI catalog can never
//     diverge), and
//   - the CP-BR7 reviewed factory ids
//     (`com.resonantos.factory.terminal-host.{ghostty,iterm2}`).
//
// The composition root (`run-bridge-minimal.mjs`) loads the seed plan here
// and hands it to `createHarnessHostService({ seedInstallations })`, which
// installs it through the same registry path the `/addons/install` route
// uses. No parallel in-memory map, no second grant path, no manifest
// `service.entrypoint` execution (the factory registry owns spawn policy).
//
// Hard rules (CP-BR9 §7):
//   - Manifests come from the pinned catalog URLs below; no caller-supplied
//     path, id, or factory id.
//   - Every manifest is re-validated against the SDK contract on load.
//   - The seed never grants a capability and never enables an add-on;
//     authorization stays operator-consented.

import { readFile } from "node:fs/promises";

import { assertValidHarnessManifest } from "./harness-adapter-contract.mjs";
import { TERMINAL_FACTORY_IDS } from "./terminal-runtime-factories.mjs";

/**
 * The reviewed add-on id → factory id → catalog manifest pairing. This is
 * the canonical factory selection for the terminal `local-service` runtime
 * family; it is defined here exactly once.
 */
export const TERMINAL_ADDON_SEEDS = Object.freeze([
  Object.freeze({
    addonId: "addon.resonant-terminal-ghostty",
    factoryId: TERMINAL_FACTORY_IDS.ghostty,
    catalogUrl: new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url),
  }),
  Object.freeze({
    addonId: "addon.resonant-terminal-iterm2",
    factoryId: TERMINAL_FACTORY_IDS.iterm2,
    catalogUrl: new URL("../../public/addons/terminal-host-iterm2.json", import.meta.url),
  }),
]);

/**
 * Load and validate the reviewed seed plan. Each entry is
 * `{ manifest, factoryId }` where `manifest` is the parsed, SDK-validated
 * catalog manifest whose `id` matches the pinned add-on id.
 *
 * @param {{
 *   readFileImpl?: typeof readFile,
 *   validate?: (candidate: unknown) => unknown,
 *   seeds?: ReadonlyArray<{ addonId: string, factoryId: string, catalogUrl: URL }>,
 * }} [options] Test seams. Production callers pass nothing.
 * @returns {Promise<Array<{ manifest: object, factoryId: string }>>}
 */
export async function loadTerminalAddonSeedInstallations(options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile;
  const validate = options.validate ?? assertValidHarnessManifest;
  const seeds = options.seeds ?? TERMINAL_ADDON_SEEDS;
  const plan = [];
  for (const seed of seeds) {
    const raw = await readFileImpl(seed.catalogUrl, "utf8");
    const manifest = JSON.parse(raw);
    if (manifest?.id !== seed.addonId) {
      throw new Error(
        `terminal-addon-seed: catalog manifest id mismatch for ${seed.addonId} (got ${JSON.stringify(manifest?.id)})`,
      );
    }
    validate(manifest);
    plan.push({ manifest, factoryId: seed.factoryId });
  }
  return plan;
}
