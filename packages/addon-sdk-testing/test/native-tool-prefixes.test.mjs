// Intent citation: docs/architecture/ADR-050-native-and-addon-tool-tiers.md
//
// Tests for the native-tool reserved surface and the classifier.
// The list is the single source of truth for "what names an addon
// tool declaration may NOT use", referenced by the validator (when
// that lands) and the bridge dev panel.
//
// ADR-050's rule is intentionally narrow: an addon tool name
// collides with the native surface only if it equals a
// `NATIVE_TOOL_CAPABILITIES` member (direct-shadow) or one of the
// short reserved literals (`fs`, `shell`, `exec`, `wallet`).
// Dotted-prefix shadows (e.g. `browser.start` matching the
// `browser.*` namespace) are not enforced today.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAddOnToolName,
  isAddOnToolNameAllowed,
  NATIVE_TOOL_CAPABILITIES,
  NATIVE_TOOL_RESERVED_LITERALS,
} from "../src/native-tool-prefixes.mjs";

test("rejects direct-shadows of native capabilities", () => {
  for (const cap of NATIVE_TOOL_CAPABILITIES) {
    const result = classifyAddOnToolName(cap);
    assert.equal(result.kind, "direct-shadow", cap);
    assert.equal(result.nativeCapability, cap);
    assert.equal(isAddOnToolNameAllowed(cap), false);
  }
});

test("rejects reserved literals", () => {
  for (const lit of NATIVE_TOOL_RESERVED_LITERALS) {
    const result = classifyAddOnToolName(lit);
    assert.equal(result.kind, "reserved-literal", lit);
    assert.equal(isAddOnToolNameAllowed(lit), false);
  }
});

test("allows ordinary addon tool names that share a native prefix", () => {
  for (const name of [
    "browser.start",
    "browser.open_url",
    "memory.search",
    "memory.read",
    "obsidian.write_note",
    "filesystem.delete_file",
    "research.ddg_search",
    "runner.probe.active",
    "addon.remove_thing",
    "provider.route_invalidate",
  ]) {
    const result = classifyAddOnToolName(name);
    assert.equal(result.kind, "none", name);
    assert.equal(isAddOnToolNameAllowed(name), true);
  }
});

test("allows ordinary addon tool names that don't share a prefix", () => {
  for (const name of [
    "deepseek_harness.status",
    "deepseek_harness.run_task",
    "reading_room.fetch_doc",
    "agent.delegate",
    "weather.current",
    "daily.summary",
    "tts_compliance_audit",
    "lia_verifier.verify",
  ]) {
    const result = classifyAddOnToolName(name);
    assert.equal(result.kind, "none", name);
    assert.equal(isAddOnToolNameAllowed(name), true);
  }
});

test("classifyAddOnToolName tolerates non-string / empty inputs", () => {
  assert.equal(classifyAddOnToolName(undefined).kind, "none");
  assert.equal(classifyAddOnToolName(null).kind, "none");
  assert.equal(classifyAddOnToolName("").kind, "none");
  assert.equal(classifyAddOnToolName(123).kind, "none");
});

test("every reserved literal is unique", () => {
  assert.equal(
    new Set(NATIVE_TOOL_RESERVED_LITERALS).size,
    NATIVE_TOOL_RESERVED_LITERALS.length,
  );
});

test("reserved literals do not silently collide with any native capability", () => {
  for (const lit of NATIVE_TOOL_RESERVED_LITERALS) {
    assert.equal(
      NATIVE_TOOL_CAPABILITIES.includes(lit),
      false,
      `${lit} is both a reserved literal and a native capability; clarify the spec`,
    );
  }
});
