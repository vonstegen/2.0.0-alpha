import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APPROVED_CONSULTATION_ALLOWLIST_DIGEST,
  CONSULTATION_EXPLANATION_SUPPORT_VERSION,
  CONSULTATION_GLOSSARY_VERSION,
  CONSULTATION_MANIFEST_VERSION,
  CONSULTATION_PROJECTION_VERSION,
  digestJson,
  sha256,
} from "../../host/augmentor-consultation-contract.mjs";

export function consultationTestBundle({ generatedAt = "2026-08-04T12:00:00.000Z", seed = "reviewed-source" } = {}) {
  const sourceHandle = `src-${sha256(seed).slice(0, 12)}`;
  const recordId = `rec-${sha256(`${seed}-record`).slice(0, 12)}`;
  const termIds = [`term-${sha256("evidence").slice(0, 12)}`, `term-${sha256("authority").slice(0, 12)}`];
  const glossary = {
    schemaVersion: CONSULTATION_GLOSSARY_VERSION,
    terms: [
      { id: termIds[0], term: "evidence", plainMeaning: "Information used to support an answer.", formalName: null, whyItMatters: "It keeps an answer tied to reviewed information.", sourceHandles: [sourceHandle], authorityEffect: "none", forbiddenInferences: ["final-truth"] },
      { id: termIds[1], term: "authority", plainMeaning: "The right held by a responsible owner to decide.", formalName: null, whyItMatters: "Evidence does not create this right.", sourceHandles: [sourceHandle], authorityEffect: "none", forbiddenInferences: ["permission-to-act"] },
    ],
  };
  const projection = {
    schemaVersion: CONSULTATION_PROJECTION_VERSION,
    records: [{
      id: recordId,
      kind: "workflow-object",
      label: "Saved conversation",
      summary: "A conversation that is saved so the person can return to it later.",
      viewIds: ["experience", "runtime"],
      fields: {
        responsibility: "The product keeps the conversation together while the person discusses related work.",
        boundary: "A saved conversation does not own work, memory, or protected actions.",
      },
      explanationSupport: {
        recordId,
        state: { scope: "ontology-model", posture: "observed", text: "Saved conversations are represented in the reviewed model.", verifiedAt: generatedAt, sourceHandle, doesNotEstablish: ["deployed", "production-ready"] },
        process: { text: "The product keeps related messages together for later use.", sourceHandle },
        illustrativeScenario: { kind: "illustrative", text: "A person returns to an architecture conversation on another day.", sourceHandles: [] },
        analogy: { text: "It is like a notebook with several topics.", limitation: "The notebook comparison does not create work, memory, or authority.", sourceHandle },
        boundary: { text: "A saved conversation is not running work or trusted memory.", sourceHandle },
        glossaryRefs: termIds,
        keywords: ["saved", "conversation", "thread", "history"],
      },
      fieldProvenance: { sourceHandle },
      sourceHandles: [sourceHandle],
      confidence: { level: "high", ownerRef: `own-${sha256("chat-owner").slice(0, 12)}`, basis: "source_derived", assessedAt: generatedAt, sourceHandle },
    }],
    structuredConflicts: [],
  };
  const schemas = {
    projection: `${JSON.stringify({ $id: CONSULTATION_PROJECTION_VERSION })}\n`,
    manifest: `${JSON.stringify({ $id: CONSULTATION_MANIFEST_VERSION })}\n`,
    glossary: `${JSON.stringify({ $id: CONSULTATION_GLOSSARY_VERSION })}\n`,
    explanationSupport: `${JSON.stringify({ $id: CONSULTATION_EXPLANATION_SUPPORT_VERSION })}\n`,
  };
  const schemaVersions = {
    projection: CONSULTATION_PROJECTION_VERSION,
    manifest: CONSULTATION_MANIFEST_VERSION,
    glossary: CONSULTATION_GLOSSARY_VERSION,
    explanationSupport: CONSULTATION_EXPLANATION_SUPPORT_VERSION,
  };
  const schemaDigests = Object.fromEntries(Object.entries(schemas).map(([name, value]) => [name, sha256(value)]));
  const outputDigest = digestJson(projection);
  const glossaryDigest = digestJson(glossary);
  const manifest = {
    schemaVersion: CONSULTATION_MANIFEST_VERSION,
    compilerVersion: "test-neutral-compiler@1.1.0",
    compilerDigest: sha256("compiler"),
    allowlistDigest: APPROVED_CONSULTATION_ALLOWLIST_DIGEST,
    opaqueIdMapVersion: "sha256-prefix@1.0.0",
    inputSources: [{ sourceHandle, sha256: sha256("source-bytes") }, { sourceHandle: `src-${sha256("explanations").slice(0, 12)}`, sha256: sha256("explanation-bytes") }, { sourceHandle: `src-${sha256("glossary").slice(0, 12)}`, sha256: sha256("glossary-bytes") }],
    schemaVersions,
    schemaDigests,
    recordCounts: { records: 1, structuredConflicts: 0, terms: glossary.terms.length },
    generatedAt,
    outputDigest,
    glossaryDigest,
    bundleDigest: digestJson({ outputDigest, glossaryDigest, schemaVersions, schemaDigests }),
    ownerApprovalRef: `approval-${sha256("approval").slice(0, 12)}`,
  };
  return { projection, glossary, manifest, schemas };
}

export async function writeConsultationTestBundle(root, bundle = consultationTestBundle()) {
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "projection.json"), JSON.stringify(bundle.projection)),
    writeFile(path.join(root, "glossary.json"), JSON.stringify(bundle.glossary)),
    writeFile(path.join(root, "projection-manifest.json"), JSON.stringify(bundle.manifest)),
    writeFile(path.join(root, "schemas", "projection.schema.json"), bundle.schemas.projection),
    writeFile(path.join(root, "schemas", "projection-manifest.schema.json"), bundle.schemas.manifest),
    writeFile(path.join(root, "schemas", "glossary.schema.json"), bundle.schemas.glossary),
    writeFile(path.join(root, "schemas", "explanation-support.schema.json"), bundle.schemas.explanationSupport),
  ]);
}
