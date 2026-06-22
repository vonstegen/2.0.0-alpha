# Install The Browser-First Alpha

The alpha install is a Chrome extension plus a local Node.js bridge.

## Prerequisites

- Node.js 18 or newer
- Chrome, Brave, Edge, or another Chromium-family browser with Manifest V3
  extension support

## Start The Bridge

```bash
npm install
npm run browser-first:bridge
```

The bridge writes:

```text
browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js
```

This generated file contains the local bridge URL and token. It is ignored by
git and regenerated on bridge startup.

## Load The Extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select `browser-first/resonantos-side-panel-extension`.

Keep the bridge process running while using the side panel.

## Verify

```bash
npm run test:browser-first
npm run test:browser-host
```

For full release validation, run the root `npm test -- --run`, `npm run build`,
and security pipeline checks.
