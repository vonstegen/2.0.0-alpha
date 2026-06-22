# Plan: Settings Strict Hierarchy

## Work Units

1. Update Settings section types and nav constants.
2. Add Advanced secondary nav and section state.
3. Add Profile, Browser Control, Add-ons, and Privacy top-level sections.
4. Move Diagnostics, Routing, Logician, Defaults, and Shell behind Advanced.
5. Remove diagnostics/runtime/activity output from Providers.
6. Update App Settings default and diagnostics trigger.
7. Add and update tests.
8. Run build and full test suite.

## Constraints

- Keep code scoped to Settings/App surfaces and run artifacts.
- Do not introduce a new routing framework.
- Preserve existing provider diagnostics behavior after the user enters Advanced.
- Do not run live subagent dispatch for code or plan lanes.

## Verification Plan

- Component hierarchy test.
- Affected App flow tests.
- Full build.
- Full test suite.
