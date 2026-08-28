// Intent citation: docs/architecture/ADR-051-ros-architecture-blueprint.md
//
// Dev-only G0-ROS workbench: a browser-viewable panel that surfaces the
// ROS architecture blueprint (fused core, harness tool loop, scoping,
// category/runtime blueprints) plus how each discovered add-on maps onto
// the G0 core (rail destination, runtime type, trust tier).
//
// Not a user-facing surface: it lives behind the bridge loopback, uses no
// external resources, and mirrors the existing dev/external-agent-runtimes
// panel pattern. Read-only; production validation stays in the TS modules.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import {
  createRosHarnessMenu,
  discoverBundledAddonManifests,
} from "./addon-delegation-service.mjs";
import { addonTrustAndIsolationSnapshot } from "./dev-panel-addon-snapshot.mjs";
import { railMenuKindForCategory, rosArchitectureSnapshot } from "./ros-architecture-snapshot.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
// browser-first/host/dev-g0-ros-panel.mjs -> browser-first/dev/g0-ros-panel.html
const PANEL_HTML_PATH = resolvePath(moduleDir, "..", "dev", "g0-ros-panel.html");

let cachedHtml = null;

function loadPanelHtml() {
  if (cachedHtml === null) {
    cachedHtml = readFileSync(PANEL_HTML_PATH, "utf8");
  }
  return cachedHtml;
}

export function createDevG0RosPanelService({ repoRoot } = {}) {
  return {
    g0RosRoutes: [
      {
        method: "GET",
        path: "/dev/g0-ros",
        handler: async (_body, _request, bridgeContext) => {
          const root = bridgeContext?.repoRoot ?? repoRoot ?? process.env.RESONANTOS_REPO_ROOT;
          if (typeof root !== "string" || root.length === 0) {
            return {
              status: 503,
              body: { error: { message: "RESONANTOS_REPO_ROOT is not set; the G0-ROS workbench cannot enumerate add-on manifests." } },
            };
          }

          const discovered = await discoverBundledAddonManifests(root);
          const manifests = discovered.map((entry) => entry.manifest);
          // No installations in a dev read-only view: the harness loop shows
          // its 13 native tools with no supersede markers.
          const harness = createRosHarnessMenu(manifests, {});

          const addons = discovered.map(({ id, manifest, source }) => {
            const snapshot = addonTrustAndIsolationSnapshot(manifest);
            const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
            return {
              id,
              name: typeof manifest.name === "string" ? manifest.name : id,
              version: manifest.version ?? "",
              category: manifest.category ?? null,
              runtimeType: manifest.runtimeType ?? null,
              railMenuKind: railMenuKindForCategory(manifest.category),
              trustTier: snapshot.trustTier,
              untrusted: snapshot.untrusted,
              trustNotice: snapshot.trustNotice,
              publisher: snapshot.publisher,
              isolationBoundary: snapshot.boundary,
              workerKey: snapshot.workerKey,
              source,
              tools: tools.map((tool) => ({
                name: tool?.name ?? null,
                coversNativeTool: tool?.coversNativeTool ?? null,
              })),
            };
          });

          return {
            status: 200,
            body: {
              architecture: rosArchitectureSnapshot(),
              harness,
              addons,
              generatedAt: new Date().toISOString(),
            },
          };
        },
      },
      {
        method: "GET",
        path: "/dev/g0-ros/",
        handler: async () => ({
          status: 200,
          body: {
            ok: true,
            __html: loadPanelHtml(),
            contentType: "text/html; charset=utf-8",
          },
        }),
      },
    ],
    getRepoRoot: () => repoRoot,
  };
}
