# SDK Demo (SDK-DEMO-003)

Reference SDK demonstration built **against current ResonantOS `dev`** — not a
parallel architecture. The add-ons here are authored with the public
`@resonantos/addon-sdk` contract (`packages/addon-sdk/`), discovered and
validated through `validateAddOnManifest`, and (in later phases) registered,
granted, enforced, and revoked through the host-owned registry
(`browser-first/host/harness-registry.mjs`) and the loopback endpoint guard
(`browser-first/host/agent-runtime-endpoint.mjs`).

The demo **consumes** ResonantOS architecture. It does not add a second manifest
schema, a second registry, a second capability system, or a custom bridge
launcher.

## Add-ons

| Add-on | ID | Purpose |
| --- | --- | --- |
| Resonant Echo | `addon.resonant-echo` | Deterministic echo; proves the host-mediated round-trip |
| Resonant Counter | `addon.resonant-counter` | *(P4)* Second independent add-on; proves the mechanism is generic |
| SDK Guide | `addon.sdk-guide` | *(P7)* Interactive tutorial that teaches the SDK while using it |

## Layout

```text
examples/sdk-demo/
  README.md
  echo/
    addon.json      # AddOnSdkManifest (requests only; host owns grants)
    server.mjs      # operator-started loopback HTTP echo service (P3)
    index.html      # sandboxed add-on UI (P5)
  counter/          # (P4)
  sdk-guide/        # (P7)
  tests/            # deterministic validation + round-trip tests
```

## Manifest contract

`echo/addon.json` follows the same pattern as the existing reference manifests
(`examples/addons/*.json`):

- `requestedCapabilities` are authored with `granted: false` — they are
  **requests**, never self-grants.
- `grantPresets` carry host-approvable grant proposals.
- `service.entrypoint` is a loopback URL the operator starts; the manifest never
  declares a `runtime.command` and the bridge never spawns it.
- `provenance` and `runtimeIsolation` describe the trust posture the host
  enforces.

## Validate

```bash
npm run test:examples:sdk-demo   # (or) npx vitest run examples/sdk-demo/tests
```

## Roadmap status

- **P2 scaffold** — this directory and a validating Echo manifest. ✅ (current)
- **P3 Echo** — operator-started loopback echo service + host-mediated round-trip.
- **P4 Counter** — second independent add-on and cross-add-on isolation.
- **P5 Cross-origin UI** — port the verified sandboxed iframe + postMessage renderer.
- **P6 Capabilities** — real host grant / deny / revoke.
- **P7 SDK Guide** — interactive tutorial with a real policy denial.
- **P8 Adversarial** — red-team the trust boundaries.
- **P9 Live demo** — clean-checkout unpacked extension + real bridge.
- **P10 Integration review** — diff audit, regression, 002-findings disposition.

See `SDK-DEMO-003-ARCHITECTURE-MAP.md` (repo root) for the full contract.
