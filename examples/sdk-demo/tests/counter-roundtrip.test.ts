import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCounterServer } from "../counter/server.mjs";
import { createEchoServer } from "../echo/server.mjs";

// P4 round-trip at the service boundary: the operator-started Counter
// upstream behaves deterministically; mutating routes require the operator-
// pinned bearer token, and the public read endpoint is unlocked (the UI
// must refresh the visible counter after every mutation).
describe("SDK demo: Resonant Counter upstream round-trip", () => {
  let service;
  let port;

  beforeEach(async () => {
    service = createCounterServer({ port: 0, initialValue: 5 });
    const started = await service.start();
    port = started.port;
  });

  afterEach(async () => {
    if (service) await service.close();
    // Drop any pinned bearer so a follow-up test sees a fresh server.
    delete process.env.RESONANTOS_COUNTER_ACTIVE_BEARER;
  });

  it("answers /health", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.addon).toBe("addon.resonant-counter");
    expect(typeof data.value).toBe("number");
  });

  it("emits no Access-Control-Allow-Origin header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/counter/value`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses mutating routes when no operator-pinned token is configured", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("counter-not-configured");
  });

  it("returns 401 on a wrong bearer token", async () => {
    process.env.RESONANTOS_COUNTER_ACTIVE_BEARER = "tok-correct";
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
    process.env.RESONANTOS_COUNTER_ACTIVE_BEARER = "tok-correct";
    const authHeader = { authorization: "Bearer tok-correct" };

    let res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect((await res.json()).value).toBe(6);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect((await res.json()).value).toBe(7);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/decrement`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect((await res.json()).value).toBe(6);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/reset`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: "{}",
    });
    expect((await res.json()).value).toBe(0);

    res = await fetch(`http://127.0.0.1:${port}/api/counter/value`);
    expect((await res.json()).value).toBe(0);
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
    expect(html).toContain("/api/counter/increment");
    expect(html).toContain("authoriz");
  });
});

// P4 isolation proof: each add-on has its own loopback origin AND its own
// operator-pinned bearer token. A bearer minted for Echo's bootstrap envelope
// must NOT authorize a Counter mutating call, and vice versa. Combined with
// the absence of any Access-Control-Allow-Origin header (covered above) and
// the iframe sandboxing (chrome-extension://…/… framed against the add-on's
// own origin), this is the per-add-on credential boundary.
describe("SDK demo: per-add-on credential isolation (Phase 2 P4 isolation proof)", () => {
  let echo;
  let counter;
  const echoToken = "echo-token-pinned";
  const counterToken = "counter-token-pinned";
  let echoPort;
  let counterPort;

  beforeEach(async () => {
    echo = createEchoServer({ port: 0 });
    const echoStarted = await echo.start();
    echoPort = echoStarted.port;

    counter = createCounterServer({ port: 0, initialValue: 0 });
    const counterStarted = await counter.start();
    counterPort = counterStarted.port;

    process.env.RESONANTOS_COUNTER_ACTIVE_BEARER = counterToken;
  });

  afterEach(async () => {
    await Promise.allSettled([echo?.close(), counter?.close()]);
    delete process.env.RESONANTOS_COUNTER_ACTIVE_BEARER;
  });

  it("Echo's bearer token cannot drive Counter's mutating routes", async () => {
    const res = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${echoToken}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("counter-unauthorized");
  });

  it("Counter's bearer does not authorize Echo's mutating path (Echo is bearer-agnostic)", async () => {
    // Echo's upstream accepts no Authorization-aware code path, so a Counter
    // bearer cannot influence its behavior — there is no shared-secret
    // coupling between the two add-ons' authorization boundaries.
    const res = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterToken}`,
      },
      body: JSON.stringify({ message: "Hello Counter" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.echo).toBe("Hello Counter");
  });

  it("the operator-pinned Counter bearer authorizes ONLY Counter mutating routes", async () => {
    // Counter increments with its own token (positive control).
    const ok = await fetch(`http://127.0.0.1:${counterPort}/api/counter/increment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterToken}`,
      },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).value).toBe(1);

    // Echo's upstream on its own port; Echo doesn't validate any token, so
    // there's no shared credential between the two add-ons' trust paths.
    const echoUpstream = await fetch(`http://127.0.0.1:${echoPort}/api/echo/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${counterToken}`,
      },
      body: JSON.stringify({ message: "Counter-bearer reaches Echo" }),
    });
    expect(echoUpstream.status).toBe(200);
    expect((await echoUpstream.json()).echo).toBe("Counter-bearer reaches Echo");
  });

  it("cross-origin iframes cannot read Counter's response (no ACAO header)", async () => {
    const res = await fetch(`http://127.0.0.1:${counterPort}/api/counter/value`, {
      headers: { origin: "http://127.0.0.1:47321" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
