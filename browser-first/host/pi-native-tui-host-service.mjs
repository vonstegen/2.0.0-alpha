// Pi-native interactive TUI session host service (2D). Same clean chain as the
// proof route (authorize -> issued projection -> reviewed planner -> bounded
// launcher) but the REAL Pi TUI runs inside a pseudo-TTY. Raw ANSI output
// streams to the authorized surface over SSE; keystrokes flow back over
// input/resize routes. The credential stays env-only; the raw plan never
// crosses this boundary.
//
// Routes are composed into run-bridge-minimal's `bridgeRoutes` as
// `piNativeTuiRoutes`, so the bridge-route-capability audit constructs this
// factory the same way it constructs every other route-owning host service.
import { randomUUID } from "node:crypto";

const piDenied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });

// Bounded SSE frame subscription implementing the bridge writer contract
// (bridge-server.mjs writeBridgeEventStream): an async-iterable event source
// plus attachTransport/close/complete/queuedBytes/terminalCode. close() MUST
// terminate the attached transport — even after complete() — or the SSE
// response never ends; the terminal frame is transport bookkeeping while the
// pi.tui.exit DATA frame carries the real outcome.
export function createPiTuiStreamSubscription({ maxQueueBytes = 512 * 1024 } = {}) {
  const frames = [];
  let totalBytes = 0;
  let completed = false;
  let terminalCode = null;
  let transport = null;
  let onOverflow = () => {};
  const waiters = [];
  const wake = () => {
    for (const resolve of waiters.splice(0)) resolve();
  };
  return {
    get terminalCode() { return terminalCode; },
    get queuedBytes() { return totalBytes; },
    set overflowHandler(value) { onOverflow = typeof value === "function" ? value : () => {}; },
    attachTransport(value) {
      transport = value;
      return () => { transport = null; };
    },
    close(code = "runtime-unavailable") {
      if (terminalCode) return;
      terminalCode = code;
      wake();
      void transport?.terminate(terminalCode);
    },
    push(frame) {
      if (completed || terminalCode) return false;
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      totalBytes += bytes;
      frames.push(frame);
      wake();
      if (totalBytes > maxQueueBytes) {
        onOverflow();
        this.close("runtime-unavailable");
        return false;
      }
      return true;
    },
    complete() {
      if (completed || terminalCode) return;
      completed = true;
      wake();
    },
    events: {
      [Symbol.asyncIterator]() {
        let cursor = 0;
        const next = async () => {
          while (!completed && !terminalCode && cursor >= frames.length) {
            await new Promise((resolve) => { waiters.push(resolve); });
          }
          if (cursor < frames.length) {
            return { value: frames[cursor++], done: false };
          }
          return { done: true };
        };
        return { next };
      },
    },
  };
}

export function createPiNativeTuiHostService({
  // Adapter-generic resolvers. The factory accepts EITHER the legacy single-
  // service shape (piNativeSessionService + issuePiProjection) for backward
  // compatibility OR the dispatcher shape (resolveSessionService +
  // resolveProjection). When both are provided, the dispatcher wins.
  piNativeSessionService,
  issuePiProjection,
  resolveManifest,
  resolveSessionService,
  resolveProjection,
  createSubscription = createPiTuiStreamSubscription,
} = {}) {
  if (typeof resolveManifest !== "function") {
    throw new Error("createPiNativeTuiHostService requires a resolveManifest(addonId) function.");
  }
  const sessionServiceFor = typeof resolveSessionService === "function"
    ? resolveSessionService
    : () => piNativeSessionService;
  const projectionFor = typeof resolveProjection === "function"
    ? resolveProjection
    : ({ addonId, sessionId, manifest }) => issuePiProjection({ addonId, sessionId, manifest });
  const nativeTuiSessions = new Map();
  const nativeTuiSessionRoute = {
    method: "POST",
    path: "/pi-native/tui-session",
    requiredCapability: "provider-model-invoke",
    loopbackHostOnly: true,
    errorFamily: "harness",
    async handler(payload = {}) {
      const addonId = String(payload.addonId ?? "").trim();
      const providerProfileId = String(payload.providerProfileId ?? "").trim();
      if (!addonId || !providerProfileId) {
        throw Object.assign(new Error("invalid-event"), { code: "invalid-event" });
      }
      // Dynamic per-addon resolution (ADR-040): no add-on id is pinned by this
      // route. An unknown/uninstalled id resolves to null and fails closed with
      // the same public surface as the authorize gate.
      const manifest = resolveManifest(addonId);
      if (!manifest) {
        throw Object.assign(new Error("Runtime permission denied."), { code: "permission-denied" });
      }
      const sessionService = sessionServiceFor({ addonId, manifest });
      if (!sessionService || typeof sessionService.startSession !== "function") {
        throw Object.assign(new Error("Runtime permission denied."), { code: "permission-denied" });
      }
      const selectedModel = typeof payload.selectedModel === "string" ? payload.selectedModel.trim() : "";
      const initialPrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const cols = Number.isSafeInteger(payload.cols) && payload.cols >= 2 ? payload.cols : 80;
      const rows = Number.isSafeInteger(payload.rows) && payload.rows >= 2 ? payload.rows : 24;
      const sessionId = randomUUID();
      const issued = await projectionFor({ addonId: manifest.id, sessionId, manifest });
      const subscription = createSubscription();
      const { projection, handle } = await sessionService.startSession({
        addonId: manifest.id,
        manifest,
        providerProfileId,
        selectedModel,
        projection: issued.projection,
        sessionId,
        cols,
        rows,
        initialPrompt,
        onData: (chunk) => { subscription.push({ type: "pi.tui.data", sessionId, data: chunk }); },
        onExit: (evidence) => {
          subscription.push({ type: "pi.tui.exit", sessionId, evidence });
          subscription.complete();
        },
      });
      subscription.overflowHandler = () => handle.cancel();
      nativeTuiSessions.set(sessionId, { handle, subscription });
      return { ok: true, sessionId, projection };
    },
  };
  const nativeTuiEventRoute = {
    method: "GET",
    path: "/pi-native/tui-session/events",
    requiredCapability: "provider-model-invoke",
    loopbackHostOnly: true,
    errorFamily: "harness",
    responseType: "sse",
    terminalEventFamily: "harness",
    async handler(_payload, request) {
      const sessionId = new URL(request?.url ?? "/", "http://127.0.0.1").searchParams.get("sessionId") ?? "";
      const session = nativeTuiSessions.get(sessionId);
      if (!session) throw piDenied();
      if (request?.selfTest === true) return { stream: true };
      return session.subscription;
    },
  };
  const nativeTuiSessionAction = (action) => ({
    method: "POST",
    path: `/pi-native/tui-session/${action}`,
    requiredCapability: "provider-model-invoke",
    loopbackHostOnly: true,
    errorFamily: "harness",
    handler(payload = {}) {
      const sessionId = String(payload.sessionId ?? "").trim();
      const session = nativeTuiSessions.get(sessionId);
      if (!session) throw piDenied();
      if (action === "input") {
        const input = String(payload.input ?? "");
        session.handle.write(input);
      } else if (action === "resize") {
        if (!Number.isSafeInteger(payload.cols) || !Number.isSafeInteger(payload.rows)) {
          throw Object.assign(new Error("invalid-event"), { code: "invalid-event" });
        }
        session.handle.resize(payload.cols, payload.rows);
      } else if (action === "cancel") {
        session.handle.cancel();
      } else if (action === "dispose") {
        nativeTuiSessions.delete(sessionId);
      }
      return { ok: true };
    },
  });
  const piNativeTuiRoutes = [
    nativeTuiSessionRoute,
    nativeTuiEventRoute,
    nativeTuiSessionAction("input"),
    nativeTuiSessionAction("resize"),
    nativeTuiSessionAction("cancel"),
    nativeTuiSessionAction("dispose"),
  ];
  return { piNativeTuiRoutes };
}
