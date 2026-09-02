// Intent citation: docs/architecture/ADR-002-modular-codebase.md
// Intent citation: docs/architecture/ADR-006-addon-runtime-sdk.md

import type { Dispatch, SetStateAction } from "react";
import type {
  AddOnHookDefinition,
  AddOnInstallation,
  AddOnInstallAuditRecord,
  AddOnManifest,
  AddOnScriptDefinition,
  CapabilityGrant,
  LogicianExecutionArtifact,
  ResonantShellState,
} from "../../core/contracts";
import { executeLogicianHook, executeLogicianScript } from "../../core/logician";
import { applyProviderCredentialStatuses, hydrateState, loadProviderCredentialStatuses, sideloadManifest } from "../../core/runtime";
import { diffAddOnManifest } from "../../../packages/addon-sdk-testing/src/permission-diff.ts";

type SideloadControllerInput = {
  sideloadPath: string;
  bundled: AddOnManifest[];
  sideloaded: AddOnManifest[];
  setReadyState: (state: ResonantShellState, nextSideloaded: AddOnManifest[]) => void;
  setSelectedAddonId: Dispatch<SetStateAction<string>>;
  setSideloadPath: Dispatch<SetStateAction<string>>;
  setErrorState: (message: string) => void;
  errorMessageOf: (error: unknown, fallback: string) => string;
  /**
   * CP-7.5.4 / §7.5.5 (ADR-039 audit-ledger, deferred piece). Called
   * once per human-approval decision (approve / deny / plain install)
   * so the host can append an `AddOnInstallAuditRecord` to the
   * in-memory ledger. The controller supplies the outcome + gate
   * metadata; the host owns the ledger slice and persistence.
   */
  recordAddonInstallAudit?: (record: Omit<AddOnInstallAuditRecord, "id" | "createdAt">) => void;
  /**
   * CP-7.5.4 (Cross-manifest id-collision detection). When true, the
   * install path allows the new manifest to shadow an existing
   * `id@publisher` collision in the bundled or sideloaded catalog. When
   * false (the default), a collision throws an `AddOnRegistryIdCollision`
   * error and the install is rejected. The prompt UI is responsible for
   * setting this to true only after a human-approved confirmation
   * (per ADR-039).
   */
  forceOverride?: boolean;
};

/**
 * CP-7.5.4 (Cross-manifest id-collision detection). Error thrown when
 * the new manifest's `id@publisher` pair matches an existing entry in
 * the bundled or sideloaded catalog and `forceOverride` is false. The
 * host UI surfaces this to the user (per ADR-039) and re-invokes the
 * install path with `forceOverride: true` only after the user
 * confirms that the existing entry may be shadowed.
 */
export class AddOnRegistryIdCollisionError extends Error {
  constructor(
    message: string,
    public readonly collidingAddonKey: string,
    public readonly existingName: string,
    public readonly existingVersion: string,
    public readonly catalog: "bundled" | "sideloaded",
  ) {
    super(message);
    this.name = "AddOnRegistryIdCollisionError";
  }
}
/**
 * CP-7.5.5 (permission-diff wiring). Error thrown when the new manifest's
 * capability set differs from the previously-installed set in a way that
 * requires human approval (add / widen / weaken / revocation-strengthen /
 * scope-narrow-then-allow). The host UI is responsible for surfacing the
 * hard-change list to the user per ADR-039 and re-invoking the install
 * path with `forceOverride: true` after confirmation.
 */
export class AddOnPermissionEscalationRequired extends Error {
  constructor(
    message: string,
    public readonly hardChanges: Array<{ path: string; kind: string }>,
  ) {
    super(message);
    this.name = "AddOnPermissionEscalationRequired";
  }
}

/**
 * CP-7.5.5 (permission-diff wiring). Reconstructs a synthetic "prior"
 * manifest from the previously-installed granted capabilities and diffs
 * it against the new manifest using the canonical `diffAddOnManifest`.
 *
 * The synthetic prior carries only the capability set (everything else
 * stays empty / undefined) because `AddOnInstallation` does not
 * preserve the full prior manifest — only the granted capabilities.
 * The prompt's diff domain is `requestedCapabilities`; identity,
 * version, isolation, runtime-type changes are surfaced as soft
 * changes (auto-accepted, logged) for now. Identity changes
 * (`identityChanged: true`) are treated as fresh installs and short-
 * circuit through.
 *
 * Throws `AddOnPermissionEscalationRequired` when the diff surfaces
 * any hard changes AND `forceOverride` is false. With `forceOverride:
 * true`, the gate is bypassed (the host UI's human-approved prompt
 * has already happened).
 */
export const applyPermissionDiffGate = (
  priorGrantedCapabilities: CapabilityGrant[],
  nextManifest: AddOnManifest,
  options: { forceOverride?: boolean } = {},
): void => {
  // Build the synthetic prior manifest with only the granted capability
  // set. Other fields are left blank — the diff falls back to comparing
  // capability sets alone.
  const syntheticPrior: AddOnManifest = {
    id: nextManifest.id,
    name: "",
    version: "",
    publisher: nextManifest.publisher,
    author: "",
    category: "tool",
    description: "",
    runtimeType: nextManifest.runtimeType,
    surfaces: [],
    requestedCapabilities: priorGrantedCapabilities,
    providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
    archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
    health: { strategy: "ready" },
    installHooks: {},
    sdkVersion: "^0.0.0",
    compatibility: { shellVersion: "0.0.0", platforms: [] },
  } as unknown as AddOnManifest;
  const delta = diffAddOnManifest(syntheticPrior, nextManifest);
  if (delta.identityChanged) {
    // Identity drift (publisher, id) — treat as a fresh install. No diff
    // gate; the install path will create a new installation record.
    return;
  }
  if (delta.hardChanges.length === 0) {
    return; // soft changes only (or no changes) — auto-accept.
  }
  if (options.forceOverride) {
    return; // human-approved prompt path; the host UI set the flag.
  }
  const summary = delta.hardChanges
    .map((c) => `${c.path}: ${c.kind}`)
    .join("; ");
  throw new AddOnPermissionEscalationRequired(
    `Install rejected: manifest "${nextManifest.id}@${nextManifest.publisher}" introduces ${delta.hardChanges.length} hard change(s) (${summary}). Pass forceOverride=true (after a human-approved confirmation per ADR-039) to accept.`,
    delta.hardChanges.map((c) => ({ path: c.path, kind: c.kind, capability: c.detail?.capability })),
  );
};

export const executeSideloadManifest = async ({
  sideloadPath,
  bundled,
  sideloaded,
  setReadyState,
  setSelectedAddonId,
  setSideloadPath,
  setErrorState,
  errorMessageOf,
  recordAddonInstallAudit,
  forceOverride = false,
}: SideloadControllerInput): Promise<void> => {
  if (!sideloadPath.trim()) {
    return;
  }

  try {
    const manifest = await sideloadManifest(sideloadPath.trim());

    // CP-7.5.4 (Cross-manifest id-collision detection). The new manifest
    // collides if its `id@publisher` pair is already in the bundled set
    // or in the existing sideloaded set. Without `--force-override` (the
    // prompt UI's human-approved confirmation per ADR-039), the install is
    // rejected and the user is asked to pick a different manifest path.
    const newKey = `${manifest.id}@${manifest.publisher}`;
    const collidesWith = (existing: AddOnManifest[]) =>
      existing.find((m) => `${m.id}@${m.publisher}` === newKey);
    const bundledCollision = collidesWith(bundled);
    const sideloadedCollision = collidesWith(sideloaded);
    const hasCollision = bundledCollision !== undefined || sideloadedCollision !== undefined;
    if (hasCollision && !forceOverride) {
      const existing = bundledCollision ?? sideloadedCollision;
      const catalog: "bundled" | "sideloaded" = bundledCollision
        ? "bundled"
        : "sideloaded";
      throw new AddOnRegistryIdCollisionError(
        `Install rejected: manifest "${newKey}" collides with an existing entry in the ${
          bundledCollision ? "bundled catalog" : "sideloaded catalog"
        }. Pass forceOverride=true (after a human-approved confirmation) to shadow the existing entry.`,
        newKey,
        existing?.name ?? newKey,
        existing?.version ?? "unknown",
        catalog,
      );
    }

    // CP-7.5.5 (permission-diff wiring). Reconstruct the prior granted
    // capability set from the existing sideloaded or bundled entry with
    // the same id@publisher, then diff against the new manifest. A diff
    // with hard changes (add / widen / weaken / trust-change) is
    // rejected unless forceOverride is set (the host UI's human-approved
    // prompt path per ADR-039).
    const priorEntry = bundledCollision ?? sideloadedCollision;
    const priorGranted: CapabilityGrant[] =
      priorEntry?.requestedCapabilities?.map((grant) => ({ ...grant, granted: false })) ?? [];
    applyPermissionDiffGate(priorGranted, manifest, { forceOverride });

    // CP-7.5.4 / §7.5.5 (ADR-039 audit-ledger, deferred piece). Record
    // the approved / plain-install outcome. A denied outcome is recorded
    // by the host UI's `onCancel`; the controller only reaches this point
    // on success, where forceOverride means the human already approved
    // the collision or the permission-escalation gate.
    recordAddonInstallAudit?.({
      addonKey: newKey,
      outcome: hasCollision
        ? "collision-shadow-approved"
        : forceOverride
          ? "permission-escalation-approved"
          : "installed",
      hardChangeCount: 0,
      hardChangePaths: [],
      existingName: hasCollision ? (bundledCollision ?? sideloadedCollision)?.name : undefined,
      existingVersion: hasCollision ? (bundledCollision ?? sideloadedCollision)?.version : undefined,
      catalog: hasCollision ? (bundledCollision ? "bundled" : "sideloaded") : undefined,
      incomingPath: sideloadPath,
    });

    const nextSideloaded = [...sideloaded, manifest].filter(
      (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
    );
    const state = await hydrateState(bundled, nextSideloaded);
    const credentialStatuses = await loadProviderCredentialStatuses();
    const nextState = applyProviderCredentialStatuses(state, credentialStatuses);
    setReadyState(nextState, nextSideloaded);
    setSelectedAddonId(manifest.id);
    setSideloadPath("");
  } catch (error) {
    // CP-7.5.4 + §7.5.5 (deferred UI per ADR-039). Typed errors
    // must escape the controller so the host UI's
    // `handleSideload` catch can intercept them and surface the
    // appropriate prompt. Only generic / unknown errors fall
    // through to the flat error banner.
    if (
      error instanceof AddOnPermissionEscalationRequired ||
      error instanceof AddOnRegistryIdCollisionError
    ) {
      throw error;
    }
    setErrorState(errorMessageOf(error, "Failed to sideload manifest."));
  }
};

export const toggleAddonInstallation = (
  manifest: AddOnManifest,
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): void => {
  updateRuntimeState((draft) => {
    const installation = draft.installations[manifest.id];
    if (!installation) {
      return draft;
    }
    if (!installation.installed) {
      installation.installed = true;
      installation.enabled = true;
      installation.status = "enabled";
      installation.notes = [`Installed from the ${installation.source} catalog.`];
    } else if (installation.enabled) {
      installation.enabled = false;
      installation.status = "disabled";
      installation.notes = ["Disabled without uninstalling the add-on."];
    } else {
      installation.enabled = true;
      installation.status = "enabled";
      installation.notes = ["Re-enabled after prior disable."];
    }
    if (manifest.id === "addon.hermes") {
      const hermesChannel = draft.channels.find((channel) => channel.id === "desktop-hermes");
      if (hermesChannel) {
        hermesChannel.enabled = installation.enabled;
      }
    }
    return draft;
  });
};

export const toggleAddonCapabilityGrant = (
  manifestId: string,
  capability: CapabilityGrant["capability"],
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): void => {
  updateRuntimeState((draft) => {
    const installation = draft.installations[manifestId] as AddOnInstallation | undefined;
    if (!installation) {
      return draft;
    }
    const target = installation?.grantedCapabilities.find((grant) => grant.capability === capability);
    if (target) {
      target.granted = !target.granted;
      installation.status = installation.enabled ? "enabled" : installation.installed ? "installed" : "available";
    }
    return draft;
  });
};

export const grantAddonCapabilities = (
  manifestId: string,
  capabilities: CapabilityGrant["capability"][],
  requestedCapabilities: CapabilityGrant[],
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): void => {
  updateRuntimeState((draft) => {
    const installation = draft.installations[manifestId] as AddOnInstallation | undefined;
    if (!installation) {
      return draft;
    }
    installation.installed = true;
    installation.enabled = true;
    const existingGrants = new Map(installation.grantedCapabilities.map((grant) => [grant.capability, grant]));
    const missingRequestedGrants = requestedCapabilities.filter((grant) => !existingGrants.has(grant.capability));
    installation.grantedCapabilities = [...installation.grantedCapabilities, ...missingRequestedGrants].map((grant) =>
      capabilities.includes(grant.capability) ? { ...grant, granted: true } : grant,
    );
    installation.status = "enabled";
    installation.notes = [`Installed, enabled, and granted ${capabilities.join(", ")} through reviewed setup.`];
    if (manifestId === "addon.hermes") {
      const hermesChannel = draft.channels.find((channel) => channel.id === "desktop-hermes");
      if (hermesChannel) {
        hermesChannel.enabled = true;
      }
    }
    return draft;
  });
};

export const updateAddonConfig = (
  manifestId: string,
  config: Record<string, unknown>,
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): void => {
  updateRuntimeState((draft) => {
    const installation = draft.installations[manifestId];
    if (!installation) {
      return draft;
    }
    installation.config = {
      ...(installation.config ?? {}),
      ...config,
    };
    return draft;
  });
};

const appendVerificationArtifact = (
  artifact: LogicianExecutionArtifact,
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): void => {
  updateRuntimeState((draft) => {
    const installation = draft.installations[artifact.addonId] as AddOnInstallation | undefined;
    if (!installation) {
      return draft;
    }
    const artifacts = [artifact, ...(installation.verificationArtifacts ?? [])].slice(0, 20);
    installation.verificationArtifacts = artifacts;
    if (artifact.status === "failed" || artifact.status === "blocked") {
      installation.status = installation.enabled ? "degraded" : installation.status;
      installation.notes = [`Latest Logician check ${artifact.status}: ${artifact.summary}`];
    } else if (artifact.status === "passed" && installation.enabled) {
      installation.status = "enabled";
      installation.notes = [`Latest Logician check passed: ${artifact.summary}`];
    } else if (artifact.status === "degraded" && installation.enabled) {
      installation.status = "degraded";
      installation.notes = [`Latest Logician check degraded: ${artifact.summary}`];
    }
    return draft;
  });
};

export const runAddonLogicianScript = async (
  manifest: AddOnManifest,
  installation: AddOnInstallation,
  script: AddOnScriptDefinition,
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): Promise<LogicianExecutionArtifact> => {
  const artifact = await executeLogicianScript({
    manifest,
    installation,
    script,
    humanInitiated: true,
  });
  appendVerificationArtifact(artifact, updateRuntimeState);
  return artifact;
};

export const runAddonLogicianHook = async (
  manifest: AddOnManifest,
  installation: AddOnInstallation,
  hook: AddOnHookDefinition,
  updateRuntimeState: (updater: (current: ResonantShellState) => ResonantShellState) => void,
): Promise<LogicianExecutionArtifact> => {
  const artifact = await executeLogicianHook({
    manifest,
    installation,
    hook,
    humanInitiated: true,
  });
  appendVerificationArtifact(artifact, updateRuntimeState);
  return artifact;
};
