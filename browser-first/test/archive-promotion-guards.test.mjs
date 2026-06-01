import assert from "node:assert/strict";
import test from "node:test";

import { assertPromotionCanRestore } from "../host/archive-promotion-guards.mjs";

test("archive promotion restore guard accepts promoted artifacts with a backup", () => {
  assert.doesNotThrow(() => assertPromotionCanRestore({
    promotionStatus: "promoted",
    rollbackStatus: "",
    backupPath: "AI_MEMORY/backups/promotions/2026-05-28/page.md",
  }));
});

test("archive promotion restore guard rejects non-promoted artifacts", () => {
  assert.throws(
    () => assertPromotionCanRestore({
      promotionStatus: "draft",
      rollbackStatus: "",
      backupPath: "AI_MEMORY/backups/promotions/2026-05-28/page.md",
    }),
    /Only promoted archive artifacts can be restored/
  );
});

test("archive promotion restore guard rejects already restored promotions", () => {
  assert.throws(
    () => assertPromotionCanRestore({
      promotionStatus: "promoted",
      rollbackStatus: "restored",
      backupPath: "AI_MEMORY/backups/promotions/2026-05-28/page.md",
    }),
    /already been restored/
  );
});

test("archive promotion restore guard requires a backup path", () => {
  assert.throws(
    () => assertPromotionCanRestore({
      promotionStatus: "promoted",
      rollbackStatus: "",
      backupPath: "",
    }),
    /no backup to restore/
  );
});
