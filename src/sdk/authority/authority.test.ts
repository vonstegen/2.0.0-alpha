// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md
import { describe, expect, it } from "vitest";
import { isScopeSubset, toLegacyGrant, type AuthorityGrant, type ScopedCapability } from "./index";

function baseScope(overrides: Partial<ScopedCapability> = {}): ScopedCapability {
  return {
    action: "network",
    resourceSelectors: ["https://api.example.com"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "harness-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    limits: { count: 10, costCeiling: 100 },
    networkAllowlist: ["api.example.com"],
    revocationBehavior: "cancel",
    ...overrides,
  };
}

describe("isScopeSubset (doc 08 child-cannot-widen)", () => {
  it("accepts a narrower child scope", () => {
    const parent = baseScope();
    const child = baseScope({
      limits: { count: 5, costCeiling: 50 },
    });
    expect(isScopeSubset(child, parent)).toBe(true);
  });

  it("rejects a child that widens operations", () => {
    expect(isScopeSubset(baseScope({ operations: ["read", "write"] }), baseScope())).toBe(false);
  });

  it("rejects a child that widens resource selectors", () => {
    const child = baseScope({
      resourceSelectors: ["https://api.example.com", "https://other.example.com"],
    });
    expect(isScopeSubset(child, baseScope())).toBe(false);
  });

  it("rejects a child that extends the time window", () => {
    expect(isScopeSubset(baseScope({ notBefore: "2026-08-26T00:00:00Z" }), baseScope())).toBe(false);
  });

  it("rejects a child that exceeds a limit ceiling", () => {
    const child = baseScope({ limits: { count: 5, costCeiling: 200 } });
    expect(isScopeSubset(child, baseScope())).toBe(false);
  });

  it("rejects a child that widens the network allowlist", () => {
    const child = baseScope({ networkAllowlist: ["api.example.com", "evil.example.com"] });
    expect(isScopeSubset(child, baseScope())).toBe(false);
  });

  it("rejects a sibling grant for a different action", () => {
    expect(isScopeSubset(baseScope({ action: "filesystem" }), baseScope())).toBe(false);
  });
});

describe("toLegacyGrant (doc 12 projection)", () => {
  it("projects an active grant to a granted legacy CapabilityGrant", () => {
    const grant: AuthorityGrant = { grantId: "g-1", scope: baseScope(), status: "active" };
    expect(toLegacyGrant(grant)).toEqual({
      capability: "network",
      granted: true,
      scope: "shared",
      revocationBehavior: "hard-stop",
    });
  });

  it("projects a revoked grant as not granted", () => {
    const grant: AuthorityGrant = { grantId: "g-2", scope: baseScope(), status: "revoked" };
    expect(toLegacyGrant(grant).granted).toBe(false);
  });
});
