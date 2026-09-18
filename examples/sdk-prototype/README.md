# ResonantOS Add-on Harness (Prototype SDK)

A minimal, self-contained, runnable **add-on harness** that ships preinstalled
with ResonantOS. It comes with the one first-party **Augmentor** — Manolo's
DeepSeek Harness (`addon.augmentor`) — already preinstalled and pre-granted. A
developer then hands this harness (the SDK) to an agentic AI agent, and the agent
authors a third-party add-on for another provider (the worked example is
**Grok-Build**).

> This is a **demo prototype** of the preinstalled harness, not the production SDK.
> The production SDK lives in `src/sdk/addons` and is governed by
> [ADR-018](../../docs/architecture/ADR-018-addon-sdk-v0.md). This prototype mirrors
> the production manifest vocabulary so a plugin authored here maps cleanly to the
> real SDK.

## What it demonstrates

1. **Manifest validation** — required fields, id/version format, and capability
   rules.
2. **Public / Privileged / Core-only capability split** — the roadmap's `D3`.
3. **Deny-by-default grants** — nothing runs until the host grants capabilities.
4. **Caller-attributed tool execution** — each tool declares required
   capabilities; the host refuses execution when a grant is missing.
5. **Prepare is not commit** — plugins can `context.propose(...)` an action, but
   the host owns the commit boundary.

## Demo scenario (community leader)

1. **Preinstalled first-party add-on** — the **Augmentor** (`plugins/augmentor/`),
   which is Manolo's DeepSeek Harness, is already installed and pre-granted via
   the `recommended-primary-chat` preset (Public `network` + `agent-delegation`;
   Privileged `providers` requires a separate reviewed grant).
2. **A developer builds a second provider** — the agent is given the harness and
   the [SDK demo prompt](../../prompts/sdk-demo-prompt.md), then authors
   `plugins/grok-build/` (the worked example): `status` needs `network` (Public);
   `run_task` needs `network` + `providers` (Privileged) + `agent-delegation` (Public).
3. The developer runs the demo and shows the Grok-Build plugin blocked without
   grants, `status` working with Public grants, and `run_task` working only after
   a reviewed `providers` grant.

## Files

| Path                      | Purpose                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `sdk.mjs`                 | The harness runtime: `loadPlugin`, `runTool`, `validateManifest`, `capabilityClass`. |
| `run-demo.mjs`            | CLI demo that loads a plugin across three grant scenarios.                           |
| `sdk.test.mjs`            | Deterministic tests (`node --test`).                                                 |
| `plugins/augmentor/`      | The Augmentor (Manolo's DeepSeek Harness), preinstalled and pre-granted.             |
| `plugins/grok-build/`     | A third-party provider add-on authored through the SDK (the demo target).            |
| `plugins/hello-resonant/` | A minimal getting-started reference plugin.                                          |

## Run the demo

```bash
# Augmentor (Manolo's DeepSeek Harness) — default
node examples/sdk-prototype/run-demo.mjs

# Explicit path (any plugin)
node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/augmentor
node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/grok-build
```

## Run the tests

```bash
node --test examples/sdk-prototype/sdk.test.mjs
```

## Author a plugin

A plugin is two files in one folder:

1. `plugin.json` — the manifest.
2. The entry module named by `manifest.entry` (e.g. `plugin.mjs`).

### Manifest (`plugin.json`)

```json
{
  "id": "plugin.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "OMP (oh-my-pi)",
  "category": "tool",
  "description": "What this plugin does.",
  "runtimeType": "local-module",
  "entry": "./plugin.mjs",
  "requestedCapabilities": ["notifications"],
  "tools": [
    {
      "name": "my-plugin.do",
      "description": "Do the thing.",
      "requiredCapabilities": []
    }
  ]
}
```

Rules:

- `id` must be a lowercase dotted identifier (e.g. `plugin.my-plugin`).
- `version` must look like semver (`1.2.3`).
- `requestedCapabilities` may only use **Public** capabilities (`notifications`,
  `archive-read`, `archive-intake-write`, `task-delegate`, `network`,
  `agent-delegation`, `chat-interface`) or **Privileged** capabilities (`providers`,
  `browser-commit`, `credential-broker`); **Core-only** capabilities
  (`policy-override`, `trust-root-modify`, `credential-export`, `ground0-replace`)
  are rejected.
- Every tool's `requiredCapabilities` must be a subset of
  `requestedCapabilities`.

### Entry module (`plugin.mjs`)

```js
export default {
  async activate(context) {
    return {
      tools: {
        "my-plugin.do": async (args) => ({ ok: true, args }),
      },
      async onEnable() {
        return { ok: true };
      },
      async onDisable() {
        return { ok: true };
      },
    };
  },
};
```

`context` provides `manifest`, `granted`, `capabilityClass`, and `propose`
(prepare/propose boundary — a plugin can propose, the host commits).

## Capability classes

| Class      | Examples                                                                                                                  | Grantable by this prototype?                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Public     | `notifications`, `archive-read`, `archive-intake-write`, `task-delegate`, `network`, `agent-delegation`, `chat-interface` | Yes, explicitly by the host.                                            |
| Privileged | `providers`, `browser-commit`, `credential-broker`                                                                        | Yes, but only as a reviewed host decision (e.g. the `providers` grant). |
| Core-only  | `policy-override`, `trust-root-modify`, `credential-export`, `ground0-replace`                                            | No — rejected at validation.                                            |
