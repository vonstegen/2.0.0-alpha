import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { auditBrowserFirstDesktopReport } from "../../scripts/audit-browser-first-desktop-report.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function readyReport() {
  return {
    status: "ready",
    reportPath: "/tmp/report.json",
    generatedAt: "2026-05-31T00:00:00.000Z",
    steps: [
      {
        id: "installed-app",
        status: "passed",
        parsed: {
          status: "ready",
          appkitMenu: "installed",
          postCefMenuInstalled: true,
          cefInitialized: true,
          nativeHostStarted: true,
          mainWorkspaceLoaded: true,
          phantomLoaded: true,
          bridge: { status: "started" },
          pinnedExtensions: { resonantOS: true, phantom: true },
          missingMenus: [],
        },
      },
      {
        id: "native-live",
        status: "passed",
        parsed: {
          status: "ready",
          verified: [
            "native CEF page load",
            "embedded NSView CEF bridge",
            "same-session click/type/scroll",
            "extension entrypoints",
            "downloads",
            "permission denial",
            "context menus",
            "standard browser menu commands",
            "local Manifest V3 extension execution",
            "Phantom provider injection",
          ],
        },
      },
    ],
  };
}

test("desktop report audit accepts a complete Chromium readiness report", () => {
  const audit = auditBrowserFirstDesktopReport(readyReport());

  assert.equal(audit.status, "ready");
  assert.deepEqual(audit.issues, []);
});

test("desktop report audit rejects missing native live proof", () => {
  const report = readyReport();
  report.steps[1].parsed.verified = report.steps[1].parsed.verified.filter((item) => item !== "Phantom provider injection");
  const audit = auditBrowserFirstDesktopReport(report);

  assert.equal(audit.status, "attention");
  assert.ok(audit.issues.some((issue) => /Phantom provider injection/.test(issue)));
});

test("desktop report audit command returns nonzero for current sandbox report", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-audit-"));
  try {
    const reportPath = path.join(tmp, "report.json");
    await writeFile(reportPath, JSON.stringify({ status: "attention", steps: [] }));

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "audit-browser-first-desktop-report.mjs"),
        `--report=${reportPath}`,
      ], { cwd: repoRoot }),
      (error) => {
        const output = JSON.parse(error.stdout);
        assert.equal(output.status, "attention");
        assert.ok(output.issues.length > 0);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
