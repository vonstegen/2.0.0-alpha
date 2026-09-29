# Resonant External Community SDK Architecture

## Objective
The External SDK is the stable boundary for community developers and AI coding harnesses. A developer identifies what is being built; the SDK returns the appropriate manifest requirements, architecture, surfaces, security constraints, examples and tests.

`Developer/AI -> classify -> describe-category -> category-specific SDK kit -> build -> validate -> install -> grant -> enable -> operate -> revoke`

## Canonical categories
| Category | Example/subtype | Purpose |
|---|---|---|
| harness | coding-agent / Pi | Agent/harness runtime integration |
| tool | utility | Bounded structured tools |
| connector | revision-control, MCP, API | External systems |
| communication | email, messaging | Communication channels |
| data-source | memory, knowledge | Retrieval/intake providers |
| ui | viewer, dashboard | Presentation extensions |
| service | background/local service | Host-mediated services |

## Dynamic SDK recognition
The category registry is machine-readable. AI developers should be able to retrieve required/optional manifest fields, runtime/surface guidance, eligible slots, credential options, security invariants, templates, examples, tests and documentation without ingesting the whole ROS repository.

## Community SDK 0.1 basis
- **Pi** — Provider Profile reuse, `primary-agent`, dynamic tool rail/workspace, governed lifecycle.
- **Utility Tool** — minimal bounded tool and generic dynamic surface.
- **Reference Memory** — existing basis for a replaceable memory-provider implementation.
- **GitHub connector** — recommended next reference to prove the external-resource/connector side.

## Stable external boundary
Community developers should depend on:
- Manifest and mandatory `classification`.
- Validator and machine-readable category discovery.
- Capabilities/grants and lifecycle semantics.
- Approved runtime/service contracts.
- Declarative surfaces.
- Provider Profile integration.
- System-slot eligibility rules.
- Public errors, examples and test harnesses.

They should not depend on internal bridge implementation details.

## Near-term extensions
- Interface ownership/type: `provider-native`, `resonantos-hosted`, `headless`; terminal/chat/dashboard/etc.
- A connector reference implementation.
- AI-harness scaffolding and validation workflow.
- Community SDK versioning independent of internal ROS revision cadence.
