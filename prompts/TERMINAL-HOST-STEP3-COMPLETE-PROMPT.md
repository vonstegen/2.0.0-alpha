# Terminal Host — Complete Step 3 (route + CLI + credential wiring) — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The session manager + grant broker primitives are done and green. This prompt
finishes step 3 — the three pieces that make the bootstrap actually usable:
the HTTP route, the credential wiring, and the `ros-session` CLI.

---

## 0. Authority (read first)

- `browser-first/host/terminal-host-service.mjs` — the broker primitives
  (`consumeGrant`, `attachSessionEnv`, `trackSessionBootstrapGrant`,
  `GRANT_PUBLIC_REJECTION_REASONS`) already carried/built.
- `browser-first/host/harness-host-service.mjs` — find `POST /addons/grants` and
  mirror its structure (loopback-only, capability, error family) for the new route.
- `browser-first/host/pi-native-provider-map.mjs` — `resolvePiNativeProvider`.
- `browser-first/host/pi-native-credential-adapter.mjs` — the credential path to wire.
- `docs/architecture/ADR-040-terminal-host-adapter-contract.md` — "No secrets in
  launch commands" (the token is **never argv/env**).

---

## 1. Hard rules

1. **Token never in argv/env.** The `SessionBootstrapGrant` token must not appear in
   a command line, env var, or shell history.
2. **Single-use + audience-bound.** Reuse `consumeGrant`; do not weaken it.
3. **No secret in logs/stdout.** The CLI must never echo the credential value.
4. **Fail closed.** Missing/unknown profile or credential → reject, do not fabricate.

---

## 2. Piece 1 — register the HTTP route · gate CP-S3a

In `browser-first/host/harness-host-service.mjs`, add:

```
POST /terminal-host/session/attach
```

- Mirror the `POST /addons/grants` precedent (same loopback-only + capability +
  error-family wiring).
- Handler reads `{ sessionId, token }`, calls `consumeGrant` (reject on the four
  `GRANT_PUBLIC_REJECTION_REASONS`), then composes and returns the projected env.
- Return `{ ok: true, env, meta }` on success; `{ ok: false, reason }` on rejection
  (no secret in either payload).

**CP-S3a gate:** a test (in the harness-host-service test bucket) proves a valid
grant returns an env, and each rejection reason maps to the right response.

`STOP AND REPORT` here.

---

## 3. Piece 2 — wire the credential resolution · gate CP-S3b

`attachSessionEnv` currently defaults `resolveCredential = () => null`. Wire a real
default (or have the route handler inject one) that:

1. Given `providerProfileId`, resolves the profile from the host provider host.
2. Maps it via `resolvePiNativeProvider(profile)` → `{ piProvider, envVar }`.
3. Resolves the secret via the host's `resolveProviderProfileCredential`.
4. Returns `{ name: envVar, value: secret }`; returns `null` on any miss (fail closed).

This is the only place the credential adapter (ADR-041) needs to be consumed for
this step — a thin wrapper, not the full launch planner.

**CP-S3b gate:** a test proves the wired resolver injects the credential under the
host-owned env name, and a missing profile/credential fails closed (no env).

`STOP AND REPORT` here.

---

## 4. Piece 3 — the `ros-session` CLI · gate CP-S3c

Provide a thin entry that the bootstrap command invokes. It must:

1. POST `{ sessionId, token }` to `/terminal-host/session/attach`.
2. Emit `export NAME='value'` lines for the returned env (for the shell to source),
   never printing the secret to stdout/stderr/logs.

**Token-delivery design point (resolve + document):** the token cannot be argv/env,
so decide how `ros-session attach` receives it. Options to evaluate (pick one and
record it in the commit message): (a) a 0600 temp file the caller writes and the CLI
reads-then-unlinks, (b) stdin, (c) the broker resolves the token from a session-local
side channel it minted. Whatever you choose, the token must never appear in `ps`,
argv, env, or shell history.

**CP-S3c gate:** a test (or a documented manual run) proves the CLI round-trips a
grant → env without the secret appearing in its stdout.

`STOP AND REPORT` here.

---

## 5. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run                                                  # core (735)
npx vitest run --config examples/sdk-demo/vitest.config.ts       # demo (103)
node --experimental-strip-types --test \
  browser-first/test/terminal-host-grant-broker.test.mjs
```

---

## 6. Verification discipline + STOP AND REPORT

Never trust a green number you did not produce yourself. Re-run; paste summary +
last ~20 lines. Commit per piece (`feat(terminal-host):` / `test(terminal-host):`).
Never push to `dev`/`main`/`upstream`. Report test counts named by label.

After CP-S3c clears, **step 3 is fully complete** — report that explicitly, then
pause: step 4 (`launchBootstrap` env wiring) is gated on the external-vs-embedded
decision, which the operator has not yet made.
