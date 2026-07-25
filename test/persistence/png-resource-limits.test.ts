import { describe, expect, it } from 'vitest';
import { inspectPng, type PngResourceLimits } from '../../src/persistence';
import { corruptLastByte, makeSmallPng, malformedChunkBoundsPng, pngChunk } from './png-fixtures';

const LIMITS: PngResourceLimits = {
  maxFileBytes: 1024 * 1024,
  maxWidth: 50_000,
  maxHeight: 50_000,
  maxPixels: 100_000_000,
  maxChunkCount: 100,
  maxChunkLength: 1024 * 1024,
  maxMetadataChunkBytes: 64 * 1024,
  maxCrcBytes: 1024 * 1024,
};

function withLimit(overrides: Partial<PngResourceLimits>): PngResourceLimits {
  return { ...LIMITS, ...overrides };
}

function expectCode(
  result: ReturnType<typeof inspectPng>,
  code: 'ASSET_RESOURCE_LIMIT' | 'ASSET_INVALID_PNG',
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe('PNG deterministic resource and integrity limits', () => {
  it('rejects an oversized file before chunk processing', () => {
    const png = makeSmallPng();
    expectCode(
      inspectPng(png, withLimit({ maxFileBytes: png.length - 1 })),
      'ASSET_RESOURCE_LIMIT',
    );
  });

  it('rejects excessive width, height and total pixels', () => {
    expectCode(
      inspectPng(makeSmallPng({ width: 101 }), withLimit({ maxWidth: 100 })),
      'ASSET_RESOURCE_LIMIT',
    );
    expectCode(
      inspectPng(makeSmallPng({ height: 101 }), withLimit({ maxHeight: 100 })),
      'ASSET_RESOURCE_LIMIT',
    );
    expectCode(
      inspectPng(makeSmallPng({ width: 11, height: 10 }), withLimit({ maxPixels: 100 })),
      'ASSET_RESOURCE_LIMIT',
    );
  });

  it('uses safe arithmetic for width × height overflow', () => {
    const result = inspectPng(
      makeSmallPng({ width: 0xffffffff, height: 0xffffffff }),
      withLimit({
        maxWidth: Number.MAX_SAFE_INTEGER,
        maxHeight: Number.MAX_SAFE_INTEGER,
        maxPixels: Number.MAX_SAFE_INTEGER,
      }),
    );
    expectCode(result, 'ASSET_RESOURCE_LIMIT');
  });

  it('rejects excessive chunk count and individual chunk length', () => {
    const png = makeSmallPng({ extraChunks: [pngChunk('tEXt'), pngChunk('tEXt')] });
    expectCode(inspectPng(png, withLimit({ maxChunkCount: 2 })), 'ASSET_RESOURCE_LIMIT');
    expectCode(
      inspectPng(makeSmallPng(), withLimit({ maxChunkLength: 12 })),
      'ASSET_RESOURCE_LIMIT',
    );
  });

  it('rejects excessive metadata chunks and bounded CRC work', () => {
    const png = makeSmallPng({ extraChunks: [pngChunk('tEXt', new Uint8Array(20))] });
    expectCode(inspectPng(png, withLimit({ maxMetadataChunkBytes: 10 })), 'ASSET_RESOURCE_LIMIT');
    expectCode(inspectPng(makeSmallPng(), withLimit({ maxCrcBytes: 16 })), 'ASSET_RESOURCE_LIMIT');
  });

  it('rejects malformed chunk bounds and CRC mismatch', () => {
    expectCode(inspectPng(malformedChunkBoundsPng(), LIMITS), 'ASSET_INVALID_PNG');
    expectCode(inspectPng(corruptLastByte(makeSmallPng()), LIMITS), 'ASSET_INVALID_PNG');
  });

  it('rejects missing IEND and trailing bytes', () => {
    expectCode(inspectPng(makeSmallPng({ includeIend: false }), LIMITS), 'ASSET_INVALID_PNG');
    expectCode(
      inspectPng(makeSmallPng({ trailing: new Uint8Array([1]) }), LIMITS),
      'ASSET_INVALID_PNG',
    );
  });

  it('accepts small transparent and opaque PNG files without decoding IDAT', () => {
    const transparent = inspectPng(makeSmallPng(), LIMITS);
    expect(transparent.ok && transparent.value.hasTransparency).toBe(true);
    const opaque = inspectPng(makeSmallPng({ transparent: false }), LIMITS);
    expect(opaque.ok && opaque.value.hasTransparency).toBe(false);
  });

  it('reads pHYs DPI metadata deterministically', () => {
    const result = inspectPng(makeSmallPng({ dpi: 300 }), LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dpi).toBe(300);
  });
});
