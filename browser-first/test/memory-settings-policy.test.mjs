import assert from "node:assert/strict";
import test from "node:test";

import { assertMemorySettingsSourceCanSave } from "../host/memory-settings-policy.mjs";

test("memory settings policy allows non-destructive source registrations", () => {
  assert.doesNotThrow(() => assertMemorySettingsSourceCanSave({ importMode: "copy-on-import" }));
  assert.doesNotThrow(() => assertMemorySettingsSourceCanSave({ importMode: "linked-readonly" }));
  assert.doesNotThrow(() => assertMemorySettingsSourceCanSave({}));
});

test("memory settings policy blocks move-on-import outside audited flow", () => {
  assert.throws(
    () => assertMemorySettingsSourceCanSave({ importMode: "move-on-import" }),
    /audited move preflight and execute flow/
  );
});
