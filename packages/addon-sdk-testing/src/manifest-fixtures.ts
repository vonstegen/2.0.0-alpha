// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md#3-boundary-rules
// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md#6-capability-map
//
// Synthetic external-agent-runtime manifest fixture. The §3 trigger
// for ADR-040 is the conjunction of `providers` + `agent-delegation`
// in `requestedCapabilities`; this fixture exercises that conjunction
// so F1–F10 have a consistent target.
//
// This fixture mirrors the canonical local-service add-on shape from
// `examples/addons/addon.recursive-mas.json` (ADR-040 §8 names that addon as
// already satisfying this ADR). It is *not* a copy of recursive-mas:
// recursive-mas is unverified-tier and out-of-tree; this fixture lives
// in-tree, is verified, and declares a minimal tool surface that F1–F10
// can target without depending on recursive-mas specifics.

import type {
  AddOnManifest,
  AddOnToolDefinition,
  Capability,
  CapabilityGrant,
  CapabilityScope,
} from "../../../src/core/contracts.ts";

import { signManifest, validateAddOnManifest } from "../../../src/sdk/addons/validation.ts";

export type ExternalAgentRuntimeManifest = AddOnManifest & {
  /** Caller-attributed token id used by the mock host in F-cases. */
  callerId: string;
};

/**
 * The minimal tool set ADR-040 §3 Rule 3 requires an external agent
 * runtime to declare. Two declared tools:
 *
 *   - `send_model_request` — exercises F1, F2, F8, F9, F10 (any
 *     model-routing code path).
 *   - `run_task` — exercises F7 (requiresHumanApproval), F4
 *     (capability escalation), F5 (undeclared tool), F3 (workspace
 *     escape via payload).
 *
 * The two names are also the names the F-cases probe the manifest for.
 */
const MOCK_EXTERNAL_AGENT_TOOLS: AddOnToolDefinition[] = [
  {
    name: "send_model_request",
    description: "Send a model request through the host's provider-fabric adapter using a routed handle.",
    requiredCapabilities: ["providers", "network"],
    inputSchema: {
      type: "object",
      properties: {
        routingDecisionId: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["routingDecisionId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { model: { type: "string" }, content: { type: "string" } },
      required: ["model", "content"],
      additionalProperties: false,
    },
    audit: {
      logRequest: true,
      logResult: true,
      artifactTypes: ["log"],
    },
  },
  {
    name: "run_task",
    description: "Run a delegated task within the runtime's task workspace.",
    requiredCapabilities: ["providers", "agent-delegation", "filesystem"],
    inputSchema: {
      type: "object",
      properties: {
        mission: { type: "string" },
        path: { type: "string" },
      },
      required: ["mission", "path"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        artifacts: { type: "array", items: { type: "string" } },
        surface: { type: "string" },
      },
      required: ["artifacts"],
      additionalProperties: false,
    },
    audit: {
      logRequest: true,
      logResult: true,
      artifactTypes: ["summary"],
    },
    requiresHumanApproval: true,
  },
];

const MOCK_EXTERNAL_AGENT_CAPABILITY_GRANTS: CapabilityGrant[] = [
  { capability: "providers", granted: false, scope: "shared", revocationBehavior: "hard-stop" },
  { capability: "agent-delegation", granted: false, scope: "workspace", revocationBehavior: "degrade" },
  { capability: "network", granted: false, scope: "self", revocationBehavior: "hard-stop" },
  { capability: "filesystem", granted: false, scope: "self", revocationBehavior: "hard-stop" },
  { capability: "archive-read", granted: false, scope: "workspace", revocationBehavior: "degrade" },
  { capability: "archive-intake-write", granted: false, scope: "intake-only", revocationBehavior: "degrade" },
  { capability: "notifications", granted: false, scope: "self", revocationBehavior: "degrade" },
];

const FIXTURE_ID = "addon.testing.external-agent-runtime";
const MOCK_CALLER_ID = "caller.testing-external-agent";

/**
 * Returns a fresh external-agent-runtime fixture. By default the
 * capability grants are *not* marked `granted: true`; tests use
 * the returned object to either flip individual grants to `true`
 * (simulating the host passing through the user-accepted grant
 * preset) or to invoke the mock host bridge unauthenticated.
 *
 * The fixture validates against `validateAddOnManifest` at module
 * load time; if shape drift occurs, the package fails to import.
 */
let validatedFixture: AddOnManifest | undefined;

function buildBase(): AddOnManifest {
  return {
  "agents": [
    {
      "displayName": "Testing External Agent",
      "id": "testing-external-agent",
      "trustTier": "external",
      "workspaceBehavior": "delegated"
    }
  ],
  "archiveIntegration": {
    "canRequestIngest": true,
    "canWriteKnowledgePages": false,
    "intakeWriteScopes": [
      "LivingArchive/INTAKE/testing-external-agent"
    ],
    "readScopes": [
      "LivingArchive/INTAKE/testing-external-agent"
    ]
  },
  "author": "Resonant Extension Framework Tests",
  "callerId": "caller.testing-external-agent",
  "category": "agent",
  "compatibility": {
    "platforms": [
      "darwin-arm64",
      "linux-x64"
    ],
    "shellVersion": "2.0.0-beta.1"
  },
  "delegation": {
    "acceptsTasks": true,
    "artifactReturnTypes": [
      "summary",
      "log"
    ],
    "defaultTargetRuntime": "external-agent",
    "notes": [
      "Synthetic external-agent-runtime test fixture; ADR-040 \u00a73 trigger."
    ],
    "requiresHumanApprovalBeforeExecution": true,
    "taskTypes": [
      "research",
      "design"
    ]
  },
  "description": "Synthetic external-agent-runtime manifest used by ADR-040 \u00a77 failure-mode tests.",
  "engineerSetup": {
    "allowedHostCommands": [
      "start",
      "stop",
      "reset"
    ],
    "auditLogRequired": true,
    "documentPath": "docs/testing/external-agent-setup.md",
    "expectedInputs": [
      "manifest",
      "routing decision"
    ],
    "expectedOutputs": [
      "task artifacts"
    ],
    "objective": "Bring up the testing external agent runtime against the mock host.",
    "requiredCapabilities": [
      "providers",
      "agent-delegation",
      "filesystem"
    ],
    "requiresHumanApprovalBeforeExecution": true
  },
  "grantPresets": [
    {
      "description": "Default granted set: providers (shared), agent-delegation (workspace), network (self), filesystem (self), archive-read (workspace), archive-intake-write (intake-only), notifications (self).",
      "grants": [
        {
          "capability": "providers",
          "granted": true,
          "revocationBehavior": "hard-stop",
          "scope": "shared"
        },
        {
          "capability": "agent-delegation",
          "granted": true,
          "revocationBehavior": "degrade",
          "scope": "workspace"
        },
        {
          "capability": "network",
          "granted": true,
          "revocationBehavior": "hard-stop",
          "scope": "self"
        },
        {
          "capability": "filesystem",
          "granted": true,
          "revocationBehavior": "hard-stop",
          "scope": "self"
        },
        {
          "capability": "archive-read",
          "granted": true,
          "revocationBehavior": "degrade",
          "scope": "workspace"
        },
        {
          "capability": "archive-intake-write",
          "granted": true,
          "revocationBehavior": "degrade",
          "scope": "intake-only"
        },
        {
          "capability": "notifications",
          "granted": true,
          "revocationBehavior": "degrade",
          "scope": "self"
        }
      ],
      "id": "testing-external-agent-default",
      "label": "Testing default external agent runtime"
    }
  ],
  "health": {
    "endpoint": "http://127.0.0.1:4891/healthz",
    "strategy": "external-agent-runtime-ready"
  },
  "id": "addon.testing.external-agent-runtime",
  "installHooks": {
    "onEnable": "enable-external-agent.sh",
    "onInstall": "install-external-agent.sh",
    "onUpgrade": "upgrade-external-agent.sh"
  },
  "name": "Testing External Agent Runtime",
  "provenance": {
    "signed": true,
    "signer": "Resonant Extension Framework Testing",
    "tier": "curated-signed",
    "verificationState": "verified"
  },
  "providerRequirements": {
    "allowExperimentalAuth": false,
    "preferredRuntimeKinds": [
      "local",
      "remote-user-owned"
    ],
    "recommendedFallbackModel": "deepseek-mini",
    "recommendedPrimaryModel": "deepseek-v4-pro",
    "sharedProfiles": [
      "resonant-deepseek-v4-pro"
    ],
    "supportsPrivateCredentials": false
  },
  "publisher": "resonantos-testing",
  "requestedCapabilities": [
    {
      "capability": "providers",
      "granted": false,
      "revocationBehavior": "hard-stop",
      "scope": "shared"
    },
    {
      "capability": "agent-delegation",
      "granted": false,
      "revocationBehavior": "degrade",
      "scope": "workspace"
    },
    {
      "capability": "network",
      "granted": false,
      "revocationBehavior": "hard-stop",
      "scope": "self"
    },
    {
      "capability": "filesystem",
      "granted": false,
      "revocationBehavior": "hard-stop",
      "scope": "self"
    },
    {
      "capability": "archive-read",
      "granted": false,
      "revocationBehavior": "degrade",
      "scope": "workspace"
    },
    {
      "capability": "archive-intake-write",
      "granted": false,
      "revocationBehavior": "degrade",
      "scope": "intake-only"
    },
    {
      "capability": "notifications",
      "granted": false,
      "revocationBehavior": "degrade",
      "scope": "self"
    }
  ],
  "runtimeIsolation": {
    "boundary": "host-mediated-service",
    "requiresReviewedGrant": true,
    "supportsDegradedMode": true
  },
  "runtimeType": "local-service",
  "sdkVersion": "^2.0.x",
  "service": {
    "entrypoint": "http://127.0.0.1:4891",
    "healthCommand": "GET /healthz",
    "protocol": "http-json",
    "shutdownCommand": "POST /shutdown",
    "visibleEntrypoint": "http://127.0.0.1:4891"
  },
  "surfaces": [
    {
      "description": "Track delegated agent-runtime tasks under test.",
      "id": "testing-external-agent-runs",
      "label": "Testing External Agent Runs",
      "type": "background-task-monitor"
    }
  ],
  "systemSlots": [],
  "tools": [
    {
      "audit": {
        "artifactTypes": [
          "log"
        ],
        "logRequest": true,
        "logResult": true
      },
      "description": "Send a model request through the host's provider-fabric adapter using a routed handle.",
      "inputSchema": {
        "additionalProperties": false,
        "properties": {
          "prompt": {
            "type": "string"
          },
          "routingDecisionId": {
            "type": "string"
          }
        },
        "required": [
          "routingDecisionId"
        ],
        "type": "object"
      },
      "name": "send_model_request",
      "outputSchema": {
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string"
          },
          "model": {
            "type": "string"
          }
        },
        "required": [
          "model",
          "content"
        ],
        "type": "object"
      },
      "requiredCapabilities": [
        "providers",
        "network"
      ]
    },
    {
      "audit": {
        "artifactTypes": [
          "summary"
        ],
        "logRequest": true,
        "logResult": true
      },
      "description": "Run a delegated task within the runtime's task workspace.",
      "inputSchema": {
        "additionalProperties": false,
        "properties": {
          "mission": {
            "type": "string"
          },
          "path": {
            "type": "string"
          }
        },
        "required": [
          "mission",
          "path"
        ],
        "type": "object"
      },
      "name": "run_task",
      "outputSchema": {
        "additionalProperties": false,
        "properties": {
          "artifacts": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "surface": {
            "type": "string"
          }
        },
        "required": [
          "artifacts"
        ],
        "type": "object"
      },
      "requiredCapabilities": [
        "providers",
        "agent-delegation",
        "filesystem"
      ],
      "requiresHumanApproval": true
    }
  ],
  "version": "0.1.0",
  "workflowBoundaries": [
    {
      "id": "testing-agent-task-boundary",
      "jobToBeDone": "Run delegated tasks under the \u00a73 boundary rules.",
      "label": "Testing External Agent Task Boundary",
      "nonGoals": [
        "Provider selection",
        "Credential storage",
        "Workspace escape"
      ],
      "owner": "addon-agent",
      "repeatability": "workflow-package",
      "userValue": "Allow the host to validate an external agent runtime against ADR-040 \u00a77."
    }
  ],
  "manifestSignature": {
    "algorithm": "ed25519",
    "publicKey": "{\"crv\":\"Ed25519\",\"x\":\"EsZYEa4u5S9MyBn5fiODyxmOnICG-8LuwoSDPFYwNhg\",\"kty\":\"OKP\"}",
    "signature": "3vFsrjaAnoApBaBlqV0i1SZGwuTs3QKBg3o8qfNIuxJW6FqItrAyGBcgFrV0pxvyk5XksY3XhLxjTqmkwbtqDw=="
  }
} as unknown as AddOnManifest;
}


/**
 * Returns the fixture base manifest. Tests should treat the returned
 * value as immutable; use `externalAgentRuntimeFixture()` for a fresh
 * copy each test.
 */
export function externalAgentRuntimeFixture(): ExternalAgentRuntimeManifest {
  if (!validatedFixture) {
    const candidate = buildBase();
    const validation = validateAddOnManifest(candidate);
    if (!validation.valid) {
      throw new Error(
        `externalAgentRuntimeFixture failed validation: ${JSON.stringify(validation.issues)}`,
      );
    }
    validatedFixture = candidate;
  }
  return { ...validatedFixture, callerId: MOCK_CALLER_ID } as ExternalAgentRuntimeManifest;
}

/**
 * Helpers that tests use to flip a single grant to `granted: true` on
 * a fresh fixture, simulating the user accepting a specific
 * `grantPreset` (or the host passing a single grant outside a preset).
 */
/**
 * Re-sign the manifest's `manifestSignature` block if the manifest declares
 * `provenance.verificationState === "verified"`. The bundled-test-signer key
 * is the same key used to sign the bundled manifests and the fixture's
 * baseline signature. Synchronous load via dynamic require to keep the
 * helpers themselves synchronous (test-friendly).
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

import { createPrivateKey } from "node:crypto";

interface BundledSigner {
  publicKey: string;
  privateKey: ReturnType<typeof createPrivateKey>;
}

let _cachedSigner: BundledSigner | undefined;
function loadBundledTestSigner(): BundledSigner {
  if (_cachedSigner) return _cachedSigner;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const keyPath = path.resolve(process.cwd(), "scripts/.bundled-test-signer.json");
  const { publicKey, privateKey: pem } = JSON.parse(fs.readFileSync(keyPath, "utf8")) as { publicKey: string; privateKey: string };
  _cachedSigner = { publicKey, privateKey: createPrivateKey(pem) };
  return _cachedSigner;
}

function resignIfVerified(manifest: AddOnManifest): AddOnManifest {
  if (!isRecord(manifest.provenance) || manifest.provenance.verificationState !== "verified") {
    return manifest;
  }
  if (!isRecord(manifest.manifestSignature)) {
    return manifest;
  }
  const signer = loadBundledTestSigner();
  const { manifestSignature: _drop, ...rest } = manifest;
  void _drop;
  const signature = signManifest(rest, signer.privateKey);
  return { ...rest, manifestSignature: { algorithm: "ed25519", publicKey: signer.publicKey, signature } };
}

export function withGranted(manifest: ExternalAgentRuntimeManifest, capability: Capability): ExternalAgentRuntimeManifest {
  const next: AddOnManifest = {
    ...manifest,
    requestedCapabilities: manifest.requestedCapabilities.map((g) =>
      g.capability === capability ? { ...g, granted: true } : g,
    ),
  };
  const signed = resignIfVerified(next);
  return { ...signed, callerId: manifest.callerId } as ExternalAgentRuntimeManifest;
}

export function withScope(manifest: ExternalAgentRuntimeManifest, capability: Capability, scope: CapabilityScope): ExternalAgentRuntimeManifest {
  const next: AddOnManifest = {
    ...manifest,
    requestedCapabilities: manifest.requestedCapabilities.map((g) =>
      g.capability === capability ? { ...g, scope } : g,
    ),
  };
  const signed = resignIfVerified(next);
  return { ...signed, callerId: manifest.callerId } as ExternalAgentRuntimeManifest;
}

export function withTool(manifest: ExternalAgentRuntimeManifest, tool: AddOnToolDefinition): ExternalAgentRuntimeManifest {
  const tools = manifest.tools ? [...manifest.tools, tool] : [tool];
  const next: AddOnManifest = { ...manifest, tools };
  const signed = resignIfVerified(next);
  return { ...signed, callerId: manifest.callerId } as ExternalAgentRuntimeManifest;
}

/** The fixture's mock caller id; exported so F-cases don't have to read it off the manifest. */
export const FIXTURE_CALLER_ID = MOCK_CALLER_ID;

/** The fixture's declared tool names, used by F5 (undeclared tool probe). */
export function declaredToolNames(manifest: ExternalAgentRuntimeManifest): readonly string[] {
  return (manifest.tools ?? []).map((t) => t.name);
}
