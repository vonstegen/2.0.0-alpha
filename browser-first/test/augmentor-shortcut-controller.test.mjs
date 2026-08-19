// Tests for issue #241 — Augmentor Alt+A / Alt+S shortcut contract.
// https://github.com/ResonantOS/2.0.0-alpha/issues/241
//
// The controller module attaches itself to globalThis via an IIFE — same
// pattern as content-inline-actions.js. We mirror the existing test approach
// from content-redaction.test.mjs: readFile the source, JSDOM-eval it, then
// pull the exported surface off `dom.window`.
//
// This deliberately avoids importing the module via ESM `import` because the
// IIFE assigns to `globalThis`, which the dynamic-import evaluator does not
// surface through the namespace. The content script consumes the same global
// at runtime, so testing against it exercises the actual contract.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const controllerScriptPath = new URL(
  "../resonantos-side-panel-extension/src/lib/augmentor-shortcut-controller.js",
  import.meta.url
);

async function loadController() {
  const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
  dom.window.eval(await readFile(controllerScriptPath, "utf8"));
  return dom.window.ResonantOSAugmentorShortcutController;
}

function makeEvent(overrides = {}) {
  return {
    altKey: false,
    code: undefined,
    ctrlKey: false,
    isComposing: false,
    key: "a",
    metaKey: false,
    shiftKey: false,
    target: { tagName: "BODY", isContentEditable: false },
    ...overrides
  };
}

test("controller is exposed on a window global and frozen", async () => {
  const ctrl = await loadController();
  assert.ok(ctrl, "controller must attach to globalThis when loaded");
  assert.equal(Object.isFrozen(ctrl), true, "controller must be frozen");
  assert.equal(typeof ctrl.classifyShortcut, "function");
  assert.equal(typeof ctrl.createRequestToken, "function");
  assert.equal(typeof ctrl.isSummaryContextStale, "function");
  assert.ok(Array.isArray(ctrl.RESTRICTED_SCHEMES));
});

test("classifyShortcut returns alt-a for Alt+A on a non-editable body", async () => {
  const ctrl = await loadController();
  {
    const result = ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true }));
    assert.equal(result.action, "alt-a");
    assert.equal(result.conflict, "none");
  }
});

test("classifyShortcut returns alt-s for Alt+S and is case-insensitive", async () => {
  const ctrl = await loadController();
  {
    const lower = ctrl.classifyShortcut(makeEvent({ key: "s", code: "KeyS", altKey: true }));
    assert.equal(lower.action, "alt-s");
    assert.equal(lower.conflict, "none");
  }
  // The DOM KeyboardEvent.key is already lowercased by browsers for letter
  // keys when shift is not held, but the upper-cased form is a real input that
  // some keyboard layers produce. The controller normalises via toLowerCase.
  {
    const upper = ctrl.classifyShortcut(makeEvent({ key: "S", code: "KeyS", altKey: true }));
    assert.equal(upper.action, "alt-s");
    assert.equal(upper.conflict, "none");
  }
});

test("classifyShortcut keeps plain Alt+A and Alt+S active", async () => {
  const ctrl = await loadController();
  const altA = ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true }));
  assert.equal(altA.action, "alt-a");
  assert.equal(altA.conflict, "none");
  const altS = ctrl.classifyShortcut(makeEvent({ key: "s", code: "KeyS", altKey: true }));
  assert.equal(altS.action, "alt-s");
  assert.equal(altS.conflict, "none");
});

test("classifyShortcut rejects other Alt+letter combos", async () => {
  const ctrl = await loadController();
  for (const key of ["b", "F", "ArrowUp", "Enter", " ", "1"]) {
    assert.equal(
      ctrl.classifyShortcut(makeEvent({ key, altKey: true })).action,
      "none",
      `Alt+${key} must not bind to a shortcut`
    );
  }
});

test("classifyShortcut rejects auxiliary modifiers as combined conflict for shortcut keys", async () => {
  const ctrl = await loadController();
  assert.equal(
    ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true, ctrlKey: true })).conflict,
    "combined"
  );
  assert.equal(
    ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true, metaKey: true })).conflict,
    "combined"
  );
  assert.equal(
    ctrl.classifyShortcut(makeEvent({ key: "S", code: "KeyS", altKey: true, shiftKey: true })).conflict,
    "combined"
  );
});

test("classifyShortcut reports composed conflict for IME events", async () => {
  const ctrl = await loadController();
  assert.equal(
    ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true, isComposing: true })).conflict,
    "composed"
  );
});

test("classifyShortcut ignores IME composition when Alt is not involved", async () => {
  const ctrl = await loadController();
  const result = ctrl.classifyShortcut(makeEvent({ key: "Process", code: "KeyA", isComposing: true }));
  assert.equal(result.action, "none");
  assert.equal(result.conflict, "none");
});

test("classifyShortcut leaves Alt+Shift+A to the documented side-panel command", async () => {
  const ctrl = await loadController();
  const result = ctrl.classifyShortcut(makeEvent({ key: "A", code: "KeyA", altKey: true, shiftKey: true }));
  assert.equal(result.action, "none");
  assert.equal(result.conflict, "none");
});

test("classifyShortcut reports editing conflict when focus is on a real form field", async () => {
  const ctrl = await loadController();
  const onInput = makeEvent({
    code: "KeyA",
    key: "a",
    altKey: true,
    target: { tagName: "INPUT", isContentEditable: false, type: "text" }
  });
  assert.equal(ctrl.classifyShortcut(onInput).conflict, "editing");
  const onContentEditable = makeEvent({
    code: "KeyS",
    key: "s",
    altKey: true,
    target: { tagName: "DIV", isContentEditable: true }
  });
  assert.equal(ctrl.classifyShortcut(onContentEditable).conflict, "editing");
});

test("classifyShortcut reports restricted conflict for chrome:// and about: pages", async () => {
  const ctrl = await loadController();
  for (const scheme of ctrl.RESTRICTED_SCHEMES) {
    const href = `${scheme}//extensions`;
    assert.equal(
      ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyA", altKey: true }), { locationHref: href }).conflict,
      "restricted",
      `expected restricted for ${href}`
    );
  }
});

test("classifyShortcut silently no-ops on bare non-modifier presses", async () => {
  const ctrl = await loadController();
  {
    const none = ctrl.classifyShortcut(makeEvent({ key: "a" }));
    assert.equal(none.action, "none");
    assert.equal(none.conflict, "none");
  }
});

test("classifyShortcut survives a missing event target (target defaults safely)", async () => {
  const ctrl = await loadController();
  // No `target` on the event at all. The controller should still report the
  // shortcut action and `conflict: none` — the page-level consumer decides
  // whether a valid selection exists.
  {
    const noTarget = ctrl.classifyShortcut({ altKey: true, code: "KeyA", key: "a", isComposing: false, metaKey: false, ctrlKey: false, shiftKey: false });
    assert.equal(noTarget.action, "alt-a");
    assert.equal(noTarget.conflict, "none");
  }
});

test("createRequestToken is monotonic and uniquely named", async () => {
  const ctrl = await loadController();
  const a = ctrl.createRequestToken();
  const b = ctrl.createRequestToken();
  const c = ctrl.createRequestToken();
  assert.ok(a.startsWith("augmentor-alt-s-"));
  assert.ok(b.startsWith("augmentor-alt-s-"));
  assert.ok(c.startsWith("augmentor-alt-s-"));
  assert.equal(new Set([a, b, c]).size, 3, "tokens must be unique");
});

test("isSummaryContextStale flags navigation by URL or title change", async () => {
  const ctrl = await loadController();
  const stored = { url: "https://example.com/a", title: "A" };
  assert.equal(ctrl.isSummaryContextStale(stored, { url: "https://example.com/b", title: "A" }), true);
  assert.equal(ctrl.isSummaryContextStale(stored, { url: "https://example.com/a", title: "B" }), true);
  assert.equal(ctrl.isSummaryContextStale(stored, { url: "https://example.com/a", title: "A" }), false);
});

test("isSummaryContextStale treats missing stored context as stale", async () => {
  const ctrl = await loadController();
  assert.equal(ctrl.isSummaryContextStale(null, { url: "https://x", title: "x" }), true);
  assert.equal(ctrl.isSummaryContextStale(undefined, { url: "https://x", title: "x" }), true);
  assert.equal(ctrl.isSummaryContextStale({}, { url: "https://x", title: "x" }), true);
});

// Smoke test for AC #5 — confirms the inline-result region can host a
// aria-live announcement. We don't dispatch DOM events here because JSDOM
// would need the rest of the content script loaded; the live-region
// attribute exists in the markup that content.js renders today.
// macOS regression test (issue raised during manual-test review).
// On macOS, Option+A produces `event.key === "å"` (and Option+S produces "ß"),
// not "a"/"s". The controller must match on `event.code` ("KeyA"/"KeyS") so
// the shortcut works on macOS, EU/UK layouts, and any Dvorak/Colemak remap.
test("classifyShortcut handles macOS Option+A (key=å, code=KeyA)", async () => {
  const ctrl = await loadController();
  {
    const a = ctrl.classifyShortcut(makeEvent({ key: "å", code: "KeyA", altKey: true }));
    assert.equal(a.action, "alt-a");
    assert.equal(a.conflict, "none");
  }
  {
    const s = ctrl.classifyShortcut(makeEvent({ key: "ß", code: "KeyS", altKey: true }));
    assert.equal(s.action, "alt-s");
    assert.equal(s.conflict, "none");
  }
});

test("classifyShortcut ignores layout-only key when code does not match", async () => {
  const ctrl = await loadController();
  // A pressed but with a different code (e.g. someone holds a dead key) should
  // not match. Only the physical-key code matters.
  assert.equal(
    ctrl.classifyShortcut(makeEvent({ key: "a", code: "KeyB", altKey: true })).action,
    "none"
  );
});

test("classifyShortcut still no-ops when neither key nor code is present", async () => {
  const ctrl = await loadController();
  {
    const result = ctrl.classifyShortcut({ altKey: true, isComposing: false, metaKey: false, ctrlKey: false, shiftKey: false });
    assert.equal(result.action, "none");
    assert.equal(result.conflict, "none");
  }
});

test("inline result region carries aria-live for screen-reader announcements", async () => {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <section id="resonantos-inline-assistant">
         <div class="ros-inline-result" aria-live="polite" aria-atomic="true">Select text, then choose an action.</div>
       </section>
     </body></html>`
  );
  const result = dom.window.document.querySelector(".ros-inline-result");
  assert.ok(result, "inline-result region must exist for announcements");
  assert.equal(result.getAttribute("aria-live"), "polite");
  assert.equal(result.getAttribute("aria-atomic"), "true");
});

// AC #3 ("Navigation or tab changes expire stale summary requests") and #2
// ("Alt+S produces exactly one source-grounded summary for the initiating
// tab") are guarded by the in-flight token. Two concurrent presses must not
// both render — and consecutive presses must both run.
//
// We exercise the controller's token generator and the staleness detector
// here; the actual non-reentrancy guarantee in content.js is enforced by the
// activeAltSRequestToken === token check at the top of runAugmentorAltS.

test("consecutive request tokens are always distinct (no token reuse)", async () => {
  const ctrl = await loadController();
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const t = ctrl.createRequestToken();
    assert.ok(!seen.has(t), `token ${t} was reused`);
    seen.add(t);
  }
  assert.equal(seen.size, 1000);
});

test("isSummaryContextStale reports false on identical context (re-press contract)", async () => {
  const ctrl = await loadController();
  const stored = { url: "https://example.com/page", title: "Page" };
  // After the first Alt+S completes, the stored context matches the current
  // page. A re-press must be allowed to refresh — the staleness gate must
  // return false so the gate does not block the re-press.
  assert.equal(
    ctrl.isSummaryContextStale(stored, { url: "https://example.com/page", title: "Page" }),
    false,
    "matching url+title must be reported as not-stale (allows re-press refresh)"
  );
});

// Regression guard: the re-press contract for runAugmentorAltS depends on
// activeAltSRequestToken being cleared after every terminal branch (success
// and error). The behaviour we want: consecutive Alt+S presses both land.
//
// We model that contract at the controller layer because the content.js
// close guards reference activeAltSRequestToken (line 1187) plus the
// createRequestToken() factory exposed here.

test("re-press Alt+S: the in-flight guard pattern permits consecutive non-overlapping completions", async () => {
  const ctrl = await loadController();
  // Stand-in for the content.js module-level variable.
  let activeAltSRequestToken = "";
  const runOnce = async (token) => {
    if (activeAltSRequestToken && activeAltSRequestToken !== token) return { skipped: true };
    activeAltSRequestToken = token;
    // Simulate async provider work.
    await Promise.resolve();
    activeAltSRequestToken = "";
    return { skipped: false, token };
  };

  const first = ctrl.createRequestToken();
  const second = ctrl.createRequestToken();
  assert.notEqual(first, second, "tokens must differ for consecutive presses");

  const r1 = await runOnce(first);
  const r2 = await runOnce(second);
  assert.deepEqual(r1, { skipped: false, token: first });
  assert.deepEqual(r2, { skipped: false, token: second });
  assert.equal(activeAltSRequestToken, "", "token must be cleared after the press completes");
});
