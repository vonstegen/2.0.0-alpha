// Intent citation: docs/architecture/ADR-015-delegation-fabric-addon-catalog-native-tools.md

function capabilityList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function uniqueCapabilities(values) {
  return [...new Set(values)];
}

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

export function capabilityReviewElement(addon = {}) {
  const state = capabilityReviewState(addon);
  const wrapper = document.createElement("div");
  wrapper.className = "settings-addon-capabilities";
  const groups = [
    ["Granted", "granted", state.granted],
    ["Needs review", "pending", state.pending],
    ["Denied", "denied", state.denied]
  ].filter(([, , capabilities]) => capabilities.length);
  if (!groups.length) {
    wrapper.append(capabilityGroup("Capability state", "empty", ["explicit grants required"]));
    return wrapper;
  }
  for (const [label, status, capabilities] of groups) {
    wrapper.append(capabilityGroup(label, status, capabilities));
  }
  return wrapper;
}
