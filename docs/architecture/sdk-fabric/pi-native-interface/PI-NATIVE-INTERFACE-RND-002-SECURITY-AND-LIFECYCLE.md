# PI-NATIVE-INTERFACE-RND-002 — Security and Lifecycle

The terminal-native harness must not become a generic shell escape.

Host owns executable resolution, cwd authorization, environment, Provider Profile resolution, PTY/external-terminal adapters, process identity, signals, audit, and grant/revocation enforcement.

## Lifecycle
AVAILABLE -> INSTALLED -> GRANTED -> ENABLED -> READY -> SESSION_STARTING -> SESSION_ACTIVE -> SESSION_ENDING -> READY.
Revoke/disable: SESSION_ACTIVE -> FENCED -> TERMINATING -> DISABLED.

## Invariants
- classification/interface grants no authority;
- manifest cannot supply arbitrary executable/argv;
- no raw secret in manifest/argv/status/log/Git;
- minimal session-scoped environment;
- authorized project cwd;
- A and B share provisioning policy;
- revocation fences launches;
- terminal output is untrusted display data;
- cleanup idempotent/orphan recovery deterministic;
- session identity host-owned;
- generic PTY certified with harmless fixture before Pi.

## Semantic PTY API
terminal.create, terminal.input, terminal.resize, terminal.interrupt, terminal.status, terminal.close, with scoped non-forgeable session authorization.

## Adversarial tests
Arbitrary executable/argv, secret in argv, unauthorized cwd, revoked grant, stale token, forged add-on identity, HTML/script-like output, post-close input/resize, orphan cleanup, concurrency, generic terminal fixture.
