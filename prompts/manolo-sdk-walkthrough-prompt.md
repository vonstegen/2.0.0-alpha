# Prompt: Manolo's DeepSeek Harness — ResonantOS SDK walkthrough, explain, and demonstrate

**Audience:** Manolo's DeepSeek Harness (`addon.augmentor`)
**Mode:** read + run the demo, then produce a walkthrough transcript and a plain-language summary. Do not modify any file.

## Purpose

Onboard Manolo onto what ResonantOS has built so far: the **add-on contract**.
Work through the prototype SDK end to end, then produce three things:

1. A **walkthrough transcript** — the commands you ran and the key output.
2. A **plain-language explanation** of the contract: what an add-on may declare,
   what the host grants, and where a human approves.
3. A **summary of the three honest boundaries** of the prototype (below).

## Setup

```bash
git clone --depth 1 --branch demo/sdk-prototype https://github.com/vonstegen/2.0.0-alpha.git
cd 2.0.0-alpha
node --test examples/sdk-prototype/sdk.test.mjs
node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/augmentor
node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/grok-build
```

## What to read first (in this order)

1. `examples/sdk-prototype/README.md` — the harness and the capability model.
2. `examples/sdk-prototype/sdk.mjs` — the runtime: `validateManifest`,
   `loadPlugin`, `runTool`, `capabilityClass`, and `propose`.
3. `examples/sdk-prototype/plugins/augmentor/plugin.json` and `plugin.mjs` — this
   is **you**: the Augmentor, Manolo's DeepSeek Harness, the product's one
   first-party add-on (`addon.augmentor`).
4. `examples/sdk-prototype/plugins/grok-build/` — a third-party add-on authored
   through the same contract.

## The contract to explain

Explain these four points in your own words, citing the code:

1. **What an add-on may declare.** A manifest (`plugin.json`) declares its id,
   version, entry module, requested capabilities, and tools. Capabilities fall
   into three classes: Public (`network`, `agent-delegation`, `notifications`,
   …), Privileged (`providers`, `browser-commit`, `credential-broker`), and
   Core-only (`policy-override`, `trust-root-modify`, `credential-export`,
   `ground0-replace`). A manifest cannot request Core-only; validation rejects it.
2. **What the host grants.** Nothing runs by default (deny-by-default). The host
   passes grants explicitly at load. Public grants are safe to hand out;
   Privileged grants are a reviewed host decision.
3. **Where a human approves.** A tool can `context.propose(...)` an action, but
   the host (or a human) owns the commit. "Prepare is not commit."
4. **Caller attribution.** Every tool declares its `requiredCapabilities`; the
   host refuses to run a tool whose grant is missing.

## What to demonstrate

Run the two `run-demo` commands and show the three grant scenarios for each:

- **Deny-by-default (no grants)** — every gated tool is blocked.
- **Public grants only** — `status` runs (it needs only `network`); `run_task`
  stays blocked because it needs the Privileged `providers` grant.
- **All requested grants (reviewed)** — both tools run; `run_task` returns
  `{ status: "proposed" }`, not a completed result.

## The three honest boundaries (state these, do not soften them)

1. **No OS confinement.** Add-ons are ordinary Node modules here; nothing is
   sandboxed. Confinement is future engine work.
2. **No provider call.** The "service" is a simulated loopback on
   `127.0.0.1:3080`; no live request is made and no credential is used.
3. **No commit boundary yet.** `propose` builds a proposal object; the host that
   approves or refuses it is still to be built.

## Where to land

End your summary by surfacing the open decision that is Manolo's call:

- The **privilege split (§13.2)** — proposed, not agreed: only the
  authority-holding parts (the action executor with its field classifier, the
  commit broker, credential custody, the update channel) would be privileged;
  everything else runs as a public extension.
- Whether the **field classifier** moves into Manolo's action executor (his
  code, his agreement first).

## Report

Produce a single document with:

- Commands run and the test count (expect **9 / 9**).
- The three grant scenarios per plugin (Augmentor, Grok-Build).
- Your four-point explanation of the contract.
- The three honest boundaries.
- The open decision you are asked to weigh in on.

## Do NOT

- Modify, create, or delete any file.
- Add a live network call, credential, secret, or external dependency.
- Change `sdk.mjs`, `run-demo.mjs`, `sdk.test.mjs`, or any plugin.
- Present the demo as a live integration; it is an offline contract walkthrough.
