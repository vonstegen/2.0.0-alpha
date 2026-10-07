# UI State Glossary (CP-BR6)

> Status: **CP-BR6 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js),
> [`docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`](BRIDGE-RUNTIME-PROJECTION.md),
> [`docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md`](BRIDGE-BOOTSTRAP-ROS-STARTUP.md),
> [`docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`](SDK-RUNTIME-LIFECYCLE-CONTRACT.md).

The Bridge & Runtimes surface renders two distinct status vocabularies.
They are never conflated.

## Core bridge vocabulary (CP-BR2)

The bootstrap native-messaging host publishes one of six public states.
The surface labels them as follows.

| Public status   | Surface label       | Tone   | View state |
| --------------- | ------------------- | ------ | ---------- |
| `offline`       | Bridge offline      | error  | failed     |
| `starting`      | Bridge starting…    | info   | loading    |
| `connected`     | Bridge connected    | ok     | ready      |
| `degraded`      | Bridge degraded     | warn   | degraded   |
| `restarting`    | Bridge restarting…  | info   | loading    |
| `failed`        | Bridge failed       | error  | failed     |

The bootstrap snapshot is the **OFFLINE source** of core-bridge health.
When the snapshot reports `connected`, the projection is the source of
online detail; when it reports anything else, the surface falls back to
bootstrap-only and renders a degraded view.

## Add-on runtime vocabulary (CP-BR3)

The CP-BR3 lifecycle contract publishes one of six public states. The
surface labels them as follows.

| Public status | Surface label     | Tone   |
| ------------- | ----------------- | ------ |
| `inactive`    | Disabled          | info   |
| `starting`    | Starting…         | info   |
| `ready`       | Active            | ok     |
| `degraded`    | Degraded          | warn   |
| `failed`      | Failed            | error  |
| `stopping`    | Stopping…         | info   |

A runtime is `inactive` when the host has it installed but not enabled.
The UI's **Enable** action routes through `POST /addons/enabled`.

## Connector vocabulary (CP-BR5)

Connectors are a subset of add-on runtimes whose classification is
`channel-addon` or whose `runtimeType` is `channel-addon`. The surface
labels the two public state axes as follows.

| Connection state  | Surface label     |
| ----------------- | ----------------- |
| `installed`       | Installed         |
| `enabled`         | Enabled           |
| `disabled`        | Disabled          |
| `not-installed`   | Not installed     |
| `incompatible`    | Incompatible      |
| `revoked`         | Revoked           |

| Authorization state | Surface label         |
| ------------------- | --------------------- |
| `granted`           | Authorized            |
| `partial`           | Partially authorized  |
| `missing`           | Authorization missing |
| `revoked`           | Authorization revoked |
| `not-applicable`    | Not applicable        |

`lastSuccessfulHealthAt` is rendered as `—` when the host has not
recorded a public timestamp. The UI never inlines a private path or
auth-file location.

## Session vocabulary

The projection exposes `addonId`, `runtimeId`, and `activeSessionCount`
per session. The surface renders these as a simple list with a count
suffix. Private session data (conversation content, prompt history,
memory content) is never surfaced.

## Surface view states

Every section of the Bridge & Runtimes surface is in one of four
view states. The view state is independent of the public status; the
surface derives it from the bootstrap snapshot + the projection.

| View state | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `loading`  | The section is waiting for its first projection; the UI shows a spinner. |
| `empty`    | The projection has been received and the list is genuinely empty.       |
| `degraded` | The bridge is offline or failed; online detail is unavailable.          |
| `failed`   | The core bridge itself is `offline` or `failed`.                        |
| `ready`    | Online detail is available and consistent.                              |

The view state drives the section's `data-state` attribute. Operators
can read the state from the DOM (for test assertions) or from the
visible label.

## Diagnostic fields

The diagnostics section always renders the public failure code, the
update mechanism (`polling` / `push` / `both`), and the current
projection generation. The first two are always available; the third
is `not yet fetched` until the first projection arrives.

## What the surface will never show

The surface is closed against the following fields. A renderer that
reads any of them is a bug.

- `token`, `accessToken`, `bearer`, `password`, `secret`, `privateKey`,
  `credential`, `authFile`, `tokenFile`
- `argv`, `childArgv`, `pid`, `processEnv`, `env`
- `memory`, `prompt`, `promptContent`, `memoryContent`
- `privatePath`, `home`, `userPath`, `rawError`, `stack`

These fields are enforced at three layers:

1. The projection is closed at the host
   ([`runtime-projection.mjs`](../../browser-first/host/runtime-projection.mjs));
   unknown fields throw.
2. The view model
   ([`bridge-runtimes-view.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js))
   re-validates the closed shape before exposing the view to the renderer.
3. The renderer uses `textContent` / `createTextNode` only; no
   `innerHTML`, no `dangerouslySetInnerHTML`, no script injection.
