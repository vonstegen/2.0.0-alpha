// Host-only custody. A binding is operator configuration, never manifest authority.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { sanitizeOpenCodePayload } from './opencode-boundary.mjs';
import { publicHarnessError } from './harness-adapter-contract.mjs';

const MAX_SECRET_BYTES = 8192;
const fail = code => Object.assign(new Error(publicHarnessError({ code }).message), { code });

async function readSecret(source, env) {
  if (!source || Object.keys(source).length !== 1) throw fail('runtime-unavailable');
  let value;
  if (typeof source.env === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(source.env)) value = env[source.env];
  else if (typeof source.file === 'string' && isAbsolute(source.file)) {
    // O_NONBLOCK prevents a substituted FIFO from blocking before fstat.
    const file = await open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_SECRET_BYTES || (stat.mode & 0o077) !== 0 ||
          (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw fail('runtime-unavailable');
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_SECRET_BYTES) throw fail('runtime-unavailable');
      value = buffer.subarray(0, size).toString('utf8');
    } finally { buffer.fill(0); await file.close(); }
  }
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_SECRET_BYTES) throw fail('runtime-unavailable');
  value = value.trim();
  if (!value || !/^[\x21-\x7e]+$/.test(value)) throw fail('runtime-unavailable');
  return value;
}

export function createHarnessCredentials({ bindings = [], env = process.env, resolveProviderProfileCredential } = {}) {
  const approved = new Map();
  for (const binding of structuredClone(bindings)) {
    if (!binding || typeof binding.name !== 'string' || approved.has(binding.name) ||
        !['addonId', 'adapterId', 'authScheme'].every(key => typeof binding[key] === 'string' && binding[key])) throw fail('permission-denied');
    const isProviderProfile = Boolean(binding.source && typeof binding.source.providerProfileId === 'string' && binding.source.providerProfileId);
    // provider-profile bindings derive their endpoint from the approved provider
    // profile; every other binding must pin an exact host-approved endpoint.
    if (!isProviderProfile && (typeof binding.endpoint !== 'string' || !binding.endpoint)) throw fail('permission-denied');
    if (isProviderProfile && binding.endpoint !== undefined) throw fail('permission-denied');
    approved.set(binding.name, binding);
  }
  // Validate and bound provider-store material to the same limits as env/file
  // secrets so a misconfigured profile can never widen the credential boundary.
  const validActionToken = value => typeof value === 'string' && value && Buffer.byteLength(value) <= MAX_SECRET_BYTES && /^[\x21-\x7e]+$/.test(value);
  return Object.freeze({
    async acquire({ addonId, runtime } = {}) {
      const binding = approved.get(runtime?.credentialBinding);
      if (!binding || addonId !== binding.addonId ||
          ['adapterId', 'authScheme'].some(key => runtime?.[key] !== binding[key])) throw fail('permission-denied');
      let endpoint;
      let actionToken;
      const providerProfileId = binding.source && typeof binding.source.providerProfileId === 'string' ? binding.source.providerProfileId : '';
      if (providerProfileId) {
        // Host-owned provider profile: the manifest names a non-secret binding,
        // the host resolves the approved profile's credential + endpoint. A
        // caller cannot swap the profile id or propose an endpoint here.
        if (runtime.credentialSource !== 'provider-profile') throw fail('permission-denied');
        if (typeof resolveProviderProfileCredential !== 'function') throw fail('runtime-unavailable');
        let resolved;
        try { resolved = await resolveProviderProfileCredential(providerProfileId); }
        catch { throw fail('runtime-unavailable'); }
        endpoint = typeof resolved?.endpoint === 'string' ? resolved.endpoint : '';
        actionToken = resolved?.actionToken;
        if (!endpoint || !validActionToken(actionToken)) throw fail('runtime-unavailable');
      } else {
        if (runtime.endpoint !== binding.endpoint) throw fail('permission-denied');
        endpoint = binding.endpoint;
        try { actionToken = await readSecret(binding.source, env); }
        catch { throw fail('runtime-unavailable'); }
      }
      let disposed = false;
      const forbidden = new Set();
      function remember(value) {
        if (disposed || typeof value !== 'string' || !value || Buffer.byteLength(value) > MAX_SECRET_BYTES) throw fail('runtime-unavailable');
        // Reuse #447's recursive key/value sanitizer, including URL/JSON/unicode
        // encodings. Include base64 encodings used by credential headers too.
        forbidden.add(value);
        forbidden.add(Buffer.from(value).toString('base64'));
        forbidden.add(Buffer.from(value).toString('base64url'));
      }
      remember(actionToken);
      return Object.freeze({
        async use(callback) {
          if (disposed) throw fail('runtime-unavailable');
          return callback({ endpoint, actionToken });
        },
        remember,
        sanitize(value) {
          try { return sanitizeOpenCodePayload(value, [...forbidden]); }
          catch { throw fail('runtime-unavailable'); }
        },
        // Keep redaction patterns until this lease is collected: late output
        // after revocation must still be safe. Never persist the lease.
        dispose() { disposed = true; actionToken = ''; },
      });
    },
  });
}
