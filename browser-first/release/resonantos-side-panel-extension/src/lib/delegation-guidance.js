import { delegationTargetLabel } from "./delegation-lifecycle.js";

export function delegationBlockerGuidance({
  blockedReason = "",
  executionEnabled = false,
  runtimeAvailable = false,
  target = ""
} = {}) {
  const label = delegationTargetLabel(target);
  const reason = String(blockedReason || "").trim() ||
    (!runtimeAvailable
      ? `${label} runtime was not detected on this machine.`
      : !executionEnabled
        ? `${label} execution is disabled by ResonantOS capability policy.`
        : `${label} task is waiting for its add-on runtime.`);
  const nextAction = !runtimeAvailable
    ? `Install or start ${label}, then refresh the workspace.`
    : !executionEnabled
      ? `Enable ${label} execution in Settings > Add-ons after reviewing requested capabilities.`
      : `Open the ${label} workspace, inspect the task packet, then retry or continue from Augmentor.`;
  return {
    boundary: `${label} is an add-on worker. Augmentor may delegate, but ResonantOS keeps filesystem, shell, provider, wallet, and Living Archive writes capability-gated.`,
    nextAction,
    reason
  };
}

export function delegationGuidanceText(input = {}) {
  const guidance = delegationBlockerGuidance(input);
  return [
    `Blocked: ${guidance.reason}`,
    `Next action: ${guidance.nextAction}`,
    `Boundary: ${guidance.boundary}`
  ].join("\n");
}
