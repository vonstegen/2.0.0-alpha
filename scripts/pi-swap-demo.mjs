// Pi (pi.dev) primary-agent swap — drives the running bridge's governed harness
// routes to install `addon.pi`, grant its declared capabilities, and assign it
// the `primary-agent` slot (replacing Augmentor/Provider Fabric).
//
// Requires the bridge already running with RESONANTOS_HARNESS_DEMO=1 and a
// RESONANTOS_HARNESS_BINDINGS entry for addon.pi (adapterId openai-compatible-v1,
// authScheme bearer, endpoint http://127.0.0.1:47326, source env PI_BEARER), and
// the pi wrapper running on 127.0.0.1:47326.
//
// Usage: node scripts/pi-swap-demo.mjs

import { readFile } from "node:fs/promises";

const CONFIG_PATH = "browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js";
const MANIFEST_PATH = "browser-first/host/harness-examples/pi.json";

function parseGeneratedConfig(source) {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Unrecognized bridge config shape.");
  return JSON.parse(source.slice(start, end + 1));
}

async function jsonFetch(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) {
    throw new Error(`${method} ${url} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

const config = parseGeneratedConfig(await readFile(CONFIG_PATH, "utf8"));
const { bridgeUrl, bridgeToken, capabilityBootstrapToken } = config;
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));

console.log(`bridge: ${bridgeUrl}`);

// 1. Request the harness capability tokens (read + control).
const { capabilityTokens } = await jsonFetch(`${bridgeUrl}/api/capability-tokens`, {
  method: "POST",
  body: { capabilities: ["addon-runtime-read", "addon-runtime-control"] },
  headers: {
    "X-ResonantOS-Bridge-Token": bridgeToken,
    "X-ResonantOS-Capability-Bootstrap-Token": capabilityBootstrapToken,
  },
});
const read = { "X-ResonantOS-Bridge-Token": bridgeToken, "X-ResonantOS-Bridge-Capability-Token": capabilityTokens["addon-runtime-read"] };
const control = { "X-ResonantOS-Bridge-Token": bridgeToken, "X-ResonantOS-Bridge-Capability-Token": capabilityTokens["addon-runtime-control"] };

// 2. Install addon.pi (installing grants nothing).
await jsonFetch(`${bridgeUrl}/addons/install`, { method: "POST", body: { manifest, enabled: true }, headers: control });
console.log("installed addon.pi (enabled, no grants)");

// 3. Grant the declared capabilities with explicit host consent.
let snapshot = await jsonFetch(`${bridgeUrl}/addons/registry`, { headers: read });
const grants = manifest.requestedCapabilities.map((grant) => ({ ...grant, granted: true }));
await jsonFetch(`${bridgeUrl}/addons/grants`, {
  method: "POST",
  body: { addonId: manifest.id, consent: true, expectedRevision: snapshot.revision, grants },
  headers: control,
});
console.log(`granted capabilities: ${grants.map((g) => g.capability).join(", ")}`);

// 4. Assign the primary-agent slot (this replaces Augmentor).
snapshot = await jsonFetch(`${bridgeUrl}/addons/registry`, { headers: read });
const incumbent = snapshot.slots?.["primary-agent"] ?? { addonId: null, generation: 0 };
await jsonFetch(`${bridgeUrl}/addons/slots/assign`, {
  method: "POST",
  body: { slot: "primary-agent", addonId: manifest.id, expectedGeneration: incumbent.generation, replace: Boolean(incumbent.addonId) },
  headers: control,
});
console.log(`assigned primary-agent slot to ${manifest.id}`);

// 5. Verify.
snapshot = await jsonFetch(`${bridgeUrl}/addons/registry`, { headers: read });
const owner = snapshot.slots["primary-agent"];
console.log(JSON.stringify({
  governanceActivated: snapshot.governanceActivated,
  primaryAgent: { addonId: owner.addonId, generation: owner.generation, available: owner.available },
  piGrants: snapshot.installations[manifest.id]?.grantedCapabilities,
}, null, 2));

if (owner.addonId !== manifest.id) {
  console.error("swap did not take effect: primary-agent owner is", owner.addonId);
  process.exit(1);
}
console.log(`\nOK — primary-agent is now ${manifest.id}. Augmentor (provider-fabric) has been replaced.`);
