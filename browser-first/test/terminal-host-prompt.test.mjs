// CP-BR11.1: POST /terminal-host/prompt
//
// The "Write a prompt" affordance. The route writes the operator's prompt
// to the host-authoritative 0600 path (the same path the prompt-path and
// launch routes use). It MUST be:
//   * loopback-only (loopbackHostOnly is set by route()).
//   * addon-runtime-control gated (control token).
//   * write-only — the route never reads the prompt content back, never
//     logs it, and never echoes it in the response.
//   * bounded — empty or >65536-char text is rejected.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateBridgeRequestForSelfTest,
} from "../host/bridge-server.mjs";

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

const load = async () => {
  const module = await import("../host/harness-host-service.mjs");
  assert.equal(typeof module.createHarnessHostService, "function");
  return module.createHarnessHostService;
};

async function fixture(t, options = {}) {
  const create = await load();
  let stored = null;
  const host = await create({
    env: {},
    store: {
      read: async () => stored,
      write: async (value) => {
        stored = structuredClone(value);
      },
    },
    providerHost: {
      executeRawProviderChat: async () => ({ reply: "answer" }),
      executeProviderStatus: async () => ({
        providers: [{ configured: true, models: [{ allowed: true }] }],
      }),
    },
    ...options,
  });
  t.after(() => host.close());
  const call = (url, body = {}, overrides = {}) => {
    const route = host.harnessRoutes.find((r) => r.path === url.split("?")[0]);
    return evaluateBridgeRequestForSelfTest({
      method: "POST",
      url,
      body,
      routes: host.harnessRoutes,
      bridgeToken: "bridge-token",
      bridgeCapabilityTokens: tokens,
      listenerPort: 47773,
      headers: {
        host: "127.0.0.1:47773",
        "x-resonantos-bridge-token": "bridge-token",
        "x-resonantos-bridge-capability-token": tokens[route?.requiredCapability],
      },
      rawHeaders: ["Host", "127.0.0.1:47773"],
      ...overrides,
    });
  };
  return { host, call };
}

test("POST /terminal-host/prompt requires addon-runtime-control", async (t) => {
  const f = await fixture(t, { promptFilePath: () => join(tmpdir(), `ros-prompt-${randomUUID()}.txt`) });
  const result = await f.call("/terminal-host/prompt", { text: "hello" }, {
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" },
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /terminal-host/prompt requires loopback host", async (t) => {
  const f = await fixture(t, { promptFilePath: () => join(tmpdir(), `ros-prompt-${randomUUID()}.txt`) });
  const result = await f.call("/terminal-host/prompt", { text: "hello" }, {
    headers: {
      host: "evil.test:47773",
      "x-resonantos-bridge-token": "bridge-token",
      "x-resonantos-bridge-capability-token": tokens["addon-runtime-control"],
    },
    rawHeaders: ["Host", "evil.test:47773"],
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /terminal-host/prompt writes a 0600 file and returns { promptPath, valid: true }", async (t) => {
  const promptPath = join(tmpdir(), `ros-prompt-${randomUUID()}.txt`);
  const f = await fixture(t, { promptFilePath: () => promptPath });
  const text = "Summarize this repository and suggest the next step.";
  const result = await f.call("/terminal-host/prompt", { text });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.promptPath, promptPath);
  assert.equal(result.payload.valid, true);
  const written = await readFile(promptPath, "utf8");
  assert.equal(written, text);
  const mode = (await stat(promptPath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("POST /terminal-host/prompt does not echo the prompt content in the response", async (t) => {
  const promptPath = join(tmpdir(), `ros-prompt-${randomUUID()}.txt`);
  const f = await fixture(t, { promptFilePath: () => promptPath });
  const text = "sk-secret-shaped-do-not-leak-value-12345678";
  const result = await f.call("/terminal-host/prompt", { text });
  assert.equal(result.status, 200);
  // The response carries only promptPath + valid (plus the transport `ok`).
  assert.deepEqual(Object.keys(result.payload).sort(), ["ok", "promptPath", "valid"]);
  assert.ok(!JSON.stringify(result.payload).includes(text), "prompt content must not appear in the response");
});

test("POST /terminal-host/prompt rejects empty text", async (t) => {
  const f = await fixture(t, { promptFilePath: () => join(tmpdir(), `ros-prompt-${randomUUID()}.txt`) });
  const result = await f.call("/terminal-host/prompt", { text: "" });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /terminal-host/prompt rejects oversized text", async (t) => {
  const f = await fixture(t, { promptFilePath: () => join(tmpdir(), `ros-prompt-${randomUUID()}.txt`) });
  const result = await f.call("/terminal-host/prompt", { text: "x".repeat(65537) });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});
