# PI-NATIVE-INTERFACE-RND-001 — Native Pi TUI Integration

## Decision
Support A (external native terminal) and B (embedded PTY). Both use one host-owned Pi Provisioner and launch the real interactive Pi TUI. Do not rebuild Pi's UI and do not treat RPC as equivalent to the full TUI.

## Router architecture
ROS owns project, Provider Profile/model, credentials, capabilities, lifecycle and future skills/memory/tools. Pi owns its runtime-native terminal interaction.

```text
ROS resources/policy -> Pi Provisioner -> A external terminal OR B embedded PTY -> real pi -> native Pi TUI
```

## Interface profile
```yaml
interface:
  ownership: runtime-native
  type: terminal
  modes: [embedded-pty, external-terminal]
```
This must be generic enough for Hermes/OpenCode/Claude Code/Codex/Grok Build later.

## A
ROS validates grants, resolves cwd/provider/model/auth/resources, builds a sanitized launch spec, launches an approved OS terminal adapter, starts real Pi interactive mode, tracks health, and cleans up on exit. No manual cd/key export/bridge/RPC/pi command.

## B
Extension terminal emulator -> semantic terminal protocol -> host PTY service -> pseudo-terminal -> real Pi -> native TUI. Required operations: create/input/output/resize/interrupt/status/close. A stdout pipe is insufficient.

## Shared provisioner
Host resolves add-on identity, project/cwd, executable identity, provider/model, scoped credential/config, allowed environment/resource roots, session policy, interface mode and audit correlation. Manifest describes intent; host creates authority.

## Credentials
ROS Provider Profiles remain source of truth. Investigate runtime auth that avoids durable duplicate Pi auth storage. If native Pi requires API-key environment form, use a per-session child environment. Never expose raw secret in argv/manifest/UI/log/Git.

## Product surface
ROS control surface shows status/project/provider/model/credential configured boolean/primary state/interface mode plus Open in ROS and Open External Terminal. Pi TUI is the work surface.

## Phasing
Phase 1: real project/provider/grants/native Pi tools/TUI. Phase 2: ROS skills/context/memory/tools/profile.

## Non-goals
No React clone, no RPC-as-TUI, no manual bridge/server startup, no arbitrary manifest shell commands, no Pi-specific PTY architecture, and no dependency on completing the future sovereign fabric.
