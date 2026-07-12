import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

import {
  assertNoManagedLabelConflicts,
  assertProjectConfiguration,
} from "./project-sync-policy.mjs";
import * as projectSyncPolicy from "./project-sync-policy.mjs";

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

test("workflow serializes all Project sync trigger classes without canceling active writes", async () => {
  const source = await readFile(
    new URL("../.github/workflows/project-issue-sync.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source);

  assert.deepEqual(workflow.concurrency, {
    group: "project-issue-sync",
    "cancel-in-progress": false,
  });
});

test("failed writes compensate the uncertain write and roll back prior writes", async () => {
  assert.equal(
    typeof projectSyncPolicy.runCompensatingWrites,
    "function",
    "project sync policy must expose compensating write execution",
  );

  const state = {
    releaseScope: "",
    labels: new Set(["scope:community-test"]),
  };
  const actions = [];
  const writeFailure = new Error("add label response failed");

  await assert.rejects(
    () => projectSyncPolicy.runCompensatingWrites([
      {
        apply: async () => {
          actions.push("set field");
          state.releaseScope = "Alpha MVP";
        },
        compensate: async () => {
          actions.push("clear field");
          state.releaseScope = "";
        },
      },
      {
        apply: async () => {
          actions.push("remove old label");
          state.labels.delete("scope:community-test");
        },
        compensate: async () => {
          actions.push("restore old label");
          state.labels.add("scope:community-test");
        },
      },
      {
        apply: async () => {
          actions.push("add new label");
          state.labels.add("scope:alpha-mvp");
          throw writeFailure;
        },
        compensate: async () => {
          actions.push("remove new label");
          state.labels.delete("scope:alpha-mvp");
        },
      },
    ]),
    (error) => error === writeFailure,
  );

  assert.equal(state.releaseScope, "");
  assert.deepEqual([...state.labels], ["scope:community-test"]);
  assert.deepEqual(actions, [
    "set field",
    "remove old label",
    "add new label",
    "remove new label",
    "restore old label",
    "clear field",
  ]);
});

test("rejects missing Project options before synchronization writes", () => {
  const fields = {
    releaseScope: { name: "Release Scope", options: [{ name: "Alpha MVP" }] },
    area: { name: "Area", options: [{ name: "Bridge" }] },
    status: { name: "Status", options: [{ name: "Backlog" }] },
  };

  assert.throws(
    () => assertProjectConfiguration(fields, {
      releaseScopes: ["Alpha MVP", "Community Test"],
      areas: ["Bridge", "Extension"],
      statuses: ["Inbox"],
    }),
    /Release Scope.*Community Test.*Area.*Extension.*Status.*Inbox/is,
  );
});

test("accepts complete Project option configuration", () => {
  const fields = {
    releaseScope: { name: "Release Scope", options: [{ name: "Alpha MVP" }, { name: "Community Test" }] },
    area: { name: "Area", options: [{ name: "Bridge" }, { name: "Extension" }] },
    status: { name: "Status", options: [{ name: "Inbox" }] },
  };

  assert.doesNotThrow(() => assertProjectConfiguration(fields, {
    releaseScopes: ["Alpha MVP", "Community Test"],
    areas: ["Bridge", "Extension"],
    statuses: ["Inbox"],
  }));
});
