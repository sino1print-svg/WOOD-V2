import { PrintAreaObstruction } from '../domain-model';

const MAX_ARRAY = 1_000;
const MAX_DEPTH = 64;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const POSITIONS = new Set(['center_chest', 'full_front', 'left_chest', 'center_back']);
const OBSTRUCTIONS = new Set<unknown>(Object.values(PrintAreaObstruction));
const PROFILE_KEYS = new Set([
  'id',
  'position',
  'minSizeRatio',
  'centeringTolerance',
  'centered',
  'maxShadowCoverage',
  'forbiddenOverlaps',
]);

type RecordValue = Record<string, unknown>;

export interface RuntimeValidationIssue {
  readonly kind: 'unsafe' | 'limit' | 'invalid';
  readonly path: string;
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function inspect(
  value: unknown,
  active = new WeakSet<object>(),
  depth = 0,
): 'unsafe' | 'limit' | null {
  if (depth > MAX_DEPTH) return 'limit';
  if (value === null || typeof value !== 'object') return null;
  if (active.has(value)) return 'unsafe';
  active.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype)
      return 'unsafe';
    for (const key in value) if (!hasOwn(value, key)) return 'unsafe';
    if (Object.getOwnPropertySymbols(value).length > 0) return 'unsafe';
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    if (names.some((key) => DANGEROUS_KEYS.has(key))) return 'unsafe';
    if (names.some((key) => key !== 'length' && descriptors[key]?.enumerable !== true))
      return 'unsafe';
    if (names.some((key) => descriptors[key]?.get || descriptors[key]?.set)) return 'unsafe';
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) return 'limit';
      const elementKeys = names.filter((key) => key !== 'length');
      if (elementKeys.length !== value.length) return 'unsafe';
      for (let index = 0; index < value.length; index += 1)
        if (!hasOwn(value, index)) return 'unsafe';
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!('value' in descriptor)) return 'unsafe';
      const nested = inspect(descriptor.value, active, depth + 1);
      if (nested) return nested;
    }
    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

function record(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return !DANGEROUS_KEYS.has(value);
}

function unitRatio(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1 &&
    !Object.is(value, -0)
  );
}

export function validatePrintAreaProfileRuntime(
  value: unknown,
  path = 'profile',
): RuntimeValidationIssue | null {
  const inspection = inspect(value);
  if (inspection) return { kind: inspection, path };
  if (!record(value)) return { kind: 'invalid', path };
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!PROFILE_KEYS.has(key)) return { kind: 'invalid', path: `${path}.${key}` };
  }
  for (const key of PROFILE_KEYS) {
    if (!hasOwn(value, key)) return { kind: 'invalid', path: `${path}.${key}` };
  }
  if (!validId(value.id)) return { kind: 'invalid', path: `${path}.id` };
  if (typeof value.position !== 'string' || !POSITIONS.has(value.position))
    return { kind: 'invalid', path: `${path}.position` };
  if (!unitRatio(value.minSizeRatio)) return { kind: 'invalid', path: `${path}.minSizeRatio` };
  if (!unitRatio(value.centeringTolerance))
    return { kind: 'invalid', path: `${path}.centeringTolerance` };
  if (typeof value.centered !== 'boolean') return { kind: 'invalid', path: `${path}.centered` };
  if (!unitRatio(value.maxShadowCoverage))
    return { kind: 'invalid', path: `${path}.maxShadowCoverage` };
  if (!Array.isArray(value.forbiddenOverlaps) || value.forbiddenOverlaps.length > MAX_ARRAY)
    return {
      kind:
        Array.isArray(value.forbiddenOverlaps) && value.forbiddenOverlaps.length > MAX_ARRAY
          ? 'limit'
          : 'invalid',
      path: `${path}.forbiddenOverlaps`,
    };
  if (Object.keys(value.forbiddenOverlaps).length !== value.forbiddenOverlaps.length)
    return { kind: 'invalid', path: `${path}.forbiddenOverlaps` };
  if (value.forbiddenOverlaps.some((item) => !OBSTRUCTIONS.has(item)))
    return { kind: 'invalid', path: `${path}.forbiddenOverlaps` };
  return null;
}
