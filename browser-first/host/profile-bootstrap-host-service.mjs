// ResonantOS bridge: profile bootstrap service.
//
// Reads the workbench's portable profile snapshot from
//   ~/ResonantOS_User/Documents/workbench/profile.json
// and reshapes it into the keys the side-panel extension
// expects (augmentorUserProfile + augmentorConfig).
//
// This is the read-side of the personal-repo → side-panel
// sync. The side-panel service worker calls this on every
// boot and writes the result into chrome.storage.local.
//
// Route:
//   GET /profile/bootstrap
//
// No capability token is required because the response only
// contains the workbench's *own* profile values. The
// side-panel is the only consumer in this workbench.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const VAULT_DOCUMENTS_DIRNAME = "Documents";
const VAULT_WORKBENCH_DIRNAME = "workbench";
const PROFILE_FILENAME = "profile.json";

function profileFilePath(userRoot) {
  return path.join(userRoot(), VAULT_DOCUMENTS_DIRNAME, VAULT_WORKBENCH_DIRNAME, PROFILE_FILENAME);
}

function buildUserProfile(raw) {
  const profile = raw.profile || {};
  return {
    displayName: profile.displayName || raw.owner || "andrewjochl",
    subtitle: profile.subtitle || "",
    email: profile.email || ""
  };
}

function buildAugmentorConfig(raw) {
  const augmentor = raw.augmentor || {};
  return {
    displayName: augmentor.displayName || "Augmentor",
    systemPrompt: augmentor.systemPrompt || ""
  };
}

async function readProfileDocument(userRoot) {
  const filePath = profileFilePath(userRoot);
  if (!existsSync(filePath)) {
    return {
      ok: false,
      source: "missing",
      path: filePath,
      reason: "no workbench profile snapshot at the portable-state root"
    };
  }
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      source: "unreadable",
      path: filePath,
      reason: `read failed: ${error?.message || String(error)}`
    };
  }
  let parsed;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return {
      ok: false,
      source: "invalid-json",
      path: filePath,
      reason: `parse failed: ${error?.message || String(error)}`
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      source: "invalid-shape",
      path: filePath,
      reason: "profile.json must be a JSON object"
    };
  }

  return {
    ok: true,
    source: "stored",
    path: filePath,
    schemaVersion: parsed.schemaVersion || "unknown",
    updatedAt: parsed.updatedAt || null,
    augmentorUserProfile: buildUserProfile(parsed),
    augmentorConfig: buildAugmentorConfig(parsed),
    aliases: parsed.aliases || null,
    provider: parsed.provider || null,
    git: parsed.git || null,
    notes: parsed.notes || []
  };
}

export function createProfileBootstrapHostService({ userRoot } = {}) {
  if (typeof userRoot !== "function") {
    throw new Error("createProfileBootstrapHostService requires a userRoot() resolver");
  }

  async function executeReadProfileBootstrap() {
    return readProfileDocument(userRoot);
  }

  return {
    executeReadProfileBootstrap,
    profileBootstrapRoutes: [
      { method: "GET", path: "/profile/bootstrap", handler: executeReadProfileBootstrap }
    ]
  };
}