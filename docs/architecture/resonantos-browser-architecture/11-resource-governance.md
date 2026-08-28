# 11 — Resource Governance for Concurrent Harnesses

## Purpose

Multi-harness execution requires admission control, reservations, accounting, and preemption. Telemetry alone cannot prevent runaway cost or starvation.

## Governed resources

- CPU, memory, GPU/accelerator, disk, processes, and wall-clock time;
- model/provider requests, tokens, rate limits, and monetary spend;
- network bandwidth/egress and endpoint quotas;
- browser sessions/tabs and external-account concurrency;
- workspace write leases and artifact storage;
- compute nodes described by ADR-032.

## Task budget

Every harness task SHOULD declare priority, deadline, concurrency class, estimated and hard budgets, required node roles, network mode, workspace mode, secret policy, and behavior on exhaustion.

## Admission and scheduling

Core computes eligibility from authority, health, capacity, cost policy, and conflicts. It may admit, queue, reject, route elsewhere, or request user approval. Scheduling SHOULD support:

- per-harness and global concurrency limits;
- fair-share with user-visible priority overrides;
- exclusive leases for conflicting resources;
- reserved capacity for the interactive user and Ground-0;
- cooperative cancellation followed by bounded forced termination;
- checkpoint/preemption where supported;
- hard spending and wall-clock ceilings.

## Isolation and accounting

Usage is attributed to task, delegation chain, harness, provider/model, and user policy. Child usage rolls up to the parent budget. A child cannot allocate beyond remaining parent capacity. Report estimated versus actual usage and mark uncertain accounting honestly.

## Failure behavior

Budget exhaustion stops new work and yields a typed event; partial artifacts are quarantined or returned according to policy. Provider throttling should delay the affected queue rather than block all harnesses. Ground-0 preempts optional work and retains its own recovery reserve.

## Relation to ADR-032

ADR-032 supplies compute node/job primitives. This document adds orchestration policy across compute jobs, provider inference, browser resources, and cost. The Resource Governor should consume the Compute Fabric, not duplicate node execution.
