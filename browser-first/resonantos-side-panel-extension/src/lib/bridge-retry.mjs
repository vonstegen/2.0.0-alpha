// Bounded retry wrapper for the bridge's fetch.
//
// Rationale
// ---------
// The bridge process accepts new connections via Node's HTTP listener. The
// extension's service worker hits ECONNREFUSED in transient bursts (kernel
// backlog saturation, App Nap throttling on the host, transient bridge
// restarts). Each ECONNREFUSED surfaces as a `TypeError: fetch failed` in
// the browser — indistinguishable to the caller from a permanent bridge
// outage. Without retry, the extension's boot fetch blanks the panels and
// they don't recover until the user manually reloads.
//
// This module wraps a fetch function with bounded retry on transient network
// failures (ECONNREFUSED, ECONNRESET, fetch-failed). AbortError is never
// retried (the caller asked to stop). HTTP error responses (4xx/5xx) are
// NOT retried — the bridge answered; the caller decides what to do.
//
// Backoff
// -------
// Linear: `delayMs * (attempt - 1)`. Defaults to 250ms, 500ms, 1000ms with
// a hard ceiling of 4 attempts (initial + 3 retries). Aborts cancel both
// the in-flight fetch AND any pending backoff sleep via the same AbortSignal.
//
// Reachability events
// -------------------
// Optional callbacks fire at each transition:
//   onUnreachable({ route, reason, attempt })            — every transient failure (during retries)
//   onRecovered({ route, attempts, transientCount })     — fetch succeeded after transient failures
//   onPersistentFailure({ route, reason, attempts })     — retries exhausted
//
// The UI subscribes to these to render "bridge unreachable — retrying" /
// "bridge recovered" banners instead of blanking the panels.

const TRANSIENT_NAME_PATTERNS = [
  /fetch failed/i,
  /networkerror/i,
  /network request failed/i,
  /failed to fetch/i,
];

// Node's undici categorizes the underlying system error as `code` on the
// TypeError. ECONNREFUSED (macOS refuse bursts) and ECONNRESET both count.
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

// Hard ceiling on attempts (initial + 3 retries = 4 fetches). Tests override.
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 250;

export function isTransientNetworkError(error) {
  if (!error) return false;
  // The browser's fetch rejects with a TypeError whose `cause` (when
  // available) carries the underlying system error with a `code`. Older
  // browsers expose only `message`.
  const code = typeof error.code === "string" ? error.code : (error.cause?.code ?? "");
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
  const message = String(error.message ?? "");
  if (TRANSIENT_NAME_PATTERNS.some((pattern) => pattern.test(message))) return true;
  return false;
}

export function backoffDelayMs(attempt, baseMs = DEFAULT_DELAY_MS) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) return 0;
  return baseMs * (attempt - 1);
}

export async function defaultBackoffSleep(ms, signal) {
  if (ms <= 0) return;
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("aborted", "AbortError");
  }
  await new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
      signal.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function describeError(error) {
  if (!error) return "unknown";
  const code = error.code ?? error.cause?.code;
  const message = error.message ?? String(error);
  return code ? `${code}: ${message}` : message;
}

// Run a fetch with bounded retry on transient failures. The wrapped fetch
// receives the same AbortSignal — aborts cancel both the in-flight fetch
// AND any pending backoff sleep.
//
// `attempts` is the max number of attempts (initial + retries). Pass 1 to
// disable retry.
export async function fetchWithRetry(fetch, url, init = {}, options = {}) {
  const maxAttempts = Number.isSafeInteger(options.attempts) && options.attempts > 0
    ? options.attempts
    : DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = Number.isSafeInteger(options.baseDelayMs) && options.baseDelayMs >= 0
    ? options.baseDelayMs
    : DEFAULT_DELAY_MS;
  const sleep = typeof options.sleep === "function" ? options.sleep : defaultBackoffSleep;
  const onUnreachable = typeof options.onUnreachable === "function" ? options.onUnreachable : null;
  const onRecovered = typeof options.onRecovered === "function" ? options.onRecovered : null;
  const onPersistentFailure = typeof options.onPersistentFailure === "function" ? options.onPersistentFailure : null;
  const signal = init.signal;
  const route = typeof options.route === "string" ? options.route : url;
  let transientCount = 0;
  let lastTransient = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    try {
      const response = await fetch(url, init);
      if (transientCount > 0 && onRecovered) {
        try { onRecovered({ route, attempts: attempt, transientCount }); } catch { /* observer never breaks the call */ }
      }
      return response;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (!isTransientNetworkError(error)) throw error;
      transientCount += 1;
      lastTransient = error;
      if (onUnreachable) {
        try { onUnreachable({ route, attempt, reason: describeError(error) }); } catch { /* observer never breaks the call */ }
      }
      if (attempt < maxAttempts) {
        const delay = backoffDelayMs(attempt, baseDelayMs);
        try {
          await sleep(delay, signal);
        } catch (sleepError) {
          if (signal?.aborted) throw signal.reason ?? sleepError;
          throw sleepError;
        }
      }
    }
  }
  if (onPersistentFailure) {
    try { onPersistentFailure({ route, attempts: maxAttempts, transientCount, reason: describeError(lastTransient) }); } catch { /* observer never breaks the call */ }
  }
  throw lastTransient ?? new Error(`fetchWithRetry exhausted ${maxAttempts} attempts for ${route}`);
}

// Create a reachability event store. The bridge client emits state
// transitions on it; the UI subscribes to render banners. Three states:
//   - online         — most recent attempt succeeded
//   - unreachable    — transient failure during retry (UI shows "retrying…")
//   - persistent     — retries exhausted (UI shows "bridge unavailable")
export function createReachabilityStore() {
  const listeners = new Set();
  let state = "online";
  let lastTransitionAt = null;
  let lastReason = null;
  let consecutiveFailures = 0;

  function emit(event) {
    lastTransitionAt = Date.now();
    for (const listener of listeners) {
      try { listener(event); } catch { /* listener failure never breaks the store */ }
    }
  }

  return {
    onUnreachable(payload) {
      if (state !== "unreachable") {
        state = "unreachable";
        lastReason = payload?.reason ?? null;
        emit({ state, ...payload });
      } else {
        lastReason = payload?.reason ?? null;
        emit({ state, ...payload });
      }
    },
    onRecovered(payload) {
      consecutiveFailures = 0;
      if (state !== "online") {
        state = "online";
        lastReason = null;
        emit({ state, ...payload });
      }
    },
    onPersistentFailure(payload) {
      consecutiveFailures += 1;
      if (state !== "persistent") {
        state = "persistent";
        lastReason = payload?.reason ?? null;
        emit({ state, ...payload });
      } else {
        lastReason = payload?.reason ?? null;
        emit({ state, ...payload });
      }
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState() {
      return { state, lastTransitionAt, lastReason, consecutiveFailures };
    },
  };
}