// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-9 capability glossary and deprecation policy. Every capability has a
// documented meaning + default scope; renames go through a deprecation/alias map
// (old -> current) so broadening is resolved explicitly, never silently.

import type { Capability } from "../core/contracts";

export interface CapabilityGlossaryEntry {
  label: string;
  description: string;
  scope: "self" | "workspace" | "shared" | "system" | "intake-only";
}

export const CAPABILITY_GLOSSARY: Record<Capability, CapabilityGlossaryEntry> = {
  filesystem: { label: "Filesystem access", description: "Read/write within granted workspace paths.", scope: "workspace" },
  "archive-read": { label: "Archive read", description: "Read scoped knowledge with citations.", scope: "shared" },
  "archive-intake-write": { label: "Archive intake write", description: "Write into the intake boundary only.", scope: "intake-only" },
  "chat-interface": { label: "Chat interface", description: "Provide the replaceable chat surface.", scope: "system" },
  "memory-provider": { label: "Memory provider", description: "Serve the memory-system slot.", scope: "system" },
  providers: { label: "Provider access", description: "Route model requests through configured providers.", scope: "shared" },
  shell: { label: "Shell integration", description: "Register shell sections and dock icons.", scope: "system" },
  network: { label: "Network access", description: "Outbound network within the allowlist.", scope: "shared" },
  "ui-embedding": { label: "UI embedding", description: "Embed a surface in the shell.", scope: "system" },
  "browser-control": { label: "Browser control", description: "Drive the controlled browser.", scope: "system" },
  "agent-delegation": { label: "Agent delegation", description: "Delegate to child agents under a task grant.", scope: "system" },
  notifications: { label: "Notifications", description: "Send notifications through channels.", scope: "shared" },
  "device-integration": { label: "Device integration", description: "Access integrated devices.", scope: "shared" },
};

// Rename aliases: old name -> current capability. Populated as capabilities are
// renamed; never silently broadens. Empty today because no capability has been
// renamed yet.
export const CAPABILITY_DEPRECATIONS: Readonly<Record<string, Capability>> = {};

// Resolve a capability name to its current Capability, or null if unknown. An
// alias resolves through the deprecation map; an unknown name is rejected.
export function resolveCapability(name: string): Capability | null {
  if (name in CAPABILITY_GLOSSARY) return name as Capability;
  return CAPABILITY_DEPRECATIONS[name] ?? null;
}

// True when a capability is deprecated (has a replacement).
export function isCapabilityDeprecated(name: string): boolean {
  return name in CAPABILITY_DEPRECATIONS;
}
