// Cross-origin workspace add-on renderer (SDK-DEMO-003 / P5).
//
// This is the render path for third-party-style workspace add-ons authored
// against the public `@resonantos/addon-sdk` contract. It implements the
// model the SDK-DEMO-002 review verified as correct, ported onto current dev:
//
//   - The iframe's `src` is the add-on's OWN upstream origin (from
//     `service.entrypoint`), NOT a bridge proxy URL. The iframe is therefore
//     same-origin with its own upstream and cross-origin from the extension.
//   - The sandbox is `allow-scripts allow-same-origin`. `allow-same-origin`
//     is safe here because the iframe origin equals the add-on's own upstream
//     origin — it does NOT grant the extension's origin, so the add-on cannot
//     reach `chrome.*` APIs, extension storage, or the bridge.
//   - Capability tokens are delivered OUT-OF-BAND via `postMessage` with
//     `targetOrigin` pinned to the add-on's origin. The bridge token is never
//     handed to the add-on, and no token appears in served HTML or a URL.
//
// This file is additive: the existing bridge-proxy/srcdoc renderer
// (`addon-iframe.js`) is unchanged and still serves Hermes/OpenCode.

export const WORKSPACE_BOOTSTRAP_TYPE = "resonantos-addon-bootstrap";

/**
 * Create a sandboxed cross-origin iframe for a workspace add-on.
 *
 * @param {object} options
 * @param {string} options.addonId     add-on id (for class/aria labels only)
 * @param {string} options.addonOrigin the add-on's own upstream origin
 *                                     (scheme://host:port), e.g.
 *                                     "http://127.0.0.1:47321"
 * @param {string} options.addonLabel  human label for the status banner
 */
export function createWorkspaceAddonIframe({ addonId, addonOrigin, addonLabel }) {
  const wrapper = document.createElement("section");
  wrapper.className = `addon-iframe-wrapper addon-iframe-wrapper--${addonId}`;
  wrapper.setAttribute("aria-label", `${addonLabel} workspace`);

  const status = document.createElement("div");
  status.className = "addon-iframe-status";
  status.textContent = `Loading ${addonLabel}...`;

  const frame = document.createElement("div");
  frame.className = "addon-iframe-frame";

  const iframe = document.createElement("iframe");
  iframe.className = "addon-iframe";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("title", `${addonLabel} workspace`);
  iframe.src = addonOrigin;

  frame.append(iframe);
  wrapper.append(status, frame);

  const setStatus = (text, tone = "") => {
    status.textContent = text;
    status.className = "addon-iframe-status";
    if (tone) status.classList.add(`addon-iframe-status--${tone}`);
  };

  iframe.addEventListener(
    "load",
    () => {
      setStatus(`${addonLabel} ready.`, "ready");
    },
    { once: true },
  );

  /**
   * Deliver the bootstrap envelope to the add-on iframe. Callable repeatedly
   * (idempotent) so the wiring layer can re-deliver once the add-on signals
   * its listener is installed — the add-on validates `event.source` and
   * `event.data.type` before trusting anything.
   */
  const deliverBootstrap = (payload = {}) => {
    const message = { type: WORKSPACE_BOOTSTRAP_TYPE, ...payload };
    iframe.contentWindow?.postMessage(message, addonOrigin);
  };

  return { wrapper, iframe, status, deliverBootstrap, setStatus };
}
