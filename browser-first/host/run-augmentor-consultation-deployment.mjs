#!/usr/bin/env node
import http from "node:http";
import path from "node:path";

import { consultationAnswerPolicy } from "./augmentor-consultation-answer-policy.mjs";
import {
  CONSULTATION_AUDIENCE,
  DEFAULT_CONSULTATION_LIMITS,
  digestJson,
} from "./augmentor-consultation-contract.mjs";
import { AugmentorConsultationService } from "./augmentor-consultation-service.mjs";

export const DEPLOYMENT_PRINCIPAL_HEADER = "x-resonantos-consultation-principal";

function writeJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const error = new Error("Consultation request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Consultation request body must be valid JSON.");
    error.code = "INVALID_JSON";
    throw error;
  }
}

export function createAugmentorConsultationDeploymentHandler({
  service,
  trustedPrincipal = "augmentor",
  maxBodyBytes = 65536,
} = {}) {
  if (!service || typeof service.consult !== "function") throw new TypeError("consultation service is required");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(trustedPrincipal)) throw new TypeError("trusted deployment principal is invalid");
  const policyDigest = digestJson({ deploymentPrincipal: trustedPrincipal, policy: "fixed-basic-auth-all-views-v1" });
  return async function handle(request, response) {
    const pathname = new URL(request.url ?? "/", "http://consultation.invalid").pathname;
    if (pathname === "/healthz") {
      writeJson(response, 200, { ok: true, service: "augmentor-consultation" });
      return;
    }
    if (pathname !== "/augmentor/consultation") {
      writeJson(response, 404, { ok: false, error: "Not found." });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      writeJson(response, 405, { ok: false, error: "Method not allowed." });
      return;
    }
    if (request.headers[DEPLOYMENT_PRINCIPAL_HEADER] !== trustedPrincipal) {
      writeJson(response, 401, { ok: false, error: "Unauthorized consultation request." });
      return;
    }
    const abortController = new AbortController();
    const abort = () => abortController.abort(new Error("Consultation client disconnected."));
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      const query = await readJsonBody(request, maxBodyBytes);
      const consultation = await service.consult(query, {
        audience: CONSULTATION_AUDIENCE,
        opaquePrincipalRef: "shared-basic-auth",
        policyDigest,
        registryRevision: 1,
        allowedViews: ["experience", "runtime", "knowledge", "authority-bridge"],
        limits: { ...DEFAULT_CONSULTATION_LIMITS },
        signal: abortController.signal,
      });
      writeJson(response, 200, { ok: true, consultation, answerPolicy: consultationAnswerPolicy(consultation) });
    } catch (error) {
      const status = error?.code === "BODY_TOO_LARGE" ? 413 : error?.code === "INVALID_JSON" ? 400 : 500;
      writeJson(response, status, { ok: false, error: status === 500 ? "Consultation service unavailable." : error.message });
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  };
}

export function startAugmentorConsultationDeploymentServer({
  projectionRoot,
  trustedPrincipal,
  host = "127.0.0.1",
  port = 8787,
} = {}) {
  const service = new AugmentorConsultationService({ projectionRoot });
  const server = http.createServer(createAugmentorConsultationDeploymentHandler({ service, trustedPrincipal }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const projectionRoot = process.env.AUGMENTOR_CONSULTATION_PROJECTION_ROOT;
  const trustedPrincipal = process.env.AUGMENTOR_CONSULTATION_TRUSTED_PRINCIPAL ?? "augmentor";
  const port = Number(process.env.AUGMENTOR_CONSULTATION_PORT ?? 8787);
  if (!projectionRoot || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AUGMENTOR_CONSULTATION_PROJECTION_ROOT and a valid port are required.");
  }
  const server = await startAugmentorConsultationDeploymentServer({ projectionRoot, trustedPrincipal, port });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
