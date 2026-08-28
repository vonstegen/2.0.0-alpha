# 04 — Augmentor Extension Model

## Definition

An Augmentor extension adds a bounded skill, tool, connector, model route, memory view, or workflow directly to Augmentor. It does not bring an independent general-purpose planning/runtime loop.

This evolves the existing `augmentorSkills` contract into a first-class extension class while preserving the rule that instructions do not grant authority.

## Required declaration

An extension SHOULD declare:

- stable extension identity and version;
- extension kind: `skill`, `tool`, `connector`, `workflow`, `model-adapter`, or `memory-view`;
- compatible Augmentor/SDK versions;
- required tools and capabilities;
- input/output schemas;
- workflow phases and approval gates;
- context read/write policy;
- deterministic verification hooks;
- failure and revocation behavior.

## Execution model

```text
User task
  -> Augmentor task context
  -> extension invocation identity
  -> Core computes task grant
  -> host-mediated tool call
  -> typed result/evidence
```

The extension runs under an identity subordinate to Augmentor for the active task. It receives only explicitly selected context. Its effective permissions are the intersection defined in document 08.

## Difference from a harness provider

| Augmentor extension | Harness provider |
| --- | --- |
| Uses Augmentor's orchestration loop | Brings its own loop/runtime |
| Usually one focused behavior | May contain many child agents/tools |
| Invoked as a tool/workflow | Receives and owns a bounded task lifecycle |
| Returns a typed extension result | Returns events, artifacts, evidence, and final result |

An integration that starts as an extension MAY graduate to a harness provider, but the manifest class and authority boundary must change explicitly.
