# Internal Modular ROS Architecture and Roadmap

Kernel modules are internal development architecture, not ordinary installable add-ons.

## Trusted kernel modules
Identity/Trust; Capability/Policy; Contract Validation; SDK/Port Router; System Slots; Lifecycle/Recovery; Audit/Provenance; Guardian/Engineer.

The Guardian/Engineer remains Ground Zero. Its diagnostic model may be configurable; authority, health monitoring, policy, recovery and emergency UI remain kernel-owned.

## System modules above the kernel
| Module | Role |
|---|---|
| Memory | memory/retrieval |
| Skills Manager | skills/instructions/workflows |
| Credential Vault | secrets/auth |
| User Profile | preferences/user context |
| Projects | project state/context |
| Map | relationships/topology |
| DAR/Artifacts | dialogue artifacts/decisions/evidence |
| Context Projection | scoped client context |

Individual memories, skills, preferences and artifacts are assets, not add-ons.

## Roadmap
1. Formalize trusted kernel boundary and internal module interfaces.
2. Add universal provides/requires port contracts and router.
3. Move Memory/Profile/Skills/Projects/Artifacts behind stable contracts incrementally.
4. Build sovereign Context Fabric and scoped projections.
5. Build external AI Client Gateway/protocol adapters.
