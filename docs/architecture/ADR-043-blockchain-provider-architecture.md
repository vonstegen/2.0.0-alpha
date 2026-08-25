# ADR-043: Blockchain Provider Architecture (Stub)

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Not applicable
- Superseded by: None
- Owner: Add-on SDK + Security + Governance review
- Decision date: 2026-08-25
- Alpha note: Stub only. The substantive architecture proposal lives
  in `docs/architecture/RESONANT_BLOCKCHAIN_DAO_EXTENSION_INTERFACE_ARCHITECTURE.md`,
  filed as a future directive. No code or contract change ships with
  this ADR. The follow-up queue is enumerated under §"Open work"
  below; each is gated on its own ADR.

## Decision

The blockchain / DAO extension architecture is a post-Alpha
directive. The detailed architecture, vocabulary, layered model,
contribution-point contracts, broker flow, governance abstraction,
event hook list, permission model, manifest examples, lifecycle
rules, cross-chain portability profile, error model, conformance
goals, and phased delivery plan all live in the proposal document
referenced above. This ADR acknowledges that proposal and registers
it on the architecture index so subsequent work can cite it.

## Why

The proposal is internally consistent with the architectural anchors
(ADR-008, ADR-018, ADR-022, ADR-023, ADR-026, ADR-032, ADR-037,
ADR-038, ADR-039, ADR-041, ADR-042). However, the proposal also
introduces concepts that require new ADRs of their own:

- a 35-name dotted-action capability vocabulary extending the
  current 13-value `Capability` union;
- a Transaction Security Broker contract distinct from the
  existing host-bridge dispatcher;
- a verification-record schema and append-only registry distinct
  from the catalog/registry of ADR-023;
- new governance events layered on top of ADR-031's contract;
- a portability-profile meta-ruleset for chain adapters.

Each of these is a load-bearing contract change; each needs its
own ADR with its own Alpha-applicability decision before any code
lands.

The proposal's own §17 #13 recommends:

> Record this proposal as one or more ADRs before implementation,
> because signing authority, governance behavior, and Alpha scope
> require explicit project decisions.

This stub ADR is that "record as ADRs" step one.

## Open work (delegated to follow-up ADRs)

These items are queued as future ADRs; each is its own decision
record and may be drafted, accepted, or rejected independently.
The numbers below are the proposed ADR slots assuming a sequential
queue; renumbering is fine.

- ADR-044: Capability vocabulary extension — extend
  `src/core/contracts.ts:Capability` with the §11 dotted-action
  names (`blockchain.*`, `wallet.*`, `identity.*`,
  `governance.*`, `compute.*`). Reconciles the proposal's
  resource-scoped grants (providers / networks / accounts /
  contracts / assets / maxValue / maxFee / validUntil /
  userPresence / automation) with ADR-018's existing grant shape
  (capability / scope / revocationBehavior).
- ADR-045: Transaction Security Broker contract — specifies the
  broker as a host-owned privileged service. Defines the
  request/response shape (`BrokerSigningRequest`,
  `AuthorizedSignedEnvelope`, `OpaqueUnsignedPayload`), the
  integrity digest (proposal + network + actions + amounts +
  destinations + fee + expiration + unsigned payload), and the
  IPC/schema boundary that keeps `WalletProvider.authorizeAndSign`
  out of the public extension API.
- ADR-046: Add-on Verification Record schema and registry —
  formalizes §13.5 (state machine, roles, record interface,
  risk-tiered profiles, expiry, suspension, revocation,
  append-only decision history). Pairs with ADR-023.
- ADR-047: Provider contribution points (`blockchainProviders`,
  `walletProviders`, `identityProviders`, `governanceProviders`,
  `computeProviders`) — adds them to the manifest validation
  surface. Each contribution point carries stable provider id,
  SDK version, capability set, supported chain/network
  identifiers, configuration schema, health strategy, and
  portability profile.
- ADR-048: Portability profile — defines the
  `portable` / `portable-with-loss` / `chain-specific`
  classification (§14), the conformance suite (§16),
  and the requirement that providers fail explicitly with
  `UnsupportedCapability` rather than emulating unsafe semantics.
- ADR-049: Governance Provider abstraction — promotes
  `GovernanceProvider` (§9) to a host-brokered contract with
  shared broker enforcement for any value-moving, voting,
  delegation, proposal-creation, or execution transactions.

These slots are placeholders. The first three are the critical
path; ADR-047 and ADR-048 follow; ADR-049 lands with the
post-Alpha DAO pilot (Phase 4 of §18).

## Rules

- The five contribution points proposed in §5 do NOT enter the
  manifest validator before ADR-047 is accepted.
- The 35-name vocabulary in §11 does NOT extend the `Capability`
  union before ADR-044 is accepted.
- The Transaction Security Broker does NOT land in the
  bridge dispatcher before ADR-045 is accepted.
- The verification record schema does NOT enter
  `bridge-audit-ledger.mjs` before ADR-046 is accepted.
- The Alpha run is unaffected. The proposal exists as future
  direction only.

## Cross-cutting

- **ADR-008 (Wallet & Web3 Security)** is the closest existing
  decision; the proposal's "keys never cross the trust
  boundary" is a tightening of ADR-008's posture. ADR-008's
  Alpha applicability remains `Partial`.
- **ADR-022 (Portable User State & Secure Vault)** is the home
  for any signing-key material the future broker reads.
- **ADR-032 (ResonantOS Compute Fabric)** is the typed-job
  surface the proposal's `computeProviders` consume.
- **ADR-038 / ADR-039 / ADR-041 / ADR-042** — the queue just
  landed; the proposal's lifecycle / isolation / verification
  expectations layer on top of these (cf. ADR-041
  `host-mediated-agent` worker for the broker; ADR-042
  publisher-tier axis overlaid by ADR-046's artifact-verification
  axis).

## Validation

- vitest: every prior test stays green.
- docs:check: this ADR + the proposal both reachable from the
  architecture index.
- No code changes; the file `docs/architecture/RESONANT_BLOCKCHAIN_DAO_EXTENSION_INTERFACE_ARCHITECTURE.md`
  is filed as future direction with the
  `Alpha applicability: Not applicable` annotation in its
  front-matter.

Out of scope (delegated to ADR-044 / 045 / 046 / 047 / 048 / 049):
- Capability vocabulary extension.
- Broker contract.
- Verification record schema and registry.
- Contribution points.
- Portability profile and conformance.
- Governance Provider abstraction.
