// Promote the dev-channel workbench to the frozen stable channel.
//
//   node scripts/release-extension.mjs
//
// Copies browser-first/resonantos-side-panel-extension (dev) over
// browser-first/release/resonantos-side-panel-extension (stable) and stamps
// release-info.json with the source commit and timestamp. The stable channel
// is version controlled: review the diff and COMMIT it for the release to
// exist in git. Until this script runs, the stable workbench never changes —
// UI repainting on the dev channel cannot leak into SDK testing.

import { execSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const repoRoot = path.resolve(import.meta.dirname, "..");
const devDir = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");
const releaseDir = path.join(repoRoot, "browser-first", "release", "resonantos-side-panel-extension");

let head;
try {
  head = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: repoRoot }).trim();
} catch {
  console.error("Not a git repository — refusing to release without a version-controlled source point.");
  process.exit(1);
}

const releaseInfo = {
  channel: "stable",
  frozenFrom: head,
  frozenAt: new Date().toISOString(),
  manifestVersion: JSON.parse(
    await readFile(path.join(devDir, "manifest.json"), "utf8"),
  ).version,
};

await mkdir(path.dirname(releaseDir), { recursive: true });
await rm(releaseDir, { recursive: true, force: true });
await cp(devDir, releaseDir, { recursive: true });
await writeFile(path.join(releaseDir, "release-info.json"), JSON.stringify(releaseInfo, null, 2) + "\n");

console.log(`Released ${releaseInfo.manifestVersion} from ${head} → browser-first/release/resonantos-side-panel-extension`);
console.log("");
console.log("Next: review `git status browser-first/release` and `git diff`, then commit the snapshot.");
console.log("      The stable channel is only version controlled once that commit exists.");
console.log("      Relaunch `npm run cft:stable` to load the new snapshot.");
