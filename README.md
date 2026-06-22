# ResonantOS vNext 2.0.0 Alpha

ResonantOS 2.0.0 alpha is a browser-first Chrome extension release. The alpha
ships the Manifest V3 side-panel extension and a local Node.js bridge server.

Tauri, Electron, native CEF hosts, Rust toolchains, terminal add-ons, and
Audio2TOL are not part of this alpha.

## Quick Start

```bash
npm install
npm run browser-first:bridge
```

Then open Chrome or another Chromium-family browser:

1. Go to `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `browser-first/resonantos-side-panel-extension`.

The bridge writes `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`
at startup with a local bridge URL and token. That file is generated, ignored,
and must not be committed.

## Development

```bash
npm run dev
```

The Vite shell is useful for React workspace development, but the alpha release
target is the Chrome extension plus the local bridge.

## Included

- Chrome Manifest V3 side-panel extension
- Pure Node.js bridge host under `browser-first/host/`
- Provider routing, Augmentor chat, browser agent control, Living Archive intake,
  add-on registry, and SDK validation
- Browser-host tests and extension-scope checks

## Not Included

- Tauri desktop shell
- Electron host
- Native CEF/browser app bundle
- Rust toolchain or Cargo build path
- Terminal and Audio2TOL workspaces

## Project Structure

```text
browser-first/resonantos-side-panel-extension/  Chrome extension
browser-first/host/                             Node bridge host
addons/resonant-browser-host/                   Browser host package
src/                                            Shared React/core code
public/addons/                                  Alpha add-on catalog
scripts/                                        Release and validation scripts
```

## Validation

```bash
npm test -- --run
npm run build
npm run test:browser-first
npm run test:browser-host
node scripts/security-pipeline/run-check.mjs
```

## Git Workflow

Active development happens on `dev`. Do not commit directly to `main` unless
explicitly instructed.

## License

MIT. See `LICENSE.txt`.
