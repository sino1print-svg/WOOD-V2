const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 64;
const MAX_ARRAY = 1_000;
const MAX_KEYS = 20_000;
const MAX_OBJECTS = 5_000;

export type RuntimeInspectionFailure = 'unsafe' | 'limit' | null;

interface Budget {
  keys: number;
  objects: number;
}

function arrayIndex(key: string, length: number): boolean {
  if (key === '') return false;
  const numeric = Number(key);
  return (
    Number.isSafeInteger(numeric) && numeric >= 0 && numeric < length && String(numeric) === key
  );
}

function inspect(
  value: unknown,
  active: WeakSet<object>,
  budget: Budget,
  depth: number,
): RuntimeInspectionFailure {
  if (depth > MAX_DEPTH) return 'limit';
  if (value === null || typeof value !== 'object') return null;
  if (active.has(value)) return 'unsafe';
  budget.objects += 1;
  if (budget.objects > MAX_OBJECTS) return 'limit';

  active.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype) return 'unsafe';

    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) return 'unsafe';
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    budget.keys += names.length;
    if (budget.keys > MAX_KEYS) return 'limit';
    if (names.some((key) => DANGEROUS_KEYS.has(key))) return 'unsafe';

    if (isArray) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !('value' in lengthDescriptor)) return 'unsafe';
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY) return 'limit';
      const elements = names.filter((key) => key !== 'length');
      if (elements.length !== length || elements.some((key) => !arrayIndex(key, length))) {
        return 'unsafe';
      }
    }

    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !('value' in descriptor)) return 'unsafe';
      if (name !== 'length' && descriptor.enumerable !== true) return 'unsafe';
      const nested = inspect(descriptor.value, active, budget, depth + 1);
      if (nested) return nested;
    }
    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

export function inspectRuntimeInput(value: unknown): RuntimeInspectionFailure {
  return inspect(value, new WeakSet<object>(), { keys: 0, objects: 0 }, 0);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): string | null {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) return key;
  for (const key of required) if (!hasOwn(value, key)) return key;
  return null;
}

export function isDenseArray(value: unknown, maximum = MAX_ARRAY): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > maximum) return false;
  const keys = Object.keys(value);
  return keys.length === value.length && keys.every((key) => arrayIndex(key, value.length));
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child, seen);
  return Object.freeze(value);
}

export function ownedFrozenClone<T>(value: T): T | null {
  try {
    return freezeDeep(structuredClone(value));
  } catch {
    return null;
  }
}
