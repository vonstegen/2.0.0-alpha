// CP-M2 Flag #1 -- security-sensitive leaf test for
// browser-first/host/harness-session-environment.mjs.
//
// Self-contained: no repo-internal dependencies beyond the module under test.
// Covers (per L1 prompt section 3):
//   - invalid env-name keys are filtered by the regex;
//   - envAllowlist copies a key from parentEnv;
//   - the credential lands under credentialName (never dropped);
//   - a baseEnv key wins over a parent key (no parent leak);
//   - redactEnvironment returns names only, sorted.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionEnvironment,
  redactEnvironment,
  SESSION_ENV_NAME_PATTERN,
} from "../host/harness-session-environment.mjs";

describe("buildSessionEnvironment", () => {
  it("filters out invalid env-name keys from baseEnv", () => {
    const env = buildSessionEnvironment({
      baseEnv: {
        HOME: "/x",
        "123bad": "nope", // rejected: starts with digit
        "has-dash": "nope", // rejected: dash
        "has space": "nope", // rejected: whitespace
        FOO: "ok",
      },
    });
    assert.deepEqual(env, { HOME: "/x", FOO: "ok" });
    assert.equal(Object.hasOwn(env, "123bad"), false);
    assert.equal(Object.hasOwn(env, "has-dash"), false);
    assert.equal(Object.hasOwn(env, "has space"), false);
  });

  it("drops non-string or empty values from baseEnv", () => {
    const env = buildSessionEnvironment({
      baseEnv: { GOOD: "yes", EMPTY: "", NUMERIC: 42, NULLED: null },
    });
    assert.deepEqual(env, { GOOD: "yes" });
  });

  it("copies an allowlisted key from parentEnv when not already in baseEnv", () => {
    const env = buildSessionEnvironment({
      baseEnv: {},
      envAllowlist: ["PATH"],
      parentEnv: { PATH: "/usr/bin", SECRET: "should-not-leak" },
    });
    assert.deepEqual(env, { PATH: "/usr/bin" });
    assert.equal(Object.hasOwn(env, "SECRET"), false);
  });

  it("ignores allowlist entries that are not valid env names or absent in parentEnv", () => {
    const env = buildSessionEnvironment({
      baseEnv: {},
      envAllowlist: ["PATH", "123bad", "missing-key"],
      parentEnv: { PATH: "/bin" },
    });
    assert.deepEqual(env, { PATH: "/bin" });
  });

  it("lands the credential under credentialName and never drops it", () => {
    const env = buildSessionEnvironment({
      baseEnv: { HOME: "/x" },
      credentialName: "OPENAI_API_KEY",
      credentialValue: "sk-live-abc",
    });
    assert.equal(env.OPENAI_API_KEY, "sk-live-abc");
    assert.equal(env.HOME, "/x");
  });

  it("rejects a credential whose name fails the regex (no silent drop of value)", () => {
    const env = buildSessionEnvironment({
      baseEnv: {},
      credentialName: "openai-api-key", // lowercase + dash -> invalid
      credentialValue: "sk-x",
    });
    // The credential must NOT appear under an invalid name; the value must
    // not be silently re-routed anywhere else.
    assert.equal(Object.hasOwn(env, "openai-api-key"), false);
    assert.equal(Object.values(env).includes("sk-x"), false);
  });

  it("does not leak the credential value via the allowlist path", () => {
    // Even if a caller mistakenly names the credential env var in the
    // allowlist, the explicit credential field wins and parent values stay
    // out: the credential is single-sourced.
    const env = buildSessionEnvironment({
      baseEnv: {},
      envAllowlist: ["OPENAI_API_KEY"],
      parentEnv: { OPENAI_API_KEY: "sk-from-parent-should-not-leak" },
      credentialName: "OPENAI_API_KEY",
      credentialValue: "sk-explicit",
    });
    assert.equal(env.OPENAI_API_KEY, "sk-explicit");
  });

  it("baseEnv wins over a parent env key with the same name (no parent leak)", () => {
    const env = buildSessionEnvironment({
      baseEnv: { HOME: "/from-base" },
      envAllowlist: ["HOME"],
      parentEnv: { HOME: "/should-not-leak" },
    });
    assert.equal(env.HOME, "/from-base");
  });

  it("is empty when called with no inputs", () => {
    assert.deepEqual(buildSessionEnvironment(), {});
  });

  it("exposes SESSION_ENV_NAME_PATTERN as a usable regex", () => {
    assert.ok(SESSION_ENV_NAME_PATTERN instanceof RegExp);
    assert.equal(SESSION_ENV_NAME_PATTERN.test("OPENAI_API_KEY"), true);
    assert.equal(SESSION_ENV_NAME_PATTERN.test("_LEADING_UNDERSCORE"), true);
    assert.equal(SESSION_ENV_NAME_PATTERN.test("123_NUMERIC_LEAD"), false);
    assert.equal(SESSION_ENV_NAME_PATTERN.test("HAS-DASH"), false);
  });
});

describe("redactEnvironment", () => {
  it("returns the env var NAMES only, never values", () => {
    const redacted = redactEnvironment({
      OPENAI_API_KEY: "sk-live-abc",
      HOME: "/x",
    });
    assert.deepEqual(redacted, ["HOME", "OPENAI_API_KEY"]); // sorted
    // Make sure no value leaked into the result.
    assert.ok(redacted.every((entry) => typeof entry === "string"));
    assert.equal(redacted.join("|").includes("sk-"), false);
  });

  it("filters invalid names out of the redacted view", () => {
    const redacted = redactEnvironment({
      HOME: "/x",
      "123bad": "v",
      FOO: "bar",
    });
    assert.deepEqual(redacted, ["FOO", "HOME"]);
  });

  it("returns an empty array for non-object or null input", () => {
    assert.deepEqual(redactEnvironment(null), []);
    assert.deepEqual(redactEnvironment(undefined), []);
    assert.deepEqual(redactEnvironment("string-not-object"), []);
  });

  it("returns sorted output regardless of insertion order", () => {
    const redacted = redactEnvironment({ ZEBRA: "z", ALPHA: "a", MID: "m" });
    assert.deepEqual(redacted, ["ALPHA", "MID", "ZEBRA"]);
  });
});