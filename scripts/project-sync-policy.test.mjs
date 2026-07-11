import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertNoManagedLabelConflicts } from "./project-sync-policy.mjs";

const scopeLabels = new Set(["scope:alpha-mvp", "scope:community-test"]);
const areaLabels = new Set(["area:bridge", "area:docs"]);

test("rejects ambiguous managed labels when the corresponding Project field is empty", () => {
  assert.throws(
    () => assertNoManagedLabelConflicts([
      {
        url: "https://github.com/ResonantOS/2.0.0-alpha/issues/210",
        labels: ["scope:alpha-mvp", "scope:community-test", "area:bridge", "area:docs"],
        releaseScope: "",
        area: "",
      },
    ], { scopeLabels, areaLabels }),
    /#210.*multiple managed scope labels.*multiple managed area labels/i,
  );
});

test("allows multiple managed labels when populated Project fields remain authoritative", () => {
  assert.doesNotThrow(() => assertNoManagedLabelConflicts([
    {
      url: "https://github.com/ResonantOS/2.0.0-alpha/issues/211",
      labels: ["scope:alpha-mvp", "scope:community-test", "area:bridge", "area:docs"],
      releaseScope: "Alpha MVP",
      area: "Bridge",
    },
  ], { scopeLabels, areaLabels }));
});

test("sync script completes global conflict preflight before its first write loop", async () => {
  const source = await readFile(new URL("./sync-project-issue-labels.mjs", import.meta.url), "utf8");
  const preflight = source.indexOf("assertNoManagedLabelConflicts(syncCandidates");
  const firstWriteLoop = source.indexOf("for (const item of openItems)");

  assert(preflight >= 0, "sync script must invoke the global conflict preflight");
  assert(firstWriteLoop >= 0, "sync script must retain the open-item synchronization loop");
  assert(preflight < firstWriteLoop, "conflict preflight must run before any synchronization writes");
});
