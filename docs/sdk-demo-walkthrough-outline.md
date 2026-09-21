# SDK demo — walkthrough outline for Andrew

A presenter's outline for walking Manolo through the ResonantOS add-on contract.
Keep it tight — ~20–25 minutes — then hand the floor to the privilege-split
conversation (Manolo + Tom).

## Before you start

- Checkout on `demo/sdk-prototype`.
- Confirm a clean run: `node --test examples/sdk-prototype/sdk.test.mjs` → **9 / 9**.
- Have `node examples/sdk-prototype/present-demo.mjs` ready to run — it walks
  both add-ons through the three scenarios with step headers and
  Enter-to-continue pauses. (`--auto` runs it hands-free.)
- Have `examples/sdk-prototype/plugins/augmentor/plugin.json` open — you'll point
  at it.

## Frame (2 min) — say this up front

> "This is an **offline walkthrough of the add-on contract**, not a live
> integration. Three things it honestly does not show:
>
> 1. add-ons are ordinary Node modules — there's no OS confinement yet;
> 2. nothing contacts a provider — the loopback is simulated;
> 3. `propose` builds a proposal — the host that approves or refuses it is still
>    to be built.
>
> Those three gaps are exactly what the engine-confinement and commit-broker
> work will close."

## The contract (5 min)

Walk the three questions, pointing at code:

1. **What an add-on may declare** — the manifest. Show `augmentor/plugin.json`:
   id `addon.augmentor`, `requestedCapabilities`, two tools each with
   `requiredCapabilities`. Explain Public / Privileged / Core-only, and that
   Core-only is rejected at validation (point at `sdk.mjs` `validateManifest`).
2. **What the host grants** — deny-by-default. Nothing runs until the host
   passes grants explicitly (`loadPlugin`).
3. **Where a human approves** — `context.propose(...)`: prepare, not commit.

## Demonstrate (10 min) — the three scenarios

Run the presenter once — it walks the Augmentor (Manolo's own harness), then
Grok-Build (the third-party add-on built through the same contract), pausing on
each scenario:

```bash
node examples/sdk-prototype/present-demo.mjs
```

Raw alternative (one add-on at a time, no pacing):

```bash
node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/augmentor
```

Point at the three scenarios in each run:

1. **No grants** → every gated tool is blocked (deny-by-default).
2. **Public grants** → `status` runs (needs only `network`); `run_task` is
   refused because it needs the Privileged `providers` grant.
3. **Reviewed grants** → both run; `run_task` returns `status: "proposed"` — it
   does not execute.

Highlight the punchlines on screen: `status: "proposed"`, `online: "simulated"`,
and the note "prepare is not commit — human approval required".

## The point it lands on (3–5 min)

- **One Augmentor**: Manolo's DeepSeek Harness is the product's single
  first-party add-on; Grok-Build is additive, not a replacement.
- The contract is the thing to react to: **what an add-on may declare, what the
  host grants, where a human approves.**

## Hand off to the decision (2 min — name it, don't answer it)

- The **privilege split (§13.2)** — proposed, not agreed: only the
  authority-holding parts (action executor + field classifier, commit broker,
  credential custody, update channel) are privileged; the rest runs as a public
  extension. This is Manolo's call with Tom.
- Whether the **field classifier** moves into Manolo's action executor (his
  code, his agreement first).

## Likely questions

- **"Is this the production SDK?"** No — this is a self-contained prototype. The
  production SDK is at `packages/addon-sdk` (governed by ADR-018); the prototype
  mirrors its manifest vocabulary so a plugin authored here maps cleanly over.
- **"Did it really call DeepSeek?"** No — the loopback is simulated; no network,
  no credential.
- **"So it can't be misused?"** The contract (deny-by-default, capability
  classes, propose-not-commit) is real and tested; OS confinement and the commit
  broker are the open gaps — that is the next work.

## Timing summary

| Section                         | Time    |
| ------------------------------- | ------- |
| Frame + boundaries              | 2 min   |
| The contract                    | 5 min   |
| Three scenarios                 | 10 min  |
| Landing point                   | 3–5 min |
| Hand off to the privilege split | 2 min   |
