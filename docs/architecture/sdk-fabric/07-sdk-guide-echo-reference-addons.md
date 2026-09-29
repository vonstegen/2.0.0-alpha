# SDK Guide and SDK Echo — Reference Add-ons

## SDK Echo 2.0

Echo is the canonical ResonantOS Hello World. It proves classification -> validation -> install -> grant -> enable -> dynamic surface -> bounded request -> host boundary -> deterministic response -> disable/revoke.

Recommended identity:

```yaml
classification:
  category: tool
  subtype: utility
interface:
  ownership: resonantos-hosted
  type: tool-panel
```

Echo should avoid provider credentials, memory, harness runtime, broad filesystem access and Core-specific code.

## SDK Guide 2.0

Guide is the human frontend to Dynamic SDK Discovery. It queries the same machine-readable category registry used by AI developers rather than maintaining separate hard-coded documentation.

It should let a developer choose Harness, Tool, Connector, Communication, Data Source, UI or Service and then show the required architecture, optional SDK facilities, reference implementation, manifest/files and validation path.

Single source of truth:

```text
SDK Category Registry
  -> AI coding harness machine guidance
  -> SDK Guide human onboarding
```

Future Guide versions may scaffold a starter add-on from category/interface/provider/resource selections.

## Initial reference suite

- SDK Guide — onboarding/dynamic discovery.
- SDK Echo — minimum canonical add-on.
- Pi — advanced harness integration.
- Reference Memory — data-source/system-provider pattern.
- GitHub Connector — external connector pattern.

Guide + Echo + Pi form the recommended onboarding progression. Refresh Guide/Echo after Pi/provider/resource/interface contracts stabilize.
