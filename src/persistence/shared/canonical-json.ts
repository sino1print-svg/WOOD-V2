import type { Sha256 } from '../../shared/domain-model';
import { fail, ok, type PersistenceResult } from './result';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TIMESTAMP_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'uploadedAt',
  'generatedAt',
  'evaluatedAt',
  'timestamp',
  'appliedAt',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`Canonical JSON rejects ${typeof value} values.`);
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new TypeError('Raw binary values are forbidden in canonical project JSON.');
  }
  if (typeof value !== 'object') throw new TypeError('Unsupported canonical JSON value.');
  if (seen.has(value)) throw new TypeError('Canonical JSON rejects cyclic structures.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const normalized = normalize(item, seen);
        return normalized === undefined ? null : normalized;
      });
    }
    if (!isPlainObject(value)) throw new TypeError('Canonical JSON accepts plain objects only.');
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Forbidden JSON key: ${key}`);
      const normalized = normalize(value[key], seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalStringify(value: unknown): PersistenceResult<string> {
  try {
    return ok(JSON.stringify(normalize(value, new Set<object>())));
  } catch (cause) {
    return fail(
      'VALIDATION_FAILED',
      'serialize',
      cause instanceof Error ? cause.message : 'Canonical serialization failed.',
      false,
    );
  }
}

export function safeJsonParse(text: string): PersistenceResult<unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    // A normalization pass rejects prototype-pollution keys and non-plain objects.
    const normalized = normalize(parsed, new Set<object>());
    return ok(normalized);
  } catch (cause) {
    return fail(
      'CORRUPT_JSON',
      'deserialize',
      cause instanceof Error ? cause.message : 'JSON parsing failed.',
      false,
    );
  }
}

export function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): PersistenceResult<string> {
  try {
    return ok(textDecoder.decode(bytes));
  } catch (cause) {
    return fail(
      'CORRUPT_JSON',
      'deserialize',
      cause instanceof Error ? cause.message : 'Stored UTF-8 data is invalid.',
      false,
    );
  }
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Sha256> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('') as Sha256;
}

export async function sha256Text(text: string): Promise<Sha256> {
  return sha256Bytes(encodeUtf8(text));
}

export function withoutTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (!isPlainObject(value)) return value;
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    if (!TIMESTAMP_KEYS.has(key)) output[key] = withoutTimestamps(value[key]);
  }
  return output;
}

export async function deterministicContentHash(value: unknown): Promise<PersistenceResult<Sha256>> {
  const serialized = canonicalStringify(withoutTimestamps(value));
  if (!serialized.ok) return serialized;
  return ok(await sha256Text(serialized.value));
}
