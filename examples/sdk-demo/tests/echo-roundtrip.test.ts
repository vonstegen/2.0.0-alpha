import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEchoServer } from "../echo/server.mjs";

// P6 round-trip at the service boundary: the operator-started upstream is
// now capability-gated exactly like Counter. Mutating routes require the
// host-minted bearer; the host-only /admin/* surface accepts a distinct
// admin token and flips an in-memory deny flag. The same Echo server is
// used by both the Phase-3 lifecycle proof (this file) and the real-extension
// test, which proves the bridge drives the same path.

const ECHO_BEARER = "live-echo-bearer-for-p6-tests";
const ECHO_ADMIN = "live-echo-admin-for-p6-tests";

describe("SDK demo: Resonant Echo upstream round-trip (P6 capability-gated)", () => {
  let service;
  let port;

  beforeEach(async () => {
    service = createEchoServer({ port: 0, bearerToken: ECHO_BEARER, adminToken: ECHO_ADMIN });
    const result = await service.start();
    port = result.port;
  });

  afterEach(async () => {
    if (service) await service.close();
    service = null;
  });

  it("answers /health (public)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.addon).toBe("addon.resonant-echo");
    expect(body.hostGranted).toBe(true);
  });

  it("returns 503 for the mutating route when started without a bearer", async () => {
    const unconfigured = createEchoServer({ port: 0, bearerToken: "", adminToken: "" });
    const { port: cfgPort } = await unconfigured.start();
    try {
      const res = await fetch(`http://127.0.0.1:${cfgPort}/api/echo/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "x" }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("echo-not-configured");
    } finally {
      await unconfigured.close();
    }
  });

  it("returns 401 when the bearer is missing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("echo-unauthorized");
  });

  it("returns 401 when the bearer is wrong (per-add-on audience boundary)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer counter-bearer-attempt" },
      body: JSON.stringify({ message: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("echoes a JSON message when the right bearer is presented", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "Hello Manolo" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: "Hello Manolo" });
  });

  it("emits no Access-Control-Allow-Origin header (sandboxed cross-origin iframe contract)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "x" }),
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it("serves the add-on UI (index.html) with the bootstrap listener", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain("resonantos-addon-bootstrap");
    expect(html).toContain("/api/echo/message");
  });

  // ---- Host-only admin / revoke lifecycle ----

  it("rejects /admin/state without an admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`);
    expect(res.status).toBe(401);
  });

  it("returns /admin/state with the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${ECHO_ADMIN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostGranted).toBe(true);
    expect(body.bearerConfigured).toBe(true);
  });

  it("host revoke flips the deny flag and the mutating route returns 403 (real host-policy result)", async () => {
    // 1. Baseline: grant + bearer succeeds.
    const ok = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "before-revoke" }),
    });
    expect(ok.status).toBe(200);

    // 2. Host flips the in-memory deny flag through the admin path.
    const deny = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_ADMIN}` },
      body: JSON.stringify({ granted: false }),
    });
    expect(deny.status).toBe(200);
    expect((await deny.json()).hostGranted).toBe(false);

    // 3. Same bearer, same payload — now denied by host policy. 403, not 401.
    const denied = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "after-revoke" }),
    });
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body.error).toBe("echo-revoked");

    // 4. Restore — host re-grants; the same bearer works again.
    const restore = await fetch(`http://127.0.0.1:${port}/admin/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_ADMIN}` },
      body: JSON.stringify({ granted: true }),
    });
    expect(restore.status).toBe(200);

    const restored = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "restored" }),
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({ echo: "restored" });
  });

  it("host-only admin token cannot be used as the bearer (distinct channels)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_ADMIN}` },
      body: JSON.stringify({ message: "admin-as-bearer" }),
    });
    expect(res.status).toBe(401);
  });

  it("echo bearer cannot be used as the admin token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin/state`, {
      headers: { authorization: `Bearer ${ECHO_BEARER}` },
    });
    expect(res.status).toBe(401);
  });
});
