# Add-on / Module Capability Matrix

| Layer | Category | Example | Status | Provides | Requires | UI | Slot | Credential | Target |
|---|---|---|---|---|---|---|---|---|---|
| System module | data-source | memory | Current/partial | memory search/read/intake | project/provenance | ROS panel/background | memory-system | none/self | 0.1 candidate |
| System module | service | skills manager | Future | skills list/read/prepare | profile/project/tools | background | skill-provider future | none | post-0.1 |
| System module | service | credential vault | Current pattern/future durable | credential status/authorize/use | kernel identity/policy | settings | credential-provider future | host-mediated | post-0.1 |
| System module | service | user profile | Current/future contract | profile read/projection | identity | settings | profile-provider future | none | post-0.1 |
| System module | service | projects | Current/future contract | project state/context | profile/files | workspace | project-provider future | none | post-0.1 |
| System module | service | map | Planned | map query/relations | memory/projects/artifacts | map | map-provider future | none | future |
| System module | service | DAR/artifacts | R&D | artifact/decision/provenance | project/context | viewer/background | artifact-provider future | none | future |
| Harness | harness | Pi | Built/tested | agent invoke/status | provider profile | ROS terminal planned | primary-agent/chat-interface | provider-profile | 0.1 |
| Harness | harness | OpenCode | Current | coding operations | own auth/files/tools | ROS terminal/web | primary-agent candidate | self | 0.1/next |
| Tool | tool | Utility | Built/tested | bounded tool | none | tool-panel | none | none | 0.1 |
| Connector | connector | GitHub | Planned reference | repository/issue/PR | credential.use | provider-native/ROS | none | host-mediated | 0.1 next |
| Communication | communication | Email | Planned | email search/read/draft/send | credential + approval | mailbox/native | communication-channel | OAuth/host-mediated | future |
| AI client | connector | ChatGPT/Claude/Grok/Gemini | R&D | client access | scoped context/tools | provider-native | none | external auth | future |
| Connector | connector | MCP server | Category supported | external tools/data | config/credential | headless/tool-panel | none | self/host-mediated | 0.1/next |

Canonical categories: harness, tool, connector, communication, data-source, ui, service.
