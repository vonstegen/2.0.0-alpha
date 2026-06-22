# Define: Settings Strict Hierarchy

## User Outcome

A user opening Settings first sees human-facing configuration categories. Technical diagnostics and internals are still available, but only after entering Advanced.

## Scope

- Settings navigation and section routing.
- Settings section content ordering.
- Provider diagnostics relocation.
- Tests for hierarchy and affected App flows.

## Acceptance Criteria

- Top-level Settings nav includes Profile, Providers, Memory, Browser Control, Add-ons, Privacy, Advanced.
- Top-level Settings nav excludes Strategy, Logician, Defaults, Shell.
- Advanced secondary nav includes Diagnostics, Routing, Logician, Defaults, Shell.
- Provider page does not show Diagnostics, runtime nodes, or provider activity logs.
- Advanced/Diagnostics shows provider health, smoke tests, runtime nodes, and provider activity logs.
- Settings opens to Profile by default.
- Full build and test suite pass.
