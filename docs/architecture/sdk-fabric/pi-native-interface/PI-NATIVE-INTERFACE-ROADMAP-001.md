# PI-NATIVE-INTERFACE-ROADMAP-001 — OMP/VIGIL Plan

Final goal: user activates Pi from ROS and uses the real Pi interactive TUI either embedded or external, with ROS provisioning project, Provider Profile/model, credentials, grants and lifecycle.

## M0 Baseline
CP0.1 exact ROS SHA/branch, Pi version/path, Node version, clean tree.
CP0.2 inventory transitional pi-server/print-wrapper/bridge/RPC assumptions.

## M1 Native Pi proof
CP1.1 real Pi TUI in real PTY on VIGIL with real provider/model and harmless repo-read task.
CP1.2 document minimum launch inputs.

## M2 Shared provisioner
CP2.1 host-owned Pi launch spec/provisioner.
CP2.2 no-secret disclosure audit.

## M3 A External terminal
CP3.1 reviewed Linux terminal adapter.
CP3.2 ROS action launches ready Pi TUI with zero manual setup.
CP3.3 real inference + read-only repo tool turn.
CP3.4 cleanup/revoke/disable.

## M4 Generic PTY
CP4.1 create/input/output/resize/interrupt/status/close.
CP4.2 certify harmless fixture first.
CP4.3 adversarial suite.

## M5 B Embedded Pi
CP5.1 generic terminal emulator surface.
CP5.2 connect to PTY.
CP5.3 real Pi TUI through shared provisioner.
CP5.4 ANSI/cursor/resize/editor/Ctrl-C/commands/tools/exit fidelity.
CP5.5 real inference + repo-read turn.

## M6 Product
CP6.1 canonical harness/coding-agent + runtime-native/terminal manifest.
CP6.2 generic dynamic rail.
CP6.3 ROS control surface with both launch modes.
CP6.4 both use same provisioner.

## M7 Provider Profile hardening
CP7.1 investigate runtime auth without durable duplicate Pi auth.
CP7.2 narrowest supported mechanism.
CP7.3 Augmentor and Pi share one ROS profile independently.

## M8 Resource seam
CP8.1 future ROS skills/context/memory/tools extension points.
CP8.2 optional one resource proof if simple.

## M9 Full graphical journey
Normal ROS start -> install/grant/enable -> dynamic Pi -> select project/provider/model -> embedded real task -> external real task -> revoke/disable -> relaunch denied. No manual bridge/wrapper/RPC/TUI startup.

## M10 Regression
SDK/category, provider/harness, PTY, A/B Pi, security, graphical, browser-first, build/typecheck, docs.

## M11 Docs
Community SDK interface profile, Pi reference docs, capability matrix, R&D, demo runbook.

## M12 Candidate
Fresh feature branch only; no merge. Report exact counts, Pi version/provider/model without secrets, evidence, SHA, branch, clean state, gaps.
