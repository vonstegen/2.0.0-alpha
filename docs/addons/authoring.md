# Authoring a ResonantOS Add-on

A practical guide for the developer who wants to ship a new add-on
family — Hermes, OpenClaw, AgentZero, or anything else — and plug it
into ResonantOS so the bridge can discover, gate, and route to it.

This document is the user-facing entry point. The formal contract is in
[ADR-018: Add-on SDK V0](../architecture/ADR-018-addon-sdk-v0.md);
the wire-format contract for `agent-addon` and `local-service`
runtimes is in
[ADR-031: Agent Add-on SDK Lessons from Hermes](../architecture/ADR-031-agent-addon-sdk-lessons-from-hermes.md)
and [ADR-005: Provider Fabric Routing](../architecture/ADR-005-provider-fabric-routing.md).
This guide tells you how to actually use those contracts to ship a

## What "shipping an add-on" means here

An add-on in ResonantOS is a JSON manifest + an implementation that
satisfies the manifest's `service.entrypoint` (for `agent-addon` /
`local-service`) or `surfaces[*].entrypoint` (for `ui-module`). The
manifest is loaded by the bridge at runtime; the bridge validates it
against the SDK, then routes requests to your service over the
declared protocol.

The bridge does not host your code. You ship:

1. **A manifest** — `examples/addons/addon.<your-id>.json` declaring
   capabilities, tools, surfaces, and the service entrypoint.
2. **An implementation** — a small HTTP / stdio / WebSocket server
   that speaks the protocol you declared under `service.protocol`.
3. **(Optional) An engineer setup runbook** — a markdown file that
   tells Resonant Engineer how to install your add-on for the human.
4. **(Optional) An augmentor skill** — a markdown file that tells
   Augmentor how to use your add-on strategically.

That's it. The bridge figures out the rest.

## The five-minute walkthrough: a `local-service` add-on

Let's ship `addon.weather` — a tiny service that returns the current
weather for a city.

### Step 1 — Write the manifest

Drop this at `examples/addons/addon.weather.json`:

```json
{
  "id": "addon.weather",
  "name": "Local Weather",
  "version": "0.1.0",
  "author": "you",
  "category": "integration",
  "sdkVersion": "0.1.0",
  "description": "Reads the current weather for a city from a local stub.",
  "runtimeType": "local-service",
  "surfaces": [],
  "requestedCapabilities": [
    { "capability": "network",  "scope": "self",     "justification": "talks to upstream weather API" },
    { "capability": "providers", "scope": "shared",   "justification": "delegation surfaces in Augmentor" }
  ],
  "providerRequirements": {
    "sharedProfiles": [],
    "allowExperimentalAuth": false
  },
  "archiveIntegration": { "readMode": "none", "writeMode": "none" },
  "health":  { "command": "weather.status",   "intervalSeconds": 60 },
  "installHooks": { "preInstall": [], "postInstall": [], "preUninstall": [], "postUninstall": [] },
  "compatibility": { "minShellVersion": "2.0.0", "blockedShells": [] },
  "service": {
    "protocol": "http-json",
    "entrypoint": "http://127.0.0.1:5099",
    "healthCommand": "weather.status",
    "shutdownCommand": "weather.stop_service"
  },
  "tools": [
    {
      "name": "weather.current",
      "description": "Return the current weather for a city.",
      "requiredCapabilities": ["network", "providers"],
      "inputSchema":  {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      },
      "outputSchema": { "type": "object" },
      "requiresHumanApproval": false
    }
  ]
}
```

Things to notice:

- `id` starts with `addon.` — this is the convention the bridge uses
  to resolve manifests on disk (`examples/addons/${id}.json`).
- `requestedCapabilities` must be a subset of the SDK capability
  set; each entry's `capability` value must exist in
  `ADDON_CAPABILITIES`. See [ADR-018 §Capabilities](../architecture/ADR-018-addon-sdk-v0.md#capabilities).
- Every entry in `tools[*].requiredCapabilities` MUST be present in
  the top-level `requestedCapabilities` array. The validator rejects
  tools that ask for capabilities the manifest didn't request.
- `service.protocol` is one of `stdio-json-rpc`, `http-json`,
  `websocket-json`, `host-command`. The bridge dispatches according
  to the declared protocol.
- `service.entrypoint` is what the bridge calls. Today, the dispatcher
  in `browser-first/host/external-agent-runtime-dispatcher.mjs` is the
  OpenAI-compatible `/api/v1/chat/completions` shape. A `rest-json`
  or stdio protocol needs its own dispatcher branch — see
  "Adding a new protocol" below.

### Step 2 — Validate the manifest

```bash
npm run validate:manifest -- examples/addons/addon.weather.json
```

The validator checks: required fields, capability superset, surface
referential integrity, protocol enum, install-hook references, and
the workflow-scaffold contract. Anything it flags is a hard error —
the bridge will refuse the manifest at runtime if the SDK validator
fails.

If you don't have a custom validator script yet, the SDK exposes
`validateAddOnManifest(manifest)` directly:

```ts
import { validateAddOnManifest } from "./src/sdk/addons/validation.ts";
const result = validateAddOnManifest(manifest);
const errors = result.issues.filter((i) => i.severity === "error");
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
```

### Step 3 — Implement the service

For `protocol: "http-json"` on `local-service`, the bridge calls
`POST ${entrypoint}/api/v1/chat/completions` with an OpenAI-compatible
body and expects an OpenAI-compatible response. The minimum server:

```js
// weather-server.mjs — runs on http://127.0.0.1:5099
import { createServer } from "node:http";

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/v1/chat/completions") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const city  = body.messages?.find((m) => m.role === "user")?.content ?? "London";
      // ... real weather lookup ...
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: `cmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "weather-stub",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: `${city}: 12°C, light rain.`,
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
    });
    return;
  }
  res.writeHead(404).end();
});
server.listen(5099, "127.0.0.1");
```

Start it. The bridge will route calls to your service at the declared
entrypoint.

### Step 4 — Test the round-trip locally

The repo ships a Docker test bench that bundles the bridge + three
existing add-on stubs. It also runs your new add-on if you drop it
under `examples/addons/` and write a stub:

```bash
# from the repo root
npm run bench:up
# open http://127.0.0.1:47773/dev/external-agent-runtimes/ in Chrome
# your addon appears in the panel as a new card
npm run bench:roundtrip
# exercises weather.current through the real dispatcher
```

For the bench to actually start a stub for your add-on, you need a
matching stub server (see `bench/stub.mjs` for the OpenAI-compatible
shape). Once discovery + per-protocol stubs land in the bench (see
the roadmap at the end of this doc), this becomes "drop a manifest,
the bench picks it up".

Until then, the manual round-trip script works: start your server in
one terminal, run the bridge in another, hit
`/external-agent-runtime/delegate` with a known capability token and
a `dev-roundtrip` caller id.

### Step 5 — Add a tool surface (optional)

If Augmentor should be able to invoke your tool, no extra work —
`tools[*]` are auto-discovered from the manifest.

If you want a dock icon and a workspace section, add `surfaces`:

```json
"surfaces": [
  {
    "id": "weather.main",
    "type": "panel",
    "entrypoint": "weather://open",
    "label": "Weather",
    "shellNavigation": {
      "sectionId": "weather",
      "dockIcon": "weather-icon",
      "order": 50
    }
  }
]
```

`shellNavigation` is discovery metadata only — the shell will only
open routes for `sectionId`s it knows about. See the §Shell Surface
Navigation section of ADR-018.

### Step 6 — Engineer setup runbook (recommended for installable add-ons)

If your add-on needs to be installed, configured, or have credentials
provisioned by the Resonant Engineer, declare an `engineerSetup`
field. The contract is in
[ADR-018 §Engineer Setup Runbook Contract](../architecture/ADR-018-addon-sdk-v0.md#engineer-setup-runbook-contract).
The template is at
[`docs/architecture/ADDON_ENGINEER_SETUP_RUNBOOK_TEMPLATE.md`](../architecture/ADDON_ENGINEER_SETUP_RUNBOOK_TEMPLATE.md).

### Step 7 — Augmentor skill (recommended for non-trivial workflows)

If your add-on needs more than "call this tool" — research, planning,
approval gates, artifact return — declare an `augmentorSkills` field.
Contract: [ADR-018 §Augmentor Skill Contract](../architecture/ADR-018-addon-sdk-v0.md#augmentor-skill-contract).
Template:
[`docs/architecture/ADDON_AUGMENTOR_SKILL_TEMPLATE.md`](../architecture/ADDON_AUGMENTOR_SKILL_TEMPLATE.md).

## Anatomy of a manifest

Every field in the SDK V0 contract is documented in ADR-018. The
quick reference:

| Field | Required? | Notes |
|---|---|---|
| `id` | yes | `addon.<your-id>` convention. Bridge resolves `${id}.json` from `examples/addons/`. |
| `name`, `version`, `author`, `category`, `description` | yes | Display metadata. `category` must be one of `agent`, `channel`, `memory`, `security`, `knowledge`, `tool`, `integration`, `orchestration`. |
| `runtimeType` | yes | `ui-module`, `embedded-module`, `local-service`, `agent-addon`, or `channel-addon`. Determines how the bridge routes calls. |
| `surfaces` | yes (can be empty array) | One entry per UI surface. Empty array for back-end-only add-ons. |
| `requestedCapabilities` | yes | The capabilities your add-on needs. Subset of `ADDON_CAPABILITIES`. |
| `providerRequirements` | yes | Shared provider profiles used, and whether experimental auth is allowed. |
| `archiveIntegration` | yes | Read/write mode for the Living Archive. Most add-ons use `readMode: "none"`. |
| `health` | yes | Health-check command + interval. |
| `installHooks` | yes | Lifecycle hooks your add-on needs called. |
| `compatibility` | yes | Min shell version + blocked shells. |
| `sdkVersion` | no | The SDK contract version your manifest targets. |
| `provenance` | no | Where the manifest came from (bundled, sideloaded, marketplace). |
| `runtimeIsolation` | no | Where the add-on runs (`host-mediated-service`, etc.). |
| `grantPresets` | no | Pre-baked grant bundles the user can grant in one click. |
| `service` | for `local-service` / `agent-addon` | Wire contract: `protocol`, `entrypoint`, etc. |
| `tools` | for `agent-addon` | The tools your service exposes. Each tool's `requiredCapabilities` must be a subset of the top-level `requestedCapabilities`. |
| `delegation` | for `agent-addon` | Whether your add-on accepts delegated tasks and what artifacts it returns. |
| `agents` | for `agent-addon` | Per-agent configuration if your add-on hosts more than one. |
| `engineerSetup` | recommended | Path + metadata for the install/setup runbook. |
| `augmentorSkills` | recommended | Path + metadata for the strategic-use skill. |
| `install` / `audit` / `embeddedWorkspace` / `agentRuntime` / `memoryAccess` / `smokeTests` | for `agent-addon` | See ADR-018 §Agent Add-on Operating Contracts. |

For the complete field reference, see
[ADR-018: Add-on SDK V0](../architecture/ADR-018-addon-sdk-v0.md).

## Capabilities — what you can ask for

The SDK V0 capability set is closed. Your `requestedCapabilities` array
must use only these values:

```
filesystem, archive-read, archive-intake-write, chat-interface,
memory-provider, providers, shell, network, ui-embedding,
browser-control, agent-delegation, notifications, device-integration
```

If you need a capability that isn't in this list, that's a request to
extend the SDK — file an ADR. Don't invent new capability names; the
bridge refuses them.

Each capability entry also declares a `scope` from the set
`none`, `self`, `workspace`, `shared`, `system`, `intake-only`. The
scope tells the bridge how broadly the capability applies:

- `self` — only your add-on's own state.
- `workspace` — files within the user's workspace.
- `shared` — shared provider profiles, model metadata, etc.
- `system` — host-level state (very high-trust).
- `intake-only` — can write only to intake boundaries, never directly
  to trusted Living Archive knowledge pages.

Default to the narrowest scope that lets your add-on work.

## Adding a new protocol

The bridge's dispatcher currently speaks OpenAI-compatible
`/api/v1/chat/completions` for `agent-addon` / `local-service`
runtimes. To add a new protocol:

1. Add the protocol name to `AddOnServiceProtocol` in
   `src/sdk/addons/contracts.ts` and the `ADDON_SERVICE_PROTOCOLS`
   list.
2. Update the validator in `src/sdk/addons/validation.ts` if the new
   protocol has additional required fields.
3. Add a branch to
   `browser-first/host/external-agent-runtime-dispatcher.mjs` (or a
   sibling dispatcher module) that knows how to call your protocol.
4. Add a test under `browser-first/test/` that locks in the wire
   shape — a "deny because protocol unsupported" path and a "allow
   through" path.
5. If you want the bench to spin up a stub for your protocol by
   default, add a `bench/stubs/<your-protocol>.mjs` and register it
   in `bench/stubs/index.mjs` (see the bench authoring doc).

The dispatcher's contract is in
[ADR-031: Agent Add-on SDK Lessons from Hermes](../architecture/ADR-031-agent-addon-sdk-lessons-from-hermes.md)
and in the dispatcher's own header comments at
`browser-first/host/external-agent-runtime-dispatcher.mjs`.
## Plugging your add-on into a running ResonantOS

Once your manifest is validated and your server is running, the
bridge needs to find it. There are three discovery paths:

1. **Bundled** — your manifest lives under `examples/addons/` (or
   `public/addons/`). The bridge enumerates the directory at startup
   and loads every valid manifest.
2. **Sideloaded** — the user drops your manifest into a user-writable
   directory (e.g. `~/.resonantos/sideload/addons/`). The bridge picks
   it up on next restart. Sideloaded manifests are flagged
   `provenance: "sideloaded"` and treated as unverified unless the host
   explicitly verifies them.
3. **Marketplace** — future; not in scope for V0.

For a bundled add-on, you ship by:

- Adding the manifest to `examples/addons/`.
- (Optional) Adding the implementation as a separate npm package
  under `addons/<your-name>/` with its own `package.json` and tests.
- (Optional) Adding docs under `docs/architecture/addon-runbooks/<your-name>/`.

## Testing your add-on

There are four layers of testing. You should ship all four.

1. **Manifest validation** — `npm run validate:manifest -- <path>`. Or
   write a Vitest test that calls `validateAddOnManifest()` and
   asserts zero errors.
2. **F1–F10 boundary contracts** — the SDK ships a failure-mode
   harness at `packages/addon-sdk-testing/`. Run
   `npm run test:external-agent-runtime` to exercise every failure
   mode against your manifest. Lock the verdicts in a regression test.
3. **Round-trip through the bridge dispatcher** — use the bench:
   ```bash
   npm run bench:up
   npm run bench:roundtrip
   ```
   This proves your service responds correctly to the actual wire
   format the bridge uses.
4. **End-to-end with the ResonantOS shell** — open the dev panel,
   see your add-on's card, click through to any UI surfaces you
   declared, exercise the tool through Augmentor.

The bench is your fastest path to layers 1-3 in one command.

## Troubleshooting

**My manifest doesn't appear in the dev panel.**
- Is the filename `${id}.json`? The bridge looks for that exactly.
- Does `validateAddOnManifest()` return zero errors? Run the
  validator directly.
- Does your `id` start with `addon.`? (Strong convention; the
  dispatcher lookup also accepts bare names but the panel
  filters by manifest directory.)
- Is your `runtimeType` one of the five SDK runtime types?
- Does `surfaces` exist (even as `[]`)? The validator requires it.

**The bridge returns `404 addon-not-found` for my dispatch call.**
- The bridge couldn't load your manifest. Check
  `RESONANTOS_REPO_ROOT` points at the directory containing
  `examples/addons/`.
- The manifest's `id` field doesn't match the `addonId` you're
  passing in the dispatch call.
- The manifest's `service.entrypoint` is missing.

**The bridge returns `403 capability-denied` for my tool call.**
- The caller doesn't hold the grant for one of
  `tools[*].requiredCapabilities`. Either mint a grant for the
  caller in your bridge launcher, or use an existing caller id
  that already has the right grants (`dev-roundtrip` is
  pre-minted with `network`, `providers`, `agent-delegation`,
  `archive-intake-write`, `memory-provider` for the bench).

**The bridge returns `404 unknown-tool` for my call.**
- The `tool` field in the dispatch body doesn't match any name
  in `tools[*].name` of the loaded manifest.

**My service receives the request but the response is rejected.**
- The bridge expects an OpenAI-compatible JSON shape. Your
  response must have `choices[0].message.content` for the
  assistant reply.
- If you're using a different protocol, declare it in
  `service.protocol` and add a dispatcher branch (see "Adding a
  new protocol").

## Where to go next

- Read [ADR-018](../architecture/ADR-018-addon-sdk-v0.md) for the
  complete manifest contract.
- Read [ADR-031: Agent Add-on SDK Lessons from Hermes](../architecture/ADR-031-agent-addon-sdk-lessons-from-hermes.md)
  for the agent-addon / local-service wire format.
- Read the bench authoring doc at
  [`bench/docs/authoring-a-new-addon.md`](../../bench/docs/authoring-a-new-addon.md)
  for the bench-specific workflow (drop a manifest, optionally a
  stub, run the loop).
- Look at the three bundled add-on manifests under
  `examples/addons/` — `addon.deepseek-harness.json`,
  `addon.recursive-mas.json`, `addon.reference-memory.json` — for
  reference shapes.
- The [`recursive-mas` engineer runbook](../architecture/addon-runbooks/recursive-mas/ENGINEER_SETUP.md)
  is a worked example of the `engineerSetup` field.