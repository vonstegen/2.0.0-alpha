// Intent citation: docs/architecture/resonantos-browser-architecture/14-master-phased-implementation-checklist.md
//
// Route-by-route compatibility telemetry (CP-2 work item, WP-2f). The bridge
// enforces privileged effects through two paths during the migration:
//
//   governed  — the CP-2/CP-3 task-grant envelope (dispatchGoverned*). The new
//               path: authority comes from an opaque grant handle, validated at
//               the effect boundary.
//   legacy    — the Phase 3.5 caller-attributed capability token
//               (`requiredCapability`). The foundation, retained during
//               migration, removed only after the governed path reaches parity.
//   ungated   — read-only/status/dev routes that enforce no privileged effect.
//
// `collectRouteEnforcementTelemetry` reports the migration baseline so a
// launcher can refuse to remove a legacy path before parity (legacy === 0).

export function classifyRouteEnforcement(route) {
  if (route?.enforcement === "governed") return "governed";
  if (route?.requiredCapability != null) return "legacy";
  return "ungated";
}

export function collectRouteEnforcementTelemetry(routes) {
  const rows = (routes ?? []).map((route) => ({
    method: route.method,
    path: route.path,
    enforcement: classifyRouteEnforcement(route),
  }));
  const governed = rows.filter((row) => row.enforcement === "governed");
  const legacy = rows.filter((row) => row.enforcement === "legacy");
  const ungated = rows.filter((row) => row.enforcement === "ungated");
  return {
    total: rows.length,
    governed: governed.length,
    legacy: legacy.length,
    ungated: ungated.length,
    // A launcher may only remove legacy paths once no legacy route remains.
    migrationComplete: legacy.length === 0,
    governedRoutes: governed.map((row) => `${row.method} ${row.path}`),
    legacyRoutes: legacy.map((row) => `${row.method} ${row.path}`),
    ungatedRoutes: ungated.map((row) => `${row.method} ${row.path}`),
  };
}
