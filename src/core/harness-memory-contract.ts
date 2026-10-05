// Harness memory projection contract (Phase M1).
//
// Mirrors the resource / skills projection tables: a host-owned, session-bound
// projection of the harness's declared `memoryAccess` contract into a bounded
// session view that the adopted terminal can read.
//
//   MEMORY REQUEST != CAPABILITY GRANT != SESSION PROJECTION
//
// `AddOnMemoryAccessContract.archiveReadMode` describes WHAT KIND of authority
// the manifest declares (none / read-only-context / retrieval-with-citations).
// This contract describes the SESSION PROJECTION — where the approved memory
// was materialized, when it expires, and which domains it covers.
//
// Hard rules (Phase M1):
//   - Memory is projected as a FILE PATH (`ROS_MEMORY_CONTEXT` env var),
//     never as inline content / argv / env value.
//   - The context file is 0600, session-bound, written under a reviewed
//     staging root, and cleaned up on session termination.
//   - `archiveReadMode: "none"` -> no file, no projection (fail closed).
//   - The projection object carries ONLY public identifiers: a projectionId,
//     sessionId, the archiveReadMode literal, the approved domain list, and
//     the absolute file path. It NEVER carries memory content, the contents
//     of the staged context, search API tokens, or stored credentials.
//   - For `retrieval-with-citations`, the projection returns `path: null`
//     with a non-secret `not-implemented` marker (deferred retrieval).
//
// The companion implementation lives in
// `browser-first/host/harness-memory-projection.mjs`.

export type MemoryArchiveReadMode =
  | "none"
  | "read-only-context"
  | "retrieval-with-citations";

/** Approved domain identifier (top-level memory directory names). */
export type MemoryDomainId = string;

/**
 * Structured projection of an `AddOnMemoryAccessContract` into a bounded
 * session view. Carries ONLY public identifiers — never memory content,
 * search API tokens, raw memory records, or stored credentials.
 */
export interface HarnessMemoryProjection {
  /** Session-bound deterministic identity for downstream cleanup. */
  projectionId: string;
  /** The session this projection is bound to. */
  sessionId: string;
  /**
   * The declared archive read mode the projection implements. When
   * `"none"`, `path` is null and the projection is a placeholder.
   */
  archiveReadMode: MemoryArchiveReadMode;
  /**
   * Absolute file path of the staged memory-context file, or `null` when
   * the mode is `"none"` or the retrieval endpoint is not yet implemented.
   */
  path: string | null;
  /**
   * Approved memory domains included in this projection, ordered, no
   * duplicates. Empty when the mode is `"none"`. For
   * `"retrieval-with-citations"` (not yet implemented) this is empty.
   */
  domains: readonly MemoryDomainId[];
  /**
   * Session-scoped expiry ISO timestamp. After this, downstream consumers
   * must treat the projection as stale. For `archiveReadMode: "none"`
   * the expiry is the issuance time itself.
   */
  expiresAt: string;
  /**
   * Non-secret marker indicating the projection is a placeholder for a
   * read mode that is not yet implemented. Only set when
   * `archiveReadMode === "retrieval-with-citations"`. Always a fixed
   * vocabulary token, never memory content or a path.
   */
  notImplemented?: "retrieval-with-citations";
}