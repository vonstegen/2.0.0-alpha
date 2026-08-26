// Intent citation: docs/architecture/ADR-051-ros-architecture-blueprint.md
//
// The ROS architecture blueprint — the single source of truth for what G0-ROS
// is, what an add-on is, and how the two relate. This module is *consumed*
// (not decorative):
//   - surface-routing.ts   → railMenuKindForCategory (category → rail menu)
//   - validation.ts        → ADDON_RUNTIME_TYPE_BLUEPRINT (runtime ↔ category)
//   - the host mirror in browser-first/host/addon-delegation-service.mjs
//
// The invariant it encodes: G0-ROS is a *fused core* (shell + integrated
// harness + system memory + recovery) that is non-removable and always on,
// plus *pluggable add-ons*. The add-on boundary is the only separable boundary.

import type { AddOnCategory, AddOnRuntimeType, CoreSectionId, NativeToolCapability } from "../../core/contracts";

// ---- Vocabulary ------------------------------------------------------------
// The taxonomy. "Agent = model + harness." Anything that is not the model is
// either the harness (the agent's runtime) or the shell (the platform).
export const ROS_ARCHITECTURE_VOCABULARY = {
  shell:
    "The runtime and control plane: hosts workspaces and the fused core (integrated harness + system memory + recovery), the global harness/add-on registry, auth/identity, and cross-workspace orchestration. Not itself a harness or an add-on.",
  harness:
    "The runtime scaffolding around a model: the loop, tools, state, context, controls, and memory/session persistence. Agent = model + harness.",
  agent: "A model plus its harness — the thing that acts. The core agent is fused to the shell; add-on agents plug in.",
  tool: "A discrete capability.",
  orchestrator: "Coordinates multiple agents.",
  project:
    "The unit of work inside a workspace: the files/build targets/deliverable, the active agent configuration, project-scoped tools/skills/add-ons, and private working memory under a sandbox/permission profile.",
  workspace:
    "The higher-level container and isolation boundary: groups projects and holds what they share — registered harnesses, shared tools and memory, provider/model configs, and permission defaults. A domain boundary (a client, a line of business, a research area).",
  memory:
    "State and context persistence. Working memory belongs to the harness; system memory and the recovery return point belong to the shell.",
} as const;

// ---- Scoping hierarchy -------------------------------------------------------
// Shell → Workspace → Project. Each level owns a different slice of the
// resource surface and adds an isolation boundary; deeper levels inherit from
// shallower ones. Harnesses register once at shell/workspace level; projects
// activate or mount the ones they need rather than re-registering them.
export const ROS_SCOPING = {
  shell: {
    owns:
      "The fused core (integrated harness + system memory + recovery), the global harness/add-on registry, auth/identity, and cross-workspace orchestration.",
  },
  workspace: {
    owns:
      "Registered harnesses, shared tools, shared memory stores, provider/model configs, and permission defaults — the isolation + shared-resource boundary.",
  },
  project: {
    owns:
      "Active agent configuration, project-scoped tools/skills/add-ons, private working memory, file mounts, and sandbox rules — the unit of work.",
  },
} as const;

// ---- The fused core ---------------------------------------------------------
// The core cannot be separated into shell-vs-harness at runtime: it is one
// unit, and it is the fallback the system returns to when add-ons fail.
export const ROS_FUSED_CORE = {
  // Shell-owned, non-removable sections (CoreSectionId).
  sections: [
    "overview",
    "strategist",
    "archive",
    "delegation",
    "compute",
    "addons",
    "settings",
  ] as readonly CoreSectionId[],
  // The shell's own integrated harness. Its display name is user-owned via
  // personalization; the role is fixed and non-removable.
  integratedHarness: "the-shell-agent",
  // The shell's self-structure memory (GoalMemoryRefKind "system-memory").
  systemMemoryKind: "system-memory",
  // The crash-recovery return point (ResonantShellState.recoverySession).
  recoveryField: "recoverySession",
} as const;

// ---- Ground-0 invariant ------------------------------------------------------
export const GROUND_ZERO_INVARIANT =
  "The fused core is self-sufficient: strip away every add-on and external provider, and the remaining shell + integrated harness + system memory + recovery restores to a known-good state. Ground-0 = base = fallback.";

// ---- G0 harness tools ---------------------------------------------------------
// The fused core's integrated harness ships a *minimal* tool loop — only what
// it needs to serve Ground-0 operation. Shell-platform functions (add-on
// management, compute-fabric runner) and bundled add-ons (e.g. RecursiveMAS)
// are NOT part of this harness.
export interface G0HarnessTool {
  name: NativeToolCapability;
  description: string;
  domain: string;
}

export const G0_HARNESS_TOOL_CATALOG: readonly G0HarnessTool[] = [
  { name: "research.search_api", description: "Search the web for current information.", domain: "research" },
  { name: "research.fetch_url", description: "Fetch and read a web page.", domain: "research" },
  { name: "browser.session", description: "Drive a controlled browser session.", domain: "browser" },
  { name: "filesystem.read", description: "Read a file within scope.", domain: "filesystem" },
  { name: "filesystem.search", description: "Search code and text within scope.", domain: "filesystem" },
  { name: "filesystem.patch", description: "Apply a reviewed, scoped patch.", domain: "filesystem" },
  { name: "process.safe_command", description: "Run an allowlisted shell command.", domain: "process" },
  { name: "provider.probe", description: "Probe a provider's health and credentials.", domain: "provider" },
  { name: "provider.route_select", description: "Select a model route within policy.", domain: "provider" },
  { name: "archive.search", description: "Search the trusted archive.", domain: "archive" },
  { name: "archive.read", description: "Read a trusted archive page.", domain: "archive" },
  { name: "archive.intake_write", description: "Write through the ingest path (Strategist-owned).", domain: "archive" },
  { name: "delegation.create_packet", description: "Create a delegation packet for another agent.", domain: "delegation" },
];

export const G0_HARNESS_TOOL_NAMES: readonly NativeToolCapability[] = G0_HARNESS_TOOL_CATALOG.map(
  (tool) => tool.name,
);

// ---- Rail menu kinds -----------------------------------------------------------
// Where an add-on lands in the shell's left rail, derived from its category.
export type AddOnRailMenuKind = "harness" | "memory" | "tools";

// ---- Category blueprint --------------------------------------------------------
// category = *what an add-on is*. It decides the rail destination, not how the
// add-on runs (that is runtimeType).
export interface AddOnCategoryBlueprint {
  definition: string;
  railMenuKind: AddOnRailMenuKind;
}

export const ADDON_CATEGORY_BLUEPRINT: Record<AddOnCategory, AddOnCategoryBlueprint> = {
  agent: {
    definition: "An agent (model + harness) you open into as a first-class destination.",
    railMenuKind: "harness",
  },
  memory: {
    definition: "A memory provider that fills the memory-system slot.",
    railMenuKind: "memory",
  },
  channel: {
    definition: "A communication channel integration (desktop, telegram, voice, mobile).",
    railMenuKind: "tools",
  },
  security: {
    definition: "A security or audit capability.",
    railMenuKind: "tools",
  },
  knowledge: {
    definition: "A knowledge base or retrieval source.",
    railMenuKind: "tools",
  },
  tool: {
    definition: "A discrete capability.",
    railMenuKind: "tools",
  },
  integration: {
    definition: "An integration with an external system.",
    railMenuKind: "tools",
  },
  orchestration: {
    definition: "Coordinates multiple agents.",
    railMenuKind: "tools",
  },
};

export const railMenuKindForCategory = (category: AddOnCategory): AddOnRailMenuKind =>
  ADDON_CATEGORY_BLUEPRINT[category].railMenuKind;

// ---- Runtime type blueprint -----------------------------------------------------
// runtimeType = *how an add-on runs*. It is orthogonal to category (*what an
// add-on is*): a memory add-on may run behind the agent-delegation interface
// (R-Awareness), just as an agent may run as an embedded module (OpenCode).
// runtimeType never decides the rail destination.
export interface AddOnRuntimeTypeBlueprint {
  definition: string;
}

export const ADDON_RUNTIME_TYPE_BLUEPRINT: Record<AddOnRuntimeType, AddOnRuntimeTypeBlueprint> = {
  "ui-module": {
    definition: "A panel that runs inside the shell's own UI.",
  },
  "embedded-module": {
    definition: "An embedded workspace or dashboard hosted by the shell.",
  },
  "local-service": {
    definition: "A local process or service the host mediates.",
  },
  "agent-addon": {
    definition: "An add-on the host delegates to through the agent-delegation interface.",
  },
  "channel-addon": {
    definition: "A communication channel integration.",
  },
};
