#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md
//
// One-command proof gate for browser-first Chromium readiness. It runs the
// desktop verifier, then audits the generated report so completion requires
// both runtime evidence and a strict readiness verdict.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runStep(id, args) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync("npm", ["run", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RESONANTOS_DESKTOP_PROOF: "1",
    },
  });
  return {
    id,
    command: ["npm", "run", ...args].join(" "),
    startedAt,
    elapsedMs: Date.now() - startedMs,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const verify = runStep("verify-desktop", ["browser-first:verify-desktop"]);
const audit = runStep("audit-desktop", ["browser-first:audit-desktop"]);
const steps = [verify, audit];
const failedSteps = steps.filter((step) => step.status !== "passed").map((step) => step.id);
const status = failedSteps.length ? "attention" : "ready";

const output = {
  status,
  failedSteps,
  passedSteps: steps.filter((step) => step.status === "passed").map((step) => step.id),
  reportPath: path.join(repoRoot, "logs", "browser-first-desktop-verification.json"),
  steps,
  nextAction: status === "ready"
    ? "Chromium desktop proof passed. The active goal can be completion-audited."
    : "Inspect the failed step output and logs/browser-first-desktop-verification.json, fix the blocker, then rerun npm run browser-first:prove-desktop from normal Terminal.",
};

console.log(JSON.stringify({
  status: output.status,
  failedSteps: output.failedSteps,
  passedSteps: output.passedSteps,
  reportPath: output.reportPath,
  nextAction: output.nextAction,
}, null, 2));

process.exit(status === "ready" ? 0 : 2);
