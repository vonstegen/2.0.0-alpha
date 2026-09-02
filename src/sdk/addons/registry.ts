// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md
// Intent citation: docs/architecture/ADR-023-addon-repository-registry-model.md

import type {
  AddOnArtifactReference,
  AddOnInstallation,
  AddOnManifest,
  AddOnProvenanceTier,
  AddOnRegistryEntry,
  AddOnRegistryReviewState,
  AddOnRegistrySource,
  InstallationStatus,
  ManifestVerificationState,
} from "../../core/contracts";

export interface AddOnRegistryEntryOptions {
  registrySource: AddOnRegistrySource;
  installation?: AddOnInstallation;
  manifestRef?: Partial<AddOnArtifactReference>;
  releaseArtifact?: AddOnArtifactReference;
  sourceRepositoryUrl?: string;
  reviewState?: AddOnRegistryReviewState;
  notes?: string[];
}

export interface AddOnRegistryBuildInput {
  bundled: AddOnManifest[];
  sideloaded: AddOnManifest[];
  installations: Record<string, AddOnInstallation>;
}

export interface AddOnRegistrySnapshot {
  entries: AddOnRegistryEntry[];
  byId: Record<string, AddOnRegistryEntry>;
  /**
   * CP-7.5.4 (Cross-manifest id-collision detection). Every collision
   * found across `bundled` + `sideloaded` manifests (keyed by the
   * worker-key `id@publisher`). A non-empty list means the snapshot
   * includes overlapping identities — callers (install path, snapshot
   * consumer) must inspect this before treating the snapshot as
   * authoritative. The snapshot itself does NOT resolve collisions;
   * that is the install path's job, with the `forceOverride` opt-out.
   */
  idCollisions: AddOnRegistryIdCollision[];
}

/**
 * CP-7.5.4 (Cross-manifest id-collision detection). The `id@publisher`
 * pair (the worker's identity key, per ADR-018 + `buildWorkerKey`) is
 * the collision domain — two manifests with the same `id` but different
 * publishers are NOT a collision (each gets its own worker); two
 * manifests with the same `id@publisher` are a collision (one will
 * shadow the other in the host's worker registry).
 */
export interface AddOnRegistryIdCollision {
  id: string;
  publisher: string;
  collisions: Array<{
    addonId: string;
    publisher: string;
    manifestPath: string;
    source: AddOnRegistrySource;
  }>;
}

const sourceDefaults = (
  manifest: AddOnManifest,
  registrySource: AddOnRegistrySource,
): {
  provenanceTier: AddOnProvenanceTier;
  verificationState: ManifestVerificationState;
  reviewState: AddOnRegistryReviewState;
} => {
  if (registrySource === "sideloaded-local" || registrySource === "developer-local") {
    return {
      provenanceTier: "sideloaded-unverified",
      verificationState: "unverified",
      reviewState: "unreviewed",
    };
  }

  // P1-e: a bundled-catalog manifest with NO provenance must NOT be trusted by
  // omission. Previously an absent provenance silently defaulted to
  // curated-signed/verified/reviewed. Instead, mark a manifest lacking any
  // provenance metadata as dev/internal/unreviewed (sideloaded-unverified /
  // unverified / unreviewed) so missing provenance is visible, never crashing.
  if (!manifest.provenance) {
    return {
      provenanceTier: "sideloaded-unverified",
      verificationState: "unverified",
      reviewState: "unreviewed",
    };
  }

  return {
    provenanceTier: manifest.provenance.tier ?? "curated-signed",
    verificationState: manifest.provenance.verificationState ?? "verified",
    reviewState: "approved",
  };
};

const defaultManifestRef = (manifest: AddOnManifest, registrySource: AddOnRegistrySource): AddOnArtifactReference => ({
  type: "manifest",
  label: `${manifest.name} manifest`,
  path: registrySource === "bundled-catalog" ? "/addons/index.json" : undefined,
  signatureRef: manifest.provenance?.signatureRef,
});

const installStateFromInstallation = (installation: AddOnInstallation | undefined): {
  installState: InstallationStatus;
  installed: boolean;
  enabled: boolean;
} => ({
  installState: installation?.status ?? "available",
  installed: installation?.installed ?? false,
  enabled: installation?.enabled ?? false,
});

/**
 * CP-7.5.4 (Cross-manifest id-collision detection). Walks the bundled +
 * sideloaded manifest sets and emits one `AddOnRegistryIdCollision`
 * per `id@publisher` pair seen two or more times. The first manifest
 * seen wins ("first-wins"); later manifests collide against the first.
 *
 * Note: same `id` with different publishers is NOT a collision (each
 * gets its own worker). The collision domain is `id@publisher` (the
 * worker identity key per `buildWorkerKey` in
 * `packages/addon-sdk-testing/src/isolation.ts`).
 */
export const detectRegistryIdCollisions = (
  bundled: AddOnManifest[],
  sideloaded: AddOnManifest[],
): AddOnRegistryIdCollision[] => {
  type Bucket = { manifest: AddOnManifest; source: AddOnRegistrySource; manifestPath: string };
  const byWorkerKey = new Map<string, Bucket[]>();
  const register = (manifest: AddOnManifest, source: AddOnRegistrySource, manifestPath: string) => {
    const key = `${manifest.id}@${manifest.publisher}`;
    const bucket = byWorkerKey.get(key) ?? [];
    bucket.push({ manifest, source, manifestPath });
    byWorkerKey.set(key, bucket);
  };
  // Bundled first (first-wins = bundled wins over sideloaded).
  for (const m of bundled) register(m, "bundled-catalog", "/addons/index.json");
  for (const m of sideloaded) register(m, "sideloaded-local", "(sideloaded)");
  const collisions: AddOnRegistryIdCollision[] = [];
  for (const [key, bucket] of byWorkerKey) {
    if (bucket.length < 2) continue;
    const [first, ...rest] = bucket;
    const at = key.indexOf("@");
    const id = key.slice(0, at);
    const publisher = key.slice(at + 1);
    collisions.push({
      id,
      publisher,
      collisions: [
        { addonId: first.manifest.id, publisher: first.manifest.publisher, manifestPath: first.manifestPath, source: first.source },
        ...rest.map((entry) => ({
          addonId: entry.manifest.id,
          publisher: entry.manifest.publisher,
          manifestPath: entry.manifestPath,
          source: entry.source,
        })),
      ],
    });
  }
  return collisions;
};

export const createAddOnRegistryEntry = (
  manifest: AddOnManifest,
  options: AddOnRegistryEntryOptions,
): AddOnRegistryEntry => {
  const defaults = sourceDefaults(manifest, options.registrySource);
  const installState = installStateFromInstallation(options.installation);
  const manifestRef = {
    ...defaultManifestRef(manifest, options.registrySource),
    ...options.manifestRef,
    type: "manifest" as const,
  };

  return {
    addonId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    category: manifest.category,
    description: manifest.description,
    runtimeType: manifest.runtimeType,
    registrySource: options.registrySource,
    provenanceTier: options.installation?.provenanceTier ?? defaults.provenanceTier,
    verificationState: options.installation?.verificationState ?? defaults.verificationState,
    reviewState: options.reviewState ?? defaults.reviewState,
    manifestRef,
    releaseArtifact: options.releaseArtifact,
    sourceRepositoryUrl: options.sourceRepositoryUrl,
    compatibility: manifest.compatibility,
    requestedCapabilities: manifest.requestedCapabilities.map((capability) => ({ ...capability })),
    recommendedGrantPresetIds:
      options.installation?.recommendedGrantPresetIds ?? (manifest.grantPresets ?? []).map((preset) => preset.id),
    ...installState,
    notes: options.notes ?? options.installation?.notes ?? ["Catalog entry is not installed yet."],
  };
};

export const createAddOnRegistrySnapshot = ({
  bundled,
  sideloaded,
  installations,
}: AddOnRegistryBuildInput): AddOnRegistrySnapshot => {
  // CP-7.5.4 (Cross-manifest id-collision detection). Surface any
  // id@publisher collision across the bundled + sideloaded sets. The
  // snapshot itself doesn't resolve the collision — the install path
  // does, with the `forceOverride` opt-out.
  const idCollisions = detectRegistryIdCollisions(bundled, sideloaded);
  const entries = [
    ...bundled.map((manifest) =>
      createAddOnRegistryEntry(manifest, {
        registrySource: "bundled-catalog",
        installation: installations[manifest.id],
      }),
    ),
    ...sideloaded.map((manifest) =>
      createAddOnRegistryEntry(manifest, {
        registrySource: "sideloaded-local",
        installation: installations[manifest.id],
      }),
    ),
  ];

  return {
    entries,
    byId: Object.fromEntries(entries.map((entry) => [entry.addonId, entry])),
    idCollisions,
  };
};
