// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md#9-deepseek-harness-exemplar
//
// Dev-only HTML panel: a tiny browser-viewable page that fetches
// /dev/external-agent-runtimes and renders a per-addon card with the
// manifest's metadata + F1-F10 verdicts.
//
// This page is meant for the developer reviewing the addon SDK work
// locally. It is NOT a user-facing surface; it lives behind the bridge
// loopback and is registered only when the bridge is started in
// development mode (see scripts/start-bridge-with-dev-panel.mjs).
//
// The HTML uses no external resources (no CDN, no fonts, no images)
// so it renders offline and can be loaded over the bridge's loopback
// without CSP headaches.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const moduleDir = dirname(fileURLToPath(import.meta.url));
// browser-first/host/dev-external-agent-runtimes-panel.mjs ->
//   browser-first/dev/external-agent-runtimes-panel.html
const PANEL_HTML_PATH = resolvePath(moduleDir, "..", "dev", "external-agent-runtimes-panel.html");

let cachedHtml = null;

function loadPanelHtml() {
  if (cachedHtml === null) {
    cachedHtml = readFileSync(PANEL_HTML_PATH, "utf8");
  }
  return cachedHtml;
}

export function createDevExternalAgentRuntimesPanelService({ repoRoot }) {
  if (typeof repoRoot !== "string") {
    throw new Error("createDevExternalAgentRuntimesPanelService requires { repoRoot }");
  }

  return {
    devPanelRoutes: [
      {
        method: "GET",
        path: "/dev/external-agent-runtimes/",
        // Open-prefix: this is a dev-only browser page; we still gate it
        // on the bridge token by requiring the host to bind it on
        // loopback only. The bridge's IP allowlist covers that.
        handler: async () => {
          const html = loadPanelHtml();
          // The bridge checks `result.payload.__html` to switch to
          // writeHtml(); we expose it at the top level so the spread
          // into `{ ok: true, ...result }` keeps the marker visible.
          return {
            status: 200,
            body: {
              ok: true,
              __html: html,
              contentType: "text/html; charset=utf-8",
            },
          };
        },
      },
    ],
    /**
     * Helper used by `GET /dev/external-agent-runtimes` to compute the
     * repo root the JSON endpoint should enumerate. Exported so the
     * routing site can pass it through bridgeContext without re-doing
     * the env lookup.
     */
    getRepoRoot: () => repoRoot,
  };
}
