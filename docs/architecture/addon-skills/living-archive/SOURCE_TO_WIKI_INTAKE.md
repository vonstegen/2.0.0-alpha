# Source To Wiki Intake Skill

Use when Living Archive processes source material into AI Memory.

Rules:
- Preserve original human/external source material before AI interpretation.
- Classify Human Knowledge, External Knowledge, and AI Memory boundaries.
- Produce reviewable intake artifacts before trusted wiki promotion.
- Maintain provenance, source hashes, index updates, and log entries.
- Never let ordinary add-ons write trusted knowledge pages directly.

Source import modes:
- Source IDs must include a stable hash of the full resolved path, not only a truncated readable slug, so deeply nested folders with the same prefix cannot overwrite each other.
- `copy-on-import` is the default safe path. ResonantOS copies the selected folder or vault into managed Memory and that managed copy becomes the active source for AI Memory work.
- `linked-readonly` leaves the source in place and allows read/review flows only. It is useful for temporary or externally managed folders, but it is not the preferred long-term canonical knowledge base.
- `move-on-import` is higher risk and must never be saved as an ordinary settings preference. It is allowed only through the host-mediated preflight, exact confirmation, execute, and rollback flow.

Source sync rules:
- `manual-review` scans connected sources and reports new/changed candidates without importing them automatically.
- `auto-intake-review` may create governed intake artifacts and review requests for new/changed compatible files when auto-sync is enabled.
- Auto-sync never writes trusted wiki pages directly. It stops at intake artifacts plus review requests; draft, verifier, and promotion rules still apply.
- `paused` must not review or import source files.
- After selected source-file intake, the UI must refresh the source review so files that were just imported become `unchanged` instead of remaining stale `changed` candidates.
- Every source sync must append a bounded redacted history entry under `Memory/CONFIG/source-sync-history.json` so the user can inspect the last sync outcome without reading raw logs. The file must retain no more than 50 entries and must store source paths as redacted aliases, not full local filesystem paths.
- The Living Archive workspace must show recent source sync history next to connected sources and offer the same governed "Run Sync Now" path as Settings. This keeps source ingestion observable from the operational memory surface, not only from configuration.
- Source sync history may store capped relative file samples, created intake artifact paths, rejection reasons, and per-source counts for drill-down. It must not store full source root paths or unbounded file lists.
- If the source-version manifest is unreadable, compatible source files must be blocked as `version-manifest-unavailable`; they must not be treated as new files. Repair requires the explicit governed `REPAIR SOURCE VERSIONS` path, which backs up the corrupt manifest under `CONFIG/source-file-history/repairs/` before resetting tracking.
- Every source-version repair must append a bounded redacted history entry under `Memory/CONFIG/source-version-repairs.json`. Settings and the Living Archive workspace must show the latest repair status, source id, redacted source alias, and backup path so the user and Resonant Engineer Agent can audit repairs after transient UI messages disappear.

Move-on-import invariants:
- Preflight must reject broad roots, system folders, existing Memory roots, symlinks, non-regular files, destination conflicts, and unreadable entries.
- The confirmation phrase must match the approved preflight exactly, for example `MOVE Vault Name`.
- Execution must bind to the approved content-hash-backed preflight fingerprint and reject stale or changed sources before moving.
- The host must preserve folder structure, Obsidian dotfolders, hidden files, and empty folders.
- Destination bytes must be verified after every move or copy-unlink fallback.
- The host must write a manifest and append-only JSONL rollback ledger before registering the moved destination as canonical.
- Every move execute and rollback must append a bounded redacted entry under `Memory/CONFIG/source-move-history.json`. The UI must show the latest move status, redacted original source alias, managed Memory destination, and ledger path so the user can audit where the source moved and how rollback would be performed.
- Partial failure must automatically rollback already-moved files/directories where possible and report any skipped cleanup instead of silently deregistering the source.
- The UI must surface failure/rollback status and let the user retry or inspect the source; it must not leave the move action stuck disabled after a failed execute.
- Rollback must use the scoped ledger path under `Memory/CONFIG/move-imports`, require `ROLLBACK MOVE`, verify destination hashes, restore the original source path, and deregister only when no files, folders, or root cleanup steps were skipped.
