// Canonical serialization + hashing.
// Every hash in SINO APEX is derived through this module so that evidence,
// ledger entries, and verifier re-derivations agree byte-for-byte.
import crypto from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted at every depth, no incidental
 * whitespace. Two structurally equal values always produce the same string.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/** Content hash of any structured value. */
export function contentHash(value) {
  return sha256(canonicalJson(value));
}

/** Constant-time string comparison for authorization-relevant tokens. */
export function timingSafeEqualString(a, b) {
  const ha = crypto
    .createHash('sha256')
    .update(String(a ?? ''))
    .digest();
  const hb = crypto
    .createHash('sha256')
    .update(String(b ?? ''))
    .digest();
  return crypto.timingSafeEqual(ha, hb);
}
