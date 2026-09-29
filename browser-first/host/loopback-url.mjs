// Shared loopback target validation for host-owned credential/authority
// boundaries (SDK-DEMO-003R review R1 hardening).
//
// Replaces the earlier prefix check (`hostname.startsWith("127.")`) that
// accepted hostile hostnames such as `127.0.0.1.evil.com`, `127.evil.com`, or
// `127.attacker` because they merely start with "127.". A privileged
// credential-bearing target must be an exact, canonical loopback destination:
//
//   * scheme http:/https: only;
//   * no userinfo (username/password) — credentials are never embedded in the
//     target URL;
//   * hostname is a canonical loopback literal (`127.0.0.0/8`, `::1`) or
//     exactly `localhost`;
//   * an explicit `:0` port is rejected;
//   * for the async (credential-bearing) path, any non-literal hostname
//     (`localhost`) is DNS re-resolved and every answer must be a loopback
//     numeric address, mirroring the outbound endpoint guard in
//     `agent-runtime-endpoint.mjs`.
//
// Structural validation is synchronous and DNS-free; the async resolver adds
// DNS re-resolution for the final credential-bearing network boundary.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// Numeric-only loopback test, applied to DNS-resolved addresses or literal
// IPs. Accepts 127.0.0.0/8 and `::1` only; rejects `0.0.0.0` (bind-any),
// IPv4-mapped IPv6, and every external address.
export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".");
    return octets.length === 4 && octets[0] === "127" &&
      octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
  }
  return false;
}

// Exact canonical loopback hostname. No prefix matching: a hostname that is
// not a loopback literal (127/8 or ::1) is accepted only when it is exactly
// `localhost`.
function isCanonicalLoopbackHostname(hostname) {
  if (typeof hostname !== "string") return false;
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  return isLoopbackAddress(normalized);
}

// Synchronous structural validation of a loopback http(s) origin. Returns
// `{ origin, hostname, port }` or `null`. Does not perform DNS: use
// `resolveLoopbackHttpOrigin` for the credential-bearing boundary.
export function parseLoopbackHttpOrigin(urlString) {
  if (typeof urlString !== "string") return null;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!isCanonicalLoopbackHostname(url.hostname)) return null;
  if (url.port === "0") return null;
  return {
    origin: url.origin,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
  };
}

// Async validation for the final credential-bearing network boundary: performs
// the structural check, then re-resolves any non-literal hostname (`localhost`)
// and requires every resolved address to be loopback. Returns the origin object
// or `null`. A null result means the target must not receive host credentials.
export async function resolveLoopbackHttpOrigin(urlString, { lookup = dnsLookup } = {}) {
  const origin = parseLoopbackHttpOrigin(urlString);
  if (!origin) return null;
  const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(hostname)) return origin; // literal loopback IP, already validated
  let answers;
  try {
    answers = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!Array.isArray(answers) || !answers.length ||
      answers.some((answer) => !isLoopbackAddress(answer?.address))) {
    return null;
  }
  return origin;
}
