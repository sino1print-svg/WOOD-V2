const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_RUNTIME_DEPTH = 72;
const MAX_RUNTIME_ARRAY_LENGTH = 20_000;
const MAX_RUNTIME_OBJECTS = 100_000;
const MAX_RUNTIME_KEYS = 500_000;
const MAX_RUNTIME_STRING_CODE_UNITS = 128 * 1024 * 1024;
const encoder = new TextEncoder();

interface RuntimeBudget {
  objects: number;
  keys: number;
  stringCodeUnits: number;
}

export type ExportRuntimeInspection = 'unsafe' | 'limit' | null;

function isArrayIndex(key: string, length: number): boolean {
  if (key.length === 0) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < length && String(value) === key;
}

function inspectValue(
  value: unknown,
  active: WeakSet<object>,
  budget: RuntimeBudget,
  depth: number,
): ExportRuntimeInspection {
  if (depth > MAX_RUNTIME_DEPTH) return 'limit';
  if (typeof value === 'string') {
    budget.stringCodeUnits += value.length;
    return budget.stringCodeUnits > MAX_RUNTIME_STRING_CODE_UNITS ? 'limit' : null;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return null;
  }
  if (typeof value !== 'object') return 'unsafe';
  if (active.has(value)) return 'unsafe';

  budget.objects += 1;
  if (budget.objects > MAX_RUNTIME_OBJECTS) return 'limit';
  active.add(value);
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    ) {
      return 'unsafe';
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return 'unsafe';

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    budget.keys += names.length;
    if (budget.keys > MAX_RUNTIME_KEYS) return 'limit';
    if (names.some((key) => DANGEROUS_KEYS.has(key))) return 'unsafe';

    if (array) {
      const length = descriptors.length;
      if (!length || !('value' in length) || !Number.isSafeInteger(length.value)) return 'unsafe';
      if (length.value < 0 || length.value > MAX_RUNTIME_ARRAY_LENGTH) return 'limit';
      const elements = names.filter((name) => name !== 'length');
      if (
        elements.length !== length.value ||
        elements.some((name) => !isArrayIndex(name, length.value))
      ) {
        return 'unsafe';
      }
    }

    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !('value' in descriptor)) return 'unsafe';
      if (name !== 'length' && descriptor.enumerable !== true) return 'unsafe';
      const nested = inspectValue(descriptor.value, active, budget, depth + 1);
      if (nested) return nested;
    }
    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

/** Reject accessors, proxies, cycles, sparse arrays, prototypes, symbols, and bombs. */
export function inspectExportRuntimeValue(value: unknown): ExportRuntimeInspection {
  return inspectValue(value, new WeakSet<object>(), { objects: 0, keys: 0, stringCodeUnits: 0 }, 0);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isDenseArray(value: unknown, maximum: number): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || value.length > maximum) return false;
  const keys = Object.keys(value);
  return keys.length === value.length && keys.every((key) => isArrayIndex(key, value.length));
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    required.every((key) => hasOwn(value, key))
  );
}

export function validId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return false;
  if (DANGEROUS_KEYS.has(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

export function validText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    !value.includes('\u0000')
  );
}

export function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  return new Date(milliseconds).toISOString() === value;
}

export function validPositiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum;
}

export function uniqueIds(value: unknown, maximum: number): value is readonly string[] {
  return (
    isDenseArray(value, maximum) && value.every(validId) && new Set(value).size === value.length
  );
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/** Ordinal comparison of UTF-8 bytes; never locale collation. */
export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child, seen);
  return Object.freeze(value);
}
