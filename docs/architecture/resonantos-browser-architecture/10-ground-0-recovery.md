# 10 — Ground-0 Recovery Architecture

## Definition

Ground-0 is a Core-controlled system state. Recovery is the workflow executed while in that state.

```text
Ground-0 state
  -> minimal authenticated extension/bridge path
  -> Core identity, policy, audit, and continuity snapshot
  -> minimal Engineer console and bounded recovery tools
  -> ADR-010 recovery ladder
```

Ground-0 is not Linux safe mode, boot recovery, or a second installation.

## Preserved state

- user identity and consent records;
- Core/Engineer identity;
- append-only history and audit chain;
- last-known-good continuity snapshot and configuration metadata;
- provider/runtime recovery hints without exposing secrets;
- recovery reports and quarantined-state inventory.

## Disabled or quarantined state

- all third-party harness executions and child agents;
- Augmentor extensions and optional hooks/scripts;
- nonessential add-ons and channels;
- scheduled/background execution and archive ingest;
- active task grants and reusable runtime handles;
- recent unvalidated executable configuration;
- external sends, destructive actions, wallet/signing, and broad filesystem actions except separately approved recovery operations.

## Entry

Ground-0 may be entered manually or after verified conditions such as repeated boot/runtime failure, policy-store corruption, add-on crash loop, failed integrity check, or recovery request. Entry MUST revoke temporal grants, stop/quarantine active runs, record the trigger, preserve evidence, and switch to a known-good manifest set.

## Recovery sequence

1. Verify bridge authentication, Core state integrity, and audit availability.
2. Load the trusted continuity snapshot read-only.
3. Start the minimal Engineer on the local recovery floor.
4. Use ADR-010 to validate and optionally promote to a stronger model route.
5. Diagnose, repair, verify, and produce a structured report.
6. Re-enable components in dependency order using health and integrity checks.
7. Issue fresh authority only for resumed tasks; never revive old grants.

## Exit criteria

- Core integrity and bridge authentication pass;
- continuity state is readable and its provenance is intact;
- selected provider route is validated or the user accepts degraded operation;
- required add-ons pass health checks;
- quarantined executable state is explicitly accepted, replaced, or left disabled;
- recovery report and post-recovery snapshot are committed;
- the user receives a clear summary of disabled items and remaining risks.

The current `src/modules/recovery` workflow becomes a consumer of Ground-0 state rather than its definition.
