// First-party sdk-demo convenience ONLY — never a third-party add-on
// delivery path. The REF boundary stays declarative: the bridge does not
// spawn add-on processes, and external operator-started upstreams remain
// the canonical way to run a local-service add-on. This helper exists so
// the four FIRST-PARTY demo upstreams (echo, counter, sdk-guide, pi —
// code that ships in this repo and is already trusted with the bridge's
// own demo tokens) can run in-process when the operator has not started
// them manually. Embedding preserves every enforcement property:
//   - each upstream keeps its own loopback PORT (distinct origin),
//   - bearer tokens still gate mutating routes (401 on wrong audience),
//   - admin tokens stay host-side and drive /admin/deny (403 on revoke),
//   - an already-listening external upstream ALWAYS wins; embedding never
//     replaces or shadows it.

const DEFAULT_PROBE_TIMEOUT_MS = 750;

/**
 * Default health probe: any HTTP response from the declared loopback port
 * means something is already serving that origin, so the external upstream
 * wins. Connection-refused/timeout means the port is free to embed.
 */
const defaultProbe = async ({ port, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { occupied: true, status: res.status };
  } catch {
    return { occupied: false };
  }
};

/**
 * For each upstream spec, decide: skip (no bearer configured), defer to an
 * external listener, or embed in-process. Never throws — a failed embed is
 * reported, not fatal, because the bridge's other services must still boot.
 *
 * @param {object} args
 * @param {Array<{addonId: string, port: number, bearerToken: string,
 *   adminToken: string, create: (opts: {port: number, bearerToken: string,
 *   adminToken: string}) => {start: () => Promise<unknown>, close: () => Promise<unknown>}>} args.upstreams
 * @param {(target: {port: number}) => Promise<{occupied: boolean, status?: number}>} [args.probe]
 * @param {(line: string) => void} [args.log]
 * @returns {Promise<{started: Array<{addonId: string, port: number, close: () => Promise<unknown>}>,
 *   decisions: Array<{addonId: string, action: string, detail?: string}>}>}
 */
export async function maybeEmbedDemoUpstreams({ upstreams, probe = defaultProbe, log = () => {} } = {}) {
  const started = [];
  const decisions = [];
  for (const upstream of upstreams) {
    const { addonId, port, bearerToken, adminToken, create } = upstream;
    if (!bearerToken) {
      decisions.push({ addonId, action: "skipped", detail: "no bearer token configured" });
      log(`${addonId}: skipped (no bearer token configured)`);
      continue;
    }
    const probeResult = await probe({ port });
    if (probeResult.occupied) {
      decisions.push({ addonId, action: "external", detail: `port ${port} already serving (status ${probeResult.status ?? "unknown"})` });
      log(`${addonId}: external upstream already listening on :${port} — using it`);
      continue;
    }
    try {
      const service = create({ port, bearerToken, adminToken });
      await service.start();
      started.push({ addonId, port, close: () => service.close() });
      decisions.push({ addonId, action: "embedded", detail: `in-process on :${port}` });
      log(`${addonId}: no upstream found — embedded in-process on :${port}`);
    } catch (error) {
      decisions.push({ addonId, action: "embed-failed", detail: String(error?.message ?? error) });
      log(`${addonId}: embed FAILED on :${port} (${String(error?.message ?? error)}) — bridge continues without it`);
    }
  }
  return { started, decisions };
}
