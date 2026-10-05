// Host-owned harness↔terminal compatibility resolver (XH3).
//
// Pure, no I/O, no process/grant side effects, no secrets. The
// resolver is the only authority that decides "is this harness
// policy runnable on the set of terminal surfaces the host has
// available?". The launcher's `invoke()` calls this resolver
// BEFORE `terminalHostService.launchBootstrap(...)` so an
// incompatible pairing fails closed without minting a grant,
// writing a token/auth file, or spawning a terminal process.
//
// Relationship to the surface registry:
//   - `terminal-surface-registry.mjs` exposes `pickCompatibleSurface`
//     as a thin convenience that returns just the descriptor (or
//     null). The XH3 resolver builds on that primitive but returns
//     the structured HarnessTerminalCompatibility result the
//     launcher needs to fail-closed with a public reason.

import {
  deriveProvenanceFidelity,
  orderDescriptorsForResolution,
  missingCapabilitiesFor,
  isTerminalSurfaceDescriptor,
} from "../../src/core/terminal-surface-contract.ts";
import {
  listTerminalSurfaceDescriptors,
} from "./terminal-surface-registry.mjs";

/**
 * @typedef {import("../../src/core/terminal-surface-contract.ts").TerminalSurfaceDescriptor} TerminalSurfaceDescriptor
 * @typedef {import("../../src/core/terminal-surface-contract.ts").TerminalCapability} TerminalCapability
 * @typedef {import("../../src/core/terminal-surface-contract.ts").HarnessTerminalCompatibility} HarnessTerminalCompatibility
 */

/**
 * Resolve harness↔terminal compatibility. Pure.
 *
 * @param {object} args
 * @param {readonly TerminalCapability[]} args.requirements
 *   The policy's terminalRequirements. May be empty; an empty
 *   requirement set is satisfied by every descriptor.
 * @param {readonly TerminalSurfaceDescriptor[]} [args.descriptors]
 *   The candidate surfaces, in the order the host wants to consider
 *   them. Defaults to the host's registered surfaces in declaration
 *   order.
 * @param {readonly string[]} [args.preferred]
 *   Optional preferred adapter ids. The resolver considers these
 *   BEFORE the rest of `descriptors`. Preferred is honored only
 *   when the entry is in `descriptors`.
 * @returns {HarnessTerminalCompatibility}
 */
export function resolveHarnessTerminalCompatibility({
  requirements,
  descriptors = listTerminalSurfaceDescriptors(),
  preferred = [],
} = {}) {
  // 1. Sanitize inputs. The resolver never throws on bad input
  //    (the launcher should never see an internal error from
  //    here); an invalid requirement set is an "unsupported" verdict.
  if (!Array.isArray(requirements)) {
    return {
      compatible: false,
      missingCapabilities: [],
      provenanceFidelity: "unsupported",
    };
  }
  // 2. Order the candidate surfaces deterministically: preferred
  //    first, then the rest in declaration order. This preserves
  //    the existing pickCompatibleSurface semantics (XH2) so the
  //    wiring is not weakened.
  const ordered = orderDescriptorsForResolution(
    descriptors.filter((d) => isTerminalSurfaceDescriptor(d)),
    preferred,
  );
  // 3. Empty surface set -> unsupported. No surface means no
  //    compatibility, ever.
  if (ordered.length === 0) {
    return {
      compatible: false,
      missingCapabilities: [...requirements],
      provenanceFidelity: "unsupported",
    };
  }
  // 4. Walk the ordered list. The FIRST surface that satisfies
  //    every requirement is the chosen one. Provenance fidelity
  //    is derived from that surface's feedback channel.
  for (const desc of ordered) {
    if (desc.capabilities.length > 0 && new Set(desc.capabilities).size !== desc.capabilities.length) {
      // Defensive: a bad descriptor (duplicate capability) is treated
      // as ineligible. The registry's module-load check rejects this,
      // but the resolver must not crash on a runtime-injected surface.
      continue;
    }
    const missing = missingCapabilitiesFor(desc, requirements);
    if (missing.length === 0) {
      return {
        compatible: true,
        surface: desc,
        missingCapabilities: [],
        provenanceFidelity: deriveProvenanceFidelity(desc.feedbackChannel),
      };
    }
  }
  // 5. No surface satisfied every requirement. Compute the
  //    missing-capabilities set for the FIRST preferred candidate
  //    (the one the launcher would have chosen had it been
  //    compatible) so the caller can publish a specific reason.
  //    If there is no preferred candidate, fall back to the first
  //    descriptor in declaration order.
  const firstCandidate = ordered[0];
  const missing = missingCapabilitiesFor(firstCandidate, requirements);
  return {
    compatible: false,
    missingCapabilities: [...missing],
    provenanceFidelity: "unsupported",
  };
}
