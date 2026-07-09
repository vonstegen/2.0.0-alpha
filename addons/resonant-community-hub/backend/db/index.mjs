// Repository factory: choose an implementation from the environment.
//
// Selection (no fake cloud calls — fail loud when misconfigured):
//   1. DATABASE_URL set              -> real Neon Postgres SQL repository.
//   2. COMMUNITY_HUB_INMEMORY=1      -> in-memory repository seeded from fixtures
//                                       (explicit local/preview fallback so the
//                                       public read path is demonstrable offline).
//   3. otherwise                     -> throw a clear configuration error.
//
// The Vercel Functions call this once and cache the result per warm instance.

import { createSqlRepository } from "../src/sql-repository.mjs";
import { createMemoryRepository } from "../src/repository.mjs";
import { createNeonExecutor } from "./neon.mjs";
import { fixtures } from "../seed/fixtures.mjs";

// Opt-in process-wide shared in-memory repository. Live Neon is one shared DB, but
// the in-memory fallback returns a fresh store per call — so in a single-process
// local host that mounts every /v1 function together, a POST and a later GET would
// hit different stores and writes would never reflect in reads. Setting
// COMMUNITY_HUB_SHARED_MEMORY=1 (the local dev server does) makes every in-memory
// resolution return ONE seeded store, so the offline end-to-end write->read loop is
// demonstrable. Default (unset) behaviour is unchanged: a fresh store per call, so
// the test suite keeps its per-call isolation.
let sharedMemoryRepo;

function useSharedMemory(env) {
  return env.COMMUNITY_HUB_SHARED_MEMORY === "1" || env.COMMUNITY_HUB_SHARED_MEMORY === "true";
}

export async function createRepositoryFromEnv(env = process.env) {
  if (env.DATABASE_URL) {
    const db = await createNeonExecutor(env.DATABASE_URL);
    return createSqlRepository(db);
  }
  if (env.COMMUNITY_HUB_INMEMORY === "1" || env.COMMUNITY_HUB_INMEMORY === "true") {
    if (useSharedMemory(env)) {
      sharedMemoryRepo ??= createMemoryRepository(fixtures());
      return sharedMemoryRepo;
    }
    return createMemoryRepository(fixtures());
  }
  throw new Error(
    "No database configured. Set DATABASE_URL (Neon) for the live path, or " +
      "COMMUNITY_HUB_INMEMORY=1 to serve seeded fixtures from memory for local/preview.",
  );
}

/** Test/dev hook: drop the shared in-memory store so a fresh seed is built next call. */
export function _resetSharedMemoryRepo() {
  sharedMemoryRepo = undefined;
}
