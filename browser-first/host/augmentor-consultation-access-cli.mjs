#!/usr/bin/env node
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { grantConsultationAccess, listConsultationClients, readConsultationAccessRegistry, revokeConsultationAccess } from "./augmentor-consultation-access.mjs";
import { loadConsultationProjectionBundle } from "./augmentor-consultation-contract.mjs";
import { consultationRoots } from "./augmentor-consultation-host-service.mjs";

const args = process.argv.slice(2);
const command = args.shift();
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? null : args[index + 1];
};
const base = path.resolve(process.env.RESONANTOS_BROWSER_FIRST_USER_ROOT || path.join(os.homedir(), "ResonantOS_User"));
const roots = consultationRoots(base);

if (command === "grant") {
  const clientId = args[0];
  const allowedViews = String(option("views") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const ttl = option("ttl-days");
  const result = await grantConsultationAccess({ root: roots.accessRoot, clientId, allowedViews, ttlDays: ttl === null ? null : Number(ttl) });
  process.stdout.write(`${JSON.stringify({ ...result, note: "Save accessKey now; it cannot be recovered." }, null, 2)}\n`);
} else if (command === "revoke") {
  process.stdout.write(`${JSON.stringify(await revokeConsultationAccess({ root: roots.accessRoot, clientId: args[0] }), null, 2)}\n`);
} else if (command === "list") {
  process.stdout.write(`${JSON.stringify(listConsultationClients(await readConsultationAccessRegistry(roots.accessRoot)), null, 2)}\n`);
} else if (command === "install-projection") {
  const sourceRoot = path.resolve(args[0] ?? "");
  await loadConsultationProjectionBundle({ root: sourceRoot });
  const parent = path.dirname(roots.projectionRoot);
  const stage = path.join(parent, `Projection.stage-${process.pid}-${Date.now()}`);
  const backup = path.join(parent, `Projection.backup-${process.pid}-${Date.now()}`);
  const files = [
    "projection.json",
    "glossary.json",
    "projection-manifest.json",
    "schemas/projection.schema.json",
    "schemas/projection-manifest.schema.json",
    "schemas/glossary.schema.json",
    "schemas/explanation-support.schema.json",
  ];
  await mkdir(path.join(stage, "schemas"), { recursive: true, mode: 0o700 });
  for (const name of files) {
    await copyFile(path.join(sourceRoot, name), path.join(stage, name));
  }
  await loadConsultationProjectionBundle({ root: stage });
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let hadExisting = false;
  try {
    await rename(roots.projectionRoot, backup);
    hadExisting = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await rename(stage, roots.projectionRoot);
    if (hadExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadExisting) await rename(backup, roots.projectionRoot);
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  await loadConsultationProjectionBundle({ root: roots.projectionRoot });
  process.stdout.write(`${JSON.stringify({ installed: true, projectionRoot: roots.projectionRoot }, null, 2)}\n`);
} else {
  process.stderr.write("Usage: augmentor-consultation-access <grant CLIENT --views a,b [--ttl-days N] | revoke CLIENT | list | install-projection DIR>\n");
  process.exitCode = 2;
}
