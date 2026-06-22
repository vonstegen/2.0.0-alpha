# Browser-First Host

This host is a local Node.js bridge for the 2.0.0 alpha Chrome extension. It
does not launch a packaged desktop app, Electron process, Rust service, or
native browser host.

## Run

```bash
npm run browser-first:bridge
```

Compatibility entrypoints such as `browser-first/host/run-browser-first.mjs`
delegate to `run-bridge-minimal.mjs`.

## Security Boundary

- Bridge access is authenticated with a generated token.
- Generated extension config is written with user-only file permissions.
- Provider secrets, wallet secrets, private keys, and full home paths are not
  exposed through diagnostics.
- Wallet connect/sign/transaction approval remains human-only inside Chrome or
  Brave.

## Routes

The host wires provider status/chat, memory intake, add-on delegation, archive
review, diagnostics, and extension preferences into the local bridge. Desktop
launch diagnostics are intentionally out of scope for this alpha.
