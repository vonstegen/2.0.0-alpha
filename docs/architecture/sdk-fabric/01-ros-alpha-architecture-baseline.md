# ROS 2.0.0-alpha Architecture Baseline

Baseline candidate: c594ca3cec92e02fa35c39016e1dc618939ec7d6.

## Current foundations
- Minimal kernel and replaceable defaults are established architecture.
- Host services are already separated across provider, memory, harness, add-on, browser, preferences, OpenCode and agent-control concerns.
- System slots include primary-agent, chat-interface, memory-system and communication-channel.
- packages/addon-sdk is the author-facing SDK boundary; privilege enforcement remains host-owned.
- Harness governance, central Provider Profiles, memory-provider brokerage, mandatory classification, category discovery and dynamic tool-panel surfaces exist on this baseline.

## Canonical dimensions
- classification: WHAT
- runtimeType: HOW
- surfaces: WHERE
- requestedCapabilities: AUTHORITY REQUEST
- systemSlots: ROS ROLE
- credential/provider requirements: AUTH/PROVIDER

Classification never grants authority.

## Gaps
- No universal provides/requires port fabric yet.
- Not every ROS subsystem is behind a uniform system-module contract.
- Durable encrypted credential storage remains future work.
- Provider-native AI connectors and sovereign context projection remain R&D.
- Kernel modularity is an internal development architecture, not ordinary add-on replaceability.
