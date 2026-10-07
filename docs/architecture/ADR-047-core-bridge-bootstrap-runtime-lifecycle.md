# ADRte -047: Core Bridge Bootstrap And Add-on Runtime Lifecycle

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-10-06

## Context

The Browser-First Alpha currently consists of an unpacked Chrome MV3 extension
and an authenticated loopback Node bridge. A historical Launch Bridge design
added `POST /bridge/launch` to that bridge and called it from the UI. That route
cannot bootstrap an offline bridge because its HTTP server and capability-token
issuer are part of the process it attempts to start.

The repository also needs a general lifecycle model for reviewed add-on runtime
services. Core bridge lifecycle and add-on runtime lifecycle are distinct: ROS
owns the core bridge, while host-owned SDK state determines which modular
runtime services are active behind it.

## Decision

### One ROS-owned core bridge

ROS owns one authenticated loopback core bridge. It owns common transport
authentication, capability enforcement, host-owned add-on registry state,
provider and credential boundaries, route composition, lifecycle
reconciliation, non-secret status projection, audit, and telemetry.

There is no bridge per add-on, category, connector, or terminal adapter.

### Independent Alpha bootstrap owner

The Alpha bootstrap owner is a dedicated Browser-First Chrome native-messaging
host at `browser-first/bootstrap/`. It is a separately installed, narrowly scoped
bootstrap process reachable when the core bridge HTTP server is offline. CP-BR1
implements its protocol, package, installer, extension origin pinning
(`chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/`), generation-fenced
lifecycle, and deterministic seams under a Browser-First-owned boundary. The
native host identity is `com.resonantos.bridge_bootstrap`; the authoritative
Alpha loopback endpoint is `http://127.0.0.1:47773`; the protocol is
`resonantos/bootstrap/v1`. See
[BRIDGE-BOOTSTRAP-PROTOCOL.md](BRIDGE-BOOTSTRAP-PROTOCOL.md) for the contract and
[BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md](BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md) for
installation.

The independent `apps/augmentor` native host remains implementation precedent
only; it is not the ROS bootstrap owner and its protocol or authority is not
reused implicitly.

A ROS-managed macOS `launchd` unit may later supervise the bridge for
development or recovery, but it is not the Alpha lifecycle authority. The
CP-BR1 installer does not generate a plist; it only writes the per-user wrapper
script and Chrome manifest described in the runbook.

CP-BR1 ships the independent native-messaging host and macOS installer;
extension startup integration is CP-BR2 and is not part of CP-BR1. **CP-BR2
completes the extension-side wiring**: the manifest carries
`nativeMessaging`; `bootstrap-client.js` wraps
`chrome.runtime.connectNative("com.resonantos.bridge_bootstrap")`; the
`background.js` service worker drives the bounded
`status` → `start` → health poll → bind sequence through
`bootstrap-startup.js`; a single `rebind-coordinator.js` is the shared
owner of the "healthy after start" trigger alongside the existing 401
rebind path; `side-panel.js` and `main-workspace.js` consume the same
lifecycle snapshot through `bootstrap-renderer.js`; a new Settings →
Bridge Bootstrap section exposes the explicit Stop / Retry actions.
See [BRIDGE-BOOTSTRAP-ROS-STARTUP.md](BRIDGE-BOOTSTRAP-ROS-STARTUP.md)
for the full contract. **CP-BR3 + CP-BR4 add the host-side add-on
runtime lifecycle**: the pure resolver (CP-BR3) in
`packages/addon-sdk/src/runtime-lifecycle.ts` produces the
desired-state decision; the reviewed factory registry and idempotent
reconciler (CP-BR4) in `browser-first/host/runtime-factory-registry.mjs`
and `browser-first/host/runtime-reconciler.mjs` translate it into
bounded, generation-fenced, per-add-on start / stop / degrade actions.
The composition root is
`browser-first/host/runtime-lifecycle-host.mjs`. CP-BR4 also closes
the CP-BR3 grant-completeness gap: the resolver now requires every
declared `requiredCapabilities` to be granted before the reconciler
acts on a `running` decision. See
[SDK-RUNTIME-LIFECYCLE-CONTRACT.md](SDK-RUNTIME-LIFECYCLE-CONTRACT.md)
and
[RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md](RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md).

### Bootstrap contract boundary

The independent host will expose only these lifecycle operations:

- `status`
- `start`
- `restart`
- `stopForShutdown`

It will pin the Node executable, bridge entrypoint, working directory, fixed
arguments, loopback endpoint policy, and explicit child environment allowlist.
Callers cannot provide an executable, shell command, argv, working directory,
arbitrary endpoint, environment, or secret.

Start is idempotent and generation-fenced. Startup, restart, stop, and health
waits are bounded. Process identity and ownership remain private; shutdown may
stop only an instance owned by this bootstrap host.

### Modular SDK runtime services

Add-ons never start the core bridge. Once the bridge is available, the host-owned
SDK lifecycle manager starts and stops reviewed runtime factories behind it.
Runtime desired state is:

```text
installed
AND enabled
AND required capabilities granted
AND compatible
AND reviewed runtime factory exists
AND no hard-stop revocation fence
```

Manifest `service.entrypoint` values do not authorize arbitrary process
execution. Runtime factories are reviewed host code.

### Classification is not lifecycle authority

Per ADR-046, `classification` describes what an add-on is. It does not grant
capabilities, select an executable, create a surface, or determine lifecycle.
Runtime activation derives from validated identity, `runtimeType`, grants,
compatibility, reviewed factory availability, revocation, and generation state.

## Public Status And Non-Leak Boundary

Core bridge status uses this closed vocabulary:

```text
offline | starting | connected | degraded | restarting | failed
```

Public bootstrap results may contain only:

- status;
- public version;
- loopback endpoint;
- instance or generation identifier;
- started-at timestamp;
- public failure code;
- `alreadyRunning` where applicable.

Add-on runtime status uses:

```text
inactive | starting | ready | degraded | failed | stopping
```

Public bootstrap/runtime projection and telemetry must not contain capability or
bootstrap tokens, provider credentials, prompt or memory content, auth/token
file contents, raw environment, private filesystem paths, child argv, PID,
unredacted exceptions, or arbitrary caller values.

## Superseded Launch Bridge Reconciliation

The three historical commits remain in Git as decision evidence. CP-BR0 treats
their files as follows:

| Historical file                                                                           | CP-BR0 disposition                                 | Reusable material                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `browser-first/host/bridge-launcher.mjs`                                                  | Kept but marked deprecated and unreachable         | `ensureBridgeReachable` reuse, env allowlist, bounded polling, spawn seam      |
| `browser-first/test/bridge-launcher.test.mjs`                                             | Kept as historical launcher-policy coverage        | Idempotence, allowlist, timeout, and shape-walker assertions to port to CP-BR1 |
| `browser-first/host/harness-host-service.mjs`                                             | Changed: removed `POST /bridge/launch`             | No offline lifecycle authority remains in the bridge                           |
| `browser-first/test/bridge-launch-route.test.mjs`                                         | Changed: now asserts the route is absent           | Regression proof for the CP-BR0 gate                                           |
| `src/core/web-transport.ts`                                                               | Changed: removed `bridge_launch`                   | Ordinary authenticated bridge transport remains unchanged                      |
| `src/core/web-transport.test.ts`                                                          | Changed: removed the superseded route expectation  | Existing route/capability inventory remains authoritative                      |
| `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js` | Changed: removed the bridge-hosted launch action   | Existing target resolution, health, and rebind UI remain                       |
| `browser-first/test/bridge-target-section-launch.test.mjs`                                | Changed: asserts no self-start action is rendered  | UI regression proof for CP-BR0                                                 |
| `src/modules/terminal/OpenInTerminalButton.tsx`                                           | Changed: disconnected state links to Settings only | Existing terminal launch, authorization, and settings recovery remain          |
| `src/modules/terminal/OpenInTerminalButton.test.tsx`                                      | Changed: asserts no self-start action              | Existing XH5 terminal behavior remains covered                                 |

The UI launch/status patterns may return only after they consume authoritative
status from the independent bootstrap transport. They must not infer core bridge
state from terminal runtime status.

## Consequences

- CP-BR1 adds a third packaged boundary, the native-messaging bootstrap host,
  without making it a second core bridge.
- The native host requires an extension-ID-pinned native-host manifest and
  installation/uninstallation documentation.
- Bridge HTTP capability tokens remain bridge-route authority; they are not the
  authority to start the bridge.
- Generated bridge configuration remains machine-local and secret. CP-BR1 must
  define secure credential adoption and explicit extension rebind without
  exposing credentials in public lifecycle status.
- Extension startup integration is deferred to CP-BR2.
- Generic SDK runtime lifecycle implementation is deferred to CP-BR3/CP-BR4.

## References

- [ROS Bridge + SDK Add-on Runtime Lifecycle Roadmap](ADDON-BRIDGE-RUNTIME-ROADMAP.md)
- [Alpha Runtime Boundary](ALPHA_RUNTIME_BOUNDARY.md)
- [Module Ownership](MODULE-OWNERSHIP.md)
- [ADR-006: Add-on Runtime & SDK](ADR-006-addon-runtime-sdk.md)
- [ADR-018: Add-on SDK V0](ADR-018-addon-sdk-v0.md)
- [ADR-037: Browser-First Chromium ResonantOS](ADR-037-browser-first-chromium-resonantos.md)
- [ADR-046: Add-on Classification, Category Registry, And Dynamic Surface Discovery](ADR-046-addon-classification-category-discovery.md)
