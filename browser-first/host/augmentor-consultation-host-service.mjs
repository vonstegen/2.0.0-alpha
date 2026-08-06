import path from "node:path";

import { authenticateConsultationAccess } from "./augmentor-consultation-access.mjs";
import { consultationAnswerPolicy } from "./augmentor-consultation-answer-policy.mjs";
import { CONSULTATION_ACCESS_HEADER, CONSULTATION_AUDIENCE, DEFAULT_CONSULTATION_LIMITS, digestJson } from "./augmentor-consultation-contract.mjs";
import { AugmentorConsultationService } from "./augmentor-consultation-service.mjs";

export const AUGMENTOR_CONSULTATION_ROUTE = "/augmentor/consultation";
export const AUGMENTOR_CONSULTATION_CAPABILITY = "augmentor-consultation-read";

export function consultationRoots(userRoot) {
  const root = path.join(userRoot, "Augmentor", "Consultation");
  return { root, projectionRoot: path.join(root, "Projection"), accessRoot: path.join(userRoot, "Secrets", "AugmentorConsultation") };
}

export function createAugmentorConsultationHostService({ userRoot, service, authenticate = authenticateConsultationAccess } = {}) {
  if (typeof userRoot !== "function") throw new TypeError("userRoot must be a function");
  const roots = consultationRoots(userRoot());
  const consultationService = service ?? new AugmentorConsultationService({ projectionRoot: roots.projectionRoot });
  const clientAuthenticator = async (request) => {
    if (!request.networkContext?.isLoopback && (!request.networkContext?.isSecure || !request.networkContext?.ipAllowlistActive)) return null;
    const accessKey = request.headers[CONSULTATION_ACCESS_HEADER];
    if (!accessKey) return null;
    const grant = await authenticate({ root: roots.accessRoot, accessKey });
    return grant ? { mode: "route-client-key", capabilities: [AUGMENTOR_CONSULTATION_CAPABILITY], ...grant } : null;
  };
  const localAuthContext = () => ({
    mode: "bridge",
    opaquePrincipalRef: "local-augmentor",
    policyDigest: digestJson({ principal: "local-augmentor", policy: "all-consultation-views-v1" }),
    registryRevision: 0,
    allowedViews: ["experience", "runtime", "knowledge", "authority-bridge"],
    limits: { ...DEFAULT_CONSULTATION_LIMITS },
  });
  return {
    consultationService,
    roots,
    augmentorConsultationRoutes: [{
      method: "POST",
      path: AUGMENTOR_CONSULTATION_ROUTE,
      requiredCapability: AUGMENTOR_CONSULTATION_CAPABILITY,
      clientAuthenticator,
      localAuthContext,
      handler: async (query, request) => {
        const auth = request.authContext;
        const result = await consultationService.consult(query, {
          audience: CONSULTATION_AUDIENCE,
          opaquePrincipalRef: auth.opaquePrincipalRef,
          policyDigest: auth.policyDigest,
          registryRevision: auth.registryRevision,
          allowedViews: auth.allowedViews,
          limits: auth.limits,
          signal: request.signal,
        });
        return { consultation: result, answerPolicy: consultationAnswerPolicy(result) };
      },
    }],
  };
}
