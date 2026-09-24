import assert from "node:assert/strict";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const toPortablePath = (value) => String(value ?? "").replace(/\\/g, "/");

// The in-process self-test does NOT actually exercise workspace
// add-ons, but the bridge still launches them at startup because
// their manifests declare runtime ports. If a port is held by an
// external process (a dev bridge, a previous test run, etc.) the
// add-on fails to bind and the bridge process exits non-zero, which
// fails this test even though the in-process self-test logic is
// correct. Probe the ports the bundled workspace add-ons declare and
// skip when any are unavailable, mirroring how live-sdk-lane skips
// when the opencode binary is absent.
async function isPortFree(port) {
  return await new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function detectOccupiedWorkspaceAddonPorts() {
  const addonRoot = path.join(process.cwd(), "browser-first", "addons");
  const occupied = [];
  for (const dir of ["resonant-echo", "resonant-counter", "sdk-guide"]) {
    try {
      const manifest = JSON.parse(await readFile(path.join(addonRoot, dir, "addon.json"), "utf8"));
      const port = manifest?.contributions?.workspace?.runtime?.port;
      if (!Number.isInteger(port) || port <= 0) continue;
      if (!(await isPortFree(port))) occupied.push({ addon: manifest.id, port });
    } catch {
      // Manifest missing or unreadable — not our concern here; the bridge
      // launcher will report it. Skip the probe.
    }
  }
  return occupied;
}

test("source-file intake bridge routes pass in-process deterministic smoke test", async (t) => {
  const occupied = await detectOccupiedWorkspaceAddonPorts();
  if (occupied.length > 0) {
    const list = occupied.map((entry) => `${entry.addon}@${entry.port}`).join(", ");
    t.skip(`workspace addon port(s) already in use on this runner: ${list}. ` +
      "The in-process self-test does not depend on these upstreams, but the bridge launches them at startup. " +
      "Stop the holder (e.g. another `npm run browser-first:bridge` instance) and re-run.");
    return;
  }
  const { stdout } = await execFileAsync(process.execPath, [
    "browser-first/host/run-browser-first.mjs",
    "--memory-source-file-intake-inprocess-self-test=true",
  ], {
    cwd: process.cwd(),
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "in-process");
  assert.equal(result.unauthorizedCapabilityStatus, 403);
  assert.equal(result.createdCount, 200);
  assert.equal(result.snapshotRecorded, true);
  assert.equal(result.duplicateRejected, true);
  assert.equal(result.escapeRejected, true);
  assert.equal(result.overflowRejected, 5);
  assert.equal(result.failureStatus, 500);
  assert.equal(result.rollbackReservedVersions, 0);
  assert.equal(result.syncFirstStatus, "unchanged");
  assert.equal(result.syncChangedStatus, "changed");
  assert.equal(result.syncNewStatus, "new");
  assert.equal(result.syncChangedVersion, 2);
  assert.equal(result.syncNewVersion, 1);
  assert.equal(result.syncUnchangedStatus, 500);
  assert.equal(result.autoSyncStatus, 200);
  assert.equal(result.autoSyncCreatedArtifacts, 1);
  assert.equal(result.autoSyncReviewRequests, 1);
  assert.equal(result.manualSyncCreatedArtifacts, 0);
  assert.equal(result.manualSyncEligibleFiles, 1);
  assert.equal(result.pausedSyncStatus, "paused");
  assert.equal(result.pausedSyncReviewedSources, 0);
  assert.ok(result.syncHistoryCount >= 3);
  assert.equal(result.syncHistoryLatestStatus, "paused");
  assert.equal(result.syncHistoryPreviousStatus, "review-only");
  assert.equal(result.syncHistoryRedactsSourcePaths, true);
  assert.equal(result.syncHistoryBounded, true);
  assert.ok(result.boundedSyncHistoryCount <= 50);
  assert.equal(result.syncHistoryEligibleFileSample, "manual.md");
  assert.match(toPortablePath(result.syncHistoryCreatedArtifactSample), /^INTAKE\/sources\//);
  assert.match(toPortablePath(result.syncHistorySourcePathSample), /^\[path\]\//);
  assert.equal(result.corruptReviewStatus, 200);
  assert.equal(result.corruptCandidateStatus, "version-manifest-unavailable");
  assert.equal(result.unauthorizedRepairStatus, 403);
  assert.equal(result.missingConfirmationRepairStatus, 500);
  assert.equal(result.repairStatus, 200);
  assert.equal(result.repairPayloadStatus, "repaired");
  assert.match(toPortablePath(result.repairBackupPath), /^CONFIG\/source-file-history\/repairs\//);
  assert.ok(result.repairHistoryCount >= 1);
  assert.equal(result.repairHistoryLatestStatus, "repaired");
  assert.match(toPortablePath(result.repairHistorySourcePathSample), /^\[path\]\//);
  assert.match(toPortablePath(result.repairHistoryBackupPath), /^CONFIG\/source-file-history\/repairs\//);
  assert.equal(result.repairHistoryRedactsSourcePaths, true);
  assert.equal(result.repairedCandidateStatus, "new");
  assert.equal(result.sourceIdCollisionAvoided, true);
});
