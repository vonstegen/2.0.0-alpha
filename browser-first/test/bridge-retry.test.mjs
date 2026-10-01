import assert from "node:assert/strict";
import test from "node:test";

import {
  backoffDelayMs,
  createReachabilityStore,
  defaultBackoffSleep,
  fetchWithRetry,
  isTransientNetworkError,
} from "../resonantos-side-panel-extension/src/lib/bridge-retry.mjs";

const okResponse = (body = {}) => ({ ok: true, status: 200, json: async () => body });

function networkError(code, message) {
  // Mimic a browser fetch TypeError with the underlying system cause.
  const error = new TypeError(message ?? "fetch failed");
  error.code = code;
  return error;
}

test("isTransientNetworkError: classifies ECONNREFUSED / fetch failed", () => {
  assert.equal(isTransientNetworkError(networkError("ECONNREFUSED")), true);
  assert.equal(isTransientNetworkError(networkError("ECONNRESET")), true);
  assert.equal(isTransientNetworkError(networkError("ETIMEDOUT")), true);
  assert.equal(isTransientNetworkError(networkError("EAI_AGAIN")), true);
  assert.equal(isTransientNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isTransientNetworkError(new TypeError("NetworkError when attempting to fetch resource.")), true);
});

test("isTransientNetworkError: rejects application errors and non-errors", () => {
  assert.equal(isTransientNetworkError(new TypeError("bad json")), false);
  assert.equal(isTransientNetworkError(new Error("bridge rejected")), false);
  assert.equal(isTransientNetworkError(null), false);
  assert.equal(isTransientNetworkError(undefined), false);
  assert.equal(isTransientNetworkError("ECONNREFUSED"), false);
});

test("isTransientNetworkError: walks error.cause for legacy codes", () => {
  const cause = new Error("connect ECONNREFUSED 127.0.0.1:47773");
  cause.code = "ECONNREFUSED";
  const wrapper = new TypeError("fetch failed");
  wrapper.cause = cause;
  assert.equal(isTransientNetworkError(wrapper), true);
});

test("backoffDelayMs: linear schedule", () => {
  assert.equal(backoffDelayMs(1, 250), 0);
  assert.equal(backoffDelayMs(2, 250), 250);
  assert.equal(backoffDelayMs(3, 250), 500);
  assert.equal(backoffDelayMs(4, 250), 750);
  assert.equal(backoffDelayMs(0, 250), 0);
});

test("fetchWithRetry: returns response on first success", async () => {
  let attempts = 0;
  const fetchFn = async () => { attempts += 1; return okResponse({ value: 1 }); };
  const response = await fetchWithRetry(fetchFn, "http://x/api", {}, { attempts: 4, baseDelayMs: 1, sleep: () => Promise.resolve() });
  assert.equal(response.status, 200);
  assert.equal(attempts, 1);
});

test("fetchWithRetry: recovers after two transient failures", async () => {
  let attempts = 0;
  const fetchFn = async () => {
    attempts += 1;
    if (attempts < 3) throw networkError("ECONNREFUSED");
    return okResponse({ value: attempts });
  };
  let recovered = null;
  const onUnreachable = [];
  const response = await fetchWithRetry(fetchFn, "http://x/api", {}, {
    attempts: 4,
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
    onUnreachable: (event) => onUnreachable.push(event),
    onRecovered: (event) => { recovered = event; },
  });
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
  assert.equal(recovered?.attempts, 3);
  assert.equal(recovered?.transientCount, 2);
  assert.equal(onUnreachable.length, 2);
  assert.equal(onUnreachable[0].attempt, 1);
});

test("fetchWithRetry: gives up after max attempts and emits persistent failure", async () => {
  let attempts = 0;
  const fetchFn = async () => { attempts += 1; throw networkError("ECONNREFUSED"); };
  let persistent = null;
  let recovered = false;
  let caught = null;
  try {
    await fetchWithRetry(fetchFn, "http://x/api", {}, {
      attempts: 4,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
      onPersistentFailure: (event) => { persistent = event; },
      onRecovered: () => { recovered = true; },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the retry helper to reject");
  assert.equal(caught?.code, "ECONNREFUSED");
  assert.equal(attempts, 4);
  assert.equal(recovered, false);
  assert.equal(persistent?.attempts, 4);
  assert.equal(persistent?.transientCount, 4);
});

test("fetchWithRetry: never retries non-transient errors", async () => {
  let attempts = 0;
  const fetchFn = async () => { attempts += 1; throw new TypeError("bad json"); };
  await assert.rejects(
    () => fetchWithRetry(fetchFn, "http://x/api", {}, {
      attempts: 4,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    }),
    /bad json/,
  );
  assert.equal(attempts, 1);
});

test("fetchWithRetry: never retries when the caller aborts", async () => {
  let attempts = 0;
  const controller = new AbortController();
  const fetchFn = async (_url, init) => {
    attempts += 1;
    controller.abort();
    throw networkError("ECONNREFUSED");
  };
  await assert.rejects(
    () => fetchWithRetry(fetchFn, "http://x/api", { signal: controller.signal }, {
      attempts: 4,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    }),
  );
  assert.equal(attempts, 1);
});

test("fetchWithRetry: abort during backoff sleep surfaces the abort error", async () => {
  const controller = new AbortController();
  const fetchFn = async () => { throw networkError("ECONNREFUSED"); };
  const promise = fetchWithRetry(fetchFn, "http://x/api", { signal: controller.signal }, {
    attempts: 4,
    baseDelayMs: 1000,
    sleep: defaultBackoffSleep,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, (error) => error.name === "AbortError" || /aborted/i.test(String(error?.message)));
});

test("defaultBackoffSleep: returns immediately when ms <= 0", async () => {
  await defaultBackoffSleep(0);
  await defaultBackoffSleep(-1);
});

test("createReachabilityStore: state transitions", () => {
  const store = createReachabilityStore();
  assert.equal(store.getState().state, "online");
  const events = [];
  store.subscribe((e) => events.push(e));
  store.onUnreachable({ reason: "ECONNREFUSED" });
  assert.equal(store.getState().state, "unreachable");
  store.onUnreachable({ reason: "ECONNREFUSED still" });
  assert.equal(store.getState().state, "unreachable");
  store.onPersistentFailure({ reason: "ECONNREFUSED exhausted" });
  assert.equal(store.getState().state, "persistent");
  store.onRecovered({ attempts: 4 });
  assert.equal(store.getState().state, "online");
  store.onUnreachable({ reason: "ECONNREFUSED again" });
  assert.equal(store.getState().state, "unreachable");
  store.onUnreachable({ reason: "still down" });
  assert.equal(store.getState().state, "unreachable");
  store.onRecovered({});
  assert.equal(store.getState().state, "online");
  // 4 events: first unreachable, second unreachable (refresh), persistent, recovered, third unreachable, fourth unreachable (refresh), recovered
  assert.ok(events.length >= 4, `expected at least 4 events, got ${events.length}`);
  const last = events[events.length - 1];
  assert.equal(last.state, "online");
});

test("createReachabilityStore: subscribe unsubscribe stops event delivery", () => {
  const store = createReachabilityStore();
  let count = 0;
  const unsubscribe = store.subscribe(() => count += 1);
  store.onUnreachable({ reason: "x" });
  assert.equal(count, 1);
  unsubscribe();
  store.onUnreachable({ reason: "x" });
  assert.equal(count, 1);
});

test("createReachabilityStore: invalid listener is a no-op", () => {
  const store = createReachabilityStore();
  const unsubscribe = store.subscribe(null);
  assert.equal(typeof unsubscribe, "function");
  // No throw on emit
  store.onUnreachable({ reason: "x" });
});