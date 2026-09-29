# ResonantOS Internal Modular Architecture & Roadmap

## Internal architecture principle
Kernel modules are an internal ROS development architecture: modular code with explicit contracts, but not ordinary user-installable add-ons.

### Trusted kernel modules
- Identity / Trust
- Capability / Policy
- Contract Validation
- SDK / Port Router
- System Slots
- Lifecycle / Recovery
- Audit / Provenance
- Guardian / Engineer

## System modules above the kernel
These can progressively implement stable SDK/service contracts:
- Memory
- Skills Manager
- Credential Vault
- User Profile
- Projects
- Map
- DAR / Artifacts
- Context Projection

The assets managed by these modules (individual memories, skills, preferences, files, artifacts) are not themselves add-ons.

## Guardian / Engineer
The Guardian/Engineer is a mandatory Ground Zero kernel module. Deterministic health monitoring should do most continuous work; a lightweight local model can interpret failures and propose repairs. Deterministic policy/allowlists retain authority. Recovery must not depend on replaceable primary-agent, chat or memory modules.

## Ground Zero
Ground Zero should ship usable defaults while the kernel reasons about required roles/contracts rather than hard-coded implementations. This gives the ROS development team a modular backend architecture without forcing users to assemble an empty OS.

## Roadmap
1. **Internal R1 — Kernel boundary:** formalize the trusted kernel boundary and internal module interfaces.
2. **Internal R2 — Port fabric:** introduce universal `provides` / `requires` contracts and routing.
3. **Internal R3 — System modules:** move Memory/Profile/Skills/Projects/Artifacts behind stable contracts incrementally.
4. **Internal R4 — Sovereign Context Fabric:** scoped user-owned context projections.
5. **Internal R5 — AI Client Gateway:** protocol adapters for provider-native AI applications.
