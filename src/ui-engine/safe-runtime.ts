export type SafeInspectionFailure =
  | 'NOT_OBJECT'
  | 'NOT_PLAIN_OBJECT'
  | 'UNEXPECTED_KEY'
  | 'MISSING_KEY'
  | 'SYMBOL_KEY'
  | 'ACCESSOR_PROPERTY'
  | 'UNSAFE_DESCRIPTOR'
  | 'REFLECTION_ERROR'
  | 'NOT_ARRAY'
  | 'NON_CANONICAL_ARRAY';

export type SafeInspectionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: SafeInspectionFailure };

function fail<T>(reason: SafeInspectionFailure): SafeInspectionResult<T> {
  return { ok: false, reason };
}

function sameKeys(a: readonly PropertyKey[], b: readonly PropertyKey[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function safeOwnKeys(value: object): SafeInspectionResult<readonly PropertyKey[]> {
  try {
    const first = Reflect.ownKeys(value);
    const second = Reflect.ownKeys(value);
    if (!sameKeys(first, second)) return fail('REFLECTION_ERROR');
    return { ok: true, value: first };
  } catch {
    return fail('REFLECTION_ERROR');
  }
}

function safeDescriptor(value: object, key: PropertyKey): SafeInspectionResult<PropertyDescriptor> {
  try {
    const first = Reflect.getOwnPropertyDescriptor(value, key);
    const second = Reflect.getOwnPropertyDescriptor(value, key);
    if (!first || !second) return fail('UNSAFE_DESCRIPTOR');
    const firstAccessor = 'get' in first || 'set' in first;
    const secondAccessor = 'get' in second || 'set' in second;
    if (firstAccessor || secondAccessor) return fail('ACCESSOR_PROPERTY');
    if (!('value' in first) || !('value' in second)) return fail('UNSAFE_DESCRIPTOR');
    if (
      first.enumerable !== second.enumerable ||
      first.configurable !== second.configurable ||
      first.writable !== second.writable ||
      !Object.is(first.value, second.value)
    )
      return fail('REFLECTION_ERROR');
    if (key !== 'length') {
      if (first.enumerable !== true) return fail('UNSAFE_DESCRIPTOR');
      if (first.writable !== first.configurable) return fail('UNSAFE_DESCRIPTOR');
    } else if (first.enumerable !== false || first.configurable !== false) {
      return fail('UNSAFE_DESCRIPTOR');
    }
    return { ok: true, value: first };
  } catch {
    return fail('REFLECTION_ERROR');
  }
}

export function inspectExactRecord(
  input: unknown,
  expectedKeys: readonly string[],
): SafeInspectionResult<Readonly<Record<string, unknown>>> {
  if (input === null || typeof input !== 'object') return fail('NOT_OBJECT');
  try {
    if (Array.isArray(input)) return fail('NOT_PLAIN_OBJECT');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return fail('NOT_PLAIN_OBJECT');
  } catch {
    return fail('REFLECTION_ERROR');
  }
  const keysResult = safeOwnKeys(input);
  if (!keysResult.ok) return keysResult;
  if (keysResult.value.some((key) => typeof key === 'symbol')) return fail('SYMBOL_KEY');
  const actual = keysResult.value as readonly string[];
  const expected = new Set(expectedKeys);
  if (actual.length !== expectedKeys.length) return fail('UNEXPECTED_KEY');
  for (const key of actual) if (!expected.has(key)) return fail('UNEXPECTED_KEY');
  for (const key of expectedKeys) if (!actual.includes(key)) return fail('MISSING_KEY');

  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = safeDescriptor(input, key);
    if (!descriptor.ok) return descriptor;
    values[key] = descriptor.value.value;
  }
  const finalKeys = safeOwnKeys(input);
  if (!finalKeys.ok || !sameKeys(keysResult.value, finalKeys.value))
    return fail('REFLECTION_ERROR');
  return { ok: true, value: Object.freeze(values) };
}

export function inspectOpenRecord(
  input: unknown,
): SafeInspectionResult<Readonly<Record<string, unknown>>> {
  if (input === null || typeof input !== 'object') return fail('NOT_OBJECT');
  try {
    if (Array.isArray(input)) return fail('NOT_PLAIN_OBJECT');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return fail('NOT_PLAIN_OBJECT');
  } catch {
    return fail('REFLECTION_ERROR');
  }
  const keysResult = safeOwnKeys(input);
  if (!keysResult.ok) return keysResult;
  if (keysResult.value.some((key) => typeof key === 'symbol')) return fail('SYMBOL_KEY');
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keysResult.value as readonly string[]) {
    const descriptor = safeDescriptor(input, key);
    if (!descriptor.ok) return descriptor;
    values[key] = descriptor.value.value;
  }
  const finalKeys = safeOwnKeys(input);
  if (!finalKeys.ok || !sameKeys(keysResult.value, finalKeys.value))
    return fail('REFLECTION_ERROR');
  return { ok: true, value: Object.freeze(values) };
}

function canonicalIndex(key: string, length: number): boolean {
  if (key === '') return false;
  const number = Number(key);
  return Number.isSafeInteger(number) && number >= 0 && number < length && String(number) === key;
}

export function inspectDenseArray(input: unknown): SafeInspectionResult<readonly unknown[]> {
  try {
    if (!Array.isArray(input)) return fail('NOT_ARRAY');
    if (Object.getPrototypeOf(input) !== Array.prototype) return fail('NON_CANONICAL_ARRAY');
  } catch {
    return fail('REFLECTION_ERROR');
  }
  const keysResult = safeOwnKeys(input as object);
  if (!keysResult.ok) return keysResult;
  if (keysResult.value.some((key) => typeof key === 'symbol')) return fail('SYMBOL_KEY');
  const lengthDescriptor = safeDescriptor(input as object, 'length');
  if (!lengthDescriptor.ok) return lengthDescriptor;
  const length = lengthDescriptor.value.value;
  if (!Number.isSafeInteger(length) || (length as number) < 0) return fail('NON_CANONICAL_ARRAY');
  const stringKeys = keysResult.value as readonly string[];
  if (stringKeys.length !== (length as number) + 1 || !stringKeys.includes('length'))
    return fail('NON_CANONICAL_ARRAY');
  for (const key of stringKeys) {
    if (key !== 'length' && !canonicalIndex(key, length as number))
      return fail('NON_CANONICAL_ARRAY');
  }
  const values: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = safeDescriptor(input as object, String(index));
    if (!descriptor.ok) return descriptor;
    values.push(descriptor.value.value);
  }
  const finalKeys = safeOwnKeys(input as object);
  if (!finalKeys.ok || !sameKeys(keysResult.value, finalKeys.value))
    return fail('REFLECTION_ERROR');
  const finalLength = safeDescriptor(input as object, 'length');
  if (!finalLength.ok || !Object.is(finalLength.value.value, length))
    return fail('REFLECTION_ERROR');
  return { ok: true, value: Object.freeze(values) };
}

export function ownValidatedClone<T>(value: T): SafeInspectionResult<T> {
  try {
    const cloned = structuredClone(value);
    return { ok: true, value: deepFreeze(cloned) };
  } catch {
    return fail('REFLECTION_ERROR');
  }
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  try {
    for (const key of Reflect.ownKeys(value as object)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value as object, key);
      if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value, seen);
    }
    return Object.freeze(value);
  } catch {
    return value;
  }
}
