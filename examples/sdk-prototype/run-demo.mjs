// Run the prototype SDK demo.
//
// Usage:
//   node examples/sdk-prototype/run-demo.mjs [pluginDir]
//
// Defaults to the Augmentor plugin (Manolo's DeepSeek Harness). The demo loads
// the plugin in three grant scenarios to show the SDK's capability model:
//   1. no grants            — deny-by-default, every gated tool is blocked
//   2. Public grants        — Public tools run; Privileged tools stay blocked
//   3. all requested grants — reviewed grants allow the full tool set

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlugin, runTool, describePlugin, capabilityClass } from "./sdk.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] ?? resolve(scriptDir, "plugins/augmentor");

const manifest = JSON.parse(await readFile(resolve(pluginDir, "plugin.json"), "utf8"));
const requested = manifest.requestedCapabilities ?? [];
const publicGrants = requested.filter((capability) => capabilityClass(capability) === "public");

function sampleArgs(toolName) {
  if (toolName.includes("hello")) return { name: "Community" };
  if (toolName.includes("notify")) return { message: "ResonantOS SDK prototype demo" };
  if (toolName.includes("run_task")) return { prompt: "Summarize the ResonantOS roadmap." };
  if (toolName.includes("respond")) return { prompt: "What should we prioritize?" };
  return {};
}

async function scenario(grantedCapabilities, label) {
  const plugin = await loadPlugin(pluginDir, { grantedCapabilities });
  console.log(`\n=== ${label} ===`);
  console.log("plugin:", JSON.stringify(describePlugin(plugin), null, 2));

  await plugin.enable();

  for (const tool of plugin.manifest.tools) {
    const result = await runTool(plugin, tool.name, sampleArgs(tool.name));
    console.log(`  ${tool.name} ->`, JSON.stringify(result));
  }

  await plugin.disable();
}

await scenario([], "Deny-by-default (no grants)");
await scenario(publicGrants, "Public capabilities granted");
await scenario(requested, "All requested capabilities granted (reviewed)");
