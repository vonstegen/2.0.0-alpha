-- Community Hub — M4: moderation + erasure (spec §4.5 FR-M2, constitution Art. VII/VIII).
--
-- Events and tasks already carry a `hidden` flag (0001_init.sql). Presence did not,
-- yet the constitution (Art. VII) requires a hide path for "events, tasks, and
-- presence entries". This migration adds the missing `hidden` flag to presence so
-- a moderator can hide an abusive presence entry and it drops out of public reads,
-- exactly like a hidden event/task.
--
-- Idempotent (IF NOT EXISTS) so re-running the full migration set is safe.

ALTER TABLE presence ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS presence_hidden_idx ON presence (hidden);

-- Speed up the "resolve open reports for a target" update the hide path issues.
CREATE INDEX IF NOT EXISTS reports_unresolved_idx ON reports (target_type, target_id) WHERE resolved = false;
