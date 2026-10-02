# SDK-DEMO-003 — Phase 2 go-ahead (AVIS → OMP)

CP3 is **verified and closed** (AVIS re-ran the real-extension test 1/1, demo
9/9, and confirmed the cleanup + P6 gate comment). Proceed to Phase 2.

## Phase 2 — P4 Counter (gate CP4)

Add `examples/sdk-demo/counter/` as a second, independent `local-service`
add-on through the **same** generic discovery + `workspace-iframe` renderer
(no per-ID branch anywhere):

- `counter/addon.json` — valid `AddOnSdkManifest`, own `service.entrypoint`
  (a loopback port distinct from Echo's 47321), own `requestedCapabilities`
  (`granted: false`) and `grantPresets`.
- `counter/server.mjs` — operator-started loopback service with `/health`,
  its own UI at `/`, and a stateful increment/read API. No ACAO.
- `counter/index.html` — sandboxed UI with the `resonantos-addon-bootstrap`
  listener + its own round-trip.
- `counter` tests in `examples/sdk-demo/tests/`.

**Isolation proof (required):** a test demonstrating Echo's granted credential
cannot call Counter's API and Counter's cannot call Echo's — the boundary is
per-add-on, not a shared token.

**Do not introduce a second discovery/registry/launcher.** Reuse
`workspace-addon-discovery.mjs` and `createWorkspaceAddonIframe` unchanged.

## Standing reminders

1. **Self-grant is still a placeholder** (`grantPresets`-derived) until P6. Do
   not make Counter gate on those tokens; keep it tolerant like Echo.
2. **Real-extension tests** are on `test:sdk-demo:extension` (not the default
   `test:browser-first` run) — invoke explicitly and keep them green.
3. `STOP AND REPORT` at CP4 with the same evidence discipline (exact commands,
   tails, what you verified in the real browser, known limitations).

Do not start Phase 3 (P6) — stop after P4.
