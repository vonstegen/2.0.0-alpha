// Intent citation: docs/architecture/ADR-015-delegation-fabric-addon-catalog-native-tools.md

function capabilityList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function uniqueCapabilities(values) {
  return [...new Set(values)];
}

export const CAPABILITY_CONTRACT_NOTE = "Capability enforcement happens at the bridge via per-route tokens; these chips describe the add-on contract.";

export function capabilityReviewState(addon = {}) {
  const granted = uniqueCapabilities(capabilityList(addon.grantedCapabilities ?? addon.grants));
  const denied = uniqueCapabilities(capabilityList(addon.deniedCapabilities ?? addon.denials));
  const requested = uniqueCapabilities(capabilityList(addon.requestedCapabilities ?? addon.capabilities));
  const pending = uniqueCapabilities([
    ...capabilityList(addon.pendingCapabilities),
    ...requested.filter((capability) => !granted.includes(capability) && !denied.includes(capability))
  ]);
  return { denied, granted, pending, requested };
}

export function capabilityContractState(addon = {}) {
  const state = capabilityReviewState(addon);
  const shellRequested = state.requested.includes("shell") || state.granted.includes("shell") || state.denied.includes("shell");
  const hasLiveOpenCodeShell = addon.id === "addon.opencode" && shellRequested;
  if (!hasLiveOpenCodeShell) {
    return { ...state, live: [] };
  }
  const withoutShell = (capabilities) => capabilities.filter((capability) => capability !== "shell");
  const enabled = Boolean(addon.execution?.localCliExecution);
  return {
    denied: withoutShell(state.denied),
    granted: withoutShell(state.granted),
    pending: withoutShell(state.pending),
    requested: state.requested,
    live: [{
      label: enabled ? "Enabled by you" : "Disabled",
      state: enabled ? "enabled-by-user" : "disabled",
      capabilities: ["shell"],
    }],
  };
}

export function capabilityGroup(label, state, capabilities) {
  const group = document.createElement("div");
  group.className = "settings-addon-capability-group";
  group.dataset.state = state;
  const title = document.createElement("small");
  title.textContent = label;
  group.append(title);
  for (const capability of capabilities) {
    const chip = document.createElement("span");
    chip.textContent = capability;
    group.append(chip);
  }
  return group;
}

export function capabilityReviewElement(addon = {}, options = {}) {
  const state = capabilityContractState(addon);
  const wrapper = document.createElement("div");
  wrapper.className = "settings-addon-capabilities";
  if (options.heading !== false) {
    const heading = document.createElement("strong");
    heading.textContent = "Capability contract";
    wrapper.append(heading);
  }
  const groups = [
    ["Declared", "declared", state.granted],
    ["Needs review", "pending", state.pending],
    ["Denied by policy", "denied", state.denied],
    ...state.live.map((entry) => [entry.label, entry.state, entry.capabilities])
  ].filter(([, , capabilities]) => capabilities.length);
  if (!groups.length) {
    wrapper.append(capabilityGroup("Declared", "empty", ["explicit grants required"]));
    const note = document.createElement("small");
    note.textContent = CAPABILITY_CONTRACT_NOTE;
    wrapper.append(note);
    return wrapper;
  }
  for (const [label, status, capabilities] of groups) {
    wrapper.append(capabilityGroup(label, status, capabilities));
  }
  const note = document.createElement("small");
  note.textContent = CAPABILITY_CONTRACT_NOTE;
  wrapper.append(note);
  return wrapper;
}
