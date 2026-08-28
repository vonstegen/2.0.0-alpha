// Intent citation: docs/architecture/ADR-051-ros-architecture-blueprint.md
//
// Host mirror of src/sdk/addons/architecture.ts for the JS-only bridge
// runtime. The TypeScript module is authoritative; this plain-`.mjs`
// copy exists so the G0-ROS workbench (a read-only dev panel) can
// surface the blueprint without a tsx loader. When the two diverge,
// architecture.ts wins — see ADR-051 §"Single source of truth".
//
// The G0 harness tool catalog itself is intentionally NOT duplicated
// here: `createRosHarnessMenu` in addon-delegation-service.mjs already
// mirrors it and is the bridge's live resolver.

export const ROS_ARCHITECTURE_VOCABULARY = Object.freeze({
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
});

export const ROS_SCOPING = Object.freeze({
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
});

export const ROS_FUSED_CORE = Object.freeze({
  // Shell-owned, non-removable sections (CoreSectionId).
  sections: Object.freeze([
    "overview",
    "strategist",
    "archive",
    "delegation",
    "compute",
    "addons",
    "settings",
  ]),
  // The shell's own integrated harness. Display name is user-owned via
  // personalization; the role is fixed and non-removable.
  integratedHarness: "the-shell-agent",
  // The shell's self-structure memory (GoalMemoryRefKind "system-memory").
  systemMemoryKind: "system-memory",
  // The crash-recovery return point (ResonantShellState.recoverySession).
  recoveryField: "recoverySession",
});

export const GROUND_ZERO_INVARIANT =
  "The fused core is self-sufficient: strip away every add-on and external provider, and the remaining shell + integrated harness + system memory + recovery restores to a known-good state. Ground-0 = base = fallback.";

export const ADDON_CATEGORY_BLUEPRINT = Object.freeze({
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
});

export const ADDON_RUNTIME_TYPE_BLUEPRINT = Object.freeze({
  "ui-module": { definition: "A panel that runs inside the shell's own UI." },
  "embedded-module": { definition: "An embedded workspace or dashboard hosted by the shell." },
  "local-service": { definition: "A local process or service the host mediates." },
  "agent-addon": { definition: "An add-on the host delegates to through the agent-delegation interface." },
  "channel-addon": { definition: "A communication channel integration." },
});

export function railMenuKindForCategory(category) {
  const blueprint = ADDON_CATEGORY_BLUEPRINT[category];
  return blueprint ? blueprint.railMenuKind : "tools";
}

export function rosArchitectureSnapshot() {
  return {
    vocabulary: ROS_ARCHITECTURE_VOCABULARY,
    scoping: ROS_SCOPING,
    fusedCore: ROS_FUSED_CORE,
    groundZeroInvariant: GROUND_ZERO_INVARIANT,
    categories: ADDON_CATEGORY_BLUEPRINT,
    runtimeTypes: ADDON_RUNTIME_TYPE_BLUEPRINT,
  };
}
