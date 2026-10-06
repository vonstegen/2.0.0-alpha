// CP-BR1: native-messaging framing tests.
//
// Pure decoder/encoder tests: split frames, multiple frames per chunk,
// oversized declared length (terminal error), exact-boundary frame,
// round-trip, and serialized stdout framing under backpressure.

import assert from "node:assert/strict";
import test from "node:test";

const {
  createFrameDecoder,
  createStdoutFramer,
  encodeFrame,
  MAX_INBOUND_MESSAGE_BYTES,
  MAX_OUTBOUND_MESSAGE_BYTES,
} = await import("../bootstrap/native-framing.mjs");

test("encodeFrame + decode round-trip preserves JSON", () => {
  const text = JSON.stringify({ protocol: "resonantos/bootstrap/v1", requestId: "r1", op: "status" });
  const frame = encodeFrame(text);
  const decoded = [];
  const decoder = createFrameDecoder({ onFrame: (msg) => decoded.push(msg) });
  decoder.push(frame);
  assert.deepEqual(decoded, [text]);
});

test("decoder handles split header, partial payload, then completion across multiple pushes", () => {
  const decoder = createFrameDecoder({
    onFrame: (text) => frames.push(text),
    onError: (error) => errors.push(error),
  });
  const frames = [];
  const errors = [];
  const msg = { x: 1 };
  const frame = encodeFrame(msg);
  decoder.push(frame.subarray(0, 2));       // 2/4 header
  decoder.push(frame.subarray(2, 4));       // remaining 2 bytes of header
  decoder.push(frame.subarray(4, 8));       // 4 of payload
  decoder.push(frame.subarray(8));          // rest
  assert.deepEqual(frames, [JSON.stringify(msg)]);
  assert.deepEqual(errors, []);
});

test("decoder delivers two frames from a single chunk in order", () => {
  const frames = [];
  const decoder = createFrameDecoder({ onFrame: (msg) => frames.push(msg) });
  const a = encodeFrame({ a: 1 });
  const b = encodeFrame({ b: 2 });
  decoder.push(Buffer.concat([a, b]));
  assert.deepEqual(frames, [JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 })]);
});

test("decoder rejects oversized declared length exactly once and becomes terminal", () => {
  const frames = [];
  const errors = [];
  const decoder = createFrameDecoder({
    maxBytes: 16,
    onFrame: (text) => frames.push(text),
    onError: (error) => errors.push(error),
  });
  // 0x80000000 = 2_147_483_648 declared length
  const oversizedHeader = Buffer.alloc(8);
  oversizedHeader.writeUInt32LE(2_147_483_648, 0);
  decoder.push(oversizedHeader);
  decoder.push(Buffer.from("leftover"));   // ignored after terminal
  decoder.push(Buffer.from("more"));        // still ignored
  assert.equal(decoder.terminal, true);
  assert.deepEqual(errors, [{ code: "oversized-frame" }]);
  assert.deepEqual(frames, []);
});

test("decoder accepts a frame at exactly the maxBytes boundary", () => {
  const maxBytes = 32;
  const decoder = createFrameDecoder({ maxBytes, onFrame: () => undefined });
  const payload = JSON.stringify({ x: "a".repeat(maxBytes) });
  // Construct payload whose UTF-8 length is exactly maxBytes.
  const sized = `"${"a".repeat(maxBytes - 2)}"`;
  assert.equal(Buffer.byteLength(sized), maxBytes);
  const json = Buffer.from(sized, "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(json.length, 0);
  decoder.push(Buffer.concat([header, json]));
  assert.equal(decoder.terminal, false);
});

test("encodeFrame refuses a message above MAX_OUTBOUND_MESSAGE_BYTES", () => {
  const huge = "x".repeat(MAX_OUTBOUND_MESSAGE_BYTES + 1);
  assert.throws(() => encodeFrame({ huge }), { code: "oversized-outbound-frame" });
});

test("createStdoutFramer serializes writes and refuses oversized outbound", async () => {
  const writes = [];
  const drainListeners = [];
  const stdout = {
    write: (chunk) => {
      writes.push(chunk);
      // First write returns false to trigger backpressure; later writes drain.
      return writes.length > 1;
    },
    once: (event, fn) => {
      if (event === "drain") drainListeners.push(fn);
      return stdout;
    },
  };
  const errors = [];
  const framer = createStdoutFramer({ stdout, onError: (e) => errors.push(e) });
  framer.send({ a: 1 });
  framer.send({ a: 2 });
  framer.send({ b: 3 });
  // Trigger drain manually (the framer's drain handler resumes the pump).
  for (const listener of drainListeners) listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 3, "all three frames flushed after backpressure");
  for (const write of writes) {
    const header = write.subarray(0, 4);
    const len = header.readUInt32LE(0);
    assert.equal(write.length, 4 + len, "every write is a single complete frame");
    JSON.parse(write.subarray(4).toString("utf8"));
  }
  assert.deepEqual(errors, []);

  // Oversized outbound is refused, never written.
  framer.send({ huge: "y".repeat(MAX_OUTBOUND_MESSAGE_BYTES + 1) });
  assert.equal(writes.length, 3, "oversized outbound was not flushed");
});

test("createStdoutFramer reports stdout write failure", () => {
  const stdout = {
    write: () => { throw new Error("EPIPE"); },
    once: () => {},
  };
  const errors = [];
  const framer = createStdoutFramer({ stdout, onError: (e) => errors.push(e) });
  framer.send({ x: 1 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "stdout-write-failed");
});