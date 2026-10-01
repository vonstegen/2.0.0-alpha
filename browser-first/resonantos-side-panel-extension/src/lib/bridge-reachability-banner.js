// Bridge reachability banner.
//
// Subscribes to the bridge client's reachability store and renders a small
// fixed-position banner at the top of the workspace when the bridge is
// transiently unreachable or persistently failed. The banner disappears as
// soon as a request succeeds.
//
// Design choices
// --------------
// - One banner per workspace mount. Mounting twice creates two banners; the
//   caller is responsible for calling `dispose()` on the existing banner
//   before re-mounting (or for reusing the returned banner instance).
// - State persistence: the banner reads the current state synchronously on
//   mount so the user sees the correct status even for late subscriptions
//   (e.g. workspace mount AFTER the bridge already failed).
// - Defensive: never throws. The bridge client already fails closed; this
//   module is purely visual.

const BANNER_ID = "resonantos-bridge-reachability-banner";
const CLASS_NAME = "resonantos-bridge-reachability-banner";
const CLASS_STATE_UNREACHABLE = "resonantos-bridge-reachability-banner--unreachable";
const CLASS_STATE_PERSISTENT = "resonantos-bridge-reachability-banner--persistent";
const CLASS_STATE_ONLINE = "resonantos-bridge-reachability-banner--online";

const COPY = {
  unreachable: "Bridge unreachable — retrying…",
  persistent: "Bridge unavailable. Check Settings → Bridge Target and the bridge process.",
  online: "Bridge recovered.",
};

export function createReachabilityBanner({ bridgeRequest, document, targetId = BANNER_ID } = {}) {
  if (!bridgeRequest || typeof bridgeRequest.subscribeReachability !== "function") {
    return { dispose() {}, update() {} };
  }
  const doc = document ?? (typeof globalThis !== "undefined" ? globalThis.document : null);
  const host = doc?.getElementById?.(targetId) ?? null;
  if (!host) {
    return { dispose() {}, update() {} };
  }
  host.classList.add(CLASS_NAME);
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");

  function applyState(state) {
    host.classList.remove(CLASS_STATE_UNREACHABLE, CLASS_STATE_PERSISTENT, CLASS_STATE_ONLINE);
    if (state.state === "unreachable") {
      host.classList.add(CLASS_STATE_UNREACHABLE);
      host.textContent = COPY.unreachable;
      host.dataset.bridgeState = "unreachable";
      host.hidden = false;
    } else if (state.state === "persistent") {
      host.classList.add(CLASS_STATE_PERSISTENT);
      host.textContent = COPY.persistent;
      host.dataset.bridgeState = "persistent";
      host.hidden = false;
    } else {
      host.classList.add(CLASS_STATE_ONLINE);
      host.textContent = COPY.online;
      host.dataset.bridgeState = "online";
      host.hidden = true;
    }
  }

  // Render the current state synchronously.
  try {
    const initial = bridgeRequest.getReachabilityState();
    if (initial) applyState(initial);
  } catch { /* non-fatal */ }

  const unsubscribe = bridgeRequest.subscribeReachability((event) => applyState(event));

  return {
    dispose() {
      try { unsubscribe(); } catch { /* already disposed */ }
      host.classList.remove(CLASS_NAME, CLASS_STATE_UNREACHABLE, CLASS_STATE_PERSISTENT, CLASS_STATE_ONLINE);
      host.textContent = "";
      delete host.dataset.bridgeState;
    },
    update() {
      try {
        const current = bridgeRequest.getReachabilityState();
        if (current) applyState(current);
      } catch { /* non-fatal */ }
    },
  };
}

export const REACHABILITY_BANNER_ID = BANNER_ID;
export const REACHABILITY_BANNER_CLASSES = Object.freeze({
  root: CLASS_NAME,
  unreachable: CLASS_STATE_UNREACHABLE,
  persistent: CLASS_STATE_PERSISTENT,
  online: CLASS_STATE_ONLINE,
});