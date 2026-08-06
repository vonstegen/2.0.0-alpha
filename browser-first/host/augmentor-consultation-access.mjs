import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_CONSULTATION_LIMITS,
  digestJson,
  effectiveConsultationLimits,
  sha256,
} from "./augmentor-consultation-contract.mjs";

export const CONSULTATION_ACCESS_REGISTRY_VERSION = "resonantos.augmentor-consultation.access-registry@1.0.0";
const CLIENT_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const KEY_HASH = /^[a-f0-9]{64}$/;
const VIEW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function registryPath(root) {
  return path.join(root, "access-clients.json");
}

function emptyRegistry() {
  return { schemaVersion: CONSULTATION_ACCESS_REGISTRY_VERSION, revision: 0, clients: [] };
}

function validateClient(client) {
  const keys = Object.keys(client ?? {}).sort();
  const expected = ["allowedViews", "clientId", "createdAt", "expiresAt", "keyHash", "limits", "revokedAt", "status"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error("Invalid consultation client record shape.");
  if (!CLIENT_ID.test(client.clientId)) throw new Error("Invalid consultation client id.");
  if (!KEY_HASH.test(client.keyHash)) throw new Error("Invalid consultation client key hash.");
  if (!Array.isArray(client.allowedViews) || client.allowedViews.length < 1 ||
      client.allowedViews.length > 8 || new Set(client.allowedViews).size !== client.allowedViews.length ||
      !client.allowedViews.every((view) => VIEW_ID.test(view))) {
    throw new Error("Invalid consultation client views.");
  }
  effectiveConsultationLimits(DEFAULT_CONSULTATION_LIMITS, client.limits);
  if (!Number.isFinite(Date.parse(client.createdAt))) throw new Error("Invalid consultation client createdAt.");
  if (client.expiresAt !== null && !Number.isFinite(Date.parse(client.expiresAt))) throw new Error("Invalid consultation client expiresAt.");
  if (client.revokedAt !== null && !Number.isFinite(Date.parse(client.revokedAt))) throw new Error("Invalid consultation client revokedAt.");
  if (!new Set(["active", "revoked"]).has(client.status)) throw new Error("Invalid consultation client status.");
}

function validateRegistry(registry) {
  const keys = Object.keys(registry ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["clients", "revision", "schemaVersion"].sort())) {
    throw new Error("Invalid consultation access registry shape.");
  }
  if (registry.schemaVersion !== CONSULTATION_ACCESS_REGISTRY_VERSION) throw new Error("Unsupported consultation access registry.");
  if (!Number.isInteger(registry.revision) || registry.revision < 0) throw new Error("Invalid consultation access registry revision.");
  if (!Array.isArray(registry.clients)) throw new Error("Invalid consultation access registry clients.");
  registry.clients.forEach(validateClient);
  if (new Set(registry.clients.map((client) => client.clientId)).size !== registry.clients.length) {
    throw new Error("Duplicate consultation client id.");
  }
  return registry;
}

export async function readConsultationAccessRegistry(root) {
  try {
    return validateRegistry(JSON.parse(await readFile(registryPath(root), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyRegistry();
    throw error;
  }
}

async function writeRegistry(root, registry) {
  validateRegistry(registry);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = registryPath(root);
  const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
  return destination;
}

export async function grantConsultationAccess({
  root,
  clientId,
  allowedViews,
  limits = DEFAULT_CONSULTATION_LIMITS,
  ttlDays = null,
  now = new Date(),
  random = randomBytes,
} = {}) {
  if (!CLIENT_ID.test(clientId ?? "")) throw new Error("Client id must use lowercase letters, numbers, dot, dash, or underscore.");
  if (!Array.isArray(allowedViews) || allowedViews.length < 1) throw new Error("At least one allowed view is required.");
  const issuedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(issuedAt.getTime())) throw new Error("Invalid grant time.");
  if (ttlDays !== null && (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3650)) throw new Error("ttlDays must be 1-3650.");
  const accessKey = `rac_${random(32).toString("base64url")}`;
  const registry = await readConsultationAccessRegistry(root);
  const client = {
    clientId,
    keyHash: sha256(accessKey),
    allowedViews: [...new Set(allowedViews)].sort(),
    limits: effectiveConsultationLimits(DEFAULT_CONSULTATION_LIMITS, limits),
    status: "active",
    createdAt: issuedAt.toISOString(),
    expiresAt: ttlDays === null ? null : new Date(issuedAt.getTime() + ttlDays * 86400000).toISOString(),
    revokedAt: null,
  };
  validateClient(client);
  const next = {
    ...registry,
    revision: registry.revision + 1,
    clients: [...registry.clients.filter((entry) => entry.clientId !== clientId), client]
      .sort((left, right) => left.clientId.localeCompare(right.clientId)),
  };
  const destination = await writeRegistry(root, next);
  const { keyHash: _keyHash, ...publicClient } = client;
  return { accessKey, client: publicClient, registryPath: destination, revision: next.revision };
}

export async function revokeConsultationAccess({ root, clientId, now = new Date() } = {}) {
  const registry = await readConsultationAccessRegistry(root);
  const index = registry.clients.findIndex((client) => client.clientId === clientId);
  if (index < 0) return { changed: false, revision: registry.revision, registryPath: registryPath(root) };
  const clients = registry.clients.map((client, current) => current === index ? {
    ...client,
    status: "revoked",
    revokedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  } : client);
  const next = { ...registry, revision: registry.revision + 1, clients };
  const destination = await writeRegistry(root, next);
  return { changed: true, revision: next.revision, registryPath: destination };
}

function hashesEqual(left, right) {
  if (!KEY_HASH.test(left ?? "") || !KEY_HASH.test(right ?? "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function authenticateConsultationAccess({ root, accessKey, now = Date.now() } = {}) {
  if (typeof accessKey !== "string" || accessKey.length < 20 || accessKey.length > 256) return null;
  const registry = await readConsultationAccessRegistry(root);
  const presentedHash = sha256(accessKey);
  let matched = null;
  for (const client of registry.clients) {
    if (hashesEqual(client.keyHash, presentedHash)) matched = client;
  }
  if (!matched || matched.status !== "active") return null;
  if (matched.expiresAt !== null && now >= Date.parse(matched.expiresAt)) return null;
  const opaquePrincipalRef = `client-${sha256(matched.clientId).slice(0, 12)}`;
  const policyDigest = digestJson({
    revision: registry.revision,
    clientId: matched.clientId,
    allowedViews: matched.allowedViews,
    limits: matched.limits,
    status: matched.status,
    expiresAt: matched.expiresAt,
  });
  return {
    opaquePrincipalRef,
    policyDigest,
    allowedViews: [...matched.allowedViews],
    limits: { ...matched.limits },
    registryRevision: registry.revision,
  };
}

export function listConsultationClients(registry) {
  return validateRegistry(registry).clients.map(({ keyHash: _keyHash, ...client }) => client);
}
