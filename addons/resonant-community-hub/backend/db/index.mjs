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

export async function createRepositoryFromEnv(env = process.env) {
  if (env.DATABASE_URL) {
    const db = await createNeonExecutor(env.DATABASE_URL);
    return createSqlRepository(db);
  }
  if (env.COMMUNITY_HUB_INMEMORY === "1" || env.COMMUNITY_HUB_INMEMORY === "true") {
    return createMemoryRepository(fixtures());
  }
  throw new Error(
    "No database configured. Set DATABASE_URL (Neon) for the live path, or " +
      "COMMUNITY_HUB_INMEMORY=1 to serve seeded fixtures from memory for local/preview.",
  );
}
