# Refine Seed Proposal

## Seed

Settings currently exposes technical sections as first-level navigation. Issue 93 requires a stricter information architecture: everyday user settings stay first-level, while diagnostics, provider activity, route internals, raw provider metadata, runtime nodes, logs, and trust-kernel details move behind Advanced/Diagnostics.

## Problem

The existing Settings sidebar included Providers, Strategy, Memory Bridge, Logician, Defaults, and Shell. That violates the issue in two ways:

- user-facing sections such as Profile, Browser Control, Add-ons, and Privacy were missing from the top level;
- internal sections such as Strategy, Logician, Defaults, and Shell competed with everyday configuration tasks.

Provider diagnostics and recent routed-call logs were also visible inside Providers, making the provider setup page do two jobs at once.

## Acceptance Frame

- Top-level Settings navigation contains only Profile, Providers, Memory, Browser Control, Add-ons, Privacy, and Advanced.
- Advanced contains secondary navigation for Diagnostics, Routing, Logician, Defaults, and Shell.
- Provider setup remains top-level but does not render diagnostics, provider activity logs, or runtime nodes.
- Diagnostics contains provider health, smoke tests, runtime nodes, and provider activity.
- Tests prevent technical sections from returning to the top-level Settings nav.
