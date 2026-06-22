# Runtime Handoff

## Implementation Work Package

Implement issue 93 in the clean worktree branch `issue-93-settings-strict-hierarchy` from `origin/dev`.

## Required Changes

1. Replace the Settings top-level nav with Profile, Providers, Memory, Browser Control, Add-ons, Privacy, and Advanced.
2. Add an Advanced secondary nav for Diagnostics, Routing, Logician, Defaults, and Shell.
3. Move provider diagnostics, smoke tests, runtime nodes, and provider activity logs behind Advanced/Diagnostics.
4. Keep Providers focused on adding/editing/checking providers.
5. Open Settings on Profile by default.
6. Add focused tests for the hierarchy and update App tests for the new paths.

## Verification Surface

- `npm test -- --run src/modules/settings/SettingsWorkspace.test.tsx`
- `npm test -- --run src/App.test.tsx -t "<affected Settings flows>"`
- `npm run build`
- `npm test -- --run`
