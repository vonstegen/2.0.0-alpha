// Neon Postgres connection helper.
//
// DEFERRED (needs live cloud creds): actually connecting requires a real
// DATABASE_URL pointing at a Neon branch and the `@neondatabase/serverless`
// package installed (declared as an optionalDependency). Neither is available in
// this sandbox, so this factory is written production-shaped but is never invoked
// by the offline tests — those use the in-memory repository. The dynamic import
// keeps the module loadable even when the driver is absent.

/**
 * Build a `{ query(text, params) }` executor backed by Neon's serverless Pool.
 * Secrets come only from the environment (constitution Art. VIII; plan: token
 * storage = host vault / env, never committed).
 *
 * @param {string} [connectionString] defaults to process.env.DATABASE_URL
 * @returns {Promise<{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>, end: () => Promise<void> }>}
 */
export async function createNeonExecutor(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Provide a Neon Postgres connection string via the host vault / environment.",
    );
  }
  let mod;
  try {
    mod = await import("@neondatabase/serverless");
  } catch (cause) {
    throw new Error(
      "@neondatabase/serverless is not installed. Run `npm i @neondatabase/serverless` in backend/ to enable the live DB path.",
      { cause },
    );
  }
  const { Pool } = mod;
  const pool = new Pool({ connectionString });
  return {
    query: (text, params) => pool.query(text, params),
    end: () => pool.end(),
  };
}
