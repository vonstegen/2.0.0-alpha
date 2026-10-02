# SDK-DEMO-003 — P6 regression fix (AVIS → OMP)

A live browser test of the demo found a real P6 bug that the automated tests
missed. Fix it before any further phase work.

## Bug

`executeAddonsStatus` (`browser-first/host/addon-delegation-service.mjs`,
around line 2754-2757) calls `registry.install(fullManifest, { enabled: false })`
**unconditionally on every `/addons/status` poll**. `harness-registry.install`
*replaces* the installation entry and resets `grantedCapabilities` back to
`requestedCapabilities` (all `granted: false`). Result: any grant made via
`POST /addons/workspace/grant` is **wiped the next time the extension polls
`/addons/status`** (i.e. every time the Add-ons panel renders).

Repro: grant `network` for Echo → re-poll `GET /addons/status` → `POST
/addons/workspace/bootstrap` returns `capabilityTokens: {}` and the grants
snapshot shows `granted: false`.

Why the existing tests missed it: `echo/counter/p6-extension-live.test.mjs`
grant *after* the last `/addons/status` fetch and never re-poll, so the wipe
never triggers in-suite.

## Fix

Only install when the add-on is not already registered (mirror the guard that
`executeWorkspaceAddonBootstrap` already has):

```js
const alreadyInstalled = workspaceAddonRegistry
  ? Boolean(workspaceAddonRegistry.snapshot().installations[fullManifest?.id])
  : false;
if (workspaceAddonRegistry && fullManifest && !alreadyInstalled) {
  await workspaceAddonRegistry.install(fullManifest, { enabled: false });
}
```

## Required regression test

Add a test that: installs → grants `network` → re-polls `/addons/status` (or
re-runs the install path) → asserts `bootstrap` still returns the bearer token
and the grants snapshot still shows `granted: true`. This must fail before the
fix and pass after.

## Then

- Full regression: vitest, demo vitest, browser-host, and the three
  real-extension tests green.
- `STOP AND REPORT` with the real tails and the new regression test.

Do not proceed to P7 until this is fixed and re-verified.
