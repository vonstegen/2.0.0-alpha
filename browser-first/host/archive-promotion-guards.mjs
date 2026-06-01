export function assertPromotionCanRestore({ promotionStatus, rollbackStatus, backupPath } = {}) {
  if (promotionStatus !== "promoted") {
    throw new Error("Only promoted archive artifacts can be restored.");
  }
  if (rollbackStatus === "restored") {
    throw new Error("This promotion has already been restored.");
  }
  if (!backupPath) {
    throw new Error("This promotion has no backup to restore.");
  }
}
