# Sovereign SDK Fabric R&D

ROS should be the durable user-owned context/capability layer underneath replaceable AI applications and harnesses.

Provider-native apps (ChatGPT, Claude, Grok, Gemini) keep their own UI and receive governed ROS context/tools. ROS-hosted harnesses (Pi, OpenCode) use ROS surfaces.

## Contract direction
- Pi requires memory.search; Memory provides memory.search.
- GitHub provides repository/issue/PR operations and requires credential.use.
- AI app connectors require scoped context/memory/skills/tools.

Assets are not add-ons; modules managing assets may implement stable contracts.

## UI ownership
- provider-native: vendor app owns UI.
- resonantos-hosted: ROS renders terminal/chat/dashboard.
- headless: status/health only.

## Sovereignty
Prefer capability and credential-use mediation over raw secrets. AI clients receive scoped projections, not unrestricted state. Memory writes should be proposed and validated by a memory authority.

## Protocols
MCP is an important transport, not the canonical ROS architecture. ROS ports should adapt to MCP, ACP, CLI, HTTP and future transports.

## R&D
Port namespace/versioning; client identity/context projection; portable skills; state migration/rollback; encrypted vault; Map/DAR/Projects integration; reference AI-client connector plus Pi proof.
