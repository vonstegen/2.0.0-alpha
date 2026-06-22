# Stage 01: Context

## Ticket Context

Issue 93 is a P1 Settings hierarchy issue. It explicitly asks for the top-level user-facing sections Profile, Providers, Memory, Browser Control, Add-ons, and Privacy, with advanced diagnostics, route internals, raw provider metadata, logs, and diagnostics behind Advanced/Diagnostics.

## Evidence Notes

- `docs/UX_AUDIT_2026-06-01.md:40-48` supplies the exact P1 acceptance language.
- `docs/PRODUCT_GUIDE_BROWSER_FIRST.md:497-516` says Settings should configure the system without requiring internal architecture knowledge and should show important status/actions first.
- `docs/product/SETTINGS-001-browser-first-settings-plan.md:579-585` defines diagnostics as bridge/browser/provider/add-on/memory health.

## Existing Code Shape

- `SettingsSection` previously included `providers`, `strategy`, `memory`, `logician`, `defaults`, and `shell`.
- Provider diagnostics and provider activity lived directly inside the Providers section.
- App defaulted Settings to `providers`, which made technical health checks too prominent.
