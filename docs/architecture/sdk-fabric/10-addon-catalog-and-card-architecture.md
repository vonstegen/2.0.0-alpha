# 10 — ResonantOS Add-on Catalog and Add-on Card Architecture

**Status:** Proposed official SDK Fabric architecture  
**Scope:** External SDK, Dynamic SDK, SDK Guide, add-on discovery, compatibility, installation state, future ROS Map  
**Purpose:** Define a normalized, machine-readable and human-readable catalog record for every known ResonantOS add-on.

## 1. Decision
ResonantOS SHALL maintain an **Add-on Catalog** in which each known add-on is represented by a normalized **Add-on Card** analogous to a library catalog/index card.

The add-on artifact is the "book." The manifest is publisher-supplied declaration. The Add-on Card is ResonantOS's validated, normalized catalog record derived from canonical metadata and host knowledge.

The Add-on Card SHALL NOT become a second manually maintained manifest.

## 2. Architectural separation

### 2.1 Catalog Card — what the add-on is
Relatively stable descriptive/compatibility information:
- canonical identity/version;
- classification/subtype;
- runtime family;
- interface ownership/type/modes;
- provider protocol compatibility and credential strategies;
- requested/available ROS resources;
- capability requirements;
- surfaces/system-slot eligibility;
- platforms/SDK compatibility;
- security profiles;
- documentation/reference status;
- relationships to providers/resources/interfaces/references.

### 2.2 Installation Record — this system's current state
Mutable user/system state:
- installed/enabled/version;
- grants;
- selected Provider Profile/model/project;
- granted resource projection;
- health/readiness;
- active sessions;
- assigned slots;
- local configuration;
- lifecycle/revocation state.

The Catalog Card describes capability and compatibility. The Installation Record describes authority and runtime state.

## 3. Normalization pipeline
```text
addon.json / package metadata
          +
Category Registry
          +
Interface Registry
          +
Resource Registry
          +
Capability Registry
          +
Host validation / compatibility derivation
          |
          v
   Normalized Add-on Card
          |
          +----> Dynamic SDK / AI developer kit
          +----> SDK Guide / human browser
          +----> Compatibility evaluator
          +----> Add-ons UI / tool rail
          +----> future ROS Map / relationship graph
```

Cards are generated from validated canonical sources, not maintained as duplicate truth.

## 4. Conceptual card
```yaml
addonCard:
  schemaVersion: resonantos-addon-card/v1
  identity: { id: addon.pi-harness, name: Pi, version: 0.1.0 }
  classification: { category: harness, subtype: coding-agent }
  runtime: { family: local-service }
  interface:
    ownership: runtime-native
    type: terminal
    modes: [embedded-pty, external-terminal]
  providers:
    consumesProviderProfiles: true
    protocols: [openai-compatible]
    credentialStrategies: [ros-provider-profile, session-environment, native-account]
  resources:
    requests:
      project: [read]
      files: [read, write]
      memory: [search, read]
      skills: [list, read]
      tools: [list, invoke]
  capabilities:
    requested: [agent-runtime, network, chat-interface]
  surfaces: [tool-panel, workspace]
  systemSlots:
    eligible: [primary-agent, chat-interface]
  compatibility:
    platforms: [macOS, linux, windows]
    sdkVersion: 0.1.0
  reference:
    level: advanced
```
Exact fields MUST reuse canonical SDK contracts rather than duplicate vocabularies.

## 5. Integration semantics
Pi is a credential-bearing terminal-native harness. A ChatGPT-style provider-native application normally owns its model authentication and consumes authorized ROS resources through a connector/MCP path. DeepSeek/OpenRouter/xAI API are provider records supplying models/credentials/protocol metadata to compatible harnesses. These identities MUST not be conflated.

## 6. Relationship graph
The Catalog SHOULD represent typed derived relationships:
```text
Pi
 |- consumes -> Provider Profile
 |- consumes -> Memory
 |- consumes -> Skills
 |- consumes -> Tools
 `- uses-interface -> Terminal

DeepSeek
 `- provides -> Models

Memory Module
 `- provides -> memory.search/read

ChatGPT Connector
 |- owns -> model authentication
 `- consumes -> ROS resources through connector/MCP
```
Relationship edges are descriptive/derived, never authority.

## 7. Compatibility evaluation
The Catalog enables deterministic preflight: required interface/protocol/resource vs available system facilities. Results may be compatible, installable-but-unconfigured, or incompatible. Compatibility never grants capabilities or credentials.

## 8. Dynamic SDK integration
Dynamic SDK combines category definitions, registries, relevant Add-on Cards, reference implementations, tests and security profiles. A request such as "build a terminal-native coding harness" can return the canonical harness kit plus qualified reference cards rather than requiring repository archaeology.

## 9. SDK Guide integration
SDK Guide SHOULD be the human browser of the same catalog/category data consumed by AI developers. It MUST NOT maintain a separate hard-coded category/reference database where canonical registry/card data exists.

## 10. Credential ownership
Provider-native applications generally require no ROS model credential; they may require ROS gateway authorization and can consume memory/skills/tools/projects. Credential-bearing harnesses may support ROS Provider Profiles, native self-auth and session credentials. API/model providers use Provider Profiles/vault credentials and expose protocol/model metadata.

## 11. Security invariants
1. Catalog classification grants no authority.
2. Resource requests are not grants.
3. Installation grants remain host-owned.
4. No raw credential is stored in a card.
5. Safe status exposes only non-secret metadata.
6. Provider compatibility is host-derived where applicable.
7. Cards cannot widen project/filesystem/resource scope.
8. Skills/relationships cannot implicitly grant tools/capabilities.
9. Unknown categories/resources/interfaces fail closed.
10. UI/external projections are safe metadata.
11. Static cards do not imply installed/runtime authority.
12. Relationship edges are never authority.

## 12. Storage evolution
Prefer deterministic generation before a standalone database:
```text
Phase A: in-memory/generated cards from current registry
Phase B: persisted searchable catalog index/cache
Phase C: remote/community catalog federation
Phase D: relationship graph integration with ROS Map
```

## 13. Reference cards
Community SDK 0.1 should include SDK Echo, SDK Guide, Pi, Reference Memory and GitHub Connector cards, followed by Grok Build/Hermes and provider-native application examples. Reference status must say implemented, qualified, experimental or planned.

## 14. Testing
Test deterministic generation; manifest/card consistency; normalization; no secret projection; compatibility; Installation Record separation; cache invalidation; unknown fields/categories; relationships; reference discovery; machine-readable Dynamic SDK output; SDK Guide rendering; version/update behavior; revocation semantics; fresh-developer catalog use.

## 15. Non-goals
No marketplace, ranking/reputation system, autonomous trust decisions, raw-secret storage, manifest replacement, grant replacement, installation-state replacement, or premature graph database.

## 16. Roadmap placement
```text
Qualified Provider Connection
 -> Pi native credential proof
 -> Harness Resource Projection
 -> Add-on Card generated model
 -> Pi/SDK Echo/SDK Guide reference cards
 -> terminal A+B qualification
 -> Grok Build/Hermes cards
 -> provider-native application cards
 -> fresh-developer SDK test
 -> Community SDK 0.1 Alpha
```

## 17. Final principle
The Add-on Catalog is the **library catalog of ResonantOS**:
- add-on = book;
- manifest = publisher declaration;
- Add-on Card = normalized library record;
- Installation Record = checkout/current-use record;
- Dynamic SDK = librarian for developers and AI;
- SDK Guide = human catalog browser;
- future ROS Map = relationship view.

Metadata describes capability but never grants authority.
