# Terminal Host — XH3: Harness↔Terminal Compatibility Resolver — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

XH1+XH2 are complete and pushed: terminal surfaces and harnesses are now two
independent layers, with a generic `external-cli-terminal` launcher and a
reviewed `pi-v1` policy. This prompt formalizes the compatibility check that
decides whether a chosen harness can run on a chosen terminal, and makes it
**fail closed before any grant is minted or any process is started**.

---

## 0. Recorded decision + invariants

Decision (unchanged): terminals and harnesses are many-to-many; ROS selects one
of each and produces a host-authorized launch plan. Compatibility is
**host-derived** from requirements + capabilities — never claimed by a manifest.

Invariants (unchanged, non-negotiable):

1. Compatibility is computed from the harness policy's `terminalRequirements`
   and the terminal surface's `capabilities`.
2. An incompatible pairing must fail **before** a `SessionBootstrapGrant` is
   minted, a token/auth file is written, or a terminal process is started.
3. Rejection reasons are public and non-secret (capability names only — never a
   path, token, credential, or env value).
4. A harness policy never controls terminal transport; a terminal adapter never
   resolves credentials (unchanged).
5. F2 split holds; grant/secret non-leak properties unchanged.

---

## 1. Authority — read first

- `src/core/terminal-surface-contract.ts` — `TerminalSurfaceDescriptor`,
  `TerminalCapability`, `terminalSurfaceSatisfies`.
- `browser-first/host/terminal-surface-registry.mjs` — descriptors,
  `getTerminalSurfaceDescriptor`, `listTerminalSurfaceDescriptors`,
  `terminalSurfaceSatisfies`, `pickCompatibleSurface`.
- `src/core/external-cli-harness-contract.ts` — `ExternalCliHarnessPolicy`
  shape (`terminalRequirements`, etc.).
- `browser-first/host/harness-policy-registry.mjs` — reviewed policy lookup.
- `browser-first/host/agent-adapters/external-cli-terminal.mjs` — the generic
  launcher; where the compatibility check must run **before** it calls
  `terminalHostService.launchBootstrap(...)`.
- `browser-first/test/external-cli-harness-xh1-xh2.test.mjs` — existing XH2
  coverage to preserve.

---

## 2. Hard rules

1. The resolver returns a **structured result**, not a thrown internal error and
   not a bare `null`.
2. `missingCapabilities` carries only `TerminalCapability` strings. No secret,
   path, token, or env name may appear in any compatibility result or error.
3. The compatibility check must complete and reject **before** grant minting /
   token-file write / `launchBootstrap` RPC. A test must prove this ordering.
4. Do not weaken `pickCompatibleSurface` for the sake of XH3; if you replace it,
   preserve its determinism and preferred-order semantics.
5. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push until AVIS audits.

---

## 3. Phase XH3a — the compatibility contract · gate CP-XH3a

Add a host-owned compatibility result type (extend
`src/core/terminal-surface-contract.ts`):

```ts
interface HarnessTerminalCompatibility {
  compatible: boolean;
  surface?: TerminalSurfaceDescriptor;              // set when compatible
  missingCapabilities: readonly TerminalCapability[]; // empty when compatible
  provenanceFidelity: "telemetry" | "observation" | "unsupported";
}
```

Derive `provenanceFidelity` from the selected surface's `feedbackChannel`:

- `event-stream` or `polling` → `telemetry`;
- `observation` → `observation`;
- `none` (or no surface) → `unsupported`.

Add a resolver (suggest `browser-first/host/harness-terminal-compatibility.mjs`):

```ts
resolveHarnessTerminalCompatibility({
  requirements,
  descriptors,
  preferred,          // preferred adapter order (optional)
}): HarnessTerminalCompatibility
```

Requirements:

1. `compatible: true` only when some descriptor satisfies every requirement
   (`terminalSurfaceSatisfies`).
2. When incompatible, return **all** missing requirements for the best
   (first-preferred) candidate, not just the first miss. Deterministic.
3. Return `provenanceFidelity: "unsupported"` and an empty `surface` when no
   descriptor is eligible at all.
4. Pure, no I/O, no secrets, no process/grant side effects.

**CP-XH3a gate:** unit tests for the resolver:

- compatible pairing returns `compatible:true` + the right surface + fidelity;
- incompatible pairing returns `compatible:false` + every missing capability;
- preferred-order determinism;
- empty/unknown descriptors → `unsupported`;
- the result never contains a path/token/credential (assert on the object
  shape).

`STOP AND REPORT` here.

---

## 4. Phase XH3b — wire into the launch path · gate CP-XH3b

In `external-cli-terminal.mjs`'s `invoke()`, resolve compatibility via
`resolveHarnessTerminalCompatibility` and reject **before** any grant/token/launch
work happens.

Requirements:

1. Resolve the policy → `terminalRequirements`.
2. Compute compatibility against the available descriptors (preferred order
   from the host's terminal-host service drive id, then the registry).
3. If incompatible:
   - yield a harness `error` event with a public reason
     (`unsupported-terminal` or the existing `runtime-unavailable`, with the
     missing capabilities listed in a non-secret `detail`);
   - do **not** mint a grant, write a token/auth file, or call
     `launchBootstrap`.
4. If compatible, proceed exactly as today (grant minting stays inside
   `launchBootstrap`).

**CP-XH3b gate:** a test drives `adapter.invoke()` with a policy whose
`terminalRequirements` are unsatisfiable and asserts:

- no `launchBootstrap` RPC reached the terminal peer;
- no grant is tracked (`listOutstandingGrants` empty);
- no token/auth file was created;
- a non-secret error is yielded with the missing capabilities.

`STOP AND REPORT` here.

---

## 5. Phase XH3c — matrix + Pi parameterization · gate CP-XH3c

1. Add a compatibility matrix test: for each `{policy requirement set} ×
   {terminal descriptor}`, assert the expected compatible/incompatible result.
   Minimum rows: `pi-v1` requirements × (ghostty, iterm2, in-memory) — all
   three must be **compatible** for Pi; add one fixture policy whose
   requirements (e.g. `screen-stream`) are unsatisfied by ghostty to prove the
   incompatible branch.
2. Prove Pi is parameterized over both real terminals: `pi-v1` + ghostty and
   `pi-v1` + iterm2 both resolve compatible (the grant-chain test already covers
   the launcher; extend it or add a matrix row so both surfaces are asserted).

**CP-XH3c gate:** matrix green; Pi×ghostty and Pi×iterm2 both compatible; the
fixture-policy×ghostty row is incompatible with the correct missing capability.

`STOP AND REPORT` here.

---

## 6. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

Report counts by label: core / demo / browser-first.

---

## 7. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label. Never trust a green number
you did not produce.

---

## 8. Out of scope (do not build here)

- Registry discovery / compatibility projection for the UI (XH4, later).
- OpenCode / Claude / Codex / Hermes policies (later).
- Linux WezTerm/kitty adapters (later).
- Memory projection and "Open in Terminal" UI (later).

Suggested commits:

1. `feat(terminal-host): add harness-terminal compatibility result + resolver`
2. `feat(terminal-host): fail closed in launcher before grant/launch`
3. `test(terminal-host): compatibility matrix + Pi parameterization`
4. `docs(terminal-host): capture XH3 prompt` (include this prompt).

Report explicitly when XH3 is complete, then pause for the XH4
(registry-discovery) prompt.
