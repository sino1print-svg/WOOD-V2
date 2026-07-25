import { sha256Text } from './canonical-json';
import { fail, ok, type PersistenceResult } from './result';

const LEGACY_STORAGE_SAFE_ID = /^[A-Za-z0-9_.:-]+$/u;
const LEGACY_ASSET_REF = /^asset:([a-f0-9]{24}):([a-f0-9]{64})$/u;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateDomainIdentifier(
  value: unknown,
  fieldName = 'identifier',
): PersistenceResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('VALIDATION_FAILED', 'validate', {
      messageEn: `${fieldName} must be a non-empty string.`,
      messageAr: `يجب أن يكون ${fieldName} نصًا غير فارغ.`,
      details: { field: fieldName },
    });
  }
  if (hasControlCharacters(value)) {
    return fail('VALIDATION_FAILED', 'validate', {
      messageEn: `${fieldName} contains forbidden control characters.`,
      messageAr: `يحتوي ${fieldName} على محارف تحكم غير مسموح بها.`,
      causeCategory: 'security',
      details: { field: fieldName },
    });
  }
  if (value !== value.normalize('NFC')) {
    return fail('VALIDATION_FAILED', 'validate', {
      messageEn: `${fieldName} must use NFC Unicode normalization.`,
      messageAr: `يجب حفظ ${fieldName} بصيغة Unicode NFC.`,
      details: { field: fieldName, normalization: 'NFC' },
    });
  }
  return ok(value);
}

export function validateOpaqueAssetRef(value: unknown): PersistenceResult<string> {
  const id = validateDomainIdentifier(value, 'AssetRef');
  if (!id.ok) return id;
  if (isAbsolutePath(id.value)) {
    return fail('ASSET_METADATA_INVALID', 'validate', {
      messageEn: 'AssetRef must be opaque and must not be an absolute path.',
      messageAr: 'يجب أن يكون AssetRef مرجعًا معتمًا وليس مسارًا مطلقًا.',
      causeCategory: 'security',
    });
  }
  return id;
}

export function isAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value);
}

export async function storageToken(namespace: string, value: string): Promise<string> {
  return sha256Text(`${namespace}\u0000${value.normalize('NFC')}`);
}

export async function projectStorageKey(projectId: string): Promise<string> {
  const token = await storageToken('project', projectId);
  return `projects/by-id/${token}.json`;
}

export function legacyProjectStorageKey(projectId: string): string | null {
  return LEGACY_STORAGE_SAFE_ID.test(projectId) ? `projects/${projectId}.json` : null;
}

export async function assetMetadataStorageKey(assetRef: string): Promise<string> {
  const token = await storageToken('asset-ref', assetRef);
  return `assets/v2/meta/${token}.json`;
}

export async function assetDataStorageKey(assetRef: string): Promise<string> {
  const token = await storageToken('asset-ref', assetRef);
  return `assets/v2/data/${token}.png`;
}

export function legacyAssetStorageKeys(
  assetRef: string,
): { readonly metadata: string; readonly data: string } | null {
  const match = LEGACY_ASSET_REF.exec(assetRef);
  if (!match) return null;
  const suffix = assetRef.slice('asset:'.length);
  return {
    metadata: `assets/meta/${suffix}.json`,
    data: `assets/data/${suffix}.png`,
  };
}

export function isValidDisplayFilename(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName === fileName.normalize('NFC') &&
    !hasControlCharacters(fileName) &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !/^[A-Za-z]:/u.test(fileName) &&
    fileName.toLowerCase().endsWith('.png')
  );
}
