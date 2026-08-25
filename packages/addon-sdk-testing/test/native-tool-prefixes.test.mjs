// Intent citation: docs/architecture/ADR-050-native-and-addon-tool-tiers.md
//
// Tests for the native-tool reserved-prefix / reserved-literal list
// and the classifier. The list is the single source of truth for
// "what names an addon tool declaration may NOT use", referenced by
// the validator (when that lands) and the bridge dev panel.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyAddOnToolName,
  isAddOnToolNameAllowed,
  NATIVE_TOOL_CAPABILITIES,
  NATIVE_TOOL_PREFIXES,
  NATIVE_TOOL_RESERVED_LITERALS,
} from "../src/native-tool-prefixes.mjs";

test("NATIVE_TOOL_PREFIXES covers every native namespace", () => {
  for (const required of [
    "research",
    "browser",
    "filesystem",
    "process",
    "provider",
    "archive",
    "delegation",
    "addon",
    "runner",
    "compute",
  ]) {
    assert.ok(NATIVE_TOOL_PREFIXES.includes(required), `missing ${required}`);
  }
});

test("every native capability lives under a registered prefix", () => {
  for (const cap of NATIVE_TOOL_CAPABILITIES) {
    const prefix = cap.split(".")[0];
    assert.ok(
      NATIVE_TOOL_PREFIXES.includes(prefix),
      `${cap} uses unregistered prefix ${prefix}`,
    );
  }
});

test("rejects direct-shadows of native capabilities", () => {
  for (const cap of NATIVE_TOOL_CAPABILITIES) {
    const result = classifyAddOnToolName(cap);
    assert.equal(result.kind, "direct-shadow", cap);
    assert.equal(result.nativeCapability, cap);
    assert.equal(isAddOnToolNameAllowed(cap), false);
  }
});

test("rejects dotted-prefix shadows", () => {
  for (const shadow of [
    "filesystem.delete_user",
    "browser.open_url",
    "research.ddg_search",
    "runner.probe.active",
    "addon.remove_thing",
    "provider.route_invalidate",
  ]) {
    const result = classifyAddOnToolName(shadow);
    assert.equal(result.kind, "prefix-shadow", shadow);
    assert.ok(isAddOnToolNameAllowed(shadow) === false);
  }
});

test("rejects reserved literals whose prefix is not in NATIVE_TOOL_PREFIXES", () => {
  for (const lit of ["shell", "exec", "fs", "wallet"]) {
    const result = classifyAddOnToolName(lit);
    assert.equal(result.kind, "reserved-literal", lit);
    assert.equal(isAddOnToolNameAllowed(lit), false);
  }
});

test("reserved literals that are also prefixes produce prefix-shadow", () => {
  for (const lit of ["browser", "filesystem", "process", "addon", "runner"]) {
    const result = classifyAddOnToolName(lit);
    assert.equal(result.kind, "prefix-shadow", lit);
    assert.ok(isAddOnToolNameAllowed(lit) === false);
  }
});

test("allows ordinary addon tool names", () => {
  for (const name of [
    "deepseek_harness.status",
    "deepseek_harness.run_task",
    "reading_room.fetch_doc",
    "memory.search",
    "agent.delegate",
    "weather.current",
    "daily.summary",
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
