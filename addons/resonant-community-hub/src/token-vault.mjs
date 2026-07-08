// Per-user session-token vault for the Community Hub host (M3).
//
// Constitution Art. VIII + plan "Token storage = host vault / user-config scope":
// the per-member session token (minted by the backend after GitHub OAuth) is a
// secret. It is held ONLY in host memory / an injected host-vault handle and is
// NEVER written to the repo, a committed config file, or the extension. This
// mirrors provider-bridge-service.mjs, which keeps provider credentials session-only
// in host memory and reads bootstrap secrets from the environment.
//
// The vault is deliberately tiny and swappable: the default is in-memory, but a
// host can inject `storage` (e.g. an OS keychain adapter) with the same get/set/
// clear shape without touching any caller.

/**
 * @param {object} [opts]
 * @param {string} [opts.initialToken]  seed token (e.g. restored by the host on boot)
 * @param {NodeJS.ProcessEnv} [opts.env] read COMMUNITY_HUB_MEMBER_TOKEN as a boot secret
 * @param {{ get(): (string|null), set(t: string|null): void }} [opts.storage] injectable backing store
 */
export function createTokenVault({ initialToken, env = process.env, storage } = {}) {
  // In-memory default backing store (session-only, never persisted to disk).
  let mem = null;
  const backing = storage ?? {
    get: () => mem,
    set: (t) => {
      mem = t;
    },
  };

  const seed = initialToken ?? (env.COMMUNITY_HUB_MEMBER_TOKEN ? String(env.COMMUNITY_HUB_MEMBER_TOKEN).trim() : null);
  if (seed) backing.set(seed);

  return {
    /** @returns {string|null} */
    get() {
      const t = backing.get();
      return t ? String(t) : null;
    },
    hasToken() {
      return Boolean(backing.get());
    },
    set(token) {
      const t = String(token ?? "").trim();
      if (!t) throw new Error("Cannot store an empty member token.");
      backing.set(t);
    },
    clear() {
      backing.set(null);
    },
  };
}
