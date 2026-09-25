import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCounterServer } from "../counter/server.mjs";
import { createEchoServer } from "../echo/server.mjs";

// P6 round-trip at the service boundary: the operator-started Counter
// upstream is capability-gated. Mutating routes require the host-minted
// bearer; the host-only /admin/* surface accepts a distinct admin token
// and flips an in-memory deny flag. The same Counter server is used by both
// the Phase-3 lifecycle proof (this file) and the real-extension test,
// which proves the bridge drives the same path.

const COUNTER_BEARER = "live-counter-bearer-for-p6-tests";
const COUNTER_ADMIN = "live-counter-admin-for-p6-tests";

describe("SDK demo: Resonant Counter upstream round-trip (P6 capability-gated)", () => {
  let service;
  let port;

  beforeEach(async () => {
    service = createCounterServer({
      port: 0,
      initialValue: 5,
      bearerToken: COUNTER_BEARER,
      adminToken: COUNTER_ADMIN,
    });
    const started = await service.start();
    port = started.port;
  });

  afterEach(async () => {
    if (service) await service.close();
    service = null;
    delete process.env.RESONANTOS_COUNTER_ACTIVE_BEARER;
  });

  it("answers /health (public)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.addon).toBe("addon.resonant-counter");
    expect(typeof data.value).toBe("number");
    expect(data.hostGranted).toBe(true);
  });

  it("emits no Access-Control-Allow-Origin header (sandboxed cross-origin iframe contract)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/counter/value`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses mutating routes when no operator-pinned token is configured", async () => {
    const unconfigured = createCounterServer({ port: 0, bearerToken: "", adminToken: "" });
    const { port: cfgPort } = await unconfigured.start();
    try {
      const res = await fetch(`http://127.0.0.1:${cfgPort}/api/counter/increment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("counter-not-configured");
    } finally {
      await unconfigured.close();
    }
  });

  it("returns 401 on a wrong bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-wrong",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("counter-unauthorized");
  });

  it("accepts the operator-pinned bearer token on increment/decrement/reset", async () => {
    const authHeader = { authorization: `Bearer ${COUNTER_BEARER}` };

    let res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBe(6);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/decrement`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBe(5);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/reset`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBe(0);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it("serves the add-on UI (index.html) with the bootstrap listener + Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain("resonantos-addon-bootstrap");
    expect(html).toContain("/api/counter/increment");
    expect(html.toLowerCase()).toMatch(/authoriz/);
  });

  // ---- Host-only admin / revoke lifecycle ----

  it("rejects /admin/state without an admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`);
    expect(res.status).toBe(401);
  });

  it("returns /admin/state with the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${COUNTER_ADMIN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostGranted).toBe(true);
    expect(body.bearerConfigured).toBe(true);
  });

  it("host revoke flips the deny flag and the mutating route returns 403 (real host-policy result)", async () => {
    // 1. Baseline: grant + bearer succeeds.
    const ok = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).value).toBe(6);

    // 2. Host flips the in-memory deny flag through the admin path.
    const deny = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_ADMIN}` },
      body: JSON.stringify({ granted: false }),
    });
    expect(deny.status).toBe(200);
    expect((await deny.json()).hostGranted).toBe(false);

    // 3. Same bearer, same payload — now denied by host policy. 403, not 401.
    const denied = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body.error).toBe("counter-revoked");

    // 4. Restore — host re-grants; the same bearer works again.
    const restore = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_ADMIN}` },
      body: JSON.stringify({ granted: true }),
    });
    expect(restore.status).toBe(200);

    const restored = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    expect(restored.status).toBe(200);
  });

  it("host-only admin token cannot be used as the bearer (distinct channels)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_ADMIN}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("counter bearer cannot be used as the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${COUNTER_BEARER}` },
    });
    expect(res.status).toBe(401);
  });
});

// P6 isolation proof: each add-on has its own loopback origin AND its own
// host-minted bearer token AND its own admin token. A bearer minted for
// Echo's bootstrap envelope must NOT authorize a Counter mutating call, and
// vice versa. The admin tokens must not cross between upstreams. Combined
// with the absence of any Access-Control-Allow-Origin header and the iframe
// sandboxing (chrome-extension://…/… framed against each add-on's own
// origin), this is the per-add-on, audience-bound credential boundary held
// under the host-owned grant model.
describe("SDK demo: per-add-on credential isolation (Phase 3 P6)", () => {
  let echo;
  let counter;
  const echoBearer = "echo-bearer-pinned";
  const echoAdmin = "echo-admin-pinned";
  const counterBearer = "counter-bearer-pinned";
  const counterAdmin = "counter-admin-pinned";
  let echoPort;
  let counterPort;

  beforeEach(async () => {
    echo = createEchoServer({ port: 0, bearerToken: echoBearer, adminToken: echoAdmin });
    const echoStarted = await echo.start();
    echoPort = echoStarted.port;

    counter = createCounterServer({
      port: 0,
      initialValue: 0,
      bearerToken: counterBearer,
      adminToken: counterAdmin,
    });
    const counterStarted = await counter.start();
    counterPort = counterStarted.port;
  });

  afterEach(async () => {
    await Promise.allSettled([echo?.close(), counter?.close()]);
  });

  it("Echo's bearer token cannot drive Counter's mutating routes", async () => {
    const res = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${echoBearer}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("counter-unauthorized");
  });

  it("Counter's bearer token cannot drive Echo's mutating routes", async () => {
    const res = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterBearer}`,
      },
      body: JSON.stringify({ message: "Counter bearer reaches Echo" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("echo-unauthorized");
  });

  it("Echo's admin token cannot revoke Counter at Counter's admin path", async () => {
    const res = await fetch(`http://127.0.0.1:${counterPort}/admin/deny`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${echoAdmin}`,
      },
      body: JSON.stringify({ granted: false }),
    });
    expect(res.status).toBe(401);
  });

  it("Counter's admin token cannot revoke Echo at Echo's admin path", async () => {
    const res = await fetch(`http://127.0.0.1:${echoPort}/admin/deny`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterAdmin}`,
      },
      body: JSON.stringify({ granted: false }),
    });
    expect(res.status).toBe(401);
  });

  it("the operator-pinned Counter bearer authorizes ONLY Counter mutating routes", async () => {
    const ok = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterBearer}`,
      },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).value).toBe(1);

    const echoUpstream = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterBearer}`,
      },
      body: JSON.stringify({ message: "Counter bearer reaches Echo" }),
    });
    expect(echoUpstream.status).toBe(401);
  });

  it("the operator-pinned Echo bearer authorizes ONLY Echo mutating routes", async () => {
    const ok = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${echoBearer}`,
      },
      body: JSON.stringify({ message: "Echo bearer authorized" }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).echo).toBe("Echo bearer authorized");

    const counterUpstream = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${echoBearer}`,
      },
      body: "{}",
    });
    expect(counterUpstream.status).toBe(401);
  });

  it("cross-origin iframes cannot read Counter's response (no ACAO header)", async () => {
    const res = await fetch(`http://127.0.0.1:${counterPort}/api/counter/value`, {
      headers: { origin: `http://127.0.0.1:${echoPort}` },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
