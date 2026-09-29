# Pi Native Interface R&D

This R&D defines the real Pi reference add-on experience for ResonantOS.

Decision: support both **A: external native terminal** and **B: embedded PTY**.
Both launch the real Pi interactive TUI and share one ROS-owned provisioning,
credential, authorization, and lifecycle path.

Sources:
- PI-NATIVE-INTERFACE-RND-001.md / .tex
- PI-NATIVE-INTERFACE-RND-002-SECURITY-AND-LIFECYCLE.md / .tex
- PI-NATIVE-INTERFACE-ROADMAP-001.md / .tex

Research basis: Pi interactive mode is the full human TUI; RPC/SDK are alternate
interfaces to the same agent/session mechanisms and RPC explicitly degrades
TUI-only extension behavior. Therefore the native TUI should run attached to a
real terminal/PTY rather than be recreated as a custom ROS chat UI.
