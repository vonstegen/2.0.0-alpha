// Side-panel: profile bootstrap.
//
// Pulls the workbench's portable profile snapshot from the
// bridge's /profile/bootstrap route and writes the result
// into chrome.storage.local under the keys the Personalization
// section reads:
//   - augmentorUserProfile (displayName, subtitle, email)
//   - augmentorConfig      (displayName, systemPrompt)
//
// Source of truth:
//   ~/ResonantOS_User/Documents/workbench/profile.json
// (mirrored from ~/Developer/Personal/resonant-os-workbench/profile.json).
//
// This module is intentionally idempotent and safe to call on
// every service-worker boot. If the bridge says "missing" or
// the network is down, it silently does nothing — the existing
// chrome.storage.local values stay put.

import { createBridgeClient } from "./bridge-client.js";

const PROFILE_USER_KEY = "augmentorUserProfile";
const PROFILE_CONFIG_KEY = "augmentorConfig";

function logBootstrapResult(outcome, details = {}) {
  const summary = JSON.stringify({ event: "profile.bootstrap", outcome, ...details });
  if (typeof console !== "undefined") {
    console.info(summary);
  }
}

export async function bootstrapProfileFromBridge({ bridgeClient, storage = chrome?.storage?.local } = {}) {
  const bridge = typeof bridgeClient === "function"
    ? bridgeClient
    : createBridgeClient();

  if (!storage || typeof storage.set !== "function") {
    logBootstrapResult("skipped", { reason: "no chrome.storage.local surface" });
    return { ok: false, reason: "no-storage" };
  }

  let payload;
  try {
    payload = await bridge("/profile/bootstrap", { method: "GET" });
  } catch (error) {
    logBootstrapResult("skipped", { reason: "bridge-unreachable", error: error?.message || String(error) });
    return { ok: false, reason: "bridge-unreachable" };
  }

  if (!payload || payload.ok !== true) {
    logBootstrapResult("skipped", {
      reason: payload?.reason || "bridge-reported-missing",
      source: payload?.source || null
    });
    return { ok: false, reason: payload?.source || "missing" };
  }

  const writes = {};
  if (payload.augmentorUserProfile) writes[PROFILE_USER_KEY] = payload.augmentorUserProfile;
  if (payload.augmentorConfig) writes[PROFILE_CONFIG_KEY] = payload.augmentorConfig;
  writes.profileBootstrapMeta = {
    source: payload.source || "stored",
    schemaVersion: payload.schemaVersion || null,
    updatedAt: payload.updatedAt || null,
    path: payload.path || null,
    syncedAt: new Date().toISOString()
  };

  try {
    await new Promise((resolve, reject) => {
      storage.set(writes, () => {
        const lastError = chrome?.runtime?.lastError;
        if (lastError) reject(new Error(lastError.message));
        else resolve();
      });
    });
  } catch (error) {
    logBootstrapResult("failed", { reason: error?.message || String(error) });
    return { ok: false, reason: "storage-write-failed" };
  }

  logBootstrapResult("ok", {
    schemaVersion: payload.schemaVersion || null,
    path: payload.path || null,
    displayName: payload.augmentorUserProfile?.displayName || null
  });

  return { ok: true, writes: Object.keys(writes) };
}