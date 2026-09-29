# Pi.dev Reference Add-on — Qualification and Test Plan

## Objective

Prove Pi is a real ResonantOS harness add-on and that its generic SDK facilities are reusable. Unit tests alone are insufficient.

## T0 Baseline/build
Exact SHA/branch; clean tree; Pi/version/executable; runtime versions; build/typecheck; no unreviewed bridge dependency; no secrets.

## T1 Manifest/Dynamic SDK
Validate harness/coding-agent, provider protocol compatibility, runtime-native terminal interface, capability requests, category discovery and dynamic right-rail appearance. Negative tests cover unknown/obsolete/unsupported declarations.

## T2 Harness Provider Connection
Credential configured once in ROS Settings; Pi sees only compatible profiles/models; no secret/endpoint projection; runtime re-check; model/profile scoping; cross-harness isolation; missing/revoked grant fails; Augmentor/Pi share one profile independently; no second Pi credential entry.

## T3 Harness Resource Projection
One session projection contains only granted/available resources. Prove provider/model, project/cwd, project files/native Pi tools, memory search/read where stable, one bounded ROS tool where stable, and skill adapter if safe. Test wrong project, stale/cross-harness projection, write escalation, tool allowlist and unknown resources.

## T4 Native Pi
Real Pi interactive TUI, real inference, repository-read task, correct cwd/provider/model, native tools, clean exit, no manual bridge/RPC/wrapper.

## T5 A — External Terminal
ROS provisions and launches approved external terminal with ready real Pi TUI. Real inference/read task, clean cleanup. No secret argv, arbitrary executable, unsafe env or unauthorized cwd.

## T6 Generic PTY
Certify a harmless fixture first: create/input/output/ANSI/resize/raw keyboard/Ctrl-C/close/status/cleanup/stale-token rejection/post-close rejection/output injection containment/orphan cleanup. No Pi-specific assumptions.

## T7 B — Embedded Pi
Real Pi through generic PTY + ROS terminal emulator. Verify TUI fidelity, cursor/ANSI, resize, input/editor, commands, Ctrl-C, tool output, inference, repo read, exit and cleanup.

## T8 ROS control surface
Safe metadata only: status, project, provider label, model, credential-configured boolean, primary state, resource sends, interface mode, Open in ROS and Open External Terminal. Both modes use one provisioner/projection.

## T9 Lifecycle/revocation
Exercise available -> installed -> granted -> enabled -> ready -> active -> ended, plus disable/revoke idle/active, Pi crash, host crash/restart and re-enable. No orphan authority.

## T10 Security/adversarial
Forged identities/tokens, incompatible protocol, arbitrary executable/argv, secret command line, unauthorized cwd/filesystem, cross-harness credentials, cross-project resources, stale PTY, output injection, trusted-memory direct write and resource escalation all fail closed.

## T11 Graphical end-to-end
Start ROS normally -> install/grant/enable Pi -> dynamic rail -> select project/provider/model/resources -> Open in ROS -> real task -> close -> Open External Terminal -> second task -> exit -> revoke/disable -> relaunch denied. No manual bridge, wrapper, RPC, key export, cd or pi command.

## T12 Regression
SDK/category; Provider Profile/harness; resource projection; memory/tool; PTY/terminal; security; browser-first full; graphical qualification; build/typecheck; docs; git diff --check.

## T13 Reusability
Use generic terminal/provider/resource facility with a second harmless harness fixture or real harness. Pi-specific code is limited to Pi adaptation.

## T14 Fresh-developer SDK test
Fresh AI harness receives only Community SDK, SDK Guide, SDK Echo, Pi reference and public docs/tests, then creates a new add-on without project history or Core modifications.

## Evidence
Preserve SHA/branch, commands/counts, screenshots for A/B, sanitized provider/model metadata, Pi version, lifecycle/audit evidence, security results, changed files, clean-tree result, limitations and no secrets.
