// Intent citation: prompts/TERMINAL-HOST-XH1-XH2-EXTERNAL-CLI-HARNESS-PROMPT.md
//
// External-CLI Harness Policy (XH1) — host-owned, declarative, and
// reviewed. A policy is the only place a harness (Pi, Claude Code,
// Codex, Hermes, OpenCode, ...) declares how to:
//
//   - resolve its own validated executable (host owns; no manifest path)
//   - declare which terminal capabilities it needs
//   - declare how it gets credentials (host always owns resolution)
//   - declare how it gets the prompt (file / stdin / argv)
//   - compose the terminal-side `commandSuffix` (host-validated
//     strings only; never the bootstrap grant, never the credential)
//
// A policy is NOT a manifest. Manifests reference a `policyId`; the
// policy itself is reviewed host code. Adding a new harness means
// adding a new policy module — never editing a manifest, never
// editing a terminal adapter, never editing the generic launcher.

import type { TerminalCapability } from "./terminal-surface-contract.ts";

export const EXTERNAL_CLI_HARNESS_POLICY_VERSION = 1 as const;

/**
 * One validated terminal executable (the harness CLI itself). The
 * host-owned runtime is the ONLY authority that may produce this
 * value; the policy module is invoked by the host during `invoke()`
 * and returns a reviewed result. The policy is not allowed to invent
 * paths, read PATH, or trust any caller-supplied string.
 */
export interface ReviewedExecutable {
  /** Absolute path to the validated executable (e.g. /usr/local/bin/pi). */
  readonly command: string;
  /** Which allowlist produced the path (audit trail). */
  readonly source: "fixed-install-root" | "npm-global-sibling" | (string & {});
  /** Optional reviewer annotation (e.g. "OpenCode CLI 0.4.x"). */
  readonly note?: string;
}

/**
 * Input to a policy's `resolveExecutable`. The host supplies context
 * (session id, host project root, env overrides for tests). The policy
 * MUST NOT receive the bootstrap grant, the credential value, or any
 * caller-supplied command.
 */
export interface PolicyExecutableInput {
  readonly sessionId: string;
  readonly hostProjectRoot: string;
  /** Test-only seam; never set in production. */
  readonly homeDirOverride?: string;
}

/**
 * Input to a policy's `composeInvocation`. The host supplies the
 * validated executable, the prompt, and the optional prompt-file
 * staging path. The policy returns the reviewed `commandSuffix` —
 * the part appended AFTER the host's own `eval "$(ros-session
// attach ...)"` clause.
 */
export interface HarnessInvocationInput {
  readonly executable: ReviewedExecutable;
  readonly prompt: string;
  /** Host-staged 0600 prompt file path; null when the prompt was
   *  argv-quoted. The policy MAY choose file vs. argv; the host
   *  decides when a file is required (multi-line / oversize). */
  readonly promptFilePath: string | null;
  /** Host-built projected env-var NAME (e.g. "OPENAI_API_KEY"). The
   *  policy never sees the VALUE. */
  readonly credentialEnvVarName: string | null;
}

export interface ReviewedInvocation {
  /** The harness-side command tail appended after the attach clause. */
  readonly commandSuffix: string;
  /** Echoed for audit logs; never includes token/credential values. */
  readonly auditSummary: string;
}

/**
 * How the harness obtains its provider authentication. The host owns
 * resolution in every mode; the policy only declares the shape.
 *
 *   - provider-profile  the host resolves the credential from the
 *                       shared provider store and injects it via
 *                       the projected session env (env-var name)
 *   - self-auth         the harness owns its own login / auth store;
 *                       the host injects nothing
 *   - none              keyless / local-runtime
 */
export type PolicyCredentialSource = "provider-profile" | "self-auth" | "none";

/**
 * How the credential is delivered to the harness when
 * `credentialPolicy.source === "provider-profile"`.
 *
 *   - session-environment  the host injects the env var into the
 *                          launched terminal session
 *   - native-login         the host performs the harness's native
 *                          login flow once and lets the harness
 *                          read its own credential store thereafter
 */
export type PolicyCredentialDelivery = "session-environment" | "native-login";

/**
 * The shape of an External-CLI Harness Policy. A policy is reviewed
 * host code; its `policyId` is referenced from a manifest's
 * `harnessRuntime.policyId`. The policy never grants authority; the
 * host maps its declared `supportedProviderFamilies` against the
 * provider-profiles it has on file, and the host always owns the
 * bootstrap grant, the token file, and the env injection.
 */
export interface ExternalCliHarnessPolicy {
  readonly contractVersion: typeof EXTERNAL_CLI_HARNESS_POLICY_VERSION;
  readonly policyId: string;
  readonly harnessId: string;
  /** Identifier the host uses to look up the executable allowlist. */
  readonly executablePolicyId: string;

  /** Capabilities the harness requires from a terminal surface. The
   *  host runs `terminalSurfaceSatisfies` to pick a compatible one. */
  readonly terminalRequirements: readonly TerminalCapability[];

  readonly credentialPolicy: {
    readonly source: PolicyCredentialSource;
    readonly supportedProviderFamilies: readonly string[];
    readonly delivery: PolicyCredentialDelivery;
  };

  /** How the harness receives the user prompt. */
  readonly promptDelivery: "file" | "stdin" | "argv";

  /** Whether the harness exposes a model-selection surface the
   *  chat UI can drive (e.g. `pi --model`). */
  readonly supportsModelSelection: boolean;

  /** Host invokes this on every `invoke()`. MUST return a
   *  reviewed executable or `null` (fail-closed). */
  resolveExecutable(input: PolicyExecutableInput): ReviewedExecutable | null;

  /** Host invokes this on every `invoke()` after the prompt has
   *  been staged. MUST return a reviewed `commandSuffix`. */
  composeInvocation(input: HarnessInvocationInput): ReviewedInvocation;
}

const KNOWN_CREDENTIAL_SOURCES: ReadonlySet<PolicyCredentialSource> = new Set([
  "provider-profile",
  "self-auth",
  "none",
]);
const KNOWN_CREDENTIAL_DELIVERY: ReadonlySet<PolicyCredentialDelivery> = new Set([
  "session-environment",
  "native-login",
]);
const KNOWN_PROMPT_DELIVERY = new Set(["file", "stdin", "argv"]);

export function isExternalCliHarnessPolicy(value: unknown): value is ExternalCliHarnessPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.contractVersion !== EXTERNAL_CLI_HARNESS_POLICY_VERSION) return false;
  if (typeof v.policyId !== "string" || v.policyId.length === 0) return false;
  if (typeof v.harnessId !== "string" || v.harnessId.length === 0) return false;
  if (typeof v.executablePolicyId !== "string" || v.executablePolicyId.length === 0) return false;
  if (!Array.isArray(v.terminalRequirements)) return false;
  if (!v.terminalRequirements.every((c) => typeof c === "string")) return false;
  const cp = v.credentialPolicy;
  if (cp === null || typeof cp !== "object" || Array.isArray(cp)) return false;
  const cpv = cp as Record<string, unknown>;
  if (typeof cpv.source !== "string" || !KNOWN_CREDENTIAL_SOURCES.has(cpv.source as PolicyCredentialSource)) return false;
  if (!Array.isArray(cpv.supportedProviderFamilies)) return false;
  if (!cpv.supportedProviderFamilies.every((f) => typeof f === "string")) return false;
  if (typeof cpv.delivery !== "string" || !KNOWN_CREDENTIAL_DELIVERY.has(cpv.delivery as PolicyCredentialDelivery)) return false;
  if (typeof v.promptDelivery !== "string" || !KNOWN_PROMPT_DELIVERY.has(v.promptDelivery as string)) return false;
  if (typeof v.supportsModelSelection !== "boolean") return false;
  if (typeof v.resolveExecutable !== "function") return false;
  if (typeof v.composeInvocation !== "function") return false;
  return true;
}
