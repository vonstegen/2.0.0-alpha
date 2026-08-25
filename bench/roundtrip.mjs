#!/usr/bin/env node
// In-container round-trip: invoke the real bridge dispatcher with the
// real Phase 3.5 grants store, targeting the addon stubs running on
// loopback. Mirrors /tmp/bridge-roundtrip.mjs so anyone working on the
// repo can reproduce the same wire path without leaving the bench.
//
// Run:
//   docker compose -f docker-compose.bench.yml exec bench /app/bench/roundtrip.mjs
// Or, after `docker exec -it resonant-bench bash`:
//   node /app/bench/roundtrip.mjs


const { dispatchExternalAgentRuntime } = await import(
  "/app/repo/browser-first/host/external-agent-runtime-dispatcher.mjs"
);
const { createBridgeGrantsStore } = await import(
  "/app/repo/browser-first/host/bridge-grants-store.mjs"
);

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const auditPath = "/var/lib/resonant-bench/BrowserFirst/audit.jsonl";
mkdirSync(dirname(auditPath), { recursive: true });
const auditLedger = {
  record(entry) {
    try {
      appendFileSync(auditPath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n");
    } catch (err) {
      console.error("[audit] write failed:", err.message);
    }
  },
};

const grants = createBridgeGrantsStore({
  tokenKey: Buffer.from("roundtrip-bench-token-key-32-bytes!"),
  callerIdAllowlist: ["dev-roundtrip"],
});
for (const cap of [
  "network",
  "providers",
  "agent-delegation",
  "archive-intake-write",
  "memory-provider",
]) {
  grants.mintGrant("dev-roundtrip", cap);
}

const perCallerGrants = {
  get(callerId) {
    const bucket = grants.snapshot()[callerId];
    if (!bucket) return null;
    return {
      capabilities: { get(cap) { return bucket[cap]; } },
    };
  },
};

const cases = [
  { addonId: "addon.deepseek-harness", tool: "deepseek_harness.status",
    payload: { model: "deepseek-chat", messages: [{ role: "user", content: "bench healthcheck" }] } },
  { addonId: "addon.deepseek-harness", tool: "deepseek_harness.run_task",
    payload: { model: "deepseek-reasoner", messages: [{ role: "user", content: "summarize ADR-040" }] } },
  { addonId: "addon.deepseek-harness", tool: "deepseek_harness.cancel",
    payload: { model: "deepseek-chat", messages: [{ role: "user", content: "cancel" }] } },
  { addonId: "addon.recursive-mas",    tool: "recursive_mas.status",
    payload: { model: "recursive-mas-light", messages: [{ role: "user", content: "ping" }] } },
  { addonId: "addon.recursive-mas",    tool: "recursive_mas.run_task",
    payload: { model: "recursive-mas-light", messages: [{ role: "user", content: "diagnose" }] } },
  { addonId: "addon.reference-memory", tool: "memory.search",
    payload: { model: "memory-search-stub", messages: [{ role: "user", content: "search ADR" }] } },
];

let allow = 0, deny = 0;
for (const c of cases) {
  const t0 = Date.now();
  const result = await dispatchExternalAgentRuntime({
    addonId: c.addonId,
    toolName: c.tool,
    payload: c.payload,
    callerId: "dev-roundtrip",
    perCallerGrants,
    auditLedger,
    repoRoot: "/app/repo",
  });
  const ms = Date.now() - t0;
  if (result.outcome === "allow") {
    allow++;
    const reply = result.response?.choices?.[0]?.message?.content ?? "";
    console.log(`ALLOW ${ms}ms  ${c.tool}`);
    console.log(`       reply: ${String(reply).replace(/\n/g, " | ").slice(0, 200)}`);
  } else {
    deny++;
    console.log(`DENY  ${ms}ms  ${c.tool}`);
    console.log(`       reason: ${result.reason}`);
    console.log(`       detail: ${result.detail}`);
  }
}

console.log(`\nresult: ${allow} allow · ${deny} deny`);
console.log(`audit : ${auditPath}`);
process.exit(deny === 0 ? 0 : 2);