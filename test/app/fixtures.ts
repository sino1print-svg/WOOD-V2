/** Phase 10.5 application-layer test fixtures (deterministic, no mocks in src/). */
import { deflateSync } from 'node:zlib';
import { Audience, DisplayMethod, GarmentView } from '../../src/shared/domain-model';
import type { Artwork, ArtworkId, AssetRef, ProjectId } from '../../src/shared/domain-model';
import type { SessionDraft, UiState } from '../../src/ui-engine';
import { createInitialUiState, updateDraft } from '../../src/ui-engine';
import { APP_PROJECT_ID, CANONICAL_APP_TIME } from '../../src/app/catalog';

export function validAppDraft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    title: 'جلسة هالوين',
    mode: 'advanced',
    seasonId: 'season-halloween' as SessionDraft['seasonId'],
    audience: Audience.All,
    countMode: 'fixed',
    targetCount: 2,
    products: [
      {
        productId: 'product-bella-3001' as SessionDraft['products'][number]['productId'],
        quantity: 2,
        selectedViews: [GarmentView.Front],
        displayMethods: [DisplayMethod.OnModel],
      },
    ],
    colorIds: ['color-white', 'color-black'] as unknown as SessionDraft['colorIds'],
    placement: 'center_chest',
    customSceneDescription: '',
    groupBy: 'product',
    includeOutputB: true,
    ...overrides,
  };
}

export function testArtwork(): Artwork {
  return {
    id: 'artwork-upload-1' as ArtworkId,
    projectId: APP_PROJECT_ID as ProjectId,
    fileName: 'design.png',
    pngAssetRef: `asset:${'a'.repeat(24)}:${'b'.repeat(64)}` as AssetRef,
    uploadedAt: CANONICAL_APP_TIME,
    format: 'png',
    hasTransparency: true,
    widthPx: 1200,
    heightPx: 1200,
    aspectRatio: 1,
    contentHash: 'c'.repeat(64) as Artwork['contentHash'],
  };
}

export function stateWithDraft(draft: SessionDraft): UiState {
  return updateDraft(createInitialUiState(), draft);
}

/**
 * Minimal real 1×1 RGBA PNG built programmatically (correct CRCs, deterministic
 * zlib stream). Used to exercise the real Asset Store registration path.
 */
export function tinyPngBytes(): Uint8Array {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1, false);
  ihdrView.setUint32(4, 1, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const pixels = deflateSync(Uint8Array.from([0, 128, 64, 32, 255]));
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(pixels)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
