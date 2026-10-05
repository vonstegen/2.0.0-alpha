// ResonantOS terminal-host bridge service (Phase 1.5 Step B / TH-7c).
//
// Composition for the bridge-side owner of a replaceable terminal host
// adapter. Subscribes to the active adapter's stdio JSON-RPC peer
// (`service.protocol: "stdio-json-rpc"`) and republishes `terminal.event`
// notifications onto the broker event bus the harness boundary already
// uses (`browser-first/host/harness-boundary.mjs:68, :138, :160, :164,
// :176`). The bus validator (`harness-adapter-contract.mjs:37`) was
// extended in Step 0 (e352b6e2) to accept the five `terminal.*` event
// types.
//
// This file is the **bridge route owner**, not the adapter itself. In
// `iterm2` and `ghostty` driver modes the bridge spawns the adapter as
// an opt-in, fixed-root stdio JSON-RPC peer (gated by
// `RESONANT_TERMINAL_HOST_BRIDGE=1` in terminal-host-bridge-wiring.mjs).
// The spawn is NOT ambient-PATH and NOT manifest-controlled: the
// entrypoint and cwd are chosen by `SPAWN_PLANS` keyed on the driver
// id, each fixed to the adapter's own directory. In `in-memory` mode
// no process is spawned.
//
// Spec: prompts/OMP-BUILD-iTerm2-SDK-Addon-Connection.md v8 §3 (Phases
// 1/1.5/2/TH-7a) and the TH-7 (Ghostty) phase prompt §3-§5.

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { createHarnessEventBus } from "./harness-event-bus.mjs";
import { validateHarnessEvent } from "./harness-adapter-contract.mjs";
import { TERMINAL_HOST_CONTRACT_VERSION } from "../../src/core/terminal-host-contract.ts";
import { buildSessionEnvironment } from "./harness-session-environment.mjs";
import { resolvePiNativeProvider } from "./pi-native-provider-map.mjs";
import { createHarnessResourceProjection } from "./harness-resource-projection.mjs";
import { createHarnessSkillsProjection } from "./harness-skills-projection.mjs";

const TERMINAL_HOST_ADDON_ID = "addon.resonant-terminal-iterm2";
const JSON_RPC_VERSION = "2.0";

// Adapter spawn env allowlist. ADR-039/040 require no `process.env`
// inheritance into the adapter; only PATH (runtime resolution) and HOME
// (iTerm2's Python API locates its socket under the user home) cross the
// boundary. RESONANT_TERMINAL_DRIVER is added explicitly at spawn time.
const ADAPTER_ENV_ALLOWLIST = ["PATH", "HOME"];

const SESSION_BOOTSTRAP_GRANT_TTL_MS = 60_000;

/**
 * Mint a SessionBootstrapGrant. The token is broker-grade: 32 random bytes
 * base64url-encoded, matching createBridgeToken() in bridge-server.mjs — not
 * the old tok-<uuid> placeholder. The grant is audience-bound to one session
 * and single-use (claim then discard); the ros-session attach consumer
 * validates + claims it against the broker, and the token rides the RPC
 * return value only, never argv/env. See ADR-040 "Authorization model" and
 * SessionBootstrapGrant in terminal-host-contract.ts.
 */
export function mintSessionBootstrapGrant({
  sessionId,
  purpose,
  now = () => new Date(),
  mintToken = () => randomBytes(32).toString("base64url"),
  ttlMs = SESSION_BOOTSTRAP_GRANT_TTL_MS,
} = {}) {
  const issuedAt = now();
  return {
    sessionId,
    token: mintToken(),
    purpose,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Session-bootstrap grant broker (CP-S2B).
//
// `mintSessionBootstrapGrant` above is a pure factory. The bridge records
// each minted grant in a module-scope Map so `consumeGrant` can validate the
// audience-bound, single-use claim and `attachSessionEnv` can return the
// authorized runtime environment for `ros-session attach <id>`.
//
// Hard rules:
//  - Single-use: consume marks `consumed = true`; replay is rejected.
//  - Audience-bound: token must equal the recorded token for `sessionId`.
//  - Expiration: claim past `expiresAt` is rejected.
//  - No secret in argv or logs: env values are returned by `attachSessionEnv`
//    to the consumer; the broker never logs `token` or env values.
//
// The tracking Map is module-scope so the bridge factory, the bootstrap
// caller, and the broker functions all share one source of truth. Tests
// can call `__resetSessionBootstrapGrantBroker()` to clear it between runs.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TrackedGrantRecord
 * @property {string} sessionId
 * @property {string} token
 * @property {"attach" | "adopt"} purpose
 * @property {string} issuedAt
 * @property {string} expiresAt
 * @property {boolean} consumed
 */

/** @type {Map<string, TrackedGrantRecord>} */
const GRANT_RECORDS = new Map();

/** @type {Readonly<Record<string, string>>} */
export const GRANT_PUBLIC_REJECTION_REASONS = Object.freeze({
  "unknown-session": "Unknown session.",
  "wrong-session": "Token does not match this session.",
  "expired": "Grant expired.",
  "already-consumed": "Grant already consumed.",
});

export function __resetSessionBootstrapGrantBroker() {
  GRANT_RECORDS.clear();
}

/**
 * @param {ReturnType<typeof mintSessionBootstrapGrant>} grant
 * @returns {ReturnType<typeof mintSessionBootstrapGrant>}
 */
export function trackSessionBootstrapGrant(grant) {
  const record = {
    sessionId: grant.sessionId,
    token: grant.token,
    purpose: grant.purpose,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    consumed: false,
  };
  GRANT_RECORDS.set(grant.sessionId, record);
  return grant;
}

/**
 * @returns {ReadonlyArray<TrackedGrantRecord>}
 */
export function listOutstandingGrants() {
  return [...GRANT_RECORDS.values()];
}

/**
 * @param {{ sessionId: string, token: string, now?: () => Date }} args
 * @returns {{ ok: true, grant: TrackedGrantRecord } | { ok: false, reason: keyof typeof GRANT_PUBLIC_REJECTION_REASONS }}
 */
export function consumeGrant({ sessionId, token, now = () => new Date() }) {
  const record = GRANT_RECORDS.get(sessionId);
  if (!record) return { ok: false, reason: "unknown-session" };
  if (record.consumed) return { ok: false, reason: "already-consumed" };
  if (record.token !== token) return { ok: false, reason: "wrong-session" };
  if (now().getTime() > new Date(record.expiresAt).getTime()) {
    return { ok: false, reason: "expired" };
  }
  record.consumed = true;
  return { ok: true, grant: record };
}

/**
 * @typedef {Object} AttachSessionEnvRequest
 * @property {string} sessionId
 * @property {string} token
 * @property {() => Date} [now]             Wall clock for expiration check; defaults to new Date().
 * @property {string} [harness]            addon id (informational; never a secret)
 * @property {{ root: string, cwd: string }} [project]
 * @property {string} [providerProfileId]  for credential resolution; null/empty fails closed
 * @property {Record<string,string>} [baseEnv]
 * @property {string[]} [envAllowlist]
 * @property {() => Record<string,string>} [parentEnv]
 * @property {(profileId: string) => { name: string, value: string } | null} [resolveCredential]
 *           Injectable; default returns null (no credential delivered)
 * @property {(args: { baseEnv: Record<string,string>, envAllowlist: string[], parentEnv: Record<string,string>, credentialName: string, credentialValue: string }) => Record<string,string>} [buildSessionEnv]
 *           Injectable; defaults to buildSessionEnvironment
 */

/**
 * @param {AttachSessionEnvRequest} args
 * @returns {{ ok: true, env: Record<string,string> } | { ok: false, reason: keyof typeof GRANT_PUBLIC_REJECTION_REASONS | "missing-credential" }}
 */
export function attachSessionEnv({
  sessionId,
  token,
  now = () => new Date(),
  harness,
  project,
  providerProfileId,
  baseEnv = {},
  envAllowlist = [],
  parentEnv,
  resolveCredential = () => null,
  buildSessionEnv,
}) {
  const claim = consumeGrant({ sessionId, token, now });
  if (!claim.ok) return { ok: false, reason: claim.reason };

  const parentEnvRecord = typeof parentEnv === "function" ? parentEnv() : (parentEnv ?? {});
  const builder = buildSessionEnv ?? buildSessionEnvironment;

  const credential = providerProfileId ? resolveCredential(providerProfileId) : null;
  // No provider profile, or credential resolution refused -> we still return
  // the env, but without any credential entry. The caller can detect
  // missing-credential via the absence of the credential name in env names.
  if (providerProfileId && !credential) {
    // Fail closed: a profile was named but no credential was resolvable.
    // Caller must NOT silently proceed; we surface the failure rather than
    // returning an env that pretends to be authorized.
    return { ok: false, reason: "missing-credential" };
  }
  const env = builder({
    baseEnv,
    envAllowlist,
    parentEnv: parentEnvRecord,
    credentialName: credential?.name ?? "",
    credentialValue: credential?.value ?? "",
  });
  // Harness + project roots are returned as opaque metadata for the
  // attaching shell; the env object itself is the only credential path.
  return { ok: true, env: { ...env, _meta: JSON.stringify({ sessionId, harness: harness ?? null, project: project ?? null, providerProfileId: providerProfileId ?? null }) } };
}

/**
 * Build a `resolveCredential(profileId)` suitable for passing into
 * `attachSessionEnv`. The host installs this so the terminal-host route
 * / browser-first callers never have to know the ROS profile-to-Pi map;
 * the seam lives here, in one place.
 *
 * Composition (PI-S3b, thin wrapper):
 *   1. `getProfile(profileId)` resolves the ROS ProviderProfile (host owns
 *      the profile store; never reaches the route handler).
 *   2. `resolvePiNativeProvider(profile)` maps the ROS identity to the
 *      Pi-native { piProvider, envVar }. An unknown ROS identity fails
 *      closed (returns null) — `shared-*` profiles have no non-persistent
 *      env-var key and never reach a real credential.
 *   3. `resolveSecret(profile)` returns the host-stored secret value, or
 *      null. The secret never traverses the route body; it is returned
 *      only inside the env under the env-var name.
 *
 * Returns null on any miss (fail closed). The route handler maps
 * `null` -> `{ ok: false, reason: 'missing-credential' }`.
 *
 * @param {object} options
 * @param {(profileId: string) => (object | null | undefined)} options.getProfile
 *        Host-owned profile lookup. Return the profile object or null/undefined.
 * @param {(profile: object) => (string | null | undefined)} options.resolveSecret
 *        Host-owned secret resolver. Return the secret value or null/undefined.
 * @returns {(profileId: string) => { name: string, value: string } | null}
 */
export function createTerminalHostCredentialResolver({ getProfile, resolveSecret } = {}) {
  if (typeof getProfile !== "function") throw new TypeError("createTerminalHostCredentialResolver: getProfile must be a function");
  if (typeof resolveSecret !== "function") throw new TypeError("createTerminalHostCredentialResolver: resolveSecret must be a function");
  return function resolveCredential(profileId) {
    if (typeof profileId !== "string" || !profileId) return null;
    const profile = getProfile(profileId);
    if (!profile || typeof profile !== "object") return null;
    const mapping = resolvePiNativeProvider(profile);
    if (!mapping || typeof mapping.envVar !== "string") return null;
    const value = resolveSecret(profile);
    if (typeof value !== "string" || !value) return null;
    return { name: mapping.envVar, value };
  };
}

/**
 * Canonical host-owned env names for the projected session environment.
 *
 *   ROS_PROJECT_ROOT  -- canonical realpath of the host-authorized project root
 *   ROS_PROJECT_CWD   -- canonical cwd (currently == ROS_PROJECT_ROOT)
 *   ROS_SKILLS_DIR    -- host-derived skills staging root (opaque digest path)
 *
 * These names pass SESSION_ENV_NAME_PATTERN (`/^[A-Z_][A-Z0-9_]*$/`) and are
 * never derived from a manifest or caller-supplied map. They are the ONLY
 * path-shaped entries the projected env may add beyond the credential under
 * the resolver-derived name.
 */
export const PROJECTED_SESSION_ENV_NAMES = Object.freeze({
  projectRoot: "ROS_PROJECT_ROOT",
  projectCwd: "ROS_PROJECT_CWD",
  skillsDir: "ROS_SKILLS_DIR",
});

/**
 * Build the FULL projected session environment: project root + skills dir +
 * credential + (optional) baseEnv/envAllowlist parentEnv.
 *
 * Composes:
 *   1. createHarnessResourceProjection -> ROS_PROJECT_ROOT, ROS_PROJECT_CWD
 *      (canonical realpath; fails closed on invalid-request / not-granted /
 *      invalid-project-root / etc.)
 *   2. createHarnessSkillsProjection -> ROS_SKILLS_DIR (host-derived opaque
 *      digest under stagingBase/skills/). Only materialized when the skills
 *      request is present + granted; absence is not an error (skills are
 *      optional for some sessions).
 *   3. credential -> under the host-owned env-var name from
 *      resolvePiNativeProvider (already done by resolveCredential factory).
 *   4. baseEnv + envAllowlist + parentEnv (existing semantics).
 *
 * Returns `{ ok: true, env, meta }` or `{ ok: false, reason, code }`. The
 * `reason` is the public rejection vocabulary; the `code` is the projection
 * adapter's diagnostic code for the host log. meta is non-secret (no token,
 * no credential value, no path-derived secret).
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {() => Date} [args.now]
 * @param {string} [args.harness]
 * @param {{ id: string, label: string, root: string }} [args.authorizedProject]
 * @param {{ requests: object }} [args.request]
 * @param {Array<{ capability: string, granted?: boolean }>} [args.grantedCapabilities]
 * @param {Array<object>} [args.skillCatalog]
 * @param {string} [args.skillSourceRoot]
 * @param {string} [args.stagingBase]
 * @param {string} [args.providerProfileId]
 * @param {(profileId: string) => { name: string, value: string } | null} [args.resolveCredential]
 * @param {Record<string,string>} [args.baseEnv]
 * @param {string[]} [args.envAllowlist]
 * @param {() => Record<string,string>} [args.parentEnv]
 * @param {(args: { baseEnv, envAllowlist, parentEnv, credentialName, credentialValue }) => Record<string,string>} [args.buildSessionEnv]
 * @param {object} [args.resourceHooks]  - realpath / statPath / homeDir injection for createHarnessResourceProjection
 * @returns {Promise<{ ok: true, env: Record<string,string>, meta: object }
 *                  | { ok: false, reason: string, code?: string, meta?: object }>}
 */
export async function buildProjectedSessionEnv(args) {
  const {
    sessionId,
    now = () => new Date(),
    harness,
    authorizedProject,
    request,
    grantedCapabilities = [],
    skillCatalog,
    skillSourceRoot,
    stagingBase,
    providerProfileId,
    resolveCredential = () => null,
    baseEnv = {},
    envAllowlist = [],
    parentEnv,
    buildSessionEnv = buildSessionEnvironment,
    resourceHooks,
  } = args ?? {};

  if (typeof sessionId !== "string" || !sessionId) {
    return { ok: false, reason: "missing-session-id" };
  }

  const meta = {
    sessionId,
    harness: harness ?? null,
    projectId: authorizedProject?.id ?? null,
    projectLabel: authorizedProject?.label ?? null,
    projectRoot: authorizedProject?.root ?? null,
    providerProfileId: providerProfileId ?? null,
    issuedAt: now().toISOString(),
  };

  // 1. Resource projection: yields ROS_PROJECT_ROOT + ROS_PROJECT_CWD.
  let resourceView = null;
  let resourceRejection = null;
  if (authorizedProject && request) {
    const projection = createHarnessResourceProjection({
      authorizedProject,
      ...(resourceHooks ?? {}),
    });
    const outcome = await projection.project({ addonId: TERMINAL_HOST_ADDON_ID, sessionId, request, grantedCapabilities });
    if (!outcome.ok) {
      resourceRejection = outcome.view?.state === "denied" ? outcome.code ?? "resource-denied" : "resource-denied";
    } else {
      resourceView = outcome.view;
    }
  }

  // 2. Skills projection: yields ROS_SKILLS_DIR (only if skills request present + granted).
  let skillsView = null;
  let skillsRejection = null;
  let skillsStagingRoot = null;
  if (authorizedProject && request && Array.isArray(skillCatalog) && skillSourceRoot && stagingBase) {
    const projection = createHarnessSkillsProjection({
      authorizedProject: { id: authorizedProject.id, label: authorizedProject.label },
      skillCatalog,
      skillSourceRoot,
      stagingBase,
    });
    const outcome = projection.project({ addonId: TERMINAL_HOST_ADDON_ID, sessionId, request, grantedCapabilities });
    if (outcome.ok) {
      skillsView = outcome.view;
      // Derive the SAME opaque owned staging root from THIS projection binding.
      // We replicate the projection's identity derivation so the env name
      // matches what consume() would later validate. The path is host-derived
      // (never caller-supplied).
      const stagingIdentity = (await import("./harness-skills-projection.mjs")).deriveStagingIdentity(
        TERMINAL_HOST_ADDON_ID,
        sessionId,
        authorizedProject.id,
      );
      skillsStagingRoot = `${stagingBase.replace(/\/$/, "")}/skills/${stagingIdentity}`;
    } else {
      skillsRejection = outcome.code ?? "skills-denied";
    }
  }

  // 3. Credential resolution (fail closed: null when providerProfileId named but credential not resolvable).
  let credential = null;
  if (providerProfileId) {
    credential = resolveCredential(providerProfileId);
    if (!credential || typeof credential.name !== "string" || !credential.name) {
      return {
        ok: false,
        reason: "missing-credential",
        code: "missing-credential",
        meta: { ...meta, resourceRejection, skillsRejection },
      };
    }
  }

  // 4. Compose the env.
  const parentEnvRecord = typeof parentEnv === "function" ? parentEnv() : (parentEnv ?? {});
  const baseWithProjections = { ...baseEnv };
  if (resourceView && resourceView.state === "projected") {
    // The projection carries the canonical realpath internally; we round-trip
    // through consume() to recover the root for the env. For alpha we re-resolve
    // via the projection's public summary: the projection owns the canonical
    // path; the env carries it under ROS_PROJECT_ROOT.
    // Note: the projection object holds root internally; we re-derive via
    // resourceView + authorizedProject.root after consume to keep the env
    // value identical to what consume would validate.
    const projection = createHarnessResourceProjection({ authorizedProject, ...(resourceHooks ?? {}) });
    const projected = await projection.project({ addonId: TERMINAL_HOST_ADDON_ID, sessionId, request, grantedCapabilities });
    if (projected.ok && projected.projection?.root) {
      baseWithProjections[PROJECTED_SESSION_ENV_NAMES.projectRoot] = projected.projection.root;
      baseWithProjections[PROJECTED_SESSION_ENV_NAMES.projectCwd] = projected.projection.cwd ?? projected.projection.root;
    }
  }
  if (skillsStagingRoot) {
    baseWithProjections[PROJECTED_SESSION_ENV_NAMES.skillsDir] = skillsStagingRoot;
  }

  const env = buildSessionEnv({
    baseEnv: baseWithProjections,
    envAllowlist,
    parentEnv: parentEnvRecord,
    credentialName: credential?.name ?? "",
    credentialValue: credential?.value ?? "",
  });

  // 5. Reflect projection denials into a degraded-but-honest meta (fail closed
  // when the projection is required; the env still carries the credential under
  // the host-owned name, but resource/skills-related denials surface so the
  // caller can decide whether to attach).
  if (resourceRejection || skillsRejection) {
    return {
      ok: false,
      reason: "projection-denied",
      code: resourceRejection ?? skillsRejection,
      meta: { ...meta, resourceRejection, skillsRejection },
    };
  }

  return {
    ok: true,
    env: { ...env, _meta: JSON.stringify(meta) },
    meta,
  };
}

/**
 * @typedef {Object} JsonRpcRequest
 * @property {"2.0"} jsonrpc
 * @property {string | number | null} id
 * @property {string} method
 * @property {unknown} [params]
 */

/**
 * @typedef {Object} JsonRpcNotification
 * @property {"2.0"} jsonrpc
 * @property {string} method
 * @property {unknown} [params]
 */

/**
 * @typedef {Object} JsonRpcResponse
 * @property {"2.0"} jsonrpc
 * @property {string | number | null} id
 * @property {unknown} [result]
 * @property {{ code: number, message: string, data?: unknown }} [error]
 */

/**
 * Frame a JSON-RPC message on a single line (newline-delimited JSON).
 * @param {JsonRpcRequest | JsonRpcNotification | JsonRpcResponse} message
 */
function frame(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Validate a RosTerminalEventEnvelope. The bridge is the boundary; it must
 * reject malformed envelopes before they reach the bus. Mirrors the
 * `validateHarnessEvent` discipline (size limits, type discriminator).
 *
 * @param {unknown} envelope
 * @returns {{ ok: true, value: import("../../src/core/terminal-host-contract.ts").RosTerminalEventEnvelope } | { ok: false, reason: string }}
 */
export function validateRosTerminalEventEnvelope(envelope) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, reason: "envelope is not an object" };
  }
  const e = /** @type {Record<string, unknown>} */ (envelope);
  if (e.version !== TERMINAL_HOST_CONTRACT_VERSION) {
    return { ok: false, reason: `version must be ${TERMINAL_HOST_CONTRACT_VERSION}` };
  }
  if (typeof e.sessionId !== "string" || e.sessionId.length === 0) {
    return { ok: false, reason: "sessionId missing" };
  }
  if (e.source !== "terminal" && e.source !== "harness") {
    return { ok: false, reason: "source must be 'terminal' or 'harness'" };
  }
  if (typeof e.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e.at)) {
    return { ok: false, reason: "at must be an ISO-8601 timestamp" };
  }
  if (e.event === null || typeof e.event !== "object" || Array.isArray(e.event)) {
    return { ok: false, reason: "event body missing" };
  }
  const ev = /** @type {Record<string, unknown>} */ (e.event);
  if (typeof ev.type !== "string" || !ev.type.startsWith("terminal.")) {
    return { ok: false, reason: "event.type must start with 'terminal.'" };
  }
  return { ok: true, value: /** @type {any} */ (envelope) };
}

/**
 * Map a RosTerminalEventEnvelope to a HarnessEvent for the bus.
 * The bus accepts 5 terminal.* event types (Phase 1.5 Step 0).
 *
 * @param {import("../../src/core/terminal-host-contract.ts").RosTerminalEventEnvelope} envelope
 * @param {{ sessionId: string, turnId: string, bootEpoch: string, generation: number, sequence: number }} provenance
 * @returns {import("../../src/core/contracts.ts").HarnessEvent}
 */
export function envelopeToHarnessEvent(envelope, provenance) {
  const event = /** @type {{ type: string, [k: string]: unknown }} */ (envelope.event);
  const { type, ...rest } = event;
  return {
    ...provenance,
    type: /** @type {any} */ (type),
    data: rest,
  };
}

/**
 * @typedef {Object} TerminalHostServiceOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {() => string} [addonId]
 * @property {() => string} [bootEpoch]
 * @property {(entrypoint: string, args: string[], envArg: NodeJS.ProcessEnv) => import("node:child_process").ChildProcess} [spawn]
 * @property {string} [entrypoint] default per RESONANT_TERMINAL_DRIVER
 * @property {string} [script]    default per RESONANT_TERMINAL_DRIVER
 * @property {string} [cwd]       default per RESONANT_TERMINAL_DRIVER
 *                                    (iTerm2 -> iterm2/, Ghostty -> ghostty/)
 */

/**
 * @typedef {Object} TerminalHostService
 * @property {() => Promise<{ adapterId: string, bus: ReturnType<typeof createHarnessEventBus>, driveId: string }>} start
 * @property {() => Promise<void>} stop
 * @property {(args: { sessionId: string, bootstrapCommand: string, turnId?: string, timeoutMs?: number }) => Promise<import("../../src/core/terminal-host-contract.ts").SessionBootstrapGrant>} launchBootstrap
 * @property {(args: { sessionId: string, text: string, turnId?: string, timeoutMs?: number }) => Promise<{ sessionId: string, delivered: boolean }>} sendInput
 * @property {(args: { sessionId: string, turnId?: string, timeoutMs?: number }) => Promise<{ sessionId: string, terminated: boolean }>} terminateSession
 * @property {(args: { sessionId: string, entryMode?: "create" | "adopt" | "detached", turnId?: string, timeoutMs?: number }) => Promise<{ sessionId: string }>} createSession
 * @property {() => { events: number, lastEventAt: number | null, alive: boolean }} status
 */

/**
 * Compose the terminal-host bridge service. The service owns one adapter
 * process (iTerm2 driver) and one broker bus scoped to the addon. The bus
 * is the same `createHarnessEventBus` the harness boundary uses; consumers
 * (DAR, side panel) subscribe via `bus.subscribe()`.
 *
 * @param {TerminalHostServiceOptions} [options]
 * @returns {TerminalHostService}
 */
export function createTerminalHostService(options = {}) {
  const env = options.env ?? process.env;
  const addonId = options.addonId ?? (() => TERMINAL_HOST_ADDON_ID);
  const bootEpoch = options.bootEpoch ?? (() => env.RESONANTOS_HARNESS_BOOTEPOCH ?? `boot-${randomUUID().slice(0, 8)}`);
  const driveId = env.RESONANT_TERMINAL_DRIVER ?? "in-memory";
  // Driver-specific spawn plan. The iTerm2 driver is a Python script
  // (iterm2's control API is Python; the bridge is the stdio JSON-RPC
  // peer). The Ghostty driver is a Node script (Ghostty's only automation
  // surface is AppleScript via osascript; see TERMINAL-HOST-GHOSTTY-
  // RECONCILIATION.md). The in-memory driver composes without spawning.
  const SPAWN_PLANS = {
    iterm2: { command: "python3", args: ["adapter.py"] },
    ghostty: { command: "node", args: ["adapter.mjs"] },
  };
  if (driveId !== "in-memory" && !(driveId in SPAWN_PLANS)) {
    throw new Error(
      `RESONANT_TERMINAL_DRIVER must be 'in-memory', 'iterm2', or 'ghostty'. Got: ${JSON.stringify(driveId)}`,
    );
  }
  const cwd = options.cwd ?? (
    driveId === "ghostty" ? "examples/sdk-demo/terminal-host/ghostty"
    : "examples/sdk-demo/terminal-host/iterm2"
  );
  const spawnFn = options.spawn ?? ((cmd, args, envArg) => spawn(cmd, args, { cwd, env: envArg, stdio: ["pipe", "pipe", "pipe"] }));
  const spawnPlan = SPAWN_PLANS[driveId] ?? { command: "node", args: ["adapter.mjs"] };
  const entrypoint = options.entrypoint ?? spawnPlan.command;
  const script = options.script ?? spawnPlan.args[0];

  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let bus = null;
  let sequence = 0;
  let eventsPublished = 0;
  let lastEventAt = /** @type {number | null} */ (null);
  let alive = false;

  /** @type {Map<string | number, { resolve: (value: unknown) => void, reject: (reason?: unknown) => void, timer: NodeJS.Timeout, startedAt: number }>} */
  const pending = new Map();

  function nextProvenance(turnId) {
    sequence += 1;
    return {
      addonId: addonId(),
      sessionId: "terminal-host-bus",
      turnId: turnId ?? "terminal",
      bootEpoch: bootEpoch(),
      generation: 0,
      sequence,
    };
  }

  function handleNotification(/** @type {JsonRpcNotification} */ msg) {
    if (msg.method !== "terminal.event") return;
    const validation = validateRosTerminalEventEnvelope(msg.params);
    if (!validation.ok) {
      console.error(JSON.stringify({ event: "terminal_host.invalid_envelope", reason: validation.reason }));
      return;
    }
    const provenance = nextProvenance(validation.value.sessionId);
    const harnessEvent = envelopeToHarnessEvent(validation.value, provenance);
    if (!validateHarnessEvent(harnessEvent)) {
      console.error(JSON.stringify({ event: "terminal_host.bus_rejected", type: harnessEvent.type }));
      return;
    }
    bus?.publish({
      turnId: harnessEvent.turnId,
      type: harnessEvent.type,
      data: /** @type {any} */ (harnessEvent.data),
    });
    eventsPublished += 1;
    lastEventAt = performance.now();
  }

  function handleResponse(/** @type {JsonRpcResponse} */ msg) {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
    else waiter.resolve(msg.result);
  }

  function handleLine(/** @type {string} */ line) {
    if (line.length === 0) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch (error) { console.error(JSON.stringify({ event: "terminal_host.bad_json", error: String(error), line: line.slice(0, 200) })); return; }
    if (msg.jsonrpc !== JSON_RPC_VERSION) {
      console.error(JSON.stringify({ event: "terminal_host.bad_version", version: msg.jsonrpc }));
      return;
    }
    if ("id" in msg && (msg.result !== undefined || msg.error !== undefined)) handleResponse(msg);
    else if ("method" in msg) handleNotification(/** @type {any} */ (msg));
  }

  function send(/** @type {JsonRpcRequest | JsonRpcNotification} */ msg) {
    if (!child?.stdin || child.stdin.destroyed) {
      throw new Error("terminal-host adapter is not running");
    }
    child.stdin.write(frame(msg));
  }

  function request(method, params, { timeoutMs = 5000 } = {}) {
    if (!child?.stdin) return Promise.reject(new Error("adapter not started"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`${method} timed out after ${timeoutMs}ms`), { code: "deadline-exceeded" }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, startedAt: performance.now() });
      send({ jsonrpc: JSON_RPC_VERSION, id, method, params });
    });
  }

  async function start() {
    if (alive) return { adapterId: addonId(), bus, driveId };
    if (driveId === "in-memory") {
      // The in-memory driver has no stdio surface; the service composes
      // but produces no bus events of its own. Tests in this mode drive
      // the in-memory host directly.
      bus = createHarnessEventBus({
        provenance: { addonId: addonId(), sessionId: "terminal-host-bus", turnId: "terminal", bootEpoch: bootEpoch(), generation: 0 },
        isCurrent: () => alive,
        maxReaders: 8,
      });
      alive = true;
      return { adapterId: addonId(), bus, driveId };
    }
    // iterm2: spawn the operator-provided adapter as a stdio JSON-RPC peer.
    bus = createHarnessEventBus({
      provenance: { addonId: addonId(), sessionId: "terminal-host-bus", turnId: "terminal", bootEpoch: bootEpoch(), generation: 0 },
      isCurrent: () => alive,
      maxReaders: 8,
    });
    const scopedEnv = { RESONANT_TERMINAL_DRIVER: driveId };
    for (const key of ADAPTER_ENV_ALLOWLIST) {
      if (env[key] !== undefined) scopedEnv[key] = env[key];
    }
    child = spawnFn(entrypoint, [script], scopedEnv);
    child.on("exit", (code, signal) => {
      alive = false;
      console.error(JSON.stringify({ event: "terminal_host.adapter_exit", code, signal }));
    });
    const rl = createInterface({ input: child.stdout });
    rl.on("line", handleLine);
    child.stderr.on("data", (chunk) => {
      console.error(`[adapter] ${chunk.toString().trimEnd()}`);
    });
    alive = true;
    return { adapterId: addonId(), bus, driveId };
  }

  async function stop() {
    if (!alive) return;
    alive = false;
    if (bus) bus.close("runtime-unavailable");
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Object.assign(new Error("service stopped"), { code: "runtime-unavailable" }));
    }
    pending.clear();
    if (child && !child.killed) {
      child.kill("SIGTERM");
      try { await Promise.race([once(child, "exit"), delay(2000)]); }
      catch { child.kill("SIGKILL"); }
    }
    child = null;
  }

  async function launchBootstrap({ sessionId, bootstrapCommand, turnId, timeoutMs = 5000 }) {
    if (driveId === "in-memory") {
      throw new Error("launchBootstrap unavailable: in-memory driver has no stdio surface");
    }
    // Per v5: consumer receives the resolved environment via the bootstrap
    // RPC return value + `terminal.session.started` event. We return the
    // grant here; the bus event is published by the adapter's notification
    // and observed via bus.subscribe().
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId, purpose: "attach" }));
    const result = await request(
      "launchBootstrap",
      { sessionId, bootstrapCommand, grant },
      { timeoutMs },
    );
    return /** @type {any} */ (result);
  }

  async function sendInput({ sessionId, text, turnId, timeoutMs = 5000 }) {
    if (driveId === "in-memory") {
      throw new Error("sendInput unavailable: in-memory driver has no stdio surface");
    }
    const result = await request(
      "sendInput",
      { sessionId, text },
      { timeoutMs },
    );
    return /** @type {any} */ (result);
  }

  async function terminateSession({ sessionId, turnId, timeoutMs = 5000 }) {
    if (driveId === "in-memory") {
      throw new Error("terminateSession unavailable: in-memory driver has no stdio surface");
    }
    const result = await request(
      "terminateSession",
      { sessionId },
      { timeoutMs },
    );
    return /** @type {any} */ (result);
  }

  async function createSessionRpc({ sessionId, entryMode = "create", turnId, timeoutMs = 5000 }) {
    if (driveId === "in-memory") {
      throw new Error("createSession unavailable: in-memory driver has no stdio surface");
    }
    const result = await request(
      "createSession",
      { sessionId, entryMode },
      { timeoutMs },
    );
    return /** @type {any} */ (result);
  }

  function status() {
    return { events: eventsPublished, lastEventAt, alive: !!child && alive };
  }

  return { start, stop, launchBootstrap, sendInput, terminateSession, createSession: createSessionRpc, status };
}
