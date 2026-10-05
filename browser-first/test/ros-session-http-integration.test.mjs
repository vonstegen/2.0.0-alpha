// CP-S5H2: authenticated HTTP round-trip integration test for ros-session.
//
// Mounts the REAL POST /terminal-host/session/attach route (from a real
// createHarnessHostService) on a REAL ephemeral loopback bridge server via
// startBridgeServer — the production mounting + auth stack — and drives it
// through the REAL ros-session.attach() native-fetch path. Only host data
// sources (profile/secret) are injected; routing, bridge-token auth,
// capability auth, the grant broker, environment composition, native fetch,
// and JSON decoding are all real.
//
// On b178d756 (pre-CP-S5H1) this fails: attach() invoked its fetcher with a
// test-only `{ url, init }` object, so native fetch rejected the call and the
// round trip returned bridge-unreachable.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attach } from "../bin/ros-session.mjs";
import { createBridgeToken, startBridgeServer } from "../host/bridge-server.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";
import {
  __resetSessionBootstrapGrantBroker,
  mintSessionBootstrapGrant,
  trackSessionBootstrapGrant,
} from "../host/terminal-host-service.mjs";
import { createTerminalHostHostWiring } from "../host/terminal-host-host-wiring.mjs";

const FAKE_CRED = "sk-cp-s5h2-sentinel-do-not-leak";
const ATTACH_PATH = "/terminal-host/session/attach";

describe("ros-session HTTP integration (CP-S5H2)", () => {
  let dir;
  let userRoot;
  let projectRoot;
  let server;
  let harness;
  let baseUrl;
  let bridgeToken;
  let controlToken;
  // Observed requests at the route boundary (spy wraps the handler; the
  // route result itself is never altered).
  let seen;

  beforeEach(async () => {
    __resetSessionBootstrapGrantBroker();
    dir = await realpath(await mkdtemp(join(tmpdir(), "ros-session-http-")));
    userRoot = join(dir, "user");
    projectRoot = join(dir, "proj");
    await mkdir(userRoot, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    const hostTerminal = createTerminalHostHostWiring({
      userRoot,
      getProfile: async (id) => id === "openai"
        ? { id, templateId: "openai", providerType: "openai" }
        : null,
      resolveSecret: async (profile) => profile?.id === "openai" ? FAKE_CRED : null,
    });
    harness = await createHarnessHostService({
      userRoot,
      env: process.env,
      providerHost: {
        executeRawProviderChat: async () => ({ reply: "noop" }),
        executeProviderStatus: async () => ({ providers: [] }),
      },
      hostTerminal,
    });

    bridgeToken = createBridgeToken();
    controlToken = createBridgeToken();
    seen = [];
    const routes = harness.harnessRoutes.map((r) =>
      r.path === ATTACH_PATH
        ? {
            ...r,
            handler: async (payload, request) => {
              seen.push({
                url: request?.url,
                host: request?.headers?.host,
                hasBridgeToken: typeof request?.headers?.["x-resonantos-bridge-token"] === "string",
                hasCapabilityToken: typeof request?.headers?.["x-resonantos-bridge-capability-token"] === "string",
                headersJson: JSON.stringify(request?.headers ?? {}),
              });
              return r.handler(payload, request);
            },
          }
        : r);

    server = await startBridgeServer({
      port: 0,
      host: "127.0.0.1",
      bridgeToken,
      bridgeCapabilityTokens: { "addon-runtime-control": controlToken },
      routes,
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
    if (harness) await harness.close();
    harness = null;
    __resetSessionBootstrapGrantBroker();
    await rm(dir, { recursive: true, force: true });
  });

  const mintTokenFile = async (sessionId) => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId, purpose: "attach" }));
    const tokenFile = join(dir, `tok-${sessionId}`);
    await writeFile(tokenFile, grant.token, { mode: 0o600 });
    return { grant, tokenFile };
  };

  it("first attach returns project/skills/credential exports through the real stack", async () => {
    const sessionId = "s-h2-1";
    const { grant, tokenFile } = await mintTokenFile(sessionId);

    const result = await attach({
      sessionId,
      tokenFile,
      providerProfileId: "openai",
      harness: "addon.resonant-terminal-iterm2",
      project: { root: projectRoot },
      baseUrl,
      bridgeToken,
      controlCapabilityToken: controlToken,
      // No fetcher: the REAL globalThis.fetch drives the REAL loopback server.
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.match(result.exports, new RegExp(`^export OPENAI_API_KEY='${FAKE_CRED}'$`, "m"));
    assert.match(result.exports, new RegExp(`^export ROS_PROJECT_ROOT='${projectRoot}'$`, "m"));
    assert.match(result.exports, /^export ROS_PROJECT_CWD='[^']+'$/m);
    assert.match(result.exports, /^export ROS_SKILLS_DIR='[^']+\/skills\/[^']+'$/m);

    // The token file is consumed by the CLI read-then-unlink discipline.
    await assert.rejects(readFile(tokenFile), /ENOENT/);

    // The route boundary observed exactly one request. The grant token and
    // the credential never appear in the URL or any header value.
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, ATTACH_PATH);
    assert.equal(seen[0].host, `127.0.0.1:${server.address().port}`);
    assert.equal(seen[0].hasBridgeToken, true);
    assert.equal(seen[0].hasCapabilityToken, true);
    assert.equal(seen[0].url.includes(grant.token), false);
    assert.equal(seen[0].headersJson.includes(grant.token), false);
    assert.equal(seen[0].headersJson.includes(FAKE_CRED), false);
  });

  it("replay of a consumed grant fails already-consumed", async () => {
    const sessionId = "s-h2-2";
    const { grant, tokenFile } = await mintTokenFile(sessionId);

    const first = await attach({
      sessionId, tokenFile, providerProfileId: "openai",
      project: { root: projectRoot }, baseUrl, bridgeToken, controlCapabilityToken: controlToken,
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    // Same grant token, fresh file: the broker consumed the grant on the
    // first attach, so the route rejects the replay.
    const replayFile = join(dir, `tok-${sessionId}-replay`);
    await writeFile(replayFile, grant.token, { mode: 0o600 });
    const replay = await attach({
      sessionId, tokenFile: replayFile, providerProfileId: "openai",
      project: { root: projectRoot }, baseUrl, bridgeToken, controlCapabilityToken: controlToken,
    });
    assert.equal(replay.ok, false);
    if (replay.ok) return;
    assert.equal(replay.reason, "already-consumed");
    assert.equal(JSON.stringify(replay).includes(grant.token), false);
    assert.equal(JSON.stringify(replay).includes(FAKE_CRED), false);
    await assert.rejects(readFile(replayFile), /ENOENT/);
  });

  it("wrong bridge token receives the auth failure (http-401)", async () => {
    const sessionId = "s-h2-3";
    const { grant, tokenFile } = await mintTokenFile(sessionId);
    const result = await attach({
      sessionId, tokenFile, providerProfileId: "openai",
      project: { root: projectRoot }, baseUrl,
      bridgeToken: createBridgeToken(), // valid shape, wrong value
      controlCapabilityToken: controlToken,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "http-401");
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
    // The grant must NOT have been consumed by an unauthorized request.
    const replayFile = join(dir, `tok-${sessionId}-after-401`);
    await writeFile(replayFile, grant.token, { mode: 0o600 });
    const retry = await attach({
      sessionId, tokenFile: replayFile, providerProfileId: "openai",
      project: { root: projectRoot }, baseUrl, bridgeToken, controlCapabilityToken: controlToken,
    });
    assert.equal(retry.ok, true, "grant survives the unauthorized attempt");
  });

  it("wrong capability token receives the auth failure (http-403)", async () => {
    const sessionId = "s-h2-4";
    const { grant, tokenFile } = await mintTokenFile(sessionId);
    const result = await attach({
      sessionId, tokenFile, providerProfileId: "openai",
      project: { root: projectRoot }, baseUrl, bridgeToken,
      controlCapabilityToken: createBridgeToken(), // valid shape, wrong value
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "http-403");
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    assert.equal(JSON.stringify(result).includes(FAKE_CRED), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("0600 discipline: the token file the host wrote is unreadable to others", async () => {
    const sessionId = "s-h2-5";
    const { tokenFile } = await mintTokenFile(sessionId);
    const mode = (await stat(tokenFile)).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});
