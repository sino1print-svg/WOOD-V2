import { APP_CONFIG } from '../../config/app-config';
import type {
  Artwork,
  ArtworkId,
  AssetRef,
  IsoTimestamp,
  ProjectId,
} from '../../shared/domain-model';
import {
  assetDataStorageKey,
  assetMetadataStorageKey,
  canonicalStringify,
  compareCodeUnits,
  decodeUtf8,
  encodeUtf8,
  fail,
  isValidDisplayFilename,
  legacyAssetStorageKeys,
  ok,
  safeJsonParse,
  sha256Bytes,
  sha256Text,
  validateDomainIdentifier,
  validateOpaqueAssetRef,
  type AtomicStorageAdapter,
  type PersistenceResult,
} from '../shared';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP']);

export interface PngResourceLimits {
  readonly maxFileBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxChunkCount: number;
  readonly maxChunkLength: number;
  readonly maxMetadataChunkBytes: number;
  readonly maxCrcBytes: number;
}

export interface RegisterPngAssetInput {
  readonly projectId: ProjectId;
  readonly artworkId: ArtworkId;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly uploadedAt: IsoTimestamp;
}

export interface AssetRecord {
  readonly artwork: Artwork;
  readonly byteLength: number;
  readonly mediaType: 'image/png';
}

interface StoredAssetMetadata extends AssetRecord {
  readonly schemaVersion?: 1;
  readonly assetRef: AssetRef;
}

export interface PngMetadata {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly hasTransparency: boolean;
  readonly dpi?: number;
  readonly chunkCount: number;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function crc32Range(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resourceFailure(limit: keyof PngResourceLimits, actual: number, maximum: number) {
  return fail<PngMetadata>('ASSET_RESOURCE_LIMIT', 'asset_register', {
    details: { limit, actual, maximum },
  });
}

function validateLimits(limits: PngResourceLimits): PersistenceResult<void> {
  for (const [name, value] of Object.entries(limits).sort(([a], [b]) => compareCodeUnits(a, b))) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return fail('ASSET_METADATA_INVALID', 'asset_register', {
        messageEn: 'PNG resource limits must be positive safe integers.',
        messageAr: 'يجب أن تكون حدود موارد PNG أعدادًا صحيحة موجبة وآمنة.',
        details: { limit: name },
      });
    }
  }
  return ok(undefined);
}

function parsePng(
  bytes: Uint8Array,
  limits: PngResourceLimits = APP_CONFIG.limits.pngAsset,
): PersistenceResult<PngMetadata> {
  const checkedLimits = validateLimits(limits);
  if (!checkedLimits.ok) return checkedLimits;
  if (bytes.length > limits.maxFileBytes) {
    return resourceFailure('maxFileBytes', bytes.length, limits.maxFileBytes);
  }
  if (bytes.length < 33 || !bytesEqual(bytes.subarray(0, 8), PNG_SIGNATURE)) {
    return fail('ASSET_INVALID_PNG', 'asset_register', {
      messageEn: 'PNG signature is missing or invalid.',
      messageAr: 'توقيع ملف PNG مفقود أو غير صالح.',
    });
  }

  let offset = 8;
  let widthPx = 0;
  let heightPx = 0;
  let colorType = -1;
  let hasTrns = false;
  let dpi: number | undefined;
  let sawIhdr = false;
  let sawIend = false;
  let chunkCount = 0;
  let crcWork = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      return fail('ASSET_INVALID_PNG', 'asset_register', {
        messageEn: 'PNG chunk header is truncated.',
        messageAr: 'رأس مقطع PNG غير مكتمل.',
        details: { offset },
      });
    }
    chunkCount += 1;
    if (chunkCount > limits.maxChunkCount) {
      return resourceFailure('maxChunkCount', chunkCount, limits.maxChunkCount);
    }

    const length = readUint32(bytes, offset);
    if (length > limits.maxChunkLength) {
      return resourceFailure('maxChunkLength', length, limits.maxChunkLength);
    }
    if (!Number.isSafeInteger(offset + 12 + length) || length > bytes.length - offset - 12) {
      return fail('ASSET_INVALID_PNG', 'asset_register', {
        messageEn: 'PNG chunk length exceeds file bounds.',
        messageAr: 'يتجاوز طول مقطع PNG حدود الملف.',
        details: { offset, chunkLength: length },
      });
    }

    const typeStart = offset + 4;
    const typeEnd = offset + 8;
    const type = String.fromCharCode(...bytes.subarray(typeStart, typeEnd));
    if (METADATA_CHUNKS.has(type) && length > limits.maxMetadataChunkBytes) {
      return resourceFailure('maxMetadataChunkBytes', length, limits.maxMetadataChunkBytes);
    }
    const dataStart = typeEnd;
    const dataEnd = dataStart + length;
    const crcBytes = 4 + length;
    if (crcWork > limits.maxCrcBytes - crcBytes) {
      return resourceFailure('maxCrcBytes', crcWork + crcBytes, limits.maxCrcBytes);
    }
    crcWork += crcBytes;
    const storedCrc = readUint32(bytes, dataEnd);
    const computedCrc = crc32Range(bytes, typeStart, dataEnd);
    if (storedCrc !== computedCrc) {
      return fail('ASSET_INVALID_PNG', 'asset_register', {
        messageEn: `PNG chunk CRC mismatch (${type}).`,
        messageAr: `بصمة CRC لمقطع PNG غير متطابقة (${type}).`,
        causeCategory: 'integrity',
        details: { chunkType: type, chunkIndex: chunkCount - 1 },
      });
    }

    if (type === 'IHDR') {
      if (sawIhdr || length !== 13 || offset !== 8) {
        return fail('ASSET_INVALID_PNG', 'asset_register', {
          messageEn: 'PNG IHDR is malformed or misplaced.',
          messageAr: 'مقطع IHDR في PNG غير صالح أو في موضع خاطئ.',
        });
      }
      sawIhdr = true;
      widthPx = readUint32(bytes, dataStart);
      heightPx = readUint32(bytes, dataStart + 4);
      colorType = bytes[dataStart + 9];
      if (widthPx < 1 || heightPx < 1) {
        return fail('ASSET_INVALID_PNG', 'asset_register', {
          messageEn: 'PNG dimensions must be positive.',
          messageAr: 'يجب أن تكون أبعاد PNG موجبة.',
        });
      }
      if (widthPx > limits.maxWidth) return resourceFailure('maxWidth', widthPx, limits.maxWidth);
      if (heightPx > limits.maxHeight)
        return resourceFailure('maxHeight', heightPx, limits.maxHeight);
      if (widthPx > Math.floor(limits.maxPixels / heightPx)) {
        const reportedPixels =
          widthPx > Math.floor(Number.MAX_SAFE_INTEGER / heightPx)
            ? Number.MAX_SAFE_INTEGER
            : widthPx * heightPx;
        return resourceFailure('maxPixels', reportedPixels, limits.maxPixels);
      }
    } else if (type === 'tRNS') {
      hasTrns = true;
    } else if (type === 'pHYs' && length === 9 && bytes[dataStart + 8] === 1) {
      const pixelsPerMeterX = readUint32(bytes, dataStart);
      const pixelsPerMeterY = readUint32(bytes, dataStart + 4);
      if (pixelsPerMeterX > 0 && pixelsPerMeterY > 0) {
        dpi = Math.round(((pixelsPerMeterX + pixelsPerMeterY) / 2) * 0.0254);
      }
    } else if (type === 'IEND') {
      if (length !== 0) {
        return fail('ASSET_INVALID_PNG', 'asset_register', {
          messageEn: 'PNG IEND must be empty.',
          messageAr: 'يجب أن يكون مقطع IEND في PNG فارغًا.',
        });
      }
      sawIend = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }

  if (!sawIhdr || !sawIend) {
    return fail('ASSET_INVALID_PNG', 'asset_register', {
      messageEn: 'PNG is incomplete or is missing IEND.',
      messageAr: 'ملف PNG غير مكتمل أو يفتقد IEND.',
    });
  }
  if (offset !== bytes.length) {
    return fail('ASSET_INVALID_PNG', 'asset_register', {
      messageEn: 'PNG contains trailing data after IEND.',
      messageAr: 'يحتوي PNG على بيانات زائدة بعد IEND.',
      causeCategory: 'security',
      details: { trailingByteCount: bytes.length - offset },
    });
  }
  const hasTransparency = colorType === 4 || colorType === 6 || hasTrns;
  return ok({
    widthPx,
    heightPx,
    hasTransparency,
    chunkCount,
    ...(dpi !== undefined ? { dpi } : {}),
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStoredMetadata(value: unknown): value is StoredAssetMetadata {
  if (!isObject(value) || !isObject(value.artwork)) return false;
  const ref = validateOpaqueAssetRef(value.assetRef);
  return (
    ref.ok &&
    value.mediaType === 'image/png' &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    typeof value.artwork.id === 'string' &&
    typeof value.artwork.projectId === 'string' &&
    typeof value.artwork.fileName === 'string' &&
    value.artwork.pngAssetRef === value.assetRef &&
    value.artwork.format === 'png' &&
    typeof value.artwork.contentHash === 'string'
  );
}

async function readFirst(
  storage: AtomicStorageAdapter,
  keys: readonly string[],
): Promise<PersistenceResult<{ readonly key: string; readonly value: Uint8Array } | null>> {
  for (const key of keys) {
    const read = await storage.read(key);
    if (!read.ok) return read;
    if (read.value) return ok({ key, value: read.value });
  }
  return ok(null);
}

function artworkMetadataMatches(left: Artwork, right: Artwork): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.pngAssetRef === right.pngAssetRef &&
    left.contentHash === right.contentHash &&
    left.fileName === right.fileName &&
    left.widthPx === right.widthPx &&
    left.heightPx === right.heightPx &&
    left.hasTransparency === right.hasTransparency &&
    left.format === right.format &&
    left.dpi === right.dpi &&
    left.aspectRatio === right.aspectRatio
  );
}

export class AssetStore {
  public constructor(
    private readonly storage: AtomicStorageAdapter,
    private readonly pngLimits: PngResourceLimits = APP_CONFIG.limits.pngAsset,
  ) {}

  public async registerPng(input: RegisterPngAssetInput): Promise<PersistenceResult<AssetRecord>> {
    const projectId = validateDomainIdentifier(input.projectId, 'projectId');
    if (!projectId.ok) return projectId;
    const artworkId = validateDomainIdentifier(input.artworkId, 'artworkId');
    if (!artworkId.ok) return artworkId;
    if (!isValidDisplayFilename(input.fileName)) {
      return fail('ASSET_METADATA_INVALID', 'asset_register', {
        messageEn: 'PNG filename must be an NFC-normalized basename with a .png extension.',
        messageAr: 'يجب أن يكون اسم PNG اسم ملف فقط بصيغة NFC وينتهي بالامتداد ‎.png.',
        causeCategory: 'security',
      });
    }
    const png = parsePng(input.bytes, this.pngLimits);
    if (!png.ok) return png;
    const contentHash = await sha256Bytes(input.bytes);
    const tokenHash = await sha256Text(`${input.projectId}\u0000${input.artworkId}`);
    // The value is deliberately treated as opaque by every reader. This legacy-compatible
    // representation is an implementation detail, not an ownership or parsing contract.
    const assetRef = `asset:${tokenHash.slice(0, 24)}:${contentHash}` as AssetRef;
    const metadataKey = await assetMetadataStorageKey(assetRef);
    const dataKey = await assetDataStorageKey(assetRef);
    const existing = await this.storage.exists(metadataKey);
    if (!existing.ok) return existing;
    const legacy = legacyAssetStorageKeys(assetRef);
    const legacyExists = legacy ? await this.storage.exists(legacy.metadata) : ok(false);
    if (!legacyExists.ok) return legacyExists;
    if (existing.value || legacyExists.value) {
      return fail('ASSET_ALREADY_EXISTS', 'asset_register', { details: { assetRef } });
    }

    const artwork: Artwork = {
      id: input.artworkId,
      projectId: input.projectId,
      fileName: input.fileName,
      pngAssetRef: assetRef,
      uploadedAt: input.uploadedAt,
      format: 'png',
      hasTransparency: png.value.hasTransparency,
      widthPx: png.value.widthPx,
      heightPx: png.value.heightPx,
      ...(png.value.dpi !== undefined ? { dpi: png.value.dpi } : {}),
      aspectRatio: png.value.widthPx / png.value.heightPx,
      contentHash,
    };
    const metadata: StoredAssetMetadata = {
      schemaVersion: 1,
      assetRef,
      artwork,
      byteLength: input.bytes.length,
      mediaType: 'image/png',
    };
    const serialized = canonicalStringify(metadata);
    if (!serialized.ok) return serialized;
    const committed = await this.storage.commit([
      { kind: 'put', key: dataKey, value: input.bytes, requireAbsent: true },
      { kind: 'put', key: metadataKey, value: encodeUtf8(serialized.value), requireAbsent: true },
    ]);
    if (!committed.ok) {
      return fail('STORAGE_FAILURE', 'asset_register', {
        messageEn: committed.error.messageEn,
        messageAr: committed.error.messageAr,
        retryable: committed.error.retryable,
        details: committed.error.details,
      });
    }
    return ok({ artwork, byteLength: input.bytes.length, mediaType: 'image/png' });
  }

  private async readMetadata(assetRef: AssetRef): Promise<PersistenceResult<StoredAssetMetadata>> {
    const validRef = validateOpaqueAssetRef(assetRef);
    if (!validRef.ok) {
      return fail('ASSET_METADATA_INVALID', 'asset_read', {
        messageEn: validRef.error.messageEn,
        messageAr: validRef.error.messageAr,
      });
    }
    const v2 = await assetMetadataStorageKey(assetRef);
    const legacy = legacyAssetStorageKeys(assetRef);
    const stored = await readFirst(this.storage, legacy ? [v2, legacy.metadata] : [v2]);
    if (!stored.ok) return stored;
    if (!stored.value) return fail('ASSET_NOT_FOUND', 'asset_read');
    const decoded = decodeUtf8(stored.value.value);
    if (!decoded.ok) return fail('ASSET_CORRUPT', 'asset_read', decoded.error.messageEn);
    const parsed = safeJsonParse(decoded.value);
    if (!parsed.ok || !isStoredMetadata(parsed.value)) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Asset metadata is corrupt.',
        messageAr: 'بيانات أصل PNG الوصفية تالفة.',
      });
    }
    if (parsed.value.assetRef !== assetRef || parsed.value.artwork.pngAssetRef !== assetRef) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Asset metadata/reference mismatch.',
        messageAr: 'مرجع أصل PNG لا يطابق بياناته الوصفية.',
      });
    }
    return ok(parsed.value);
  }

  public async retrieve(
    projectId: ProjectId,
    assetRef: AssetRef,
  ): Promise<PersistenceResult<{ readonly record: AssetRecord; readonly bytes: Uint8Array }>> {
    const validProject = validateDomainIdentifier(projectId, 'projectId');
    if (!validProject.ok) return validProject;
    const metadata = await this.readMetadata(assetRef);
    if (!metadata.ok) return metadata;
    if (metadata.value.artwork.projectId !== projectId) {
      return fail('ASSET_CROSS_PROJECT', 'asset_read', {
        details: { requestedProjectId: projectId },
      });
    }

    const v2 = await assetDataStorageKey(assetRef);
    const legacy = legacyAssetStorageKeys(assetRef);
    const storedBytes = await readFirst(this.storage, legacy ? [v2, legacy.data] : [v2]);
    if (!storedBytes.ok) return storedBytes;
    if (!storedBytes.value) return fail('ASSET_NOT_FOUND', 'asset_read');
    if (storedBytes.value.value.length !== metadata.value.byteLength) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Asset byte length does not match metadata.',
        messageAr: 'حجم بيانات أصل PNG لا يطابق البيانات الوصفية.',
      });
    }
    const contentHash = await sha256Bytes(storedBytes.value.value);
    if (contentHash !== metadata.value.artwork.contentHash) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Asset content hash verification failed.',
        messageAr: 'فشل التحقق من بصمة محتوى أصل PNG.',
      });
    }
    const png = parsePng(storedBytes.value.value, this.pngLimits);
    if (
      !png.ok ||
      png.value.widthPx !== metadata.value.artwork.widthPx ||
      png.value.heightPx !== metadata.value.artwork.heightPx ||
      png.value.hasTransparency !== metadata.value.artwork.hasTransparency ||
      png.value.dpi !== metadata.value.artwork.dpi
    ) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Asset PNG structure does not match stored metadata.',
        messageAr: 'بنية أصل PNG لا تطابق بياناته الوصفية.',
      });
    }
    const record: AssetRecord = {
      artwork: metadata.value.artwork,
      byteLength: metadata.value.byteLength,
      mediaType: 'image/png',
    };
    return ok({ record, bytes: storedBytes.value.value.slice() });
  }

  public async validateArtworkAssociation(
    projectId: ProjectId,
    artwork: Artwork,
  ): Promise<PersistenceResult<void>> {
    if (artwork.projectId !== projectId) return fail('ASSET_CROSS_PROJECT', 'asset_read');
    const retrieved = await this.retrieve(projectId, artwork.pngAssetRef);
    if (!retrieved.ok) return retrieved;
    if (!artworkMetadataMatches(retrieved.value.record.artwork, artwork)) {
      return fail('ASSET_CORRUPT', 'asset_read', {
        messageEn: 'Project artwork metadata does not match the authoritative Asset Store record.',
        messageAr: 'بيانات العمل الفني داخل المشروع لا تطابق سجل Asset Store المعتمد.',
      });
    }
    return ok(undefined);
  }
}

export { parsePng as inspectPng };
