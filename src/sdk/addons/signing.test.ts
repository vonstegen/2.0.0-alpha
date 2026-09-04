// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md
// CP-7.5.1 (Manifest Signing). Targeted tests for the ed25519 manifest
// signature contract: canonical-JSON body (recursively sorted object keys,
// no whitespace, `manifestSignature` field excluded) over the manifest, with
// the verifier requiring a valid signature whenever the manifest's
// provenance.verificationState is "verified".

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AddOnManifest } from "../../core/contracts";
import {
  canonicalizeManifestBody,
  signManifest,
  validateAddOnManifest,
  verifyManifestSignature,
} from "./validation";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_JWK = JSON.stringify(publicKey.export({ format: "jwk" }));

const baseManifest = (overrides: Partial<AddOnManifest> = {}): AddOnManifest => ({
  id: "addon.signing-test",
  name: "Signing Test",
  version: "0.1.0",
  publisher: "resonantos-testing",
  author: "Resonant Alpha",
  category: "tool",
  description: "Signing smoke test add-on.",
  runtimeType: "local-service",
  surfaces: [
    {
      id: "main",
      label: "Main",
      description: "Main surface.",
      type: "page",
    },
  ],
  requestedCapabilities: [
    { capability: "network", granted: false, scope: "shared", revocationBehavior: "hard-stop" },
  ],
  provenance: {
    tier: "curated-signed",
    verificationState: "verified",
    signed: true,
    signer: "ResonantOS test catalog",
  },
  runtimeIsolation: {
    boundary: "host-mediated-service",
    supportsDegradedMode: false,
    requiresReviewedGrant: false,
  },
  providerRequirements: {
    sharedProfiles: [],
    supportsPrivateCredentials: false,
  },
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false,
  },
  health: { strategy: "ready" },
  installHooks: {},
  sdkVersion: "^2.0.x",
  compatibility: { shellVersion: "^2.0.0-beta.1", platforms: ["darwin"] },
  ...overrides,
});

describe("add-on manifest signing (CP-7.5.1)", () => {
  it("accepts a verified manifest whose ed25519 signature verifies", () => {
    const manifest = baseManifest();
    const signature = signManifest(manifest, privateKey);
    const signed = {
      ...manifest,
      manifestSignature: {
        algorithm: "ed25519",
        publicKey: PUBLIC_KEY_JWK,
        signature,
      },
    };
    const result = validateAddOnManifest(signed);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === "manifest-signature-missing")).toBe(false);
    expect(result.issues.some((i) => i.code === "manifest-signature-invalid")).toBe(false);
  });

  it("rejects a verified manifest whose body was tampered with after signing", () => {
    const manifest = baseManifest();
    const signature = signManifest(manifest, privateKey);
    const tampered = {
      ...manifest,
      name: "Tampered",
      manifestSignature: {
        algorithm: "ed25519",
        publicKey: PUBLIC_KEY_JWK,
        signature,
      },
    };
    const result = validateAddOnManifest(tampered);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "manifest-signature-invalid")).toBe(true);
  });

  it("rejects a verified manifest that omits manifestSignature entirely", () => {
    const result = validateAddOnManifest(baseManifest());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "manifest-signature-missing")).toBe(true);
  });

  it("does not require a signature when provenance.verificationState is unverified", () => {
    const unverified = baseManifest({
      provenance: {
        tier: "sideloaded-unverified",
        verificationState: "unverified",
        signed: false,
      },
    });
    const result = validateAddOnManifest(unverified);
    expect(result.issues.some((i) => i.code === "manifest-signature-missing")).toBe(false);
    expect(result.issues.some((i) => i.code === "manifest-signature-invalid")).toBe(false);
  });

  it("canonicalizeManifestBody sorts keys recursively and strips manifestSignature", () => {
    const body = {
      b: 1,
      a: { d: 4, c: { z: 26, a: 1 } },
      manifestSignature: { algorithm: "ed25519", publicKey: "x", signature: "y" },
    };
    const out = canonicalizeManifestBody(body);
    expect(out).toBe(JSON.stringify({ a: { c: { a: 1, z: 26 }, d: 4 }, b: 1 }));
  });

  it("verifyManifestSignature returns true for a valid signature and false for tampered bytes", () => {
    const manifest = baseManifest();
    const signature = signManifest(manifest, privateKey);
    const sig = {
      algorithm: "ed25519",
      publicKey: PUBLIC_KEY_JWK,
      signature,
    };
    expect(verifyManifestSignature(manifest, sig)).toBe(true);
    const tampered = { ...manifest, version: "9.9.9" };
    expect(verifyManifestSignature(tampered, sig)).toBe(false);
    expect(
      verifyManifestSignature(manifest, { algorithm: "ed25519", publicKey: "", signature }),
    ).toBe(false);
    expect(
      verifyManifestSignature(manifest, { algorithm: "rsa", publicKey: PUBLIC_KEY_JWK, signature }),
    ).toBe(false);
  });
});
