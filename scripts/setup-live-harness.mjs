// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// Live-harness provisioning check. Reports which of the seven external agent
// runtimes are present on this machine and prints the exact install/credential
// command for each missing one. Read-only: never installs, writes, or mints
// anything. Run: node scripts/setup-live-harness.mjs

import { spawnSync } from "node:child_process";
import path from "node:path";

function hasCommand(cmd) {
  // `r.error` is ENOENT when the binary is not on PATH; otherwise the binary
  // was found (exit code is irrelevant for a presence check). `--version` is
  // non-interactive and the timeout guards against a CLI that ignores it.
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !r.error;
}

function hasNpmGlobalPackage(pkg) {
  const r = spawnSync("npm", ["ls", "-g", "--depth=0", pkg], { stdio: "ignore", timeout: 10000 });
  return !r.error && r.status === 0;
}

async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

// Read-only probe: does the omp credential store hold a non-disabled DeepSeek
// api_key? The `data` column is JSON ({ "key": "...", "source": "..." }), so
// the raw key lives at json_extract(data, '$.key') — never the column itself.
function hasOmpDeepSeekCredential() {
  const home = process.env.HOME || "";
  if (!home) return false;
  const db = path.join(home, ".omp", "agent", "agent.db");
  const r = spawnSync("sqlite3", [
    db,
    "SELECT 1 FROM auth_credentials WHERE provider='deepseek' AND credential_type='api_key' AND disabled_cause IS NULL AND json_extract(data, '$.key') IS NOT NULL LIMIT 1",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  return !r.error && String(r.stdout ?? "").trim() === "1";
}

const checks = [
  {
    id: "hermes",
    label: "Hermes",
    detect: () => Boolean(process.env.HERMES_COMMAND) || hasCommand("hermes"),
    install: "set HERMES_COMMAND to the Hermes CLI path (the repo's own agent)",
  },
  {
    id: "opencode",
    label: "OpenCode",
    detect: () => Boolean(process.env.OPENCODE_COMMAND) || hasCommand("opencode"),
    install: "npm i -g opencode-ai   # or set OPENCODE_COMMAND",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    detect: () => hasCommand("openclaw"),
    install: "install the OpenClaw runtime gateway (openclaw CLI)",
  },
  {
    id: "agentzero",
    label: "AgentZero",
    detect: () => hasCommand("docker"),
    install: "install Docker, then run the AgentZero container on the local socket",
  },
  {
    id: "deepseek-harness",
    label: "DeepSeek harness (Cordis)",
    detect: async () =>
      (await isReachable("http://127.0.0.1:3080/health")) || Boolean(process.env.DEEPSEEK_API_KEY),
    install: "Cordis kernel on 127.0.0.1:3080, or `npm run cordis-stub:start` for the in-repo stub",
  },
  {
    id: "pi",
    label: "Pi (pi.dev)",
    detect: () => hasNpmGlobalPackage("@earendil-works/pi-coding-agent"),
    install: "npm i -g --ignore-scripts @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh",
  },
  {
    id: "aider",
    label: "Aider",
    detect: () => hasCommand("aider"),
    install: "pipx install aider-chat",
  },
];

async function main() {
  console.log("Live-harness provisioning check");
  console.log("===============================\n");

  const results = [];
  for (const check of checks) {
    const ready = await check.detect();
    results.push({ ...check, ready });
    console.log(`${ready ? "\u2713" : "\u2717"} ${check.label}${ready ? "" : "  (missing)"}`);
  }

  const missing = results.filter((result) => !result.ready);
  console.log(`\n${results.length - missing.length}/${results.length} harnesses ready`);
  const ompHasDeepSeek = hasOmpDeepSeekCredential();
  console.log("\nDeepSeek credential (omp store, read-only check):");
  console.log(`  ${ompHasDeepSeek ? "\u2713" : "\u2717"} DeepSeek api_key in ~/.omp/agent/agent.db${ompHasDeepSeek ? "" : " (sign in via `omp /login`)"}`);
  console.log("  Source it at runtime so the bridge reads shared-deepseek (never printed):");
  console.log(`  export DEEPSEEK_API_KEY="$(sqlite3 "$HOME/.omp/agent/agent.db" "SELECT json_extract(data, '$.key') FROM auth_credentials WHERE provider='deepseek' AND credential_type='api_key' AND disabled_cause IS NULL LIMIT 1")"`);

  if (missing.length === 0) {
    console.log("\nAll live harnesses present. Run the parity + recovery gates:");
    console.log("  node scripts/governed-runtime-drills.mjs");
    console.log("  npm run deepseek-harness:smoke");
    console.log("  npm run test:external-agent-runtime");
    console.log("  npm run test:phase35");
    return;
  }

  console.log("\nInstall/credential commands for missing harnesses:");
  for (const m of missing) {
    console.log(`  ${m.label}: ${m.install}`);
  }

  console.log("\nZero-cost start: `npm run cordis-stub:start` boots an in-repo");
  console.log("OpenAI-compatible stub at 127.0.0.1:3080 (no API key required) to");
  console.log("exercise the DeepSeek-harness dispatcher end-to-end.");
}

main();
