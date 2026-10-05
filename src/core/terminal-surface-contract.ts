// Intent citation: prompts/TERMINAL-HOST-XH1-XH2-EXTERNAL-CLI-HARNESS-PROMPT.md
//
// Terminal Surface Descriptor (XH1) — host-owned, declarative, and
// harness-agnostic. A descriptor is the single source of truth for "what
// can a terminal do" so a host-owned generic launcher can pick a
// compatible surface for any external-CLI harness policy without
// embedding harness-specific or terminal-specific branches.
//
// Relationship to `terminal-host-contract.ts`:
//   - The legacy `TerminalHostAdapterContract.supportedOperations` and
//     `TerminalHostAdapterCapability` are the transport-level operations
//     a terminal adapter implements (createSession, launchBootstrap,
//     sendInput, terminateSession) plus the low-level capabilities
//     (launch, cwd, environment, lifecycle-events, ...). They describe
//     "how the bridge talks to the terminal".
//   - This file's `TerminalSurfaceDescriptor` and `TerminalCapability`
//     are the higher-level "what does a surface expose to a generic
//     harness launcher" vocabulary used for compatibility resolution.
//     They are derived FROM the transport-level contract (and from
//     observed adapter behavior); they never widen the adapter's
//     actual capability set.
//   - A descriptor is filled in by the host from the reviewed adapter
//     definition + observed adapter telemetry. Manifests, harnesses,
//     and policies NEVER supply it.

import type { TerminalHostAdapterId } from "./terminal-host-contract.ts";

export const TERMINAL_SURFACE_CONTRACT_VERSION = 1 as const;

/**
 * The fixed four terminal-agnostic operations. Mirrors
 * `TERMINAL_HOST_OPERATIONS` one-to-one; declared as a tuple so the
 * union exhaustiveness check at every call site stays automatic.
 */
export const TERMINAL_SURFACE_OPERATIONS = [
  "createSession",
  "launchBootstrap",
  "sendInput",
  "terminateSession",
] as const;

export type TerminalSurfaceOperation = (typeof TERMINAL_SURFACE_OPERATIONS)[number];

/**
 * High-level capability vocabulary a generic external-CLI harness
 * launcher consults to decide whether a surface is compatible with a
 * policy's `terminalRequirements`. These are NOT transport primitives
 * (those live in `terminal-host-contract.ts`); they are user-facing
 * features a harness can opt into.
 *
 *   - command            the surface can run a shell command at launch
 *   - environment        the surface can deliver per-session env vars
 *   - cwd                the surface can launch with an explicit cwd
 *   - send-input         the surface can accept user text after launch
 *   - lifecycle-events   the surface emits start / terminate events
 *   - command-events     the surface emits per-command start/ended events
 *   - screen-stream      the surface exposes its rendered screen
 *   - multiplexer        the surface is a multiplexer (tmux/zellij/...)
 *   - adopt-existing     the surface can adopt a user-opened window
 */
export type TerminalCapability =
  | "command"
  | "environment"
  | "cwd"
  | "send-input"
  | "lifecycle-events"
  | "command-events"
  | "screen-stream"
  | "multiplexer"
  | "adopt-existing";

/**
 * How a surface pushes state back to ROS.
 *   - event-stream  a real-time event channel (iTerm2, WezTerm, kitty)
 *   - polling       the surface is observed on an interval (Ghostty 1.3.1)
 *   - observation   no feedback; the surface is one-way
 *   - none          a placeholder that never participates
 */
export type TerminalFeedbackChannel = "event-stream" | "polling" | "observation" | "none";

/**
 * A terminal surface as observed by the host. Populated by the host from
 * the reviewed adapter definition + observed adapter behavior. Contains
 * no harness-specific behavior, no manifest-derived data, and no
 * caller-supplied values. Two surfaces with the same `adapterId` MUST
 * carry the same descriptor (no per-launch mutation).
 */
export interface TerminalSurfaceDescriptor {
  readonly contractVersion: typeof TERMINAL_SURFACE_CONTRACT_VERSION;
  readonly adapterId: TerminalHostAdapterId;
  readonly platform: "macos" | "linux" | "windows";
  readonly supportedOperations: readonly TerminalSurfaceOperation[];
  readonly capabilities: readonly TerminalCapability[];
  readonly feedbackChannel: TerminalFeedbackChannel;
}

/**
 * Build a descriptor in one call. Caller must supply an honest
 * capability set; `isTerminalSurfaceDescriptor` validates the result
 * before it is published.
 */
export function defineTerminalSurface(input: TerminalSurfaceDescriptor): TerminalSurfaceDescriptor {
  if (!isTerminalSurfaceDescriptor(input)) {
    throw new TypeError("defineTerminalSurface: input failed descriptor validation");
  }
  return Object.freeze({ ...input });
}

const KNOWN_OPERATIONS = new Set<string>(TERMINAL_SURFACE_OPERATIONS);
const KNOWN_CAPABILITIES = new Set<TerminalCapability>([
  "command",
  "environment",
  "cwd",
  "send-input",
  "lifecycle-events",
  "command-events",
  "screen-stream",
  "multiplexer",
  "adopt-existing",
]);
const KNOWN_FEEDBACK: ReadonlySet<TerminalFeedbackChannel> = new Set([
  "event-stream",
  "polling",
  "observation",
  "none",
]);
const KNOWN_PLATFORMS = new Set(["macos", "linux", "windows"]);

export function isTerminalSurfaceDescriptor(value: unknown): value is TerminalSurfaceDescriptor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.contractVersion !== TERMINAL_SURFACE_CONTRACT_VERSION) return false;
  if (typeof v.adapterId !== "string" || v.adapterId.length === 0) return false;
  if (typeof v.platform !== "string" || !KNOWN_PLATFORMS.has(v.platform)) return false;
  if (!Array.isArray(v.supportedOperations)) return false;
  if (!v.supportedOperations.every((op) => typeof op === "string" && KNOWN_OPERATIONS.has(op))) return false;
  if (new Set(v.supportedOperations).size !== v.supportedOperations.length) return false;
  if (!Array.isArray(v.capabilities)) return false;
  if (!v.capabilities.every((c) => typeof c === "string" && KNOWN_CAPABILITIES.has(c as TerminalCapability))) return false;
  if (new Set(v.capabilities).size !== v.capabilities.length) return false;
  if (typeof v.feedbackChannel !== "string" || !KNOWN_FEEDBACK.has(v.feedbackChannel as TerminalFeedbackChannel)) return false;
  return true;
}

/**
 * Pure compatibility check: a policy's `terminalRequirements` is
 * satisfied by a descriptor iff every required capability is present
 * in the descriptor's capability set. Order-insensitive. Empty
 * requirements are satisfied by every descriptor.
 */
export function terminalSurfaceSatisfies(
  descriptor: TerminalSurfaceDescriptor,
  requirements: readonly TerminalCapability[]
): boolean {
  const have = new Set(descriptor.capabilities);
  return requirements.every((req) => have.has(req));
}

// ---------------------------------------------------------------------------
// XH3a: harness↔terminal compatibility result + resolver contract.
//
// The resolver runs BEFORE the launcher calls
// `terminalHostService.launchBootstrap(...)`. An incompatible
// pairing fails closed: no grant is minted, no token file is
// written, no terminal process is started. The result is
// structured, public, and non-secret.
// ---------------------------------------------------------------------------

/**
 * The provenance fidelity the surface can deliver back to DAR
 * (the recording layer). Derived from the surface's
 * `feedbackChannel`:
 *   - event-stream / polling -> "telemetry"
 *   - observation             -> "observation"
 *   - none / no surface        -> "unsupported"
 *
 * "structured" (harness-published events) is intentionally NOT a
 * value here: the surface alone can never guarantee it; a wrapping
 * policy can upgrade telemetry -> structured, but that is per-
 * harness work and is not assumed.
 */
export type ProvenanceFidelity = "telemetry" | "observation" | "unsupported";

/**
 * The compatibility verdict for one (requirements, surfaces) pair.
 * When `compatible: false`, the result is a fail-closed signal
 * that the launcher MUST short-circuit before any grant/launch
 * work. The shape carries only public values: capability strings
 * and a provenance fidelity — never a path, token, credential,
 * or env name.
 */
export interface HarnessTerminalCompatibility {
  readonly compatible: boolean;
  /** The chosen descriptor when compatible; undefined otherwise. */
  readonly surface?: TerminalSurfaceDescriptor;
  /** Every requirement the chosen candidate is missing. Empty
   *  when compatible. */
  readonly missingCapabilities: readonly TerminalCapability[];
  /** The fidelity the chosen surface can deliver. "unsupported"
   *  when no surface is eligible at all. */
  readonly provenanceFidelity: ProvenanceFidelity;
}

/**
 * Map a surface's feedback channel to provenance fidelity. Pure.
 */
export function deriveProvenanceFidelity(
  feedbackChannel: TerminalFeedbackChannel
): ProvenanceFidelity {
  switch (feedbackChannel) {
    case "event-stream":
    case "polling":
      return "telemetry";
    case "observation":
      return "observation";
    case "none":
      return "unsupported";
  }
}

/**
 * The order in which the resolver considers descriptors: the
 * `preferred` adapter ids first, then the remaining registered
 * ids in declaration order. Stable, deterministic, no side effects.
 */
export function orderDescriptorsForResolution(
  descriptors: readonly TerminalSurfaceDescriptor[],
  preferred: readonly string[] = []
): readonly TerminalSurfaceDescriptor[] {
  const byAdapterId = new Map(descriptors.map((d) => [d.adapterId, d]));
  const out = [];
  const seen = new Set();
  for (const id of preferred) {
    const d = byAdapterId.get(id);
    if (d && !seen.has(id)) { out.push(d); seen.add(id); }
  }
  for (const d of descriptors) {
    if (!seen.has(d.adapterId)) { out.push(d); seen.add(d.adapterId); }
  }
  return out;
}

/**
 * Compute the missing capabilities for a single descriptor against
 * a requirement set. Pure; capability strings only.
 */
export function missingCapabilitiesFor(
  descriptor: TerminalSurfaceDescriptor,
  requirements: readonly TerminalCapability[]
): readonly TerminalCapability[] {
  const have = new Set(descriptor.capabilities);
  return requirements.filter((req) => !have.has(req));
}
