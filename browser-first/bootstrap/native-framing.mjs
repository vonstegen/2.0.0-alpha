// CP-BR1: Chrome native-messaging framing for the independent bootstrap host.
//
// Wire format (Chrome native messaging):
//   [4-byte little-endian unsigned message length][UTF-8 JSON payload]
//
// Hard rules:
//   * Bounded. A declared inbound length above MAX_INBOUND_MESSAGE_BYTES is
//     a deterministic protocol error: `onError({ code: "oversized-frame" })`
//     fires exactly once and the decoder becomes terminal (later pushes are
//     ignored). The stream cannot be resynchronized safely, so the host
//     exits after this; Chrome observes the port disconnect.
//   * Truncated frames (stdin ends mid-frame) produce no callback and no
//     partial parse; the host exits on stdin end.
//   * Split frames (a frame spread over many chunks) and multiple frames
//     per chunk are handled by accumulation.
//   * stdout carries framed protocol messages ONLY. `createStdoutFramer`
//     serializes writes through a queue so an interleaved `write` can never
//     tear a frame, and honors backpressure via `drain`.
//   * Outbound payloads above MAX_OUTBOUND_MESSAGE_BYTES are refused and
//     reported through `onError`; they are never written.

export const MAX_INBOUND_MESSAGE_BYTES = 256 * 1024;
export const MAX_OUTBOUND_MESSAGE_BYTES = 1024 * 1024;

const HEADER_BYTES = 4;

/**
 * Incremental frame decoder. Pure: no I/O, no timers.
 *
 * @param {{
 *   maxBytes?: number,
 *   onFrame: (payloadText: string) => void,
 *   onError?: (error: { code: string }) => void,
 * }} options
 * @returns {{ push: (chunk: Buffer | Uint8Array) => void, readonly terminal: boolean }}
 */
export function createFrameDecoder({ maxBytes = MAX_INBOUND_MESSAGE_BYTES, onFrame, onError } = {}) {
  if (typeof onFrame !== "function") throw new TypeError("createFrameDecoder requires onFrame");
  let buffered = Buffer.alloc(0);
  let terminal = false;
  const fail = (code) => {
    if (terminal) return;
    terminal = true;
    onError?.({ code });
  };
  return {
    get terminal() { return terminal; },
    push(chunk) {
      if (terminal) return;
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      while (buffered.length >= HEADER_BYTES) {
        const declared = buffered.readUInt32LE(0);
        if (declared > maxBytes) {
          buffered = Buffer.alloc(0);
          fail("oversized-frame");
          return;
        }
        if (buffered.length < HEADER_BYTES + declared) return; // truncated: wait for more
        const payload = buffered.subarray(HEADER_BYTES, HEADER_BYTES + declared);
        buffered = buffered.subarray(HEADER_BYTES + declared);
        onFrame(payload.toString("utf8"));
        if (terminal) return; // a handler may terminate the decoder
      }
    },
  };
}

/**
 * Encode one outbound message as a native-messaging frame. The message is
 * `JSON.stringify`-ed inside; callers may also pass an already-stringified
 * text frame to avoid the second serialization round-trip.
 *
 * @param {unknown} message JSON-serializable value or pre-stringified text
 * @param {{ maxBytes?: number }} [options]
 * @returns {Buffer}
 */
export function encodeFrame(message, { maxBytes = MAX_OUTBOUND_MESSAGE_BYTES } = {}) {
  const json = typeof message === "string"
    ? Buffer.from(message, "utf8")
    : Buffer.from(JSON.stringify(message), "utf8");
  if (json.length > maxBytes) {
    const error = new Error("outbound frame exceeds the native-messaging size limit");
    error.code = "oversized-outbound-frame";
    throw error;
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/**
 * Serialized stdout framer. Every `send` enqueues one complete frame; a
 * single pump flushes the queue in order and waits for `drain` when the
 * stream applies backpressure, so frames can never interleave or tear.
 *
 * @param {{
 *   stdout: { write: (chunk: Buffer) => boolean, once: (event: string, fn: () => void) => void },
 *   onError?: (error: { code: string }) => void,
 *   maxBytes?: number,
 * }} options
 * @returns {{ send: (message: unknown) => boolean, flush: () => Promise<void> }}
 */
export function createStdoutFramer({ stdout, onError, maxBytes = MAX_OUTBOUND_MESSAGE_BYTES } = {}) {
  if (!stdout || typeof stdout.write !== "function") throw new TypeError("createStdoutFramer requires stdout");
  const queue = [];
  let pumping = false;
  let flushWaiters = [];
  const pump = () => {
    if (pumping) return;
    pumping = true;
    while (queue.length > 0) {
      const frame = queue[0];
      let ok;
      try {
        ok = stdout.write(frame);
      } catch {
        queue.length = 0;
        pumping = false;
        onError?.({ code: "stdout-write-failed" });
        resolveFlushWaiters();
        return;
      }
      queue.shift();
      if (!ok) {
        stdout.once("drain", () => {
          pumping = false;
          pump();
        });
        return;
      }
    }
    pumping = false;
    resolveFlushWaiters();
  };
  const resolveFlushWaiters = () => {
    if (queue.length === 0 || !pumping) {
      const waiters = flushWaiters;
      flushWaiters = [];
      for (const resolve of waiters) resolve();
    }
  };
  return {
    send(message) {
      let frame;
      try {
        frame = encodeFrame(message, { maxBytes });
      } catch {
        onError?.({ code: "oversized-outbound-frame" });
        return false;
      }
      queue.push(frame);
      pump();
      return true;
    },
    flush() {
      if (queue.length === 0) return Promise.resolve();
      return new Promise((resolve) => {
        flushWaiters.push(resolve);
        pump();
      });
    },
  };
}
