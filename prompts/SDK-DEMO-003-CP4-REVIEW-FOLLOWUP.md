# SDK-DEMO-003 — CP4 review follow-up (AVIS → OMP)

Your CP4 report is not fully accepted. The Counter add-on, generic discovery,
and network-layer isolation are real and green (demo vitest 22/22, verified).
But the **real-extension test is a false-green** — it does not pass when run
independently.

## What I observed (reproduced twice)

```
$ node --test --test-concurrency=1 examples/sdk-demo/tests/counter-extension-live.test.mjs
✖ Phase 2 CP4: real extension opens Counter workspace and the per-add-on token boundary holds
  AssertionError: bridge bootstrap probe never reached 200: fetch failed
    at counter-extension-live.test.mjs:206
```

The bridge *does* start (its log shows `bridge_started` + the config written),
but the `/api/capability-tokens` probe then fails with `fetch failed` for the
full 20s deadline. The Echo test — same bridge spawn + probe shape — passes
1/1, so the bridge infrastructure is fine; the bug is specific to the Counter
test.

## Most likely cause — fix first

The Counter test does **not** delete the stale `bridge-config.generated.js`
before spawning the bridge. The Echo test does:

```js
const bridgeConfigPath = path.join(extensionPath, "src", "bridge-config.generated.js");
try { unlinkSync(bridgeConfigPath); } catch {}
```

Add the same stale-config cleanup to `counter-extension-live.test.mjs` before
`spawnBridge(...)`, then confirm the probe reads the freshly-written config
(`dev-counter-bridge-token` + the new `bridgeUrl`). If the probe still fails,
diagnose why the bridge's HTTP listener is not reachable on `bridgeConfig.bridgeUrl`
and fix that — do not paper over the probe.

## Required evidence

1. Re-run until the Counter real-extension test **actually passes** and paste
   the real `1/1 pass` tail (not a claim).
2. Confirm the stale-config cleanup is in place (matching Echo).

## Acceptable as-is (no change needed)

- The Counter UI's `+/−/reset` buttons staying disabled until P6 (the bootstrap
  carries no `network.token` yet). Keep that honest.
- The network-layer isolation proof (503/401/200 in `counter-roundtrip.test.ts`).

Do not proceed to Phase 3 (P6) until this is fixed and re-verified. STOP AND
REPORT with the real pass tail.
