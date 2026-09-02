#!/usr/bin/env node
// CP-7.5.1 (Manifest Signing) CLI.
//
// Usage:
//   node scripts/sign-addon-manifest.mjs <manifest.json> <privateKey> [publicKey]
//
// - <manifest.json>  : path to a JSON file containing an add-on manifest. The
//                      file is read, canonicalized (recursively sorted keys,
//                      no whitespace, with `manifestSignature` excluded),
//                      signed, and written back in place with a
//                      `manifestSignature` block embedded.
// - <privateKey>    : Ed25519 private key as JWK JSON
//                      ({"kty":"OKP","crv":"Ed25519",...}), or PEM
//                      (`-----BEGIN PRIVATE KEY-----`), or a base64 32-byte
//                      Ed25519 seed. When given as a seed, the matching
//                      public key is derived automatically.
// - [publicKey]     : optional. The matching Ed25519 public key, either as
//                      JWK JSON, PEM (`-----BEGIN PUBLIC KEY-----`), or
//                      base64 of an SPKI DER. When omitted, the script
//                      derives it from the supplied private key.
//
// The embedded `manifestSignature` is:
//   { algorithm: "ed25519", publicKey: <string>, signature: <base64> }
//
// The signing/verification algorithm matches `canonicalizeManifestBody` in
// src/sdk/addons/validation.ts; any change on one side MUST be mirrored on
// the other.

import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { resolve } from "node:path";

const MANIFEST_SIGNATURE_FIELD = "manifestSignature";
const MANIFEST_SIGNATURE_ALGORITHM = "ed25519";

const stripSignature = (value) => {
  if (Array.isArray(value)) return value.map(stripSignature);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === MANIFEST_SIGNATURE_FIELD) continue;
      out[key] = stripSignature(value[key]);
    }
    return out;
  }
  return value;
};

const canonicalize = (manifest) => JSON.stringify(stripSignature(manifest));

const loadPrivateKey = (raw) => {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("{")) {
    return createPrivateKey({ key: JSON.parse(trimmed), format: "jwk" });
  }
  if (trimmed.startsWith("-----BEGIN")) {
    return createPrivateKey(trimmed);
  }
  const seed = Buffer.from(trimmed, "base64");
  if (seed.length !== 32) {
    throw new Error(
      `Expected 32-byte Ed25519 seed (base64) or PEM/JWK private key; got ${seed.length} bytes.`,
    );
  }
  return createPrivateKey({ key: seed, format: "jwk" });
};

const derivePublicKeyString = (privateKey, provided) => {
  if (provided) {
    const trimmed = String(provided).trim();
    if (trimmed.startsWith("{")) return JSON.stringify(JSON.parse(trimmed));
    if (trimmed.startsWith("-----BEGIN")) return trimmed;
    return trimmed;
  }
  const publicKey = createPublicKey(privateKey);
  return JSON.stringify(publicKey.export({ format: "jwk" }));
};

const main = () => {
  const [, , manifestPath, privateKeyRaw, publicKeyRaw] = process.argv;
  if (!manifestPath || !privateKeyRaw) {
    process.stderr.write(
      "Usage: node scripts/sign-addon-manifest.mjs <manifest.json> <privateKey> [publicKey]\n",
    );
    process.exit(2);
  }
  const absoluteManifest = resolve(process.cwd(), manifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifest, "utf8"));
  const privateKey = loadPrivateKey(privateKeyRaw);
  const publicKeyString = derivePublicKeyString(privateKey, publicKeyRaw);
  const payload = canonicalize(manifest);
  const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
  // Surgical in-place write: insert the manifestSignature block as the last
  // key of the root object, preserving the original formatting.
  const text = readFileSync(absoluteManifest, "utf8");
  const closing = text.match(/(\r?\n)*\}(\s*)$/);
  if (!closing) {
    throw new Error(`Cannot find root closing brace in ${manifestPath}`);
  }
  const before = text.slice(0, closing.index);
  const after = closing[2] + text.slice(closing.index + closing[0].length);
  const tail = before.trimEnd();
  const needsComma = !tail.endsWith(",");
  const block = JSON.stringify(
    { algorithm: MANIFEST_SIGNATURE_ALGORITHM, publicKey: publicKeyString, signature },
    null,
    2,
  );
  const indented = block
    .split("\n")
    .map((line, i) => (i === 0 ? line : "  " + line))
    .join("\n");
  const insertion = (needsComma ? "," : "") + "\n  \"manifestSignature\": " + indented + "\n";
  writeFileSync(absoluteManifest, before + insertion + "}" + after, "utf8");
  process.stdout.write(
    `Signed ${manifestPath} (algorithm=${MANIFEST_SIGNATURE_ALGORITHM}, sig=${signature.length} chars base64)\n`,
  );
};

try {
  main();
} catch (err) {
  process.stderr.write(`sign-addon-manifest: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
}
