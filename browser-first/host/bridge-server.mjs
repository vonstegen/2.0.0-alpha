import { writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";

const bridgeTokenHeader = "x-resonantos-bridge-token";
const bridgeTokenHeaderName = "X-ResonantOS-Bridge-Token";
const bridgeCapabilityHeader = "x-resonantos-bridge-capability-token";
const bridgeCapabilityHeaderName = "X-ResonantOS-Bridge-Capability-Token";

export function createBridgeToken() {
  return randomBytes(32).toString("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedBridgeRequest(request, bridgeToken) {
  return constantTimeEqual(request.headers[bridgeTokenHeader], bridgeToken);
}

function writeJson(response, status, payload, extensionOrigin) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": extensionOrigin,
    "Access-Control-Allow-Headers": `Content-Type, ${bridgeTokenHeaderName}, ${bridgeCapabilityHeaderName}`,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function routeKey(method, requestUrl) {
  const pathname = new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;
  return `${method ?? "GET"} ${pathname}`;
}

function compileRoutes(routes) {
  return new Map(routes.map((route) => [
    routeKey(route.method, route.path),
    route,
  ]));
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
}

export async function writeBridgeConfig({ extensionRoot, bridgePort, bridgeToken, bridgeCapabilityTokens = {} }) {
  const configPath = path.join(extensionRoot, "src", "bridge-config.generated.js");
  // SECURITY: Only bridgeUrl and bridgeToken are written to the generated config file.
  // bridgeCapabilityTokens are NOT included here; they are delivered at runtime via the
  // authenticated /api/capability-tokens endpoint, scoped behind the bridge token.
  const config = {
    bridgeUrl: `http://127.0.0.1:${bridgePort}`,
    bridgeToken,
  };
  await writeFile(
    configPath,
    `globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`,
    { mode: 0o600 },
  );
  return configPath;
}

function isAuthorizedCapabilityRequest(request, bridgeCapabilityTokens, requiredCapability) {
  if (!requiredCapability) {
    return true;
  }
  const expectedToken = bridgeCapabilityTokens?.[requiredCapability];
  return Boolean(expectedToken) && constantTimeEqual(request.headers[bridgeCapabilityHeader], expectedToken);
}

export async function evaluateBridgeRequestForSelfTest({
  method = "GET",
  url = "/",
  headers = {},
  body = {},
  bridgeToken,
  bridgeCapabilityTokens = {},
  routes = [],
} = {}) {
  try {
    const request = {
      method,
      url,
      headers: normalizeHeaders(headers),
    };
    if (method === "OPTIONS") {
      return { status: 204, payload: {} };
    }
    if (!isAuthorizedBridgeRequest(request, bridgeToken)) {
      return { status: 401, payload: { ok: false, error: "Unauthorized browser-first bridge request." } };
    }
    const route = compileRoutes(routes).get(routeKey(method, url));
    if (!route) {
      return { status: 404, payload: { ok: false, error: "Unknown browser-first bridge route." } };
    }
    if (!isAuthorizedCapabilityRequest(request, bridgeCapabilityTokens, route.requiredCapability)) {
      return { status: 403, payload: { ok: false, error: `Bridge route requires ${route.requiredCapability} capability.` } };
    }
    const payload = method === "POST" ? body : {};
    const result = await route.handler(payload, request);
    return { status: 200, payload: { ok: true, ...result } };
  } catch (error) {
    return { status: 500, payload: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function startBridgeServer({ port, bridgeToken, bridgeCapabilityTokens = {}, extensionOrigin, routes }) {
  // SECURITY: /api/capability-tokens is a built-in internal route that delivers capability
  // tokens only to callers who already hold a valid bridge token. Capability tokens are
  // never written to the generated config file; the extension fetches them at runtime.
  const internalRoutes = [
    {
      method: "GET",
      path: "/api/capability-tokens",
      handler: async () => ({ capabilityTokens: bridgeCapabilityTokens }),
    },
    ...routes,
  ];
  const server = http.createServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readJsonBody(request) : {};
      const result = await evaluateBridgeRequestForSelfTest({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
        bridgeToken,
        bridgeCapabilityTokens,
        routes: internalRoutes,
      });
      writeJson(response, result.status, result.payload, extensionOrigin);
    } catch (error) {
      writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }, extensionOrigin);
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
  return server;
}

export function bridgeServerPort(server, fallbackPort = 0) {
  const address = server.address();
  return typeof address === "object" && address ? address.port : fallbackPort;
}

export async function startBridgeServerWithFallback({
  port,
  bridgeToken,
  bridgeCapabilityTokens = {},
  extensionOrigin,
  routes,
  fallbackPorts = [0],
}) {
  const attempts = [port, ...fallbackPorts].filter((candidate, index, list) =>
    Number.isInteger(Number(candidate)) && list.indexOf(candidate) === index
  );
  let lastError = null;
  for (const candidate of attempts) {
    try {
      const server = await startBridgeServer({
        port: Number(candidate),
        bridgeToken,
        bridgeCapabilityTokens,
        extensionOrigin,
        routes,
      });
      const actualPort = bridgeServerPort(server, Number(candidate));
      return {
        server,
        requestedPort: Number(port),
        attemptedPort: Number(candidate),
        actualPort,
        recovered: Number(candidate) !== Number(port),
      };
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("Failed to start browser-first bridge.");
}

export async function runBridgeAuthSelfTest({ port, bridgeToken, extensionOrigin }) {
  const server = await startBridgeServer({
    port,
    bridgeToken,
    extensionOrigin,
    routes: [{ method: "GET", path: "/status", handler: async () => ({ bridge: "self-test" }) }],
  });
  const actualPort = bridgeServerPort(server, port);
  const unauthorized = await fetch(`http://127.0.0.1:${actualPort}/status`);
  const wrongToken = await fetch(`http://127.0.0.1:${actualPort}/status`, {
    headers: { [bridgeTokenHeaderName]: "wrong-token" },
  });
  const authorized = await fetch(`http://127.0.0.1:${actualPort}/status`, {
    headers: { [bridgeTokenHeaderName]: bridgeToken },
  });
  server.close();
  return {
    ok: unauthorized.status === 401 && wrongToken.status === 401 && authorized.ok,
    unauthorizedStatus: unauthorized.status,
    wrongTokenStatus: wrongToken.status,
    authorizedStatus: authorized.status,
  };
}
