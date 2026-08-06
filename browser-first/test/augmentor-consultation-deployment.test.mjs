import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONSULTATION_QUERY_VERSION, DEFAULT_CONSULTATION_LIMITS } from "../host/augmentor-consultation-contract.mjs";
import { startAugmentorConsultationDeploymentServer } from "../host/run-augmentor-consultation-deployment.mjs";
import { writeConsultationTestBundle } from "./fixtures/augmentor-consultation-bundle.mjs";

async function projection(root) {
  await writeConsultationTestBundle(root, undefined);
}

test("deployment adapter trusts only the fixed-auth reverse-proxy principal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "augmentor-deployment-"));
  let server;
  try {
    await projection(root);
    server = await startAugmentorConsultationDeploymentServer({ projectionRoot: root, trustedPrincipal: "augmentor", port: 0 });
    assert.equal(server.address().address, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${endpoint}/healthz`)).status, 200);
    assert.equal((await fetch(`${endpoint}/augmentor/consultation`, { method: "POST", body: "{}" })).status, 401);
    const query = {
      schemaVersion: CONSULTATION_QUERY_VERSION,
      requestId: "deploy-request",
      questionId: "deploy-question",
      operation: "search",
      query: { text: "saved conversation" },
      scope: { viewIds: ["experience"] },
      limits: { ...DEFAULT_CONSULTATION_LIMITS },
    };
    const response = await fetch(`${endpoint}/augmentor/consultation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ResonantOS-Consultation-Principal": "augmentor" },
      body: JSON.stringify(query),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.consultation.status, "ok");
    assert.equal(payload.answerPolicy.action, "answer");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
