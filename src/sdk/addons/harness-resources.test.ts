// Intent citation: docs/architecture/ADR-042-generic-harness-resource-request.md

import { describe, expect, it } from "vitest";
import type { AddOnHarnessResourceRequestContract, CapabilityGrant } from "../../core/contracts";
import {
  createHarnessResourceProjection,
  normalizeHarnessResourceRequest,
  resolveHarnessResourceGrants,
} from "../../../packages/addon-sdk/src/harness-resources.ts";

const piStyleRequest = (): AddOnHarnessResourceRequestContract => ({
  requests: {
    project: ["read", "context"],
    files: ["read", "write"],
    skills: ["list", "read"],
    memory: ["search", "read"],
    tools: ["list", "invoke"],
  },
});

const grantedCapabilities = (capabilities: string[]): CapabilityGrant[] =>
  capabilities.map((capability) => ({ capability, granted: true, scope: "system", revocationBehavior: "hard-stop" }) as CapabilityGrant);

describe("normalizeHarnessResourceRequest", () => {
  it("normalizes a canonical Pi-style request", () => {
    const result = normalizeHarnessResourceRequest(piStyleRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(piStyleRequest());
    }
  });

  it("accepts a partial request naming only some families", () => {
    const result = normalizeHarnessResourceRequest({ requests: { project: ["read"], memory: ["search"] } });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object block", () => {
    const result = normalizeHarnessResourceRequest("project");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("harness-resources-object");
  });

  it("rejects unknown top-level fields so no credential/provider/command channel can ride through", () => {
    for (const block of [
      { requests: { project: ["read"] }, credentials: { token: "x" } },
      { requests: { project: ["read"] }, provider: "openai" },
      { requests: { project: ["read"] }, model: "gpt-5" },
      { requests: { project: ["read"] }, command: "/bin/sh" },
    ]) {
      const result = normalizeHarnessResourceRequest(block);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((issue) => issue.code === "harness-resources-field")).toBe(true);
    }
  });

  it("rejects unknown resource families", () => {
    const result = normalizeHarnessResourceRequest({ requests: { "user-profile": ["read"] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "harness-resources-unknown-family")).toBe(true);
  });

  it("rejects operations outside a family's allowlist", () => {
    const cases: Array<[string, string[]]> = [
      ["project", ["delete"]],
      ["files", ["execute"]],
      ["skills", ["invoke"]],
      ["memory", ["write"]],
      ["tools", ["exec"]],
    ];
    for (const [family, operations] of cases) {
      const result = normalizeHarnessResourceRequest({ requests: { [family]: operations } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((issue) => issue.code === "harness-resources-unknown-operation")).toBe(true);
    }
  });

  it("rejects empty family declarations", () => {
    const result = normalizeHarnessResourceRequest({ requests: { files: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "harness-resources-empty-family")).toBe(true);
  });

  it("rejects duplicate operations", () => {
    const result = normalizeHarnessResourceRequest({ requests: { files: ["read", "read"] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "harness-resources-duplicate-operation")).toBe(true);
  });

  it("rejects paths, credentials, commands, and object tool declarations", () => {
    const cases = [
      { requests: { files: ["/etc/passwd"] } },
      { requests: { files: ["~/secrets/.env"] } },
      { requests: { memory: ["AWS_SECRET_ACCESS_KEY"] } },
      { requests: { tools: [{ name: "bash", command: "rm -rf /" }] } },
    ];
    for (const block of cases) {
      const result = normalizeHarnessResourceRequest(block);
      expect(result.ok).toBe(false);
    }
  });
});

describe("resolveHarnessResourceGrants", () => {
  it("grants only operations whose backing capability is granted", () => {
    const grants = resolveHarnessResourceGrants(piStyleRequest(), grantedCapabilities(["filesystem", "archive-read"]));
    const grantedFor = (family: string) =>
      grants.filter((grant) => grant.family === family && grant.granted).map((grant) => grant.operation);
    expect(grantedFor("project")).toEqual(["read", "context"]);
    expect(grantedFor("files")).toEqual(["read", "write"]);
    expect(grantedFor("memory")).toEqual(["search", "read"]);
  });

  it("fails closed for ungranted capabilities", () => {
    const grants = resolveHarnessResourceGrants(piStyleRequest(), grantedCapabilities([]));
    expect(grants.every((grant) => grant.granted === false)).toBe(true);
  });

  it("fails closed for families without a single backing capability (skills, tools)", () => {
    const grants = resolveHarnessResourceGrants(piStyleRequest(), grantedCapabilities(["filesystem", "archive-read", "agent-runtime"]));
    for (const grant of grants.filter((grant) => grant.family === "skills" || grant.family === "tools")) {
      expect(grant.granted).toBe(false);
      expect(grant.grant).toBeNull();
    }
  });
});

describe("createHarnessResourceProjection", () => {
  it("projects only granted operations and fails closed otherwise", () => {
    const grants = resolveHarnessResourceGrants(piStyleRequest(), grantedCapabilities(["filesystem"]));
    const projections = createHarnessResourceProjection(piStyleRequest(), grants);
    const project = projections.find((projection) => projection.family === "project");
    const memory = projections.find((projection) => projection.family === "memory");
    expect(project?.granted).toBe(true);
    expect(project?.operations).toEqual(["read", "context"]);
    expect(memory?.granted).toBe(false);
    expect(memory?.operations).toEqual([]);
  });

  it("marks a family granted only when every requested operation is granted", () => {
    const request: AddOnHarnessResourceRequestContract = { requests: { files: ["read", "write"] } };
    const grants = resolveHarnessResourceGrants(request, grantedCapabilities(["filesystem"]));
    const projections = createHarnessResourceProjection(request, grants);
    expect(projections).toHaveLength(1);
    expect(projections[0].granted).toBe(true);
  });
});
