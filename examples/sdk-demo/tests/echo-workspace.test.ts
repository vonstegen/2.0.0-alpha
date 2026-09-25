// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceAddonIframe,
  WORKSPACE_BOOTSTRAP_TYPE,
} from "../../../browser-first/resonantos-side-panel-extension/src/lib/addon-iframe-workspace.js";

describe("createWorkspaceAddonIframe (P5 cross-origin renderer)", () => {
  it("points the iframe at the add-on's own origin with the narrow sandbox", () => {
    const { wrapper, iframe } = createWorkspaceAddonIframe({
      addonId: "addon.resonant-echo",
      addonOrigin: "http://127.0.0.1:47321",
      addonLabel: "Resonant Echo",
    });
    expect(iframe.getAttribute("src")).toBe("http://127.0.0.1:47321");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(wrapper.querySelector("iframe")).toBe(iframe);
  });

  it("delivers the bootstrap envelope with a pinned targetOrigin and no apiBasePath", () => {
    const { iframe, deliverBootstrap } = createWorkspaceAddonIframe({
      addonId: "addon.resonant-echo",
      addonOrigin: "http://127.0.0.1:47321",
      addonLabel: "Resonant Echo",
    });
    const postMessage = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage },
      configurable: true,
    });
    deliverBootstrap({ capabilityTokens: { network: "tok" } });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0];
    expect(message.type).toBe(WORKSPACE_BOOTSTRAP_TYPE);
    // Workspace-iframe bootstrap is declarative only — no apiBasePath is carried
    // because the iframe is the add-on's own upstream origin (sandboxed
    // cross-origin) and the add-on issues same-origin fetches directly.
    expect("apiBasePath" in message).toBe(false);
    expect(message.capabilityTokens).toEqual({ network: "tok" });
    expect(targetOrigin).toBe("http://127.0.0.1:47321");
  });

  it("never sends the bridge token and includes no token in the frame attributes", () => {
    const { iframe } = createWorkspaceAddonIframe({
      addonId: "addon.resonant-echo",
      addonOrigin: "http://127.0.0.1:47321",
      addonLabel: "Resonant Echo",
    });
    expect(iframe.getAttribute("src")).not.toContain("token");
    expect(iframe.getAttribute("srcdoc")).toBeNull();
  });
});
