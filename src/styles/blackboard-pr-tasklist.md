# Blackboard Addon PR Tasklist

## Changes
- [ ] Update `browser-first/resonantos-side-panel-extension/src/addons/blackboard/blackboard.js`
  - tighten `iframe.sandbox` for Blackboard embed frames
  - enforce secure embed URL policy

- [ ] Update `browser-first/resonantos-side-panel-extension/src/lib/blackboard-url-policy.js`
  - block or restrict non-HTTPS/mixed-content embed URLs
  - add allowlist behavior if required

- [ ] Update `browser-first/resonantos-side-panel-extension/src/background.js`
  - ensure only extension/host pages can relay Blackboard messages
  - add safe parent-mediated handling for iframe-triggered tab/popup requests

## Extension task items
- [ ] Verify extension background relay only accepts messages from authorized pages
- [ ] Add secure parent-mediated handling for iframe-originated tab/popup actions
- [ ] Ensure extension page and side-panel host code implement the Blackboard relay contract
- [ ] Update extension user approval/allowlist handling for embed sources
- [ ] Confirm extension-level logging or diagnostics for blocked embed attempts

- [ ] Define embed approval system
  - establish whether embeds require explicit approval or allowlisting
  - document approval rules and runtime enforcement points
  - support owner/PM review of embed content before activation

## Tests
- [ ] Add or extend tests for:
  - embed URL policy coverage
  - sandbox enforcement tests
  - background relay gating tests
  - Blackboard controller open/retry behavior test

## Documentation
- [ ] Document addon vs extension responsibility boundary
- [ ] Capture secure embed expectations and flow

## Validation
- [ ] Run Blackboard-specific tests
- [ ] Run full `npm test` regression suite
