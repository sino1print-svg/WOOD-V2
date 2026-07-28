import { APP_CONFIG } from '../config/app-config';
import type { ExportFormatterLimits } from './format-result';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FORBIDDEN_METADATA_KEYS = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'bearer',
  'password',
  'secret',
  'credential',
  'credentials',
  'token',
  'processenv',
  'evaluationcontext',
  'resolvedconstraint',
  'resolvedconstraints',
  'stack',
  'ownerref',
  'pngassetref',
  'projectstate',
  'artworkbytes',
  'assetbytes',
  'base64',
  'objecturl',
  'bloburl',
  'filesystemhandle',
  'runtimecache',
  'uistate',
]);
const NON_PROMPT_PATHS = [
  /(?:^|[^A-Za-z])[A-Za-z]:\\/u,
  /(?:^|\/)(?:home|Users|tmp|var\/tmp)\//u,
  /file:\/\//iu,
  /blob:/iu,
  /node_modules/iu,
  /process\.env/iu,
  /iVBORw0KGgo/u,
  /data:image\/(?:png|jpeg|webp);base64,/iu,
];

interface InspectionBudget {
  objects: number;
  keys: number;
  stringCodeUnits: number;
}

export type FormatterRuntimeInspection = 'unsafe' | 'limit' | null;

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
}

function isArrayIndex(key: string, length: number): boolean {
  if (key.length === 0) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < length && String(value) === key;
}

function unsafeMetadataText(value: string, propertyName: string | null): boolean {
  if (propertyName === 'promptText') return false;
  return NON_PROMPT_PATHS.some((pattern) => pattern.test(value));
}

function inspectValue(
  value: unknown,
  active: WeakSet<object>,
  budget: InspectionBudget,
  depth: number,
  maximumDepth: number,
  maximumArrayLength: number,
  propertyName: string | null,
): FormatterRuntimeInspection {
  if (depth > maximumDepth) return 'limit';
  if (typeof value === 'string') {
    budget.stringCodeUnits += value.length;
    if (budget.stringCodeUnits > APP_CONFIG.limits.export.maxJsonBytes) return 'limit';
    return unsafeMetadataText(value, propertyName) ? 'unsafe' : null;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
  ) {
    return null;
  }
  if (typeof value !== 'object' || active.has(value)) return 'unsafe';

  budget.objects += 1;
  if (budget.objects > APP_CONFIG.limits.export.maxZipEntries * 40) return 'limit';
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
    if (budget.keys > APP_CONFIG.limits.export.maxZipEntries * 160) return 'limit';
    if (
      names.some(
        (key) =>
          DANGEROUS_KEYS.has(key) ||
          (key !== 'length' && FORBIDDEN_METADATA_KEYS.has(normalizedKey(key))),
      )
    ) {
      return 'unsafe';
    }

    if (array) {
      const length = descriptors.length;
      if (!length || !('value' in length) || !Number.isSafeInteger(length.value)) return 'unsafe';
      if (length.value < 0 || length.value > maximumArrayLength) return 'limit';
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
      const nested = inspectValue(
        descriptor.value,
        active,
        budget,
        depth + 1,
        maximumDepth,
        maximumArrayLength,
        name,
      );
      if (nested) return nested;
    }
    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

export function inspectFormatterRuntimeValue(
  value: unknown,
  maximumDepth = APP_CONFIG.limits.export.maxJsonDepth,
  maximumArrayLength = APP_CONFIG.limits.export.maxZipEntries,
): FormatterRuntimeInspection {
  return inspectValue(
    value,
    new WeakSet<object>(),
    { objects: 0, keys: 0, stringCodeUnits: 0 },
    0,
    maximumDepth,
    maximumArrayLength,
    null,
  );
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === required.length &&
    keys.every((key) => required.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function validFormatterLimits(value: unknown): value is ExportFormatterLimits {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'maxPathSegment',
      'maxPathLength',
      'maxArtifactBytes',
      'maxJsonBytes',
      'maxJsonDepth',
      'maxZipEntries',
      'maxArchiveBytes',
      'maxUncompressedBytes',
      'maxCompressionRatio',
      'maxClipboardBytes',
    ])
  ) {
    return false;
  }
  if (
    !positiveInteger(value.maxPathSegment) ||
    !positiveInteger(value.maxPathLength) ||
    !positiveInteger(value.maxArtifactBytes) ||
    !positiveInteger(value.maxJsonBytes) ||
    !positiveInteger(value.maxJsonDepth) ||
    !positiveInteger(value.maxZipEntries) ||
    !positiveInteger(value.maxArchiveBytes) ||
    !positiveInteger(value.maxUncompressedBytes) ||
    !positiveInteger(value.maxCompressionRatio) ||
    !positiveInteger(value.maxClipboardBytes)
  ) {
    return false;
  }
  const approved = APP_CONFIG.limits.export;
  return (
    value.maxPathSegment <= approved.maxPathSegment &&
    value.maxPathLength <= approved.maxPathLength &&
    value.maxArtifactBytes <= approved.maxArtifactBytes &&
    value.maxJsonBytes <= approved.maxJsonBytes &&
    value.maxJsonDepth <= approved.maxJsonDepth &&
    value.maxZipEntries <= approved.maxZipEntries &&
    value.maxArchiveBytes <= approved.maxArchiveBytes &&
    value.maxUncompressedBytes <= approved.maxUncompressedBytes &&
    value.maxCompressionRatio <= approved.maxCompressionRatio &&
    value.maxClipboardBytes <= approved.maxClipboardBytes &&
    value.maxPathSegment <= value.maxPathLength &&
    value.maxArtifactBytes <= value.maxUncompressedBytes &&
    value.maxArchiveBytes <= value.maxUncompressedBytes &&
    value.maxCompressionRatio > 1
  );
}

export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined)
      return leftBytes.length - rightBytes.length;
    const difference = leftByte - rightByte;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function freezeOwned<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value) || ArrayBuffer.isView(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) freezeOwned(descriptor.value, seen);
  }
  return Object.freeze(value);
}
