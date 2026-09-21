# Prompt: OMP — rehearse the ResonantOS SDK demo (Andrew's presenter prep)

**Audience:** oh-my-pi harness (OMP)
**Mode:** read-only — run the demo and read the docs; do not modify any file.

## Goal

Rehearse the ResonantOS SDK walkthrough so Andrew can present it live to Manolo.
Run the demo, read the presenter outline, and produce a ready-to-narrate script
plus a Q&A cheat sheet.

## Steps

1. Run the demo hands-free and capture the full output:

   ```bash
   cd 2.0.0-alpha
   node examples/sdk-prototype/present-demo.mjs --auto
   ```

   (Sanity check first if you like: `node --test examples/sdk-prototype/sdk.test.mjs`
   → expect **9 / 9**.)

2. Read, in order:

   - `docs/sdk-demo-walkthrough-outline.md` — the presenter runbook.
   - `examples/sdk-prototype/README.md` — the capability model.
   - `examples/sdk-prototype/plugins/augmentor/plugin.json` + `plugin.mjs`.
   - `examples/sdk-prototype/plugins/grok-build/plugin.json` + `plugin.mjs`.

## Produce

1. **A 30-second elevator summary** — what the demo is, and what it is not.
2. **A scenario-by-scenario narration script** — for each of the three scenarios
   (deny-by-default, Public grants, reviewed grants), the one thing Andrew should
   point at on screen and the one sentence to say.
3. **The three honest boundaries, verbatim** — no OS confinement, simulated
   loopback (no provider call), propose ≠ commit.
4. **A Q&A cheat sheet** — start from the outline's "likely questions" and add any
   you would expect from a technical founder, each with a one-to-two sentence
   answer.
5. **A "watch for" list** — the exact lines that prove the point
   (`status: "proposed"`, `online: "simulated"`, and the "requires ungranted
   capabilities" refusals).
6. **A dry-run report** — confirm the run behaved as described and flag anything
   that drifted.

## Constraints

- Read-only: do not modify, create, or delete any file.
- No live network call, credential, secret, or dependency.
- Frame the demo as an offline contract walkthrough, not a live integration.
