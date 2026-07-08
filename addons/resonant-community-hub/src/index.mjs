// Community Hub local-service host entrypoint (M3).
//
// Wires the pieces the milestone builds: token vault -> outbound api-client ->
// policy service -> poller -> loopback http-json server. Configuration comes only
// from the environment (base URL, port, poll cadence, and — if the host restored
// one — the member token via the vault). No secrets are read from or written to
// the repo (Art. VIII).
//
//   COMMUNITY_HUB_API_BASE_URL   required — hosted Community API base (https://…)
//   COMMUNITY_HUB_HOST_PORT      optional — loopback port (default 4890, matches manifest)
//   COMMUNITY_HUB_POLL_MS        optional — poll cadence (default 20000, per plan)
//   COMMUNITY_HUB_MEMBER_TOKEN   optional — restored member session token (host vault)
//
// Run directly (`node src/index.mjs`) or import `createCommunityHubHost` to embed.

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import process from "node:process";
import { createCommunityApiClient } from "./api-client.mjs";
import { createTokenVault } from "./token-vault.mjs";
import { createCommunityHubService } from "./community-host.mjs";
import { createCommunityPoller } from "./poller.mjs";
import { createCommunityHubServer, listen } from "./http-server.mjs";
import { createAgentDelegationBridge } from "./agent-bridge.mjs";

/**
 * Load the manifest `delegation` contract that gates the M5 agent bridge. In a real
 * install the host is handed its manifest by the shell; here we resolve the bundled
 * manifest (the single source of truth the SDK validation tests also read) so the
 * wired bridge enforces exactly the contract that ships. Override with
 * COMMUNITY_HUB_MANIFEST_PATH.
 * @returns {object | null} the delegation contract, or null if none is resolvable.
 */
export function loadDelegationContract(env = process.env) {
  const explicit = String(env.COMMUNITY_HUB_MANIFEST_PATH ?? "").trim();
  const candidates = explicit
    ? [explicit]
    : [
        new URL("../../../public/addons/community-hub.json", import.meta.url),
        new URL("../../../examples/addons/community-hub.json", import.meta.url),
      ];
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      if (manifest && typeof manifest.delegation === "object" && manifest.delegation) {
        return manifest.delegation;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function createCommunityHubHost(env = process.env) {
  const baseUrl = String(env.COMMUNITY_HUB_API_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error(
      "COMMUNITY_HUB_API_BASE_URL is required (the hosted Community API base URL). " +
        "Set it via the host config; the extension never calls this URL directly (Art. II).",
    );
  }
  const pollMs = Number.parseInt(env.COMMUNITY_HUB_POLL_MS ?? "", 10);

  const vault = createTokenVault({ env });
  const client = createCommunityApiClient({ baseUrl });
  const service = createCommunityHubService({ client, vault });
  const poller = createCommunityPoller({
    service,
    intervalMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 20_000,
  });

  // Wire the M5 agent-delegation bridge so agents actually reach the delegation
  // read/write path over the loopback host (community.list_task_steps /
  // community.submit_task_write), with the manifest delegation contract + approval
  // gate enforced before any write is dispatched into the community-host.
  const delegation = loadDelegationContract(env);
  const agentBridge = delegation ? createAgentDelegationBridge({ service, delegation }) : null;

  const server = createCommunityHubServer({ service, poller, agentBridge });

  return { vault, client, service, poller, agentBridge, server };
}

export async function startCommunityHubHost(env = process.env) {
  const host = createCommunityHubHost(env);
  const port = Number.parseInt(env.COMMUNITY_HUB_HOST_PORT ?? "", 10);
  const { url, port: boundPort } = await listen(host.server, {
    port: Number.isFinite(port) && port > 0 ? port : 4890,
  });
  await host.poller.start().catch(() => undefined);
  return { ...host, url, port: boundPort };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startCommunityHubHost()
    .then(({ url }) => {
      process.stdout.write(`Community Hub host listening on ${url}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
