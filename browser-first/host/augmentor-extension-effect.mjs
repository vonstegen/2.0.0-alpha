// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
//
// CP-3 host-mediated extension effect. After the governed envelope authorizes an
// invocation (bridge-governed-authority.mjs), this factory produces the effect
// executor that runs the extension's declared tool and returns a typed result.
// Dependency-injected so the dispatch/manifest lookup are testable without a
// live bridge.

import { dispatchExternalAgentRuntime, findAddonManifest, findTool } from "./external-agent-runtime-dispatcher.mjs";

export function createAugmentorExtensionEffect({
  repoRoot,
  auditSink,
  findManifest = findAddonManifest,
  findToolDef = findTool,
  dispatch = dispatchExternalAgentRuntime,
} = {}) {
  return async function runAugmentorExtensionEffect(invocation) {
    const addonId = String(invocation.extensionId ?? "").split(":")[0];
    const toolName = invocation.input?.tool;
    const manifest = addonId ? await findManifest(addonId, { repoRoot }) : null;
    const tool = toolName ? findToolDef(manifest, toolName) : (manifest?.tools ?? [])[0] ?? null;

    const base = {
      invocationId: invocation.invocationId,
      extensionId: invocation.extensionId,
      evidence: [],
      actionsTaken: [],
      approvedGates: invocation.pendingApprovalGates ?? [],
      auditCorrelationId: invocation.invocationId,
    };

    if (!manifest || !tool) {
      return { ...base, status: "failed", output: { error: `extension tool not found for ${invocation.extensionId}` } };
    }

    const result = await dispatch({
      addonId,
      toolName: tool.name,
      payload: { messages: [{ role: "user", content: JSON.stringify(invocation.input ?? {}) }] },
      callerId: invocation.principalId,
      perCallerGrants: null,
      auditLedger: auditSink ? { record: auditSink } : null,
      repoRoot,
    });

    if (result.outcome === "deny") {
      return { ...base, status: "failed", output: { error: result.detail ?? result.reason } };
    }
    return { ...base, status: "ok", actionsTaken: [`dispatched ${tool.name}`], output: result.response };
  };
}
