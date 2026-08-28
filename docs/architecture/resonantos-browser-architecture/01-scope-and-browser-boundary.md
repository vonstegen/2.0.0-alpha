# 01 — Scope and Browser-First Boundary

## Definition

ResonantOS is a browser-first, local-bridge-mediated AI operating environment. Its required Alpha runtime remains:

1. a Chrome Manifest V3 extension; and
2. an authenticated Node bridge bound to the local host.

“Operating environment” describes coordination across agents, add-ons, memory, providers, browser surfaces, and host capabilities. It does not mean that ResonantOS owns the machine's kernel or base operating system.

## Trust boundaries

```text
Unprivileged presentation         Trusted policy             Privileged effects
Extension UI and add-on panes --> Core/SDK + bridge auth --> host services/resources
```

- The extension presents state and requests operations.
- ResonantOS Core owns identity, policy decisions, grants, delegation lineage, lifecycle, audit, and recovery state.
- Platform services implement privileged operations behind the authenticated bridge.
- Add-ons and harnesses are consumers; install or provenance never creates ambient authority.

## Required invariants

- Every privileged effect MUST cross a named, authenticated, capability-gated host route.
- UI visibility, enablement, a prompt, or an Augmentor decision MUST NOT itself authorize an operation.
- Provider secrets, browser credentials, filesystem roots, and external-account authority MUST remain host-mediated.
- The local bridge MUST default to loopback and reject unauthenticated requests.
- Replaceable UI or agent implementations MUST NOT displace the recovery and policy floor.
- Historical native-shell ADRs MUST NOT silently broaden the active browser-first runtime.

## Product vocabulary

| Term | Meaning |
| --- | --- |
| ResonantOS Core | Non-optional policy, identity, lifecycle, audit, and recovery authority |
| Browser shell | MV3 extension surfaces and shell-owned navigation |
| Platform service | Host-mediated implementation behind an authenticated route |
| Augmentor | Native ResonantOS-aware orchestration implementation for the primary-agent role |
| Augmentor extension | Focused capability or workflow used within Augmentor |
| Harness provider | Adapter for a complete external AI harness with its own loop, tools, and agents |
| System add-on | Capability such as memory, browser, channel, or compute that is neither of the above |
| Ground-0 | Minimum known-good browser/bridge state for recovery |
| Host OS | macOS, Windows, or Linux beneath ResonantOS |

## Out of scope

The architecture does not define a Linux distro, compositor, kernel service, boot recovery, root filesystem, host package manager, or replacement desktop. Portability across host operating systems is a design quality, not permission to model future Linux internals in the current SDK.

## Acceptance test

A proposed feature belongs here only if it can be expressed as an extension/bridge interaction or a portable Core contract. If it requires boot-time, kernel-level, or machine-wide ownership, it belongs to a separate future project.
