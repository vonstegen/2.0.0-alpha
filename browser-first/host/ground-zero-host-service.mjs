// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
//
// Ground-0 host routes. Entry/exit are Core-owned recovery controls, so they
// are gated by a dedicated `ground-zero-control` capability (not an add-on
// runtime capability): entering Ground-0 revokes every grant and disabling it
// is the most privileged action the bridge exposes. Status is read-only and
// gated by `ground-zero-read`.

export function createGroundZeroHostService({
  executeGroundZeroEnter,
  executeGroundZeroExit,
  executeGroundZeroStatus,
} = {}) {
  const handlers = { executeGroundZeroEnter, executeGroundZeroExit, executeGroundZeroStatus };
  for (const name of Object.keys(handlers)) {
    if (typeof handlers[name] !== "function") {
      throw new Error(`Ground-0 host service missing handler: ${name}`);
    }
  }

  return {
    groundZeroRoutes: [
      {
        method: "POST",
        path: "/ground-zero/enter",
        requiredCapability: "ground-zero-control",
        handler: executeGroundZeroEnter,
      },
      {
        method: "POST",
        path: "/ground-zero/exit",
        requiredCapability: "ground-zero-control",
        handler: executeGroundZeroExit,
      },
      {
        method: "GET",
        path: "/ground-zero/status",
        requiredCapability: "ground-zero-read",
        handler: executeGroundZeroStatus,
      },
    ],
  };
}
