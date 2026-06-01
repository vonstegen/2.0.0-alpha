export function assertMemorySettingsSourceCanSave(source = {}) {
  if (source?.importMode === "move-on-import") {
    throw new Error("Move-on-import sources must use the audited move preflight and execute flow.");
  }
}
