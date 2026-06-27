# Alpha Distribution

Status: Chrome extension alpha MVP guidance
Date: 2026-06-25

## Purpose

This document explains how to build and share the ResonantOS 2.0.0 alpha MVP
with reviewers. The alpha release is browser-first: a Chrome Manifest V3
extension plus a local Node.js bridge.

Do not distribute Tauri, Electron, native CEF, or Rust/Cargo desktop artifacts
as part of this alpha unless the release owner explicitly reopens that scope.

## Supported Alpha Target

The supported reviewer install is:

- Chrome, Brave, Edge, or another Chromium-family browser with Manifest V3
  extension support.
- The unpacked extension at `browser-first/resonantos-side-panel-extension`.
- The local Node.js bridge under `browser-first/host`.
- Node.js 18 or newer.

The alpha does not include:

- Tauri desktop packaging.
- Electron packaging.
- Native CEF/browser-host bundles.
- Rust toolchain or Cargo build path.
- Native desktop signing/notarization.
- Terminal or Audio2TOL workspaces.

## How To Build And Run Locally

Install dependencies:

```bash
npm install
```

Start the browser-first bridge:

```bash
npm run browser-first:bridge
```

The bridge writes:

```text
browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js
```

That generated file contains the local bridge URL and token. It is ignored by
git, regenerated on bridge startup, and must not be committed or shared as a
source artifact.

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Select `browser-first/resonantos-side-panel-extension`.
5. Keep the bridge process running while testing the extension.

## Release Validation

Before sharing an alpha package or install instructions, run:

```bash
npm test -- --run
npm run build
npm run test:browser-first
npm run test:browser-host
npm run test:health
node scripts/security-pipeline/run-check.mjs
npm run browser-first:audit-scope
npm run browser-first:audit-scope:staged
```

For host-service changes, also run the relevant focused suites:

```bash
npm run test:living-archive-mcp
npm run test:living-archive-memory-service
npm run test:engineer-runner
```

Do not use `npm run tauri:build` as an alpha release gate. Tauri packaging is
outside the Chrome extension MVP scope.

## Alpha Privacy Boundary

The alpha should not include founder personal data, provider secrets, generated
bridge tokens, local runtime state, or reviewer-specific workspace data.

Local runtime/user state may exist under paths such as:

- `ResonantOS_User/`
- `browser-first/Runtime/`
- `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`
- local `.env` files
- local `output/` and `runs/` evidence directories

Those paths are not distribution payloads.

## Provider And Secret Policy

Provider credentials are supplied by each reviewer through the bridge/settings
flow or the reviewer's local environment. Do not include credential values in
source, reports, screenshots, logs, generated configs, or packaged artifacts.

Required pre-share scan:

```bash
rg -n "sk-[A-Za-z0-9_-]+|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|GITHUB_TOKEN|BEGIN PRIVATE KEY|bridge-token|capabilityTokens" .
```

Review each match before sharing. Expected safe matches include documentation
examples, variable names, and redacted placeholders. Secret values, generated
bridge tokens, or capability-token payloads are release blockers.

## Add-on Policy For Alpha

Add-ons are visible as governed, replaceable capabilities. They are not trusted
core agents and should not receive raw provider secrets, wallet authority, or
trusted memory-write authority.

Alpha status:

- OpenCode governed delegation may execute through the browser-first bridge when
  explicitly enabled and configured.
- Hermes dashboard/setup and governed packet delegation are available. When
  explicitly enabled and configured, Hermes local execution runs through the
  browser-first bridge's prompt-file Python adapter so delegation content stays
  out of process argv.
- Terminal and Audio2TOL are outside this alpha scope.

## Reviewer Instructions

Ask reviewers to focus on:

- loading the extension successfully;
- starting and connecting to the local bridge;
- configuring a provider without exposing credential values;
- using main chat and the side-panel chat;
- checking Settings, Diagnostics, Bridge Target, Add-ons, Living Archive,
  Hermes, and OpenCode surfaces;
- confirming unavailable or deferred capabilities are explained clearly.

Ask reviewers not to evaluate this alpha as production-ready for:

- desktop packaging;
- native signing/notarization;
- encrypted portable vault;
- signed add-on marketplace;
- final wallet security;
- final native browser automation.

## Current Release Waivers And Deferrals

The release owner must explicitly accept or close these before publishing:

- #102 Living Archive real-data validation: complete with evidence or waive.
- #111 encrypted vault: may be deferred only while alpha credentials remain
  session-only/env-only and plaintext persistence is not reintroduced.
- #163 PATH-resolved binary exec/install shell hardening: defer only as broader
  local CLI hardening with opt-in local execution gated.
- #192 and #194 runtime/native installation issues: add to the project board and
  fix, close, or formally defer as outside Chrome MVP scope.

## Release Gate Before Sharing

Before sending the alpha to reviewers:

- confirm the current branch is `dev`;
- confirm all release-scope changes are committed and pushed;
- confirm clean validation commands pass;
- confirm project-board status matches the GitHub issues/PRs;
- confirm no generated bridge config or provider secret values are included;
- produce screenshot evidence for every shipped surface;
- record any release-owner waivers in the release report.
