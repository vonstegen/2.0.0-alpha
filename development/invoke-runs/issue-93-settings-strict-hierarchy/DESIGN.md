# Design: Settings Strict Hierarchy

## Information Architecture

Top-level Settings is reserved for user-facing decisions:

- Profile: trusted identity and delegation posture.
- Providers: add/edit/check provider setup.
- Memory: Living Archive bridge controls.
- Browser Control: browser session status.
- Add-ons: installed manifests and capability review summary.
- Privacy: credentials, archive, and memory boundaries.
- Advanced: a deliberate entry point for technical state.

Advanced owns secondary tabs:

- Diagnostics: provider health, smoke tests, runtime nodes, provider activity.
- Routing: model strategy.
- Logician: trust kernel and gate internals.
- Defaults: system defaults.
- Shell: layout/application posture.

## Interaction Notes

- Each top-level section starts with an action or status block.
- Provider setup keeps Add AI Provider and Check Health at the top but does not inline diagnostic output.
- Diagnostics remains inspectable and testable without hiding existing provider health behavior.

## Technical Approach

- Change `SettingsSection` to the new top-level union.
- Add local `AdvancedSettingsSection` state inside `SettingsWorkspace`.
- Keep old internal panels intact but gate them through `props.settingsSection === "advanced"` and the secondary tab.
- Update App default from `providers` to `profile`.
- Move automatic provider diagnostics loading from Providers to Advanced.
