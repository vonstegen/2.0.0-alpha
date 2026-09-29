# 11 — Pi Harness ↔ ResonantOS Resource Connection Reference Architecture

**Status:** Proposed official SDK Fabric architecture  
**Role:** Pi reference map for generic harness/resource integration  
**Scope:** External SDK, Harness Resource Projection, Dynamic SDK, Add-on Catalog, SDK Guide

## 1. Purpose
Pi is the first advanced reference harness for showing how an external coding/agent harness can connect to the ResonantOS sovereign resource fabric without surrendering its native runtime, interface, tools, or session model.

The architectural goal is not to make ROS-specific copies of Pi facilities. ROS should use a harness's native conventions where appropriate, expose sovereign ROS services through a bounded adapter where necessary, and use MCP primarily for portable/external integrations.

## 2. Reference patch bay
```text
                         RESONANT OS
                    Sovereign Resource Fabric
 ┌─────────────┬────────────┬────────────┬──────────────┐
 ▼             ▼            ▼            ▼              ▼
Providers    Memory       Skills       Tools         Projects
/ Models                                              / Files
 ├─────────────┼────────────┼────────────┼──────────────┤
 ▼             ▼            ▼            ▼              ▼
Provider    Context      Skill       Tool/MCP       Working-dir
Adapter     Adapter      Adapter      Adapter         Adapter
 └─────────────┴────────────┴────────────┴──────────────┘
                              │
                    Pi Resource Projection
                              ▼
                         REAL Pi
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
             Model          Agent          Native Tools
            Provider        Session     read/write/edit/bash
```

## 3. Provider/model
ROS owns Provider Profile identity, protocol compatibility, credential authority, model authorization and grants. Pi owns inference execution. Provider identity and protocol compatibility remain separate gates.

## 4. Skills
ROS remains canonical owner. Authorized skills may be projected into Pi-compatible skill locations so Pi discovers them normally. Projection may be ephemeral/session-scoped.

## 5. Tools
Pi-native read/write/edit/bash remain native; ROS governs project/environment authority. ROS-provided tools (memory.search, GitHub, DAR, research, project services, notifications, connectors) should flow through one generic Pi ROS Resource Extension rather than one extension per service.

## 6. MCP
MCP is a portability bridge, not a mandatory internal ROS protocol. Prefer native ROS resource calls for local sovereign services and MCP for external apps, databases and remote services.

## 7. Memory
Pi conversation/session context is distinct from ROS sovereign memory. Initial bounded interface: `ros_memory_search`, `ros_memory_read`; later use proposal/intake for writes rather than unrestricted trusted-memory mutation.

## 8. Project/filesystem
ROS authorizes the active project root/cwd. Pi uses its native filesystem tools inside that boundary. ROS governs which project; Pi governs work inside the granted project.

## 9. Project context
ROS can project architecture, project rules, current goal, decisions and working conventions through a Pi-compatible context adapter. DAR/project knowledge may later feed this projection.

## 10. Generic Pi ROS Adapter Extension
Use one Pi-side socket into the SDK fabric:
```text
        ROS PI ADAPTER EXTENSION
                  │
          ROS Resource Broker
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    Memory      Tools      Context
     Skills     Project    Profile
```

## 11. Sessions
ROS tracks session identity, project, provider/model, resource projection, lifecycle and audit ID. Pi retains its native transcript/runtime/session mechanics.

## 12. User Profile
User Profile is a scoped authorized projection, never wholesale database access.

## 13. GitHub/connectors
Prefer reusable ROS connectors where credentials, account selection, audit and policy remain centralized, making the same connector reusable by Pi, Hermes, Grok Build, ChatGPT, Claude and future consumers.

## 14. DAR/artifacts
Expose bounded operations such as `ros.artifact.create`, `ros.artifact.read`, and `ros.decision.propose`; Pi need not understand DAR internals.

## 15. Pi Add-on Card target
TYPE: Harness/Coding Agent. INTERFACE: runtime-native/terminal. PROVIDER: ROS Provider Profiles, native Pi providers, self-auth. PROJECT: cwd/files/context. MEMORY: search/read/future propose-write. SKILLS: list/read/session projection. TOOLS: Pi native + ROS + external connectors. MCP: adapter/gateway. SESSION: Pi-native + ROS lifecycle. USER PROFILE: scoped. DAR: artifacts/decisions. GITHUB: ROS connector.

## 16. Three connection mechanisms
```text
                    ROS RESOURCE FABRIC
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
     NATIVE PROJECTION   ROS ADAPTER      MCP GATEWAY
                         EXTENSION
           ▼               ▼                ▼
      filesystem         memory           GitHub
      skills dirs        tools            external apps
      env/provider       context          SaaS/databases
      cwd                profile
```
**Native Projection:** use harness-native conventions (credential→environment, project→cwd, skills→native skill directory).

**ROS Adapter Extension:** use when the harness actively queries sovereign ROS services (memory, ROS tools, profile/context, DAR).

**MCP Gateway:** use primarily for portable/external integrations.

## 17. Genericity beyond Pi
```text
                     ROS MEMORY
                        │
        ┌───────────────┼─────────────────┐
        ▼               ▼                 ▼
   Pi Adapter       Hermes Adapter     ChatGPT MCP
        ▼               ▼                 ▼
       Pi             Hermes           ChatGPT
```
Canonical resource stays in ROS; only the projection adapter changes.

## 18. Phase 2 implementation order
1. Project + Files native projection.
2. Skills native projection.
3. Memory search/read through ROS Pi Adapter.
4. One harmless bounded ROS Tool.
5. Define User Profile, DAR, Map and additional buses as extension seams until canonical modules are ready.

Invariant: `resource request != capability grant != session projection`.

## 19. Security invariants
Canonical resources remain ROS-owned; declarations grant no authority; project/filesystem roots are host-authorized; skills cannot grant tools/capabilities; trusted memory writes remain host-gated; external credentials remain centralized/non-exported where possible; gateways expose only authorized operations; projections are bounded/revocable/auditable/disposable; User Profile is minimum relevant projection; native tools cannot widen the approved boundary.

## 20. Final principle
Pi is the first advanced reference map, not a special-case architecture. ROS owns sovereign resources and authority while each harness retains its native interface, runtime, session model and tools. The same ROS Memory, Skills, Tools, Projects, Providers and Connectors should be reusable across Pi, Hermes, Grok Build, provider-native applications and future harnesses through appropriate projection adapters.
