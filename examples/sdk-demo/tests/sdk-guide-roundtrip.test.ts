import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSdkGuideServer } from "../sdk-guide/server.mjs";
import { createEchoServer } from "../echo/server.mjs";
import { createCounterServer } from "../counter/server.mjs";

// P7 round-trip at the service boundary: the SDK Guide upstream is the third
// local-service add-on to exercise the Phase-3 (P6) lifecycle. The 9-step
// guide UI walks through every host-policy boundary in the order a real
// developer would encounter it. This test proves the boundary holds when
// driven by direct HTTP fetches against the operator-started upstream; the
// sibling real-extension test (sdk-guide-extension-live.test.mjs) drives the
// exact same paths through the unpacked extension + the bridge.

const SDK_GUIDE_BEARER = "live-sdk-guide-bearer-for-p7-tests";
const SDK_GUIDE_ADMIN = "live-sdk-guide-admin-for-p7-tests";

describe("SDK demo: SDK Guide upstream round-trip (P7 capability-gated, 9-step)", () => {
  let service;
  let port;

  beforeEach(async () => {
    service = createSdkGuideServer({ port: 0, bearerToken: SDK_GUIDE_BEARER, adminToken: SDK_GUIDE_ADMIN });
    const started = await service.start();
    port = started.port;
  });

  afterEach(async () => {
    if (service) await service.close();
    service = null;
    delete process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER;
  });

  it("answers /health (public)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.addon).toBe("addon.sdk-guide");
    expect(data.hostGranted).toBe(true);
    expect(data.bearerConfigured).toBe(true);
  });

  it("emits no Access-Control-Allow-Origin header (sandboxed cross-origin iframe contract)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/guide/step/1`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it("public read-only steps 1..6 are bearer-free and return 200", async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/guide/step/${n}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.step).toBe(n);
      expect(typeof data.title).toBe("string");
      expect(typeof data.lesson).toBe("string");
    }
  });

  it("returns 404 for step numbers outside 1..6", async () => {
    const tooLow = await fetch(`http://127.0.0.1:${port}/api/guide/step/0`);
    expect(tooLow.status).toBe(404);
    const tooHigh = await fetch(`http://127.0.0.1:${port}/api/guide/step/7`);
    expect(tooHigh.status).toBe(404);
  });

  it("refuses the mutating ping route when no operator-pinned token is configured", async () => {
    const unconfigured = createSdkGuideServer({ port: 0, bearerToken: "", adminToken: "" });
    const { port: cfgPort } = await unconfigured.start();
    try {
      const res = await fetch(`http://127.0.0.1:${cfgPort}/api/guide/ping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("sdk-guide-not-configured");
    } finally {
      await unconfigured.close();
    }
  });

  it("step 7 returns 401 with a wrong bearer (real audience-bound credential boundary)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok-wrong" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("sdk-guide-unauthorized");
  });

  it("step 7 returns 200 with the operator-pinned bearer (authorized call)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_BEARER}` },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pong).toBe(true);
    expect(body.step).toBe(7);
    expect(typeof body.echo).toBe("string");
  });

  it("serves the add-on UI (index.html) with the bootstrap listener + Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain("resonantos-addon-bootstrap");
    expect(html).toContain("/api/guide/ping");
    expect(html.toLowerCase()).toMatch(/authoriz/);
    // 9-step UI must be present.
    const stepMatches = html.match(/data-step="(\d)"/g) ?? [];
    expect(stepMatches).toHaveLength(9);
  });

  // ---- Host-only admin / revoke lifecycle ----

  it("rejects /admin/state without an admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`);
    expect(res.status).toBe(401);
  });

  it("returns /admin/state with the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${SDK_GUIDE_ADMIN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostGranted).toBe(true);
    expect(body.bearerConfigured).toBe(true);
  });

  it("step 9 — host revoke flips the deny flag and the mutating route returns 403 (real host-policy result)", async () => {
    // 1. Baseline: grant + bearer succeeds (step 7).
    const ok = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_BEARER}` },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).pong).toBe(true);

    // 2. Host flips the in-memory deny flag through the admin path.
    const deny = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_ADMIN}` },
      body: JSON.stringify({ granted: false }),
    });
    expect(deny.status).toBe(200);
    expect((await deny.json()).hostGranted).toBe(false);

    // 3. Same bearer — now denied by host policy. 403, not 401.
    const denied = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_BEARER}` },
      body: "{}",
    });
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body.error).toBe("sdk-guide-revoked");

    // 4. Restore — host re-grants; the same bearer works again.
    const restore = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_ADMIN}` },
      body: JSON.stringify({ granted: true }),
    });
    expect(restore.status).toBe(200);

    const restored = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_BEARER}` },
      body: "{}",
    });
    expect(restored.status).toBe(200);
  });

  it("host-only admin token cannot be used as the bearer (distinct channels)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/guide/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SDK_GUIDE_ADMIN}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("sdk-guide bearer cannot be used as the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${SDK_GUIDE_BEARER}` },
    });
    expect(res.status).toBe(401);
  });
});

// P7 isolation proof: each of the three local-service add-ons (Echo,
// Counter, sdk-guide) has its own loopback origin AND its own host-minted
// bearer token AND its own admin token. The audience-bound credential
// boundary holds across all three: a bearer minted for one add-on cannot
// drive another add-on's mutating route. The admin tokens do not cross
// between upstreams. Combined with the absence of any
// Access-Control-Allow-Origin header and the iframe sandboxing, this is the
// per-add-on, audience-bound credential boundary held under the host-owned
// grant model.
describe("SDK demo: per-add-on credential isolation (Phase 4 P7 — 3 add-ons)", () => {
  let echo;
  let counter;
  let guide;
  let echoPort;
  let counterPort;
  let guidePort;

  const ECHO_BEARER = "live-iso-echo-bearer";
  const COUNTER_BEARER = "live-iso-counter-bearer";
  const GUIDE_BEARER = "live-iso-guide-bearer";

  beforeEach(async () => {
    echo = createEchoServer({ port: 0, bearerToken: ECHO_BEARER, adminToken: "echo-admin" });
    counter = createCounterServer({ port: 0, bearerToken: COUNTER_BEARER, adminToken: "counter-admin" });
    guide = createSdkGuideServer({ port: 0, bearerToken: GUIDE_BEARER, adminToken: "guide-admin" });
    const e = await echo.start(); echoPort = e.port;
    const c = await counter.start(); counterPort = c.port;
    const g = await guide.start(); guidePort = g.port;
  });

  afterEach(async () => {
    await Promise.allSettled([echo?.close?.(), counter?.close?.(), guide?.close?.()]);
    delete process.env.RESONANTOS_ECHO_ACTIVE_BEARER;
    delete process.env.RESONANTOS_COUNTER_ACTIVE_BEARER;
    delete process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER;
  });

  it("Echo bearer cannot drive Counter's or Guide's mutating route (401)", async () => {
    const onCounter = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: { authorization: `Bearer ${ECHO_BEARER}` },
      body: "{}",
    });
    expect(onCounter.status).toBe(401);
    const onGuide = await fetch(`http://127.0.0.1:${guidePort}/api/guide/ping`, {
      method: "POST",
      headers: { authorization: `Bearer ${ECHO_BEARER}` },
      body: "{}",
    });
    expect(onGuide.status).toBe(401);
  });

  it("Counter bearer cannot drive Echo's or Guide's mutating route (401)", async () => {
    const onEcho = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: JSON.stringify({ message: "noise" }),
    });
    expect(onEcho.status).toBe(401);
    const onGuide = await fetch(`http://127.0.0.1:${guidePort}/api/guide/ping`, {
      method: "POST",
      headers: { authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    expect(onGuide.status).toBe(401);
  });

  it("Guide bearer cannot drive Echo's or Counter's mutating route (401)", async () => {
    const onEcho = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${GUIDE_BEARER}` },
      body: JSON.stringify({ message: "noise" }),
    });
    expect(onEcho.status).toBe(401);
    const onCounter = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: { authorization: `Bearer ${GUIDE_BEARER}` },
      body: "{}",
    });
    expect(onCounter.status).toBe(401);
  });

  it("each add-on's admin token cannot drive another add-on's /admin/state (401)", async () => {
    const echoOnCounter = await fetch(`http://127.0.0.1:${counterPort}/admin/state`, {
      headers: { authorization: "Bearer echo-admin" },
    });
    expect(echoOnCounter.status).toBe(401);
    const counterOnEcho = await fetch(`http://127.0.0.1:${echoPort}/admin/state`, {
      headers: { authorization: "Bearer counter-admin" },
    });
    expect(counterOnEcho.status).toBe(401);
    const echoOnGuide = await fetch(`http://127.0.0.1:${guidePort}/admin/state`, {
      headers: { authorization: "Bearer echo-admin" },
    });
    expect(echoOnGuide.status).toBe(401);
    const guideOnEcho = await fetch(`http://127.0.0.1:${echoPort}/admin/state`, {
      headers: { authorization: "Bearer guide-admin" },
    });
    expect(guideOnEcho.status).toBe(401);
  });
});
