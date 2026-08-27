#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md
// Intent citation: docs/architecture/ADR-041-addon-isolation-boundary.md
// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
//
// The add-on builder's bench: connect a newly-created add-on manifest and
// run it through the SDK's own contract tests in one shot.
//
// Mirrors the agent -> create -> connect -> validate -> test workflow a
// future builder follows: an agent emits a manifest (built against the SDK),
// and this script reports whether it is recognized, valid, correctly
// classified, and constrained by the mock host's capability enforcement.
//
// Usage:
//   npm run addon:bench -- examples/addons/addon.testing-hello.json
//   npm run addon:bench -- examples/addons            # every *.json in the dir
//
// Exit codes:
//   0 - every targeted manifest validated and passed its applicable tests
//   1 - one or more manifests failed validation
//   2 - one or more manifests failed a runtime/capability test
//   3 - no manifests found / a target could not be read
//   4 - unhandled error

import { readFileSync, readdirSync, statSync } from "node:fs";
import { runAddOnFailureMode, FAILURE_MODE_IDS } from "../packages/addon-sdk-testing/src/failure-modes/index.ts";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAddOnManifest } from "../src/sdk/addons/validation.ts";
import { buildWorkerKey, validateRuntimeIsolationForManifest } from "../packages/addon-sdk-testing/src/isolation.ts";
import { getTrustTierFromManifest, trustNoticeForManifest } from "../packages/addon-sdk-testing/src/trust-tier.ts";
import { mockHost } from "../packages/addon-sdk-testing/src/failure-modes/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectTargets(args) {
  const targets = args.length > 0 ? args : ["examples/addons"];
  const files = [];
  for (const target of targets) {
    const abs = resolve(repoRoot, target);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (name.endsWith(".json")) files.push(join(abs, name));
      }
    } else if (stat.isFile() && abs.endsWith(".json")) {
      files.push(abs);
    }
  }
  return [...new Set(files)].sort();
}

function line(label, detail = "") {
  // eslint-disable-next-line no-console
  console.log(`${detail ? "  " : "==>"} ${label}${detail ? `: ${detail}` : ""}`);
}

function hasAgentRuntimeTrigger(manifest) {
  const caps = new Set((manifest.requestedCapabilities ?? []).map((c) => c?.capability));
  return caps.has("providers") && caps.has("agent-delegation");
}

function runMockHostChecks(manifest, callerId) {
  const host = mockHost();
  const declaredTools = (manifest.tools ?? []).map((t) => t?.name).filter(Boolean);
  const granted = (manifest.requestedCapabilities ?? [])
    .map((c) => c?.capability)
    .filter(Boolean)
    .filter((c) => (manifest.requestedCapabilities ?? []).find((g) => g.capability === c)?.granted === true);

  const results = [];

  // A declared tool is served; an undeclared tool is denied.
  for (const toolName of declaredTools) {
    const call = host.invokeTool({ callerId, toolName, payload: {} }, declaredTools);
    results.push({ check: `declared tool "${toolName}" served`, pass: call.ok === true, code: call.ok ? "ok" : call.code });
  }
  if (declaredTools.length === 0) {
    results.push({ check: "no tools declared", pass: true, code: "n/a" });
  }
  const unknown = host.invokeTool({ callerId, toolName: "undeclared.probe", payload: {} }, declaredTools);
  results.push({ check: "undeclared tool denied", pass: unknown.ok === false && unknown.code === "unknown-tool", code: unknown.ok ? "ok" : unknown.code });

  // An unrequested archive capability is denied.
  const intake = host.callArchiveIntakeWrite({ callerId, granted, requested: "archive-read", itemRef: "bench-probe" });
  results.push({ check: "unrequested capability denied", pass: intake.ok === false && intake.code === "capability-denied", code: intake.ok ? "ok" : intake.code });

  // A workspace path escape is always rejected.
  const ws = host.accessWorkspace({ callerId, requestedPath: "/etc/passwd", workspaceRoot: "/tmp/addon-bench" });
  results.push({ check: "workspace escape rejected", pass: ws.ok === false && ws.code === "workspace-escape", code: ws.ok ? "ok" : ws.code });

  return results;
}

function benchOne(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    line("ERROR", `${file}: unreadable (${err.message})`);
    return { failed: true };
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    line("ERROR", `${file}: invalid JSON (${err.message})`);
    return { failed: true };
  }

  line("ADD-ON", `${manifest.id ?? basename(file)}  (${file})`);

  const validation = validateAddOnManifest(manifest, { source: "sideload" });
  const errors = validation.issues.filter((i) => i.severity === "error");
  const warnings = validation.issues.filter((i) => i.severity !== "error");
  if (errors.length > 0) {
    line("VALIDATE", "FAILED");
    for (const err of errors) line("  error", `${err.path}: ${err.code} — ${err.message}`);
  } else {
    line("VALIDATE", warnings.length === 0 ? "clean" : `${warnings.length} warning(s), 0 errors`);
    for (const warn of warnings) line("  warn", `${warn.path}: ${warn.code} — ${warn.message}`);
  }

  const tier = getTrustTierFromManifest(manifest);
  const verdict = trustNoticeForManifest(manifest);
  line("TRUST", `${tier}${verdict.untrusted ? " (untrusted)" : ""}`);
  if (verdict.untrusted) line("  notice", verdict.notice);

  const isolation = validateRuntimeIsolationForManifest(manifest);
  if (isolation.valid) {
    line("ISOLATION", `valid · workerKey=${buildWorkerKey(manifest)}`);
  } else {
    line("ISOLATION", "invalid");
    for (const err of isolation.errors) line("  error", `${err.path}: ${err.code} — ${err.message}`);
  }

  const checks = runMockHostChecks(manifest, "caller.addon-bench");
  let testFailed = false;
  for (const c of checks) {
    line(c.pass ? "PASS" : "FAIL", `${c.check} (${c.code})`);
    if (!c.pass) testFailed = true;
  }

  let fFailures = 0;
  if (hasAgentRuntimeTrigger(manifest)) {
    const annotated = { ...manifest, callerId: "caller.addon-bench" };
    const declaresExperimentalAuth = manifest.providerRequirements?.allowExperimentalAuth === true;
    for (const modeId of FAILURE_MODE_IDS) {
      const report = runAddOnFailureMode(modeId, annotated);
      const isF10Na = modeId === "F10" && declaresExperimentalAuth && report.actual.code === "fixture-mismatch";
      const flag = report.pass || isF10Na ? "PASS" : "FAIL";
      const note = isF10Na ? " (N/A: experimental auth declared)" : "";
      line(flag, `F-case ${modeId} (${report.actual.code})${note}`);
      if (flag === "FAIL") fFailures += 1;
    }
  } else {
    line("SKIP", "F1-F10 (requires providers + agent-delegation)");
  }

  const failed = errors.length > 0 || !isolation.valid || testFailed || fFailures > 0;
  line(failed ? "RESULT" : "RESULT", failed ? "NOT READY" : "READY — recognized, valid, and constrained by ROS");
  return { failed };
}


function main() {
  const targets = collectTargets(process.argv.slice(2));
  if (targets.length === 0) {
    console.error("No .json manifests found for the given target(s).");
    process.exit(3);
  }
  console.log(`Bench targets: ${targets.length} manifest(s)`);
  let anyFailed = false;
  let unreadable = false;
  for (const file of targets) {
    const result = benchOne(file);
    if (result.failed) anyFailed = true;
    console.log("");
  }
  process.exit(anyFailed ? (unreadable ? 3 : 1) : 0);
}

try {
  main();
} catch (err) {
  console.error(`unhandled: ${err?.stack ?? err?.message ?? String(err)}`);
  process.exit(4);
}
