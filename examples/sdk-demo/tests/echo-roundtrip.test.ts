import { afterEach, describe, expect, it } from "vitest";
import { createEchoServer } from "../echo/server.mjs";

// P3 round-trip at the service boundary: the operator-started upstream returns
// the host-mediated echo payload deterministically. The extension→host→add-on
// hop is covered in P5 (cross-origin renderer) + P6 (capabilities).
describe("SDK demo: Resonant Echo upstream round-trip", () => {
  let service;
  afterEach(async () => {
    if (service) await service.close();
  });

  it("answers /health", async () => {
    service = createEchoServer({ port: 0 });
    const { port } = await service.start();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", addon: "addon.resonant-echo" });
  });

  it("echoes a JSON message", async () => {
    service = createEchoServer({ port: 0 });
    const { port } = await service.start();
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Hello Manolo" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: "Hello Manolo" });
  });

  it("emits no Access-Control-Allow-Origin header", async () => {
    service = createEchoServer({ port: 0 });
    const { port } = await service.start();
    const res = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x" }),
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 404 for unknown routes", async () => {
    service = createEchoServer({ port: 0 });
    const { port } = await service.start();
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it("serves the add-on UI (index.html) with the bootstrap listener", async () => {
    service = createEchoServer({ port: 0 });
    const { port } = await service.start();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain("resonantos-addon-bootstrap");
    expect(html).toContain("/api/echo/message");
  });
});
