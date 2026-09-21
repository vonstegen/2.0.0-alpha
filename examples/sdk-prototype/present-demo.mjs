// present-demo.mjs — guided, step-by-step presenter for the ResonantOS prototype SDK demo.
//
// Zero-dependency; reuses the same sdk.mjs runtime as run-demo.mjs, so the
// behaviour shown is byte-for-byte the same — just paced for a live walkthrough
// with step headers and pauses.
//
// Usage:
//   node examples/sdk-prototype/present-demo.mjs                      # full walkthrough (both add-ons)
//   node examples/sdk-prototype/present-demo.mjs plugins/augmentor     # a single add-on
//   node examples/sdk-prototype/present-demo.mjs --auto                # auto-advance, no Enter
//
// Interactive (TTY): press Enter to advance between steps. With --auto or when
// stdout is not a TTY, steps advance automatically.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { loadPlugin, runTool, describePlugin, capabilityClass } from "./sdk.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const positional = args.filter((a) => a !== "--auto");
const pluginDirs = positional.length
  ? positional.map((p) => resolve(p))
  : [resolve(scriptDir, "plugins/augmentor"), resolve(scriptDir, "plugins/grok-build")];

const isTTY = Boolean(process.stdin.isTTY) && !auto;
const div = "─".repeat(72);

function header(text) {
  console.log(`\n${div}\n${text}\n${div}`);
}

function pause() {
  if (auto) return new Promise((r) => setTimeout(r, 1600));
  if (!isTTY) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePrompt) =>
    rl.question("\n  [Enter] to continue  ", () => {
      rl.close();
      resolvePrompt();
    }),
  );
}

function sampleArgs(toolName) {
  if (toolName.includes("hello")) return { name: "Community" };
  if (toolName.includes("notify")) return { message: "ResonantOS SDK prototype demo" };
  if (toolName.includes("run_task")) return { prompt: "Summarize the ResonantOS roadmap." };
  if (toolName.includes("respond")) return { prompt: "What should we prioritize?" };
  return {};
}

async function presentPlugin(pluginDir) {
  const manifest = JSON.parse(await readFile(resolve(pluginDir, "plugin.json"), "utf8"));
  const requested = manifest.requestedCapabilities ?? [];
  const publicGrants = requested.filter((c) => capabilityClass(c) === "public");

  const scenarios = [
    {
      granted: [],
      title: "Scenario 1 — Deny-by-default (no grants)",
      why: "No capabilities granted. Every gated tool must be refused.",
    },
    {
      granted: publicGrants,
      title: "Scenario 2 — Public capabilities granted",
      why: "Public grants only. Public tools run; Privileged tools stay blocked.",
    },
    {
      granted: requested,
      title: "Scenario 3 — All requested grants (reviewed)",
      why: "Reviewed grants. The full tool set runs, and run_task stops at propose (prepare, not commit).",
    },
  ];

  for (const scenario of scenarios) {
    const plugin = await loadPlugin(pluginDir, { grantedCapabilities: scenario.granted });
    header(
      `${scenario.title}\n\n   ${scenario.why}\n\n   Add-on: ${plugin.manifest.name} (${plugin.manifest.id})\n   Granted: ${scenario.granted.length ? scenario.granted.join(", ") : "(none)"}`,
    );

    await plugin.enable();
    for (const tool of plugin.manifest.tools) {
      const result = await runTool(plugin, tool.name, sampleArgs(tool.name));
      const pretty = JSON.stringify(result, null, 2).split("\n").join("\n   ");
      console.log(`\n   ${tool.name}\n   ${pretty}`);
    }
    await plugin.disable();
    await pause();
  }
}

async function main() {
  header("ResonantOS — Add-on Contract Walkthrough (offline prototype)");

  console.log(`
  Three honest boundaries, up front:
    1. No OS confinement — add-ons are ordinary Node modules.
    2. No provider call — the loopback on 127.0.0.1:3080 is simulated.
    3. No commit boundary — propose builds a proposal; the approving host is still to be built.
`);
  await pause();

  for (const dir of pluginDirs) {
    await presentPlugin(dir);
  }

  header("Where this lands");

  console.log(`
  The contract to react to: what an add-on may declare, what the host grants,
  where a human approves.

  Open decision (Manolo + Tom): the privilege split (§13.2) — only the
  authority-holding parts (action executor + field classifier, commit broker,
  credential custody, update channel) privileged; the rest a public extension.
  And whether the field classifier moves into Manolo's action executor.
`);
}

main().catch((err) => {
  console.error("\nWalkthrough failed:", err.message ?? err);
  process.exit(1);
});
