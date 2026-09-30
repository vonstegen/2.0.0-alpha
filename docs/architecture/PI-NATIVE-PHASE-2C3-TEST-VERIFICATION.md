# Pi-Native Phase 2C.3 — Test Verification Report

- **Report date:** 2026-09-30
- **Scope:** (1) re-verification of the P2 session-credential work; (2) full test pass of the Phase 2 chain (2A → 2B → 2B.1 → 2C → 2C.1 → 2C.2 → 2C.3).
- **Next step (not performed):** independent audit of the exact Phase 2C.3 candidate.

## Worktrees and exact HEAD SHAs

| Worktree | Branch | HEAD (full SHA) | Subject | Tree |
|---|---|---|---|---|
| `pi-native-p2` | `feature/pi-native-session-credential-p2` | `5ac7c248ed85cd07ff02c882f09d45ccb9cbcd99` | `docs(pi-native): add P2 user live proof report (LaTeX)` | clean |
| `pi-phase2` | `feature/pi-phase2c3-staging-identity-encoding` | `e8074499bfe3b3f617133af88f65136a23242c71` | `Phase 2C.3: unambiguous length-prefixed staging identity encoding` | clean (before this report commit) |

The **Phase 2C.3 candidate** to be independently audited is the immutable commit
`e8074499bfe3b3f617133af88f65136a23242c71`.

## Toolchain

| Component | Version | Notes |
|---|---|---|
| Node (test runs) | `v24.21.0` | absolute binary `/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node` |
| Node (PATH) | `v22.13.0` | ambient shell default |
| npm (PATH) | `10.9.2` | ambient shell default |
| npm (v24 bin) | `11.19.0` | used for `npm install`; resolved to node `v22.13.0` via shebang PATH (see note) |
| Vitest | `4.1.11` | `darwin-arm64`, node `v24.21.0` |
| Test runner | Node built-in `node:test` | for all `.mjs` suites |
| Test runner | Vitest `4.1.11` | for `.ts` SDK suites |

> **Engine note:** `npm install` ran under node `v22.13.0` (the v24 `npm` shebang
> resolves `node` from PATH), producing an `EBADENGINE` warning — `package.json`
> requires `node >= 24.21.0`. Vitest was therefore invoked directly under node
> `v24.21.0` (`node node_modules/vitest/vitest.mjs run …`), which satisfied the gate.

## Test results

### 1 — P2 credential work (worktree `pi-native-p2`)

**Suite A — Pi credential / service / launcher** (node `v24.21.0`, `node:test`)

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node --test --test-concurrency=1 \
  browser-first/test/pi-native-session-credential.test.mjs \
  browser-first/test/pi-native-session-service.test.mjs \
  browser-first/test/pi-process-launcher.test.mjs
```

- **35 / 35 pass** — 0 fail, 0 skip.

**Suite B — Module ownership doc** (node `v24.21.0`, `node:test`)

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node --test scripts/module-ownership-doc.test.mjs
```

- **2 / 2 pass** — 0 fail, 0 skip.

### 2 — Phase 2 chain (worktree `pi-phase2`)

**Suite C — Harness resource + skills projection, staging audit, staging hardening**
(node `v24.21.0`, `node:test`)

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node --test --test-concurrency=1 \
  browser-first/test/harness-resource-projection.test.mjs \
  browser-first/test/harness-skills-projection.test.mjs \
  browser-first/test/harness-skills-staging-audit.test.mjs \
  browser-first/test/harness-skills-staging-hardening.test.mjs
```

- **99 / 99 pass** — 0 fail, 0 skip.

**Suite D — Shared suites modified by the chain**
(node `v24.21.0`, `node:test`)

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node --test --test-concurrency=1 \
  browser-first/test/pi-native-session-credential.test.mjs \
  browser-first/test/category-registry.test.mjs \
  browser-first/test/tool-category.test.mjs
```

- **47 / 47 pass** — 0 fail, 0 skip.

**Suite E — SDK Vitest suites** (vitest `4.1.11`, node `v24.21.0`)

Install:

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/npm install --no-audit --no-fund
```

- 278 packages added.

Run:

```
/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run \
  src/sdk/addons/harness-resources.test.ts \
  src/sdk/addons/validation.test.ts
```

- **102 / 102 pass** — 0 fail, 0 skip (`harness-resources.test.ts` 14, `validation.test.ts` 88).

## Totals

| Scope | Pass | Fail | Skip |
|---|---|---|---|
| P2 credential work (Suites A + B) | 37 | 0 | 0 |
| Phase 2 chain (Suites C + D + E) | 248 | 0 | 0 |
| **Grand total** | **285** | **0** | **0** |

## Safety and hygiene

- No credential was read, printed, or modified.
- Pi `auth.json` was not inspected or modified.
- Provider profiles and the ROS provider/vault mechanism were not touched.
- OMP / VIGIL / VIGIL-MCP processes were not started, stopped, or reconfigured.
- Both worktrees reported a clean working tree after all test runs.

## Constraints honored

- No merge performed.
- No application to `dev`.
- No Phase 2D work performed.
