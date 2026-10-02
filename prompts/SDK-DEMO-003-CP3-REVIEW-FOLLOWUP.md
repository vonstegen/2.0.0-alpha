# SDK-DEMO-003 — CP3 review follow-up (AVIS → OMP)

Your CP3 report was independently verified. The code and tests are genuinely
green (I re-ran: discovery 10/10, demo 9/9, main-workspace-addons 6/6,
**browser-first 2182/2182**). Three items remain before CP3 is fully closed.
Do them in order, then STOP AND REPORT again.

## 1. BLOCKER — run the real-extension test now (it is the CP3 gate, not a P9 item)

The Phase-1 spec required loading the **actual unpacked extension** in Chrome and
driving the visible UI. A network-level smoke test is not sufficient — the 002
history is full of network tests that passed while the visible-UI path was broken.

Required evidence:

- Load `browser-first/resonantos-side-panel-extension` unpacked in Chrome
  (no `--disable-extensions`, no `Page.addScriptToEvaluateOnNewDocument`).
- Navigate to **Add-ons → Workspace add-ons → Open Resonant Echo**.
- Type `Hello Manolo`, click **SEND**.
- Assert the visible response renders `Resonant Echo received: "Hello Manolo"`.
- Paste: the test file you added, the command, and the pass/fail tail. If the
  visible path fails, fix it and re-run — do not paper over it.

## 2. TRACKED — self-grant must become host-owned in P6 (confirm it is not dropped)

`capabilityTokens` (bootstrap) and `grantedCapabilities` (UI) are currently
derived from the manifest's `grantPresets` — i.e. whatever the add-on author
wrote as `granted: true`. That is finding #5 (self-declared grants). It is
acceptable as a *placeholder* only if it is unambiguous that P6 replaces it with
the live `harness-registry` (`install()` + `setGrants(consent)`), so the bootstrap
reflects **host-owned** grants, not author-declared presets.

Confirm in your report that this is a hard P6 gate and not silently carried
forward.

## 3. CLEANUP — two small fixes in `main-workspace.js`

- Remove the dead no-op loop:
  `for (const preset of addon.surfaces?.length ? addon.surfaces : []) { void preset; }`
- `apiBasePath` is currently set to `addon.origin` (an origin, not a path).
  Either set a real base path (e.g. `"/api"`) or drop the field — do not pass an
  origin where a path is expected.

## Then

After item 1 is done (real-extension test green), proceed to **Phase 2 — P4
Counter** per `SDK-DEMO-003-OMP-BUILD-PROMPT.md`. STOP AND REPORT at CP4.
