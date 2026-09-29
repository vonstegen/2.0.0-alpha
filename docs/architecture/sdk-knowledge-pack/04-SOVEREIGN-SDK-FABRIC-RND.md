# ResonantOS Sovereign SDK Fabric — R&D Architecture

## North star
ResonantOS should be the durable user-owned context/capability layer underneath replaceable AI applications and harnesses. Provider-native apps such as ChatGPT, Claude, Grok and Gemini can keep their own UI while drawing authorized context/tools from ROS; Pi/OpenCode-style harnesses can use ROS-hosted interfaces.

## Everything uses contracts
Both consumers and resource/service providers should connect through SDK-defined contracts.

Examples:
- Pi **requires** `memory.search`; the Memory Module **provides** `memory.search`.
- GitHub **provides** repository/issue/PR operations and **requires** `credential.use`.
- An AI-app connector **requires** context/memory/skills/tools according to grants.

## Provides / requires model
The future common fabric should express what each component provides and requires. This creates a routable dependency graph without tightly coupling clients to implementations.

## UI ownership
- **provider-native:** ChatGPT, Claude, Grok, Gemini. ROS exposes governed context/capabilities through supported protocols and does not recreate the vendor UI.
- **resonantos-hosted:** Pi, OpenCode and local tools. ROS renders terminal/chat/dashboard surfaces.
- **headless:** services and automation. No interactive UI except health/status as needed.

## Sovereignty
Normal clients should receive capability rather than raw secrets. Prefer `credential.use` / authorization semantics. Memory clients should search/read and propose writes; a memory authority should validate provenance, scope and conflicts before durable mutation.

## Protocol strategy
MCP is a strong transport/socket for provider-native AI apps, but should not become the canonical ROS architecture. ROS should define stable contracts/ports and adapt them to MCP, ACP, CLI, HTTP or future transports.

## Future R&D
- Canonical port namespace, schema and versioning.
- Client identity and context projection.
- Portable canonical Skill representation.
- State migration/rollback for stateful modules.
- Encrypted durable credential vault.
- Map/DAR/Projects integration.
- Reference provider-native AI connector plus Pi harness using the same sovereign fabric.
