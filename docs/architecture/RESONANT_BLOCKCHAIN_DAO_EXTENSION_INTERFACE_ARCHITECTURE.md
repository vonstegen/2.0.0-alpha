# ResonantOS Blockchain and DAO Extension Interface Architecture


**Status:** Proposed architecture; future directive. **Not implemented.**
**Audience:** ResonantOS core, Extension SDK, security, wallet, governance, compute, and AI harness implementers  
**Suggested owner:** Add-on SDK with Security and Governance review  
**Alpha applicability:** Not applicable — this document describes a future post-Alpha blockchain / DAO extension layer. See ADR-008 (Wallet & Web3 Security, Alpha applicability: Partial) and ADR-037 (Browser-First Chromium ResonantOS, Alpha applicability: Partial) for the Alpha-boundary reading. Wallet custody, signing, DAO execution, and multi-chain production support are **not** in the Alpha.
**Compatibility target:** Resonant Extension SDK; VS Code/VSCodium-style extension host model  
**Last updated:** 2026-08-25
## 1. Executive summary

ResonantOS should expose blockchain functionality as a set of chain-neutral, capability-gated provider interfaces rather than embedding any one blockchain into the core. Extensions declare contributions such as `blockchainProviders`, `walletProviders`, `identityProviders`, `governanceProviders`, and `computeProviders`. The ResonantOS host validates those declarations, isolates extension code, brokers privileged operations, and emits normalized lifecycle and blockchain events.

The central security rule is non-negotiable:

> Extensions may construct and propose intent, but private keys, seed phrases, raw signing handles, and unrestricted signing authority never enter extension memory.

All signing and value-moving actions flow through a trusted Transaction Security Broker. The broker evaluates permissions and policy, simulates or previews the operation where supported, obtains the required human or policy approval, invokes a trusted wallet provider, submits through a chain adapter, and writes an attributable audit record.

This architecture allows a future Resonant DAO to use a stable `GovernanceProvider` contract while its implementation remains portable across Sui, Ethereum/EVM networks, Solana, Cardano, or a non-blockchain governance backend.

## 2. Scope and goals

This document defines the architecture contract for blockchain-aware Resonant extensions and AI-harness tools. It covers:

- provider contribution points and discovery;
- transport, chain-adapter, and protocol layers;
- normalized account, asset, transaction, event, identity, governance, and compute contracts;
- permission vocabulary and scoped grants;
- secure transaction proposal and signing mediation;
- extension lifecycle, isolation, revocation, health, and audit behavior;
- integration with the existing VS Code/VSCodium extension reference model;
- portability requirements and open design decisions.

It does not select a launch chain, define a token, prescribe DAO economics, implement custody, or authorize autonomous financial activity. Current Alpha constraints remain authoritative: wallet detection may be read-only, and wallet approval, signing, secret access, network switching, and public value actions remain human-controlled unless a later accepted decision explicitly changes that boundary.

## 3. Architectural principles

1. **Chain-neutral core.** Core contracts describe intent and capabilities, not chain-specific transaction formats.
2. **Host-mediated authority.** Extension installation or provenance never implies wallet, identity, governance, network, compute, or signing authority.
3. **Keys never cross the trust boundary.** Trusted wallet implementations sign internally; extensions receive only public metadata, request status, receipts, and normalized errors.
4. **Separate construction from authorization.** An extension may build a proposal without being allowed to sign or submit it.
5. **Least privilege with resource scopes.** Grants are constrained by provider, network, account, asset, contract/program, DAO, action, amount, time, and user-presence requirements.
6. **Portable semantics, explicit escape hatches.** Common operations use normalized types. Chain-specific features use namespaced extensions and clearly reduce portability.
7. **Deterministic safety around probabilistic agents.** AI-generated intent is schema-validated, policy-checked, simulated where possible, and presented in human-readable form before privileged execution.
8. **Observable and revocable.** Every provider and grant has health, lifecycle, audit, and revocation behavior.
9. **Governance is a protocol surface, not signing authority.** A governance extension can inspect and prepare proposals or votes, but the broker controls execution.
10. **Verification is governed evidence, not a permanent badge.** A verified add-on has a traceable, reproducible, expiring verification record tied to an exact artifact digest, SDK version, capability set, and review policy.

## 4. Relationship to the Resonant Extension SDK

The design extends the established add-on/extension model rather than creating a parallel plugin system. It preserves the familiar VS Code/VSCodium concepts of a declarative manifest, contribution points, activation events, commands, extension context, disposables, workspace trust, secret storage, and host-owned UI surfaces.

| VS Code/VSCodium concept | ResonantOS adaptation |
| --- | --- |
| `package.json` `contributes` | Adds provider contribution points and blockchain event subscriptions |
| Activation events | Adds provider/network/governance event activation with rate and trust controls |
| Extension host | Runs untrusted integration logic outside privileged wallet/security services |
| Commands | Commands express user intent; privileged execution is routed through a broker |
| Workspace trust | Adds provider, account, network, DAO, and value-action trust dimensions |
| Secret storage | Stores API credentials only through the host vault; never exposes wallet keys |
| Disposable subscriptions | Required for provider registrations and event hooks |
| Webview/view contributions | Host-owned UI with sanitized messages and no direct privileged APIs |

The current Resonant add-on manifest remains the outer package contract. These contribution points should be introduced as a versioned SDK module and validated before activation. Existing provenance tiers (`bundled-core`, `curated-signed`, `sideloaded-unverified`, and future `enterprise-signed`) affect warnings and recommended defaults, but never bypass permission checks.

## 5. Provider contribution points

### 5.1 `blockchainProviders`

Provide normalized chain access: network discovery, reads, transaction preparation, simulation, submission, receipts, and events. A provider may support one network, one chain family, or several compatible networks.

### 5.2 `walletProviders`

Represent user-controlled, external-connected, hardware, multisignature, or optional managed wallets. Wallet providers expose public account metadata and accept broker-issued signing requests. They do not return private key material or unrestricted signer objects.

### 5.3 `identityProviders`

Resolve and verify decentralized identifiers, names, credentials, attestations, membership proofs, and account bindings. Selective disclosure and consent must be explicit. Identity evidence is never treated as wallet authority.

### 5.4 `governanceProviders`

Expose organizations, spaces, proposals, votes, delegations, treasuries, execution states, and governance events through a common abstraction. A provider may adapt an on-chain DAO framework, off-chain signaling service, multisig, or future Resonant governance protocol.

### 5.5 `computeProviders`

Expose blockchain-related compute such as indexers, RPC relays, simulation nodes, proof generation, event processing, or governance analytics. They consume the ResonantOS Compute Fabric through typed jobs; they do not receive general shell access or runner credentials.

### 5.6 Registration and selection

Every contribution has a stable provider ID, SDK version, capability set, supported chain/network identifiers, configuration schema, health strategy, and portability profile. The host owns provider selection. Consumers request capabilities and constraints, not a hard-coded implementation, unless the user has explicitly selected one.

## 6. Layered architecture

```text
ResonantOS UI, agents, workflows, and extensions
                         |
              Intent and provider APIs
                         |
        Capability + Policy Enforcement Layer
                         |
      Transaction / Signing Security Broker
                         |
  Protocol layer: DAO, tokens, identity, staking, etc.
                         |
 Chain-adapter layer: Sui | EVM | Solana | Cardano
                         |
 Transport layer: RPC | WebSocket | indexer | hardware bridge
                         |
            External networks and wallets
```

### 6.1 Transport layer

The transport layer provides bounded connectivity and reliability primitives: request/response RPC, subscriptions, retries, backoff, endpoint health, chain ID verification, finality polling, and rate limiting. Credentials remain in host-managed provider profiles. Extensions receive an opaque transport reference or a high-level client, never raw secrets.

Transport implementations must defend against endpoint spoofing, chain-ID mismatch, DNS or certificate failures, malformed payloads, unbounded subscriptions, replay, and unexpected network changes.

### 6.2 Chain-adapter layer

Adapters translate normalized Resonant types to chain-native representations and back. They own address validation, canonical serialization, fee representation, nonce or object-version semantics, commitment/finality mapping, simulation, receipt normalization, and native error translation.

Examples:

- **Sui:** objects, Move calls, gas objects, checkpoints, epochs, and transaction blocks;
- **Ethereum/EVM:** accounts, calldata, gas, nonce, logs, confirmations, and EIP-compatible typed data;
- **Solana:** accounts, programs, instructions, recent blockhashes, compute units, and commitment levels;
- **Cardano:** UTXOs, assets, scripts, datums/redeemers, eras, and slot/finality semantics.

Adapters must not pretend that materially different models are identical. Chain-native detail belongs in namespaced `extensions`, while normalized summaries remain available to generic consumers.

### 6.3 Protocol layer

Protocol adapters compose chain capabilities into higher-level domains: fungible and non-fungible assets, identity, governance, multisig, treasury, staking, naming, attestations, and DAO frameworks. A governance provider may depend on a blockchain provider and wallet provider but remains independently discoverable and replaceable.

### 6.4 Application and AI-harness layer

Extensions and agents operate on typed intent. The harness may research, explain, compare, draft, simulate, or propose. It must label estimates, preserve source/network context, and never represent a generated proposal as executed. Privileged actions require a broker request with an attributable actor and declared purpose.

## 7. Core TypeScript contracts

The following interface is intentionally generic. Exact packaging and naming should be finalized in the SDK specification.

```ts
type ProviderId = string;
type ChainId = string;       // CAIP-compatible identifier recommended
type NetworkId = string;
type AccountId = string;

interface Disposable {
  dispose(): void;
}

interface ProviderContext {
  readonly extensionId: string;
  readonly providerId: ProviderId;
  readonly grantedCapabilities: readonly CapabilityGrant[];
  readonly signal: AbortSignal;
  requestHostService<T>(request: HostServiceRequest): Promise<T>;
}

interface BlockchainProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly sdkVersion: string;
  readonly capabilities: readonly BlockchainCapability[];

  initialize(context: ProviderContext): Promise<void>;
  getHealth(): Promise<ProviderHealth>;
  listNetworks(): Promise<NetworkInfo[]>;
  getNetwork(networkId: NetworkId): Promise<NetworkInfo>;
  getAccount(accountId: AccountId): Promise<PublicAccount>;
  getBalance(request: BalanceRequest): Promise<AssetBalance[]>;
  query<T = unknown>(request: ChainQuery): Promise<QueryResult<T>>;

  prepareTransaction(
    request: TransactionIntent
  ): Promise<TransactionProposal>;

  simulateTransaction(
    proposal: TransactionProposal
  ): Promise<SimulationResult>;

  // Accepts only a broker-authorized signed envelope. It never accepts a key.
  submitTransaction(
    envelope: AuthorizedSignedEnvelope
  ): Promise<TransactionSubmission>;

  getTransactionReceipt(
    networkId: NetworkId,
    transactionId: string
  ): Promise<TransactionReceipt>;

  subscribe(
    filter: BlockchainEventFilter,
    listener: (event: BlockchainEvent) => void
  ): Disposable;

  shutdown(reason: ShutdownReason): Promise<void>;
}

interface TransactionIntent {
  networkId: NetworkId;
  fromAccountId?: AccountId;
  actions: TransactionAction[];
  constraints?: {
    maxFee?: AssetAmount;
    maxValue?: AssetAmount;
    expiresAt?: string;
    expectedChainState?: ChainStateConstraint[];
  };
  purpose: string;
  correlationId: string;
  extensions?: Record<string, unknown>;
}

interface TransactionProposal {
  proposalId: string;
  providerId: ProviderId;
  network: NetworkInfo;
  normalizedSummary: HumanReadableTransactionSummary;
  unsignedPayload: OpaqueUnsignedPayload;
  requiredSigners: SignerRequirement[];
  feeEstimate?: FeeEstimate;
  warnings: PolicyWarning[];
  simulation?: SimulationResult;
  expiresAt?: string;
  integrityDigest: string;
}
```

`OpaqueUnsignedPayload` is serializable only through the broker path. SDK APIs should prevent general inspection when payload content could expose unsafe signing primitives. Proposal integrity covers the network, actions, amounts, destinations, fee constraints, expiration, and unsigned payload so approval cannot be reused after mutation.

## 8. Wallet and signing contracts

```ts
interface WalletProvider {
  readonly id: ProviderId;
  listPublicAccounts(filter?: AccountFilter): Promise<PublicAccount[]>;
  getCapabilities(accountId: AccountId): Promise<WalletCapability[]>;

  // Callable only by the trusted broker, not by ordinary extensions.
  authorizeAndSign(request: BrokerSigningRequest): Promise<SignedEnvelope>;
}

interface BrokerSigningRequest {
  requestId: string;
  proposal: TransactionProposal;
  requestingActor: ActorIdentity;
  requestedAccountId: AccountId;
  approvalRequirement: ApprovalRequirement;
  policySnapshotId: string;
  auditContext: AuditContext;
}
```

The SDK surface exposed to extensions contains `propose`, `requestApproval`, and status APIs—not `authorizeAndSign`. That method exists only across an authenticated host-to-wallet boundary.

### 8.1 Transaction Security Broker flow

1. The extension submits a typed `TransactionIntent` with purpose and correlation ID.
2. The host validates schema, grant scopes, provider health, chain/network identity, and account visibility.
3. The chain adapter constructs a `TransactionProposal`.
4. The broker obtains an independent simulation or preview where supported.
5. Policy evaluates destinations, contracts/programs, assets, amounts, fees, slippage, freshness, expected state, risk signals, and automation limits.
6. The host presents a canonical, human-readable summary. Chain-native wallet UI may add a second confirmation.
7. After approval, the broker sends the integrity-bound proposal to the selected trusted wallet provider.
8. The wallet signs internally. Hardware or external wallets may require physical/user confirmation.
9. The broker verifies that the signed envelope matches the approved digest and submits it through the selected chain adapter.
10. The host records proposal, approval, signature metadata, submission, finality, denial, expiry, or failure in a redacted audit trail.

The broker rejects blind signing by default, proposal mutation after approval, network mismatch, expired block references/nonces, replayed requests, undeclared contracts, policy drift, and attempts to return raw keys or signer objects.

## 9. GovernanceProvider abstraction

```ts
interface GovernanceProvider {
  readonly id: ProviderId;
  readonly capabilities: readonly GovernanceCapability[];

  listOrganizations(filter?: OrganizationFilter): Promise<GovernanceOrg[]>;
  getOrganization(organizationId: string): Promise<GovernanceOrg>;
  listProposals(request: ProposalQuery): Promise<GovernanceProposal[]>;
  getProposal(proposalId: string): Promise<GovernanceProposal>;
  getVotingPower(request: VotingPowerRequest): Promise<VotingPower>;
  getDelegation(request: DelegationQuery): Promise<DelegationState>;
  getTreasurySummary(organizationId: string): Promise<TreasurySummary>;

  prepareCreateProposal(
    request: CreateProposalIntent
  ): Promise<GovernanceActionProposal>;

  prepareVote(
    request: VoteIntent
  ): Promise<GovernanceActionProposal>;

  prepareDelegation(
    request: DelegationIntent
  ): Promise<GovernanceActionProposal>;

  prepareExecution(
    request: ExecuteProposalIntent
  ): Promise<GovernanceActionProposal>;

  subscribe(
    filter: GovernanceEventFilter,
    listener: (event: GovernanceEvent) => void
  ): Disposable;
}
```

`GovernanceActionProposal` contains normalized governance meaning plus one or more `TransactionIntent` objects when on-chain action is required. All value-moving, voting, delegation, proposal-creation, or execution transactions still pass through the Transaction Security Broker.

For a future Resonant DAO, the core application should depend on this interface, not on a Sui Move package, EVM contract ABI, Solana program, or Cardano script directly. DAO rules such as voting system, quorum, proposal stages, delegation, timelock, treasury controls, emergency process, and execution model remain protocol configuration or a protocol-specific adapter.

## 10. Blockchain and governance event hooks

Extensions may subscribe declaratively and programmatically to normalized events:

- `blockchain.networkChanged`
- `blockchain.accountChanged`
- `blockchain.balanceChanged`
- `blockchain.transactionObserved`
- `blockchain.transactionFinalized`
- `blockchain.transactionReverted`
- `blockchain.contractEvent`
- `blockchain.reorgDetected`
- `wallet.connected`
- `wallet.disconnected`
- `wallet.capabilityChanged`
- `identity.credentialChanged`
- `governance.proposalCreated`
- `governance.proposalStateChanged`
- `governance.voteRecorded`
- `governance.delegationChanged`
- `governance.executionReady`
- `governance.executionCompleted`
- `provider.healthChanged`
- `permission.grantChanged`

Event delivery rules:

- Hooks require an explicit event capability and filter scope.
- The host enforces rate limits, batching, backpressure, cursor/checkpoint persistence, and maximum replay windows.
- Events carry provider, chain, network, block/slot/checkpoint, finality, timestamp, canonical event ID, and reorg/replacement metadata where meaningful.
- Unfinalized events are labeled and may later be reversed or replaced.
- Hooks are at-least-once by default; handlers must be idempotent and persist their last processed cursor through host storage.
- Hooks cannot sign, vote, spend, execute proposals, mutate external state, or silently expand permissions. They may enqueue a new intent that independently passes policy and approval.
- Sensitive event fields are minimized and redacted according to grants.

## 11. Granular permission model

Permissions use dotted action names plus structured resource scopes. Initial vocabulary:

```text
blockchain.network.read
blockchain.account.read
blockchain.balance.read
blockchain.query.read
blockchain.event.subscribe
blockchain.transaction.prepare
blockchain.transaction.simulate
blockchain.transaction.request_sign
blockchain.transaction.submit

wallet.account.discover
wallet.account.connect
wallet.public_metadata.read
wallet.signature.request
wallet.message_signature.request

identity.identifier.resolve
identity.credential.read
identity.credential.request
identity.credential.present
identity.attestation.verify

governance.organization.read
governance.proposal.read
governance.proposal.prepare
governance.vote.read
governance.vote.prepare
governance.delegation.read
governance.delegation.prepare
governance.treasury.read
governance.execution.prepare
governance.event.subscribe

compute.job.submit
compute.job.status
compute.job.cancel
compute.artifact.read
compute.artifact.write
compute.network.egress
```

A grant may constrain:

```yaml
capability: blockchain.transaction.request_sign
scope:
  providers: [sui-main]
  networks: ["sui:mainnet"]
  accounts: ["account:primary-governance"]
  contracts: ["0x...::resonant_dao"]
  actions: [governance.vote]
  assets: ["sui:mainnet/slip44:784"]
  maxValuePerAction: "0"
  maxFeePerAction: "0.05"
  validUntil: "2026-12-31T23:59:59Z"
  userPresence: required
  automation: prohibited
revocationBehavior: abort-pending-and-disable
```

Read, prepare, simulate, request-signature, and submit are separate grants. `wallet.signature.request` does not imply `blockchain.transaction.submit`. Message signing is separate from transaction signing because authentication signatures can be replayed or abused as authorizations. Wildcard account, network, destination, and contract scopes should be rejected for sideloaded extensions and discouraged for all others.

## 12. Manifest examples

### 12.1 Multi-provider extension

```json
{
  "id": "org.resonantos.chain-toolkit",
  "name": "Resonant Chain Toolkit",
  "version": "0.1.0",
  "author": "ResonantOS",
  "category": "integration",
  "runtimeType": "local-service",
  "sdkVersion": "^1.0.0",
  "activationEvents": [
    "onProvider:blockchain:sui",
    "onGovernanceEvent:proposalStateChanged"
  ],
  "requestedCapabilities": [
    "network",
    "providers",
    "blockchain.network.read",
    "blockchain.query.read",
    "blockchain.event.subscribe",
    "blockchain.transaction.prepare",
    "blockchain.transaction.simulate",
    "governance.organization.read",
    "governance.proposal.read"
  ],
  "contributes": {
    "blockchainProviders": [
      {
        "id": "sui",
        "displayName": "Sui",
        "chainNamespaces": ["sui"],
        "capabilities": ["query", "prepare", "simulate", "submit", "events"],
        "transportKinds": ["json-rpc", "websocket", "indexer"],
        "configurationSchema": "./schemas/sui-provider.schema.json",
        "healthStrategy": "rpc-and-chain-id"
      }
    ],
    "identityProviders": [
      {
        "id": "resonant-identity",
        "capabilities": ["resolve", "verify-attestation"]
      }
    ],
    "computeProviders": [
      {
        "id": "chain-indexer-jobs",
        "capabilities": ["index-events", "governance-analytics"],
        "requiredNodeRoles": ["container-runner"]
      }
    ]
  },
  "hooks": [
    {
      "event": "blockchain.transactionFinalized",
      "handler": "onTransactionFinalized",
      "requiredCapabilities": ["blockchain.event.subscribe"]
    }
  ],
  "compatibility": {
    "resonantOS": ">=2.0.0",
    "blockchainApi": "^1.0.0"
  }
}
```

### 12.2 Future Resonant DAO adapter

```yaml
id: org.resonantos.dao.sui
name: Resonant DAO — Sui Adapter
version: 0.1.0
category: integration
runtimeType: local-service
sdkVersion: ^1.0.0
requestedCapabilities:
  - providers
  - blockchain.network.read
  - blockchain.query.read
  - blockchain.transaction.prepare
  - blockchain.transaction.simulate
  - blockchain.transaction.request_sign
  - governance.organization.read
  - governance.proposal.read
  - governance.proposal.prepare
  - governance.vote.read
  - governance.vote.prepare
  - governance.delegation.read
  - governance.delegation.prepare
  - governance.treasury.read
  - governance.execution.prepare
  - governance.event.subscribe
contributes:
  governanceProviders:
    - id: resonant-dao-sui
      protocol: resonant-dao
      protocolVersion: 1
      chainNamespaces: [sui]
      capabilities:
        - organizations
        - proposals
        - voting
        - delegation
        - treasury-read
        - timelocked-execution
      requires:
        blockchainProvider: { chainNamespace: sui }
        walletProvider: { signingModes: [transaction] }
grantPresets:
  - id: read-only-governance
    recommended: true
    grants:
      - governance.organization.read
      - governance.proposal.read
      - governance.vote.read
      - governance.treasury.read
audit:
  requiredFor:
    - governance.proposal.prepare
    - governance.vote.prepare
    - governance.delegation.prepare
    - governance.execution.prepare
```

Manifest validation must ensure that contribution, tool, hook, setup, and skill requirements are subsets of `requestedCapabilities`. Recommended grant presets are suggestions, not entitlements.

### 12.3 Verification declaration

The manifest may declare how the package expects to be verified, but it cannot declare itself verified. Verification status is issued and signed by a host-recognized verification authority after the declared process passes.

```yaml
verification:
  profile: blockchain-provider-standard-v1
  source:
    repository: https://example.invalid/resonant-dao-sui
    revision: 4d7c2f1
  build:
    reproducible: required
    commandId: addon.build.release
    expectedArtifact: dist/resonant-dao-sui.rspkg
  checks:
    - manifest-schema
    - dependency-lock
    - license-policy
    - unit-tests
    - provider-conformance
    - broker-boundary
    - permission-scope
    - secret-scan
    - dependency-vulnerability
    - static-analysis
    - signed-artifact
  evidencePolicy:
    retainDays: 365
    publicSummary: required
  reverifyOn:
    - artifact-digest-change
    - requested-capability-change
    - provider-code-change
    - signing-path-change
    - dependency-lock-change
    - sdk-major-change
```

URLs, revisions, commands, and checks in this declaration are inputs to policy. They are not trusted merely because the publisher supplied them.

## 13. Lifecycle and security model

### 13.1 Package lifecycle

Use the established states: `available`, `installed`, `enabled`, `disabled`, `degraded`, `update-available`, and `incompatible`. Provider instances add `registered`, `initializing`, `ready`, `unhealthy`, `suspended`, `revoked`, and `stopped`.

Recommended sequence:

1. Verify package provenance and signature status.
2. Validate manifest and compatibility without executing extension code.
3. Show requested permissions and recommended scopes.
4. Install in an isolated extension location.
5. Activate only on declared events or direct user action.
6. Register providers through a host API and return disposables.
7. Probe health using bounded host-mediated checks.
8. On disable, revoke, update, crash, or shutdown, cancel subscriptions and pending non-approved requests.
9. Require re-consent when an update adds permissions, expands scopes, changes signing code, changes provider identity, or crosses a trust boundary.

### 13.2 Runtime isolation

- Untrusted extension code runs outside the trusted wallet, policy, vault, audit, and submission services.
- UI surfaces receive sanitized view models and communicate through typed host messages.
- Network access is restricted to approved provider profiles and endpoints.
- Compute runs through typed Compute Fabric jobs with node, network, filesystem, secret, cost, timeout, and artifact policies.
- Provider credentials and wallet material remain in host-controlled vaults or external devices.
- Sideloaded extensions start with minimal trust and no signing or submission grant.
- A provider crash cannot leave signing requests executable; request state is durable, integrity-bound, expiring, and broker-owned.

### 13.3 Audit and privacy

Audit records include actor, extension, provider, network, account alias, intent digest, human-readable summary digest, policy result, approval method, timestamps, transaction ID, finality, and outcome. Logs must redact secrets, seed phrases, private keys, authentication tokens, unnecessary identity claims, and sensitive raw payloads. Users can inspect and export relevant audit artifacts and revoke grants.

### 13.4 AI-specific constraints

- Agent output is advisory until the host creates a validated proposal.
- Agents cannot click or synthesize wallet confirmation as a substitute for user presence.
- Prompt or web content cannot grant permissions or change policy.
- Retrieved contract metadata is untrusted until verified against configured sources.
- The UI distinguishes estimates, simulations, signatures, submissions, and finalized transactions.
- Automated voting or treasury execution is prohibited by default and requires a future, explicit, narrowly scoped policy design.

### 13.5 Governed development verification

ResonantOS should track development verification as a first-class governance process for curated and verified add-ons. The process produces an immutable verification record linked to the exact packaged artifact. It is separate from installation state, provenance tier, runtime permissions, and marketplace approval.

#### Verification roles

- **Publisher:** submits source revision, build recipe, dependency lockfiles, artifact, requested capabilities, threat model, and change summary.
- **Verification runner:** executes approved checks in an isolated, reproducible Compute Fabric job and signs the resulting evidence bundle.
- **Technical reviewer:** evaluates architecture, implementation, tests, dependency risk, and conformance evidence.
- **Security reviewer:** is mandatory for wallet, identity, signing, transaction submission, governance execution, secrets, or unrestricted network/compute boundaries.
- **Governance approver:** applies the review policy and issues, denies, suspends, or revokes verified status. The approver must not be the sole author of the submitted release.
- **Host/registry:** verifies attestations, presents status and scope to the user, enforces expiry, and prevents stale evidence from being applied to a different artifact.

One person may hold multiple roles for low-risk development builds, but production signing-capable releases require separation between publisher and final approver. Policy should define the minimum reviewer count and required independence by risk tier.

#### Verification state machine

```text
unsubmitted -> submitted -> checks-running -> review-required
                                      |              |
                                      v              v
                                   failed         verified
                                                      |
                              +-----------------------+------------------+
                              v                       v                  v
                           expired                 suspended           revoked
                              |                       |
                              +----------> re-verification <------------+
```

Suggested machine-readable states are `unverified`, `submitted`, `checks-running`, `checks-failed`, `review-required`, `verified`, `verified-with-conditions`, `expired`, `suspended`, and `revoked`.

`verified-with-conditions` must identify its limitations—for example read-only operation, a restricted network list, or a disabled submission capability. The host must enforce those conditions rather than displaying them as informational text.

#### Verification record

```ts
interface AddonVerificationRecord {
  recordId: string;
  addonId: string;
  addonVersion: string;
  artifactDigest: string;
  sourceRevision: string;
  manifestDigest: string;
  dependencyLockDigest: string;
  sdkVersion: string;
  verificationProfile: string;
  riskTier: "read-only" | "state-changing" | "signing" | "governance-critical";
  requestedCapabilities: readonly string[];
  permittedScopes?: readonly CapabilityScope[];
  checkResults: readonly VerificationCheckResult[];
  evidenceBundleDigest: string;
  runnerAttestation: SignedAttestation;
  reviewerAttestations: readonly SignedAttestation[];
  decision: "verified" | "verified-with-conditions" | "denied";
  conditions?: readonly VerificationCondition[];
  issuedAt: string;
  expiresAt: string;
  policyVersion: string;
  supersedesRecordId?: string;
  revocation?: VerificationRevocation;
}
```

The registry should maintain an append-only decision history. Corrections and revocations create new signed records that reference earlier records; they do not silently rewrite prior evidence. Public records should contain digests and safe summaries, while sensitive test artifacts remain access-controlled.

#### Required verification gates

All verified add-ons should pass:

- manifest/schema validation and capability-subset checks;
- clean build from the recorded source revision and locked dependencies;
- artifact-to-source provenance and signature verification;
- unit, integration, lifecycle, failure, and upgrade tests appropriate to the package;
- SDK/provider conformance suites for every contributed provider type;
- dependency, license, static-analysis, secret, and supply-chain checks;
- permission minimization and denial-path tests;
- deterministic documentation of checks, tool versions, results, exceptions, and retained evidence.

State-changing add-ons additionally require transaction mutation, replay, network mismatch, finality, event reorganization, cancellation, and recovery tests. Signing-capable or governance-critical add-ons additionally require broker-boundary testing, human-approval UI review, threat modeling, independent security review, and proof that extension processes cannot obtain keys, seed phrases, signer handles, or reusable authorizations.

#### Change classification and re-verification

Every release is classified before verification:

- **Documentation-only:** no executable artifact or permission change; may use an abbreviated review.
- **Low risk:** implementation changes outside security boundaries with unchanged capabilities; rerun affected and baseline checks.
- **Material:** dependency, provider, transport, event, manifest, scope, or SDK compatibility change; full relevant profile required.
- **Security critical:** signing, wallet, vault, identity disclosure, transaction submission, governance execution, update mechanism, or verification logic change; full profile plus independent security approval required.

Verified status is bound to the artifact digest and does not automatically transfer to a new version. Any artifact, manifest, requested-capability, dependency-lock, provider identity, signing path, governance execution path, or verification-policy change triggers re-verification. A time-based expiry also forces periodic review even when code is unchanged.

#### Suspension and revocation

The governance authority may suspend verification while an incident is investigated and revoke it for compromised signing keys, falsified evidence, critical vulnerabilities, provenance failure, policy violation, malicious behavior, or an unremediated expired dependency risk. The host must:

- refresh revocation information before install or update and periodically afterward;
- display the reason, effective time, affected versions/digests, and recommended remediation;
- block new installs of revoked artifacts by default;
- disable affected privileged capabilities immediately when policy requires;
- cancel pending signing or governance requests associated with the revoked artifact;
- preserve audit evidence and offer a safe disable, rollback, or removal path;
- never silently replace the user’s installed package.

Verification revocation is not the same as permission revocation. Either may occur independently, although loss of verification may cause policy-driven permission degradation.

#### User-facing trust presentation

The UI must show more than a generic check mark. It should identify the verified artifact version and digest, verification profile, risk tier, verification authority, issue/expiry dates, conditions, granted permissions, and whether the installed bytes still match the verified artifact. Labels should distinguish:

- publisher signature verified;
- build and checks verified;
- security review verified;
- governance approval verified;
- installed artifact currently matches the verification record.

The word **verified** must never mean “safe under all conditions,” “endorsed by ResonantOS,” or “granted every requested permission.”

## 14. Cross-chain portability profile

Each provider declares whether a feature is `portable`, `portable-with-loss`, or `chain-specific`.

| Concern | Portable contract | Important chain differences |
| --- | --- | --- |
| Network identity | Canonical chain/network ID | Chain IDs, genesis identifiers, clusters, eras |
| Account | Public identifier and capabilities | Account-based, object-based, program accounts, UTXO ownership |
| Transaction | Intent, actions, constraints, summary | Nonce, gas object, recent blockhash, UTXO selection, scripts |
| Fees | Asset, estimate, upper bound | Gas markets, storage costs, compute units, fee inputs |
| Finality | Normalized state and confidence | Confirmations, checkpoints, commitment levels, slots/epochs |
| Events | Canonical event envelope and cursor | Logs, Move events, program logs/accounts, chain indexers |
| Contracts | Target, method/action, arguments | Move modules, EVM ABI, Solana programs, Plutus/native scripts |
| Governance | Proposal/vote/delegation/execution semantics | Token/object voting, snapshots, multisig, off-chain signals |

Portability requirements:

- Generic applications must work from normalized summaries and capability discovery.
- Providers must fail explicitly with `UnsupportedCapability`; they must not emulate unsafe semantics.
- Chain-specific fields live under a namespaced key such as `extensions["sui.resonantos.org/v1"]`.
- Addresses and assets carry their network namespace; bare strings are not sufficient at trust boundaries.
- Amounts use integer base units plus explicit decimals and asset identity—never floating-point values.
- Finality is a state machine, not a boolean.
- Cross-chain or bridge actions are modeled as multi-step workflows with independent risks, receipts, timeouts, and approvals.

## 15. Error and result model

Providers should return stable error codes with redacted details:

- `PermissionDenied`
- `ScopeMismatch`
- `UserApprovalRequired`
- `UserRejected`
- `ProviderUnavailable`
- `NetworkMismatch`
- `UnsupportedCapability`
- `InvalidIntent`
- `SimulationFailed`
- `PolicyDenied`
- `ProposalExpired`
- `ProposalIntegrityMismatch`
- `WalletUnavailable`
- `SigningFailed`
- `SubmissionFailed`
- `FinalityTimeout`
- `ChainReorganization`
- `RateLimited`

Errors must indicate whether retry is safe, requires reconstruction, requires renewed approval, or is prohibited. Raw RPC errors may appear only in redacted diagnostic metadata.

## 16. Testing and conformance

The SDK should ship a provider conformance suite with deterministic fixtures and mock transports. Certification should cover:

- manifest validation and capability subset rules;
- lifecycle, cancellation, revocation, and crash recovery;
- network and account scope enforcement;
- proposal integrity and mutation rejection;
- key/non-exportability tests and log-secret scans;
- simulation/summary consistency;
- event deduplication, reorg handling, cursor recovery, and backpressure;
- chain adapter golden vectors for serialization and receipt normalization;
- governance state-transition fixtures;
- hostile provider/RPC responses and endpoint mismatch;
- multi-provider selection and graceful degradation;
- accessibility and clarity of transaction approval summaries.

No adapter should be described as signing-capable until it passes broker-boundary tests showing that extension processes cannot obtain key material, signer handles, or reusable authorization artifacts.

## 17. Concrete recommendations

1. Add an experimental `@resonantos/sdk-blockchain` package rather than expanding the initial SDK namespace without version isolation.
2. Adopt CAIP-style chain, account, and asset identifiers where they fit, with versioned Resonant wrappers for unsupported ecosystems.
3. Implement read-only network/query/event contracts first using a mock chain adapter and recorded fixtures.
4. Build the Transaction Security Broker as a core privileged service before exposing any signing contribution point.
5. Keep `WalletProvider.authorizeAndSign` out of the public extension API and enforce the boundary at IPC/schema level, not only through TypeScript visibility.
6. Define canonical transaction and governance summaries before building approval UI; the approved digest must cover exactly what the user sees.
7. Separate grant names for read, prepare, simulate, request-sign, submit, governance action, and message signing.
8. Treat all value actions, votes, delegation changes, proposal execution, identity presentations, and external account mutations as human-approved by default.
9. Start Resonant DAO integration through `GovernanceProvider` plus a chain-specific adapter; keep DAO application code chain-neutral.
10. Reuse the Compute Fabric for indexers, simulations, relays, and proof jobs rather than granting extensions broad shell access.
11. Provide one reference adapter and one deliberately different adapter during design validation—for example Sui plus Cardano or Solana—to expose false EVM assumptions early.
12. Publish a portability matrix and conformance badge per provider version; never infer compatibility from package installation.
13. Record this proposal as one or more ADRs before implementation, because signing authority, governance behavior, and Alpha scope require explicit project decisions.
14. Add an append-only Add-on Verification Registry whose signed records bind source, build, tests, reviews, permissions, and policy to an exact artifact digest.
15. Define risk-tiered verification profiles and require independent security approval for signing-capable and governance-critical releases.
16. Treat verified status as expiring and revocable; require re-verification on every material change and degrade privileged capabilities when verification becomes invalid.

## 18. Suggested delivery phases

### Phase 0 — contracts and threat model

Finalize identifiers, capability vocabulary, trust boundaries, schemas, canonical summaries, audit model, verification profiles, attestation format, revocation model, and threat analysis. Produce mocks only.

### Phase 1 — read-only provider fabric

Support network metadata, queries, public balances, governance reads, health, and normalized event streams. No signing or public submission.

### Phase 2 — proposal and simulation

Allow extensions to prepare integrity-bound proposals and request simulation. The UI clearly labels these as unexecuted.

### Phase 3 — brokered user signing

After the vault and privileged host boundary are production-ready, add trusted wallet adapters, explicit user approvals, submission, receipts, and audit artifacts.

### Phase 4 — Resonant DAO pilot

Implement a `GovernanceProvider` adapter for the selected protocol and chain. Keep treasury execution behind multisig/timelock and strict human approval.

### Phase 5 — additional chains and bounded policy automation

Validate portability with materially different ledgers. Consider narrowly bounded automation only through a separate accepted security and governance decision.

## 19. Open design decisions

These items should remain unresolved until recorded in ADRs or equivalent accepted specifications:

1. Which identifier standards and canonical encoding rules are mandatory?
2. Where does the trusted broker run in browser-first, desktop, and future Rust-backed deployments?
3. Which wallet custody tiers are supported first: external connected, hardware, local user-controlled, multisig, or optional managed?
4. Is transaction submission always broker-owned, or may a separately granted provider submit an already authorized envelope?
5. Which simulation sources qualify as independent, and how is simulation disagreement shown?
6. How are contract/program allowlists verified and updated?
7. What constitutes adequate user presence for local, remote, hardware, multisig, and accessibility flows?
8. How are session permissions bounded, expired, and recovered after crashes?
9. What audit data is portable, encrypted, retained, or eligible for deletion?
10. What governance model, proposal lifecycle, voting method, quorum, delegation, timelock, and emergency controls will the Resonant DAO use?
11. Which actions, if any, may later be automated, and under what value, time, destination, and revocation limits?
12. How are forks, reorgs, chain upgrades, contract migrations, and DAO protocol upgrades surfaced to users?
13. How should identity credentials be selectively disclosed without linking accounts unnecessarily?
14. Which provider code may run in-process versus isolated local service, worker, WASM sandbox, or remote compute node?
15. What marketplace review and conformance requirements apply to signing-capable or governance-capable extensions?
16. Who may act as a verification authority, how are authority keys rotated, and how is authority compromise recovered?
17. Which evidence is public, private, reproducible by users, or retained only by reviewers?
18. What reviewer independence and quorum are required for each risk tier?
19. How frequently does verification expire, and which vulnerability feeds or incidents trigger immediate re-review?
20. Can community or enterprise authorities issue verification records, and how does the host communicate differing trust policies?

## 20. Acceptance criteria for an SDK proposal

The design is ready to move from architecture to implementation when:

- all five contribution points have versioned schemas and capability discovery;
- the trusted/untrusted process boundary is documented for every supported host;
- the public SDK contains no method capable of exporting private key material or a reusable unrestricted signer;
- proposal integrity, canonical user summaries, policy evaluation, approval, signing, submission, finality, and audit have defined state machines;
- permission grants support resource scopes, expiration, revocation, degradation, and update re-consent;
- event hooks define finality, replay, reorg, ordering, deduplication, and backpressure behavior;
- at least two materially different chain adapters pass conformance fixtures;
- a mock `GovernanceProvider` proves that Resonant DAO UI and agent workflows do not depend on chain-native types;
- security review and threat modeling cover malicious extensions, malicious RPCs, compromised providers, prompt injection, replay, UI deception, and supply-chain updates;
- verification records bind an exact source revision, manifest, dependency lock, SDK version, capability set, evidence bundle, reviewer decision, policy version, and packaged artifact digest;
- risk-tiered verification, expiry, suspension, revocation, incident response, and material-change re-verification are enforced by the host and registry;
- the UI distinguishes publisher signature, reproducible checks, security review, governance approval, artifact match, and runtime permission grants;
- the proposal is reconciled with the accepted ResonantOS Add-on SDK, wallet/Web3 security, secure vault, privileged host boundary, compute fabric, and browser-host decisions.

## 21. Reference alignment

This proposal is designed to extend the intent of the existing ResonantOS architecture:

- signed manifests, provenance tiers, explicit capabilities, host mediation, revocation, and degraded states from the Add-on Runtime and SDK decisions;
- construction-versus-signing separation, local-custody support, human confirmation, and auditable signing from the Wallet and Web3 Security decision;
- typed compute jobs, node trust, network policy, secrets handling, and audit from the Compute Fabric decision;
- VS Code/VSCodium-compatible manifest and extension-host ergonomics without inheriting the editor extension host as a privileged wallet boundary.

This document is a proposed future interface, not evidence that wallet custody, signing, DAO execution, or multi-chain production support currently exists in ResonantOS.

## 22. Architectural anchors (Alpha status)

The following Alpha-window decisions constrain how and when this proposal
lands. The numbered items below are the ADRs whose status the proposal
presupposes; substantive implementation depends on each anchor being
extended in a follow-up ADR.

- [ADR-008: Wallet & Web3 Security](../architecture/ADR-008-wallet-web3-security.md) — hybrid wallet model and human-only signing; **Partial** Alpha applicability.
- [ADR-018: Add-on SDK V0](../architecture/ADR-018-addon-sdk-v0.md) — manifest shape; the §11 capability vocabulary extension is the first blocking decision.
- [ADR-022: Portable User State & Secure Vault](../architecture/ADR-022-portable-user-state-secure-vault.md) — encrypted vault for provider credentials and any future wallet key material.
- [ADR-023: Add-on Repository And Registry Model](../architecture/ADR-023-addon-repository-registry-model.md) — registry model the §13.5 verification record piggybacks on.
- [ADR-026: Minimal Kernel And Replaceable Default Add-ons](../architecture/ADR-026-minimal-kernel-replaceable-default-addons.md) — kernel-vs-extension boundary.
- [ADR-032: ResonantOS Compute Fabric](../architecture/ADR-032-resonantos-compute-fabric.md) — typed jobs for `computeProviders` and any non-add-on compute work.
- [ADR-037: Browser-First Chromium ResonantOS](../architecture/ADR-037-browser-first-chromium-resonantos.md) — Alpha package boundary; the Alpha is the unpacked Chrome extension plus Node bridge, not a custom Chromium build, and not a Rust host.
- [ADR-038: Add-on Runtime Identity](../architecture/ADR-038-addon-runtime-identity.md) — `id@publisher` triple the provider contribution points extend.
- [ADR-039: New-Permission Review On Update](../architecture/ADR-039-addon-permission-diff-on-update.md) — gates §11 dotted-action capability additions on update.
- [ADR-041: Add-on Isolation Boundary](../architecture/ADR-041-addon-isolation-boundary.md) — `host-mediated-agent` worker isolation the §6 broker depends on.
- [ADR-042: Add-on Trust-Tier Transitions](../architecture/ADR-042-addon-trust-tier-transitions.md) — publisher-tier transitions; §13.5 verification states overlay this axis (a separate "artifact verification" axis).

This document is a proposed future interface, not evidence that wallet custody, signing, DAO execution, or multi-chain production support currently exists in ResonantOS.
