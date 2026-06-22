# Task Session: issue-93-settings-strict-hierarchy

## Summary

Implemented the Settings strict hierarchy for issue 93.

## Changed Surfaces

- `src/modules/settings/SettingsWorkspace.tsx`
- `src/modules/settings/settings.css`
- `src/modules/settings/SettingsWorkspace.test.tsx`
- `src/App.tsx`
- `src/App.test.tsx`

## Result

- Settings now opens on Profile.
- Top-level Settings nav is Profile, Providers, Memory, Browser Control, Add-ons, Privacy, Advanced.
- Advanced secondary nav is Diagnostics, Routing, Logician, Defaults, Shell.
- Provider setup no longer renders diagnostics, runtime nodes, or provider activity logs inline.
- Advanced/Diagnostics renders provider health, smoke tests, runtime nodes, and provider activity.
- Tests cover the hierarchy and updated App interactions.

## Verification

- `npm ci`: pass; emitted a `jsdom` engine warning because Node is `v22.12.0` and jsdom requests `^20.19.0 || ^22.13.0 || >=24.0.0`.
- `npm test -- --run src/modules/settings/SettingsWorkspace.test.tsx`: pass, 3 tests.
- `npm test -- --run src/App.test.tsx -t "shows provider diagnostics in settings|adds a provider profile through the compact settings modal|starts the Living Archive memory bridge from settings|connects Resonant Notes to a selected vault and previews a note"`: pass, 4 tests.
- `npm test -- --run src/App.test.tsx -t "renders Home as a sidebar plus expanded chat surface and accepts a message|opens the main chat rail from Living Archive instead of toggling hidden archive chat layout|opens the Resonant Browser workspace from Home with a live viewport contract"`: pass, 3 tests.
- `npm run build`: pass.
- `npm test -- --run`: pass, 37 files and 309 tests.

## Notes

An earlier full test run was started in parallel with the production build and failed three unrelated App tests under resource contention. The same three tests passed in isolation, and the final full test run passed when executed alone.
