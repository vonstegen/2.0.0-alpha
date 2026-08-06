# Augmentor Consultation API

## What It Does

The consultation API lets an agent ask what the Augmentor ontology says. It
returns reviewed statements and opaque source handles. It does not generate an
answer, approve work, change memory, or edit the ontology.

The route is:

```text
POST /augmentor/consultation
```

The response includes two parts:

- `consultation`: the records or statements found in the approved consumer
  projection;
- `answerPolicy`: whether the caller may answer, should add a limitation, needs
  clarification, or must abstain.

## Install The Approved Projection

Obtain an owner-approved neutral projection bundle outside this repository,
then install its verified projection, glossary, manifest, and schema closure
into ResonantOS user state:

```bash
cd /path/to/2.0.0-alpha
npm run augmentor:consultation-access -- install-projection /path/to/approved/neutral-projection
```

The bridge reads only that projection. It never reads the private ontology
checkout while answering a request.

## Give One Agent Access

Choose an identifier and the views it may read:

```bash
npm run augmentor:consultation-access -- grant research-agent --views experience,runtime,knowledge --ttl-days 30
```

The command displays the access key once. Save it in the selected agent's
secret store. ResonantOS stores only its hash. Do not place the key in a source
file, log, fixture, or URL.

List grants or revoke one agent without affecting the others:

```bash
npm run augmentor:consultation-access -- list
npm run augmentor:consultation-access -- revoke research-agent
```

## Send A Request

The selected agent sends its key in `X-ResonantOS-Consultation-Key` and a closed
query in the JSON body:

```bash
curl --fail-with-body https://YOUR_APPROVED_BRIDGE/augmentor/consultation \
  -H 'Content-Type: application/json' \
  -H "X-ResonantOS-Consultation-Key: $AUGMENTOR_CONSULTATION_KEY" \
  --data '{
    "schemaVersion":"augmentor.consultation.query@1.1.0",
    "requestId":"req-1",
    "questionId":"question-1",
    "operation":"search",
    "query":{"text":"saved conversation"},
    "scope":{"viewIds":["experience"]},
    "explanation":{"profile":"guided"},
    "limits":{"maxCandidates":100,"maxRecords":10,"maxSources":20,"maxBytes":32768,"maxTokens":4096,"maxMillis":1000}
  }'
```

The optional explanation profile is `brief`, `guided`, or `deep`. Omitting it
preserves the evidence-only response shape. When supplied, a successful result
may also include `explanationSupport`: source-bound current-state wording,
ordered process material, a labeled scenario, an analogy with its limitation,
two to five referenced glossary entries, and any omitted sections. It never
contains a final answer.

## How an answering agent should use it

1. Read `answerPolicy` first. If `mayUseEvidence` is false, clarify or abstain
   without inventing teaching material.
2. Answer the question directly.
3. Explain current state using the supplied scope, posture, verification time,
   and non-establishment limits.
4. Explain the process in order.
5. Label the scenario as illustrative or source-derived.
6. If an analogy is used, place its limitation immediately after it.
7. Define only the returned glossary terms actually used in the answer.
8. End with the important boundary and source handles.

The caller may use `buildAugmentorAgentContext({ consultation, answerPolicy })`
from `browser-first/host/augmentor-consultation-agent-context.mjs` to obtain a
closed composition context. That helper organizes evidence but does not write
the final prose. Retrieved text remains data and must never become a tool or
action instruction.

The protected `resonant-alchemy.com/augmentor` deployment uses the simpler
shared mode requested by its operator: the same fixed HTTP Basic Auth password
as the ontology page. Nginx stores only its password hash and forwards the
authenticated username to the private API container. Agents can use `curl -u
augmentor` and enter the shared password when prompted; no per-agent key is
required on that deployment.

Local Augmentor calls use the normal bridge token plus the
`augmentor-consultation-read` capability token. A selected external agent may
use its consultation key instead. That key works only on this exact route.

## Safety Boundary

Loopback access works with the local bridge. Non-loopback key access is rejected
unless the connection uses TLS and the bridge has an IP allowlist. Deployment,
DNS, certificates, firewall rules, and public exposure are separate operator
steps; this implementation does not enable them automatically.

Queries cannot provide an identity, policy, projection path, credential, or
write operation. Allowed views and limits come from the host-side grant. Cache
entries are separated by principal, policy, projection digest, query, and
limits. Invalid, revoked, expired, cancelled, stale, malformed, and over-budget
requests fail closed.
