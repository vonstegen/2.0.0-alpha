# Prompt: test the ResonantOS prototype SDK demo

**Audience:** any AI-agent harness (Codex, OMP, DeepSeek-harness, or equivalent)
**Mode:** read-only — run tests, do not modify any file

## Goal

Fetch and test the ResonantOS prototype SDK demo, then report results. Verify the
preinstalled first-party add-on is the **Augmentor** (Manolo's DeepSeek Harness),
not the old "Augmentor Chat".

## Steps

1. Clone the demo branch:

   ```bash
   git clone --depth 1 --branch demo/sdk-prototype https://github.com/vonstegen/2.0.0-alpha.git
   cd 2.0.0-alpha
   ```

2. Run the test suite and both demo scenarios:

   ```bash
   node --test examples/sdk-prototype/sdk.test.mjs
   node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/augmentor
   node examples/sdk-prototype/run-demo.mjs examples/sdk-prototype/plugins/grok-build
   ```

3. Read `prompts/sdk-demo-prompt.md` for what the demo must demonstrate.

## Confirm

- **9 / 9 tests pass.**
- The preinstalled first-party add-on is the **Augmentor** (Manolo's DeepSeek
  Harness, `addon.augmentor`), NOT the old Augmentor Chat.
- In each `run-demo` scenario, deny-by-default holds: ungated tools are blocked,
  Public-only grants let Public tools run while Privileged tools stay blocked, and
  `run_task` stops at `"proposed"` (prepare, not commit).
- The backend is a **simulated loopback** on `127.0.0.1:3080`; no live API call is
  made and no credential is used.

## Report

- Test count (expect 9/9).
- The three grant scenarios per plugin (Augmentor, Grok-Build).
- Any deviation from `prompts/sdk-demo-prompt.md`.

## Do NOT

- Edit, create, or delete any file.
- Add a live network call, credential, secret, or dependency.
- Change `sdk.mjs`, `run-demo.mjs`, `sdk.test.mjs`, or any plugin.
