# ResonantOS Browser-First Alpha

This directory contains the browser-first alpha surface:

- `resonantos-side-panel-extension/` is the loadable Chrome Manifest V3
  extension.
- `host/` is the local Node.js bridge used by the extension.

The 2.0.0 alpha does not ship a packaged desktop browser, Electron sidecar,
native CEF host, or Rust/Tauri shell.

## Run The Bridge

```bash
npm run browser-first:bridge
```

The bridge starts on loopback, generates a per-run bridge token, and writes
`resonantos-side-panel-extension/src/bridge-config.generated.js`. The generated
config is ignored by git.

## Load The Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `browser-first/resonantos-side-panel-extension`.

## Browser Control Boundary

Augmentor runs in the side panel and can only act through typed mediated browser
tools. It can read pages, inspect forms, click visible non-submit controls, type
into editable fields, scroll, and switch to observed tabs.

The alpha blocks wallet approvals, signatures, credential autofill, payments,
public form submission, destructive document actions, and other privileged
browser operations unless a human performs them directly in the browser.

## Tests

```bash
npm run test:browser-first
npm run test:browser-host
```

Use the root validation commands before tagging or merging release work.
