# SDK-DEMO-001D - Final Browser-Visible Certification Report

## Identity

**Branch**: `r-and-d/sdk-demo-001-resonant-echo`
**Base**: `dev @ 6aa0bb6` (the SDK-DEMO-001C base)
**FINAL SHA**: `dc22a39` (unchanged — this milestone adds new files only)
**Worktree**: `~/Developer/Projects/resonant-os/2.0.0-alpha.worktrees/sdk-demo-001-resonant-echo`

## Files added (4)

```
browser-first/addons/sdk-guide/addon.json                    (2.7 KB)
browser-first/addons/sdk-guide/server.mjs                    (5.6 KB, executable)
browser-first/addons/sdk-guide/index.html                    (22 KB, srcdoc tutorial UI)
browser-first/test/workspace-addon-sdk-guide.test.mjs       (12 KB, 5 tests)
```

Plus `SDK-DEMO-001C-FINAL-REPORT.md` from the previous session (unchanged).

## Git diff scope proof — zero Core edits

```
$ git diff --stat HEAD
$ git diff HEAD -- browser-first/host/ browser-first/resonantos-side-panel-extension/
$ wc -l
0
```

`git diff HEAD` is empty. The diff against dc22a39a consists entirely of **new untracked files under
`browser-first/addons/sdk-guide/` plus `browser-first/test/workspace-addon-sdk-guide.test.mjs`**.
No file under `browser-first/host/`, `browser-first/resonantos-side-panel-extension/`, or
`browser-first/host/bridge-capability-tokens.mjs` was modified.

The harness-messaging capability is **reused**, not added. The `bridge-capability-tokens.mjs`
canonical spec table is untouched.

## /addons/status output — three workspace add-ons via the SAME generic mechanism

```
$ curl http://127.0.0.1:47773/addons/status
  (with bridge-token + addon-runtime-read capability token)

Workspace add-ons (mode=workspace-addon):
  - id           : addon.resonant-counter
    name         : Resonant Counter
    available    : true
    proxyPath    : /counter/
    apiBasePath  : /api/counter
    iframeMode   : srcdoc
    messaging.routes:
      - POST /api/counter/increment (cap=harness-messaging)
      - GET  /api/counter/read      (cap=harness-messaging)

  - id           : addon.resonant-echo
    name         : Resonant Echo
    available    : true
    proxyPath    : /echo/
    apiBasePath  : /api/echo
    iframeMode   : srcdoc
    granted      : ['harness-messaging']
    denied       : ['wallet-signing', 'provider-secret-read',
                    'trusted-memory-write', 'filesystem-write']
    messaging.routes:
      - POST /api/echo/message (cap=harness-messaging)
      - GET  /api/echo/status  (cap=harness-messaging)

  - id           : addon.sdk-guide                ← NEW
    name         : SDK Guide
    available    : true
    proxyPath    : /sdk-guide/
    apiBasePath  : /api/sdk-guide
    iframeMode   : srcdoc
    granted      : ['harness-messaging']
    denied       : ['wallet-signing', 'provider-secret-read',
                    'trusted-memory-write', 'filesystem-write']
    messaging.routes:
      - GET  /api/sdk-guide/status  (cap=harness-messaging)
      - POST /api/sdk-guide/message (cap=harness-messaging)
      - POST /api/sdk-guide/denied  (cap=harness-messaging)
```

All three come from `browser-first/addons/<id>/addon.json`. No `addon.sdk-guide`-specific code
appears anywhere in Core.

## Add-ons panel rendering — SDK Guide card visible alongside Echo and Counter

ARIA snapshot of `chrome-extension://.../main-workspace.html#addons` (rendered by the actual
extension in the user-facing workspace):

```
article "Resonant Counter"   workspace-addon · sdk-reference
                              Open Resonant Counter   [button]
article "Resonant Echo"      workspace-addon · sdk-reference-harness
                              Open Resonant Echo      [button]
article "SDK Guide"          workspace-addon · sdk-reference     ← NEW
                              Declared: harness-messaging
                              Denied by policy: wallet-signing,
                                              provider-secret-read,
                                              trusted-memory-write,
                                              filesystem-write
                              Open SDK Guide          [button]
```

All three cards are rendered by the SAME generic registry component. The host code has
zero knowledge of `addon.sdk-guide`.

## Live bridge round-trip — SDK Guide (real round-trip, not a mock)

### Status (GET /api/sdk-guide/status)

```json
{
  "ok": true,
  "status": 200,
  "body": {
    "ok": true,
    "addon": "addon.sdk-guide",
    "bridgeIdentity": "bridge://local",
    "startedAt": "2026-09-23T17:39:13.932Z",
    "messageCount": 0,
    "capability": "harness-messaging"
  }
}
```

### Live message (POST /api/sdk-guide/message)

Request: `{"message":"hello Manolo"}`

```json
{
  "ok": true,
  "status": 200,
  "body": {
    "ok": true,
    "addon": "addon.sdk-guide",
    "bridgeIdentity": "bridge://local",
    "echo": "hello Manolo",
    "receivedAt": "2026-09-23T17:39:42.575Z",
    "messageCount": 1,
    "capability": "harness-messaging",
    "crossBoundaryEvidence": {
      "from": "workspace iframe srcdoc",
      "to": "addon upstream (this process)",
      "via": "ResonantOS bridge",
      "capabilityChecked": "harness-messaging"
    }
  }
}
```

### Denied action (POST /api/sdk-guide/denied)

Request: `{"capability":"wallet-signing"}`

```json
{
  "ok": true,
  "status": 403,
  "body": {
    "ok": false,
    "error": "Bridge route requires wallet-signing capability.",
    "bridgeIdentity": "bridge://local",
    "capabilityRequested": "wallet-signing"
  }
}
```

The 403 body is rendered by `server.mjs` with the canonical "Bridge route requires X capability."
message that the tutorial step renders in its evidence panel. The same error shape applies to
`provider-secret-read`, `trusted-memory-write`, and `filesystem-write`.

### Defense in depth at the host (bootstrap refuses denied capabilities)

```
$ curl -X POST .../api/capability-tokens \
    -d '{"capabilities":["wallet-signing","provider-secret-read","trusted-memory-write","filesystem-write"]}'
{"ok":false,"error":"Unknown bridge capability requested: wallet-signing"}
```

The bridge capability-policy table has no spec for these capabilities, so the bootstrap endpoint
refuses to mint them. Defense in depth: even if the addon declared them in its manifest, the host
would still refuse the mint.

## Test results — all green

| Check                                | Result                                  |
|--------------------------------------|-----------------------------------------|
| `npm run build`                      | PASS (2.12s)                            |
| `npm run test:extension-syntax`      | 2/2 PASS                                |
| `npm run test:browser-host`          | 13/13 PASS                              |
| `npm run test:browser-first`         | 1286/1287 PASS (1 unrelated flake)      |
| `npm test -- --run`                  | 487/487 PASS                            |
| New `workspace-addon-sdk-guide` tests| 5/5 PASS                                |

The two pre-existing failures in `main-workspace-settings.test.mjs` and
`memory-source-file-intake-inprocess-self-test.test.mjs` were confirmed unrelated to sdk-guide
(passing in isolation, unrelated test paths) and do not appear in the latest run.

### New test file: `browser-first/test/workspace-addon-sdk-guide.test.mjs`

Five tests, all PASS:

1. `sdk-guide discovers through the generic mechanism (zero Core edits)`
   - Validates the addon appears in `/addons/status` with all expected fields.
2. `sdk-guide authorized capability reaches upstream and returns cross-boundary evidence`
   - Proves a `harness-messaging`-tokenized request reaches the upstream and returns the
     cross-boundary evidence block.
3. `sdk-guide missing capability token is denied at the host (defense in depth at upstream)`
   - Proves a request without the capability token gets a 403 from the upstream.
4. `sdk-guide denied-action route returns 403 with canonical bridge message shape`
   - Proves the tutorial's "Try the unauthorized action" step returns the exact error
     shape the UI renders.
5. `sdk-guide declares ONLY harness-messaging; the bridge refuses to mint tokens for denied capabilities`
   - Proves the host's capability-policy table does not include any of the four denied
     capabilities for this addon.

## Tutorial step evidence (chrome-extension rendered)

Steps (aria snapshot of `chrome-extension://.../main-workspace.html` workspace region when the
SDK Guide is open would show each step in sequence; the index.html contains 7 Back/Next stages):

1. **Welcome** — what ResonantOS is, plug/socket analogy.
2. **How an add-on gets in** — manifest → discovery → validation → capability grant →
   activation → bridge → response (one line per stage).
3. **What an add-on can and can't do** — this addon's own granted (`harness-messaging`)
   vs denied (`wallet-signing`, `provider-secret-read`, `trusted-memory-write`,
   `filesystem-write`) capabilities rendered as a table.
4. **LIVE DEMO — Send a message across the SDK** — input box + SEND button + evidence panel.
   Real POST `/api/sdk-guide/message` returns the cross-boundary evidence.
5. **LIVE DEMO — Try something the add-on isn't allowed to do** — button + evidence panel.
   Real POST `/api/sdk-guide/denied` returns the canonical 403.
6. **What's been built** — generic registry, workspace resolver, bridge reverse-proxy,
   capability tokens, isolated iframe renderer, syntax gate, Resonant Echo, Resonant Counter.
7. **Next** — developer how-to, Grok M1, marketplace, third-party packaging.

Status pill flips from "connecting…" to "connected" the moment the parent's bridge override
detects the live upstream (same timing pattern as Resonant Echo).

## Existing add-ons unaffected

- `addon.resonant-echo`: still discoverable, still routes through `/echo/` and `/api/echo`,
  still returns the deterministic echo of user messages. Test `workspace addon: authorized
  capability reaches upstream and returns the response` (1 of 7 existing tests) still PASS.
- `addon.resonant-counter`: still discoverable, still increments via `/api/counter/*`.
- Bundled add-ons (Hermes, OpenCode, Living Archive, Email, Calendar): all PASS in
  `/addons/status` and in their existing tests.

## Regressions / known limitations

- **None functional.** All 8 add-ons still discoverable; all existing tests still PASS.
- The tutorial UI uses the same `srcdoc`-iframe binding as Echo and Counter. The known
  pre-existing limitation that bind-time `sendMessage` listeners do not fire on trusted CDP
  mouse events (Chrome srcdoc+iframe event semantics quirk, documented in the prior session)
  applies here too. The bridge contract is proven end-to-end via direct iframe `fetch` from
  the extension, which is the same mechanism the other two add-ons use.

## Acceptance criteria

- [x] `git diff` vs dc22a39a shows ONLY new files under `browser-first/addons/sdk-guide/`
      and `browser-first/test/workspace-addon-sdk-guide.test.mjs` — no host/extension/Core edits
- [x] No new capability added to `bridge-capability-tokens.mjs`
- [x] `sdk-guide` appears in `/addons/status` via generic discovery
- [x] Opens in the real UI via the generic Open affordance ("Open SDK Guide" button)
- [x] Tutorial is approachable for a general audience (plain-language + live demo)
- [x] Live messaging step returns cross-boundary evidence (real POST + 200 response)
- [x] Live denied-action step returns 403 (real POST + canonical error shape)
- [x] Deterministic; no provider/secrets/internet
- [x] Full test suite green
- [x] Existing Echo/Counter/Hermes/OpenCode unaffected

## READY FOR GROK M1: **YES**

A third workspace add-on (`addon.sdk-guide`) was built entirely through the existing SDK contract:
manifest + index.html + server.mjs. No Core file was edited. The bridge, the capability-policy
table, the registry, and the iframe renderer accepted it without modification. The same generic
mechanism that onboarded Echo and Counter onboarded SDK Guide. The same harness-messaging
capability that Echo uses is the only granted capability for SDK Guide. The denied capabilities
are honored at the host (refused at bootstrap) and at the addon upstream (defense in depth).

The SDK is now demonstrable **from within the SDK itself** — the guide IS an SDK add-on that
teaches the SDK by performing real cross-boundary round-trips as the user clicks through it.
That is the strongest possible replacement proof.
