# Community SDK 0.1 — Revision End-State

The current SDK revision is complete only when it proves both a real Pi.dev harness add-on and a reusable External SDK that a fresh developer/AI harness can use without modifying ResonantOS Core.

## Pi reference add-on

Install/enable Pi -> dynamic harness/coding-agent classification -> ROS provisions Provider Profile/model, project/files, memory, skills, selected tools and grants -> Pi control surface -> Embedded PTY or External Terminal -> real Pi native TUI.

No manual bridge, wrapper, RPC process, credential export, cd, or Pi startup. Pi remains Pi; ROS is the sovereign router/control plane.

## Reusable Community SDK

Initial categories: harness, tool, connector, communication, data-source, ui, service.

A harness kit should describe classification, runtime, interface ownership/type, Provider Connection, resource requests/projection, capabilities/grants, system slots, surfaces, lifecycle, security, validation and testing.

Provider identity is separate from protocol compatibility. A harness requests resources; ROS grants and projects only the authorized subset: request != grant != session projection.

Initial resource families: provider/model, project, files, memory, skills and tools. Future seams: User Profile, DAR/Artifacts, Map and connectors.

## Runtime-native terminal profile

```yaml
interface:
  ownership: runtime-native
  type: terminal
  modes: [embedded-pty, external-terminal]
```

This should later support Hermes, OpenCode, Claude Code, Codex, Grok Build and similar harnesses.

## Fresh-developer proof

Give a fresh AI coding harness only the Community SDK, public docs and reference add-ons. It must discover the category, build a valid manifest, request resources/capabilities, choose an interface, pass validation/security, install dynamically and function without Core changes.

## Roadmap

1.1A Provider/protocol model -> 1.1B providerProtocols contract -> 1.1C discovery/runtime enforcement -> 1.1D qualification -> Harness Resource Projection -> real Pi -> External Terminal -> Generic PTY -> Embedded Pi -> full Pi reference -> SDK Guide/Echo refresh -> Community SDK packaging -> fresh-developer test -> Community SDK 0.1 Alpha.
