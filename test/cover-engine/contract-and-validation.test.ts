import { describe, expect, it } from 'vitest';
import { CoverLayout, OutputStatus, type CoverMetadata } from '../../src/shared/domain-model';
import { composeCover, type CoverEngineInput } from '../../src/engines/cover-engine';
import { ERROR_BY_CODE } from '../../src/shared/errors';
import { COLORS, coverInput, source } from './fixtures';

function expectFailure(input: CoverEngineInput, code: string, field?: string): void {
  const result = composeCover(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      code,
      severity: 'blocking',
      originEngine: 'cover',
    });
    if (field) expect(result.failures[0]?.field).toBe(field);
  }
}

describe('Cover Engine contract and validation', () => {
  it('composes a MainCover prompt-only value through the public API', () => {
    const result = composeCover(coverInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: 'cover-phase7',
      sessionId: 'session-phase7',
      status: OutputStatus.Pending,
      generatedAt: null,
      renderHash: null,
    });
    expect(result.value.promptText.length).toBeGreaterThan(100);
    expect(result.value).not.toHaveProperty('image');
    expect(result.value).not.toHaveProperty('imageBytes');
    expect(result.value).not.toHaveProperty('render');
  });

  it('blocks before composition when the authoritative barrier is false', () => {
    const input = coverInput({ override: { allOutputAReady: false } });
    expectFailure(input, 'COVER_BARRIER_001');
    const result = composeCover(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.message).toBe(ERROR_BY_CODE.COVER_BARRIER_001?.messageAr);
  });

  it('blocks a non-generated Output A even if the flag is hostilely true', () => {
    const pending = source(1, { output: { status: OutputStatus.Pending } });
    expectFailure(
      coverInput({ count: 1, saleImages: [pending] }),
      'COVER_BARRIER_001',
      'saleImages[0].output.status',
    );
  });

  it('rejects an Output B-shaped object cast into the sale-image boundary', () => {
    const item = source(1);
    const outputB = {
      ...item.output,
      sourceOutputAId: item.output.id,
      artworkId: 'artwork-1',
      onlyArtworkChanges: true,
    } as unknown as typeof item.output;
    expectFailure(
      coverInput({ count: 1, saleImages: [{ ...item, output: outputB }] }),
      'COVER_SRC_001',
    );
  });

  it('rejects a duplicated Sale Image id', () => {
    const first = source(1);
    expectFailure(
      coverInput({ count: 2, saleImages: [first, { ...source(2), output: first.output }] }),
      'COVER_DUP_001',
    );
  });

  it('rejects a metadata count that differs from the source count', () => {
    const base = coverInput();
    expectFailure(
      { ...base, metadata: { ...base.metadata, mockupCount: 99 } },
      'COVER_COUNT_001',
      'metadata.mockupCount',
    );
  });

  it('rejects missing cover metadata fields', () => {
    const base = coverInput();
    const missing = Object.fromEntries(
      Object.entries(base.metadata).filter(([key]) => key !== 'primaryAudience'),
    );
    expectFailure({ ...base, metadata: missing as CoverMetadata }, 'COVER_META_001', 'metadata');
  });

  it('rejects unknown cover metadata fields', () => {
    const base = coverInput();
    expectFailure(
      { ...base, metadata: { ...base.metadata, unknown: true } as CoverMetadata },
      'COVER_META_001',
    );
  });

  it('rejects a source garment color outside the locked set', () => {
    const hostile = source(1, { output: { color: 'color-hostile' as (typeof COLORS)[0]['id'] } });
    expectFailure(
      coverInput({ count: 1, saleImages: [hostile] }),
      'COVER_COLOR_001',
      'saleImages.output.color',
    );
  });

  it('rejects strip metadata containing a non-locked color', () => {
    const base = coverInput();
    expectFailure(
      {
        ...base,
        metadata: {
          ...base.metadata,
          colors: [...base.metadata.colors, 'color-hostile' as (typeof COLORS)[0]['id']],
        },
      },
      'COVER_COLOR_001',
      'metadata.colors',
    );
  });

  it('rejects product metadata that does not match source products', () => {
    const base = coverInput();
    expectFailure(
      {
        ...base,
        metadata: {
          ...base.metadata,
          productIds: ['missing-product' as (typeof base.metadata.productIds)[number]],
        },
      },
      'COVER_META_001',
      'metadata.productIds',
    );
  });

  it('rejects a missing product-manifest resolution', () => {
    const base = coverInput();
    expectFailure(
      { ...base, products: base.products.slice(1) },
      'COVER_META_001',
      'metadata.productIds',
    );
  });

  it('rejects a season manifest that does not match metadata', () => {
    const base = coverInput();
    expectFailure(
      { ...base, season: { ...base.season, id: 'other-season' as typeof base.season.id } },
      'COVER_META_001',
      'season',
    );
  });

  it('rejects an explicitly wrong layout', () => {
    expectFailure(
      coverInput({ override: { requestedLayout: CoverLayout.Mosaic } }),
      'COVER_LAYOUT_001',
      'requestedLayout',
    );
  });

  it('accepts an explicitly correct layout', () => {
    expect(
      composeCover(coverInput({ override: { requestedLayout: CoverLayout.Grid2x2 } })).ok,
    ).toBe(true);
  });

  it('rejects a requested green background', () => {
    expectFailure(
      coverInput({ override: { backgroundPreference: 'green' } }),
      'COVER_GREENBG_001',
      'backgroundPreference',
    );
  });

  it('rejects any request to mutate a source image', () => {
    expectFailure(
      coverInput({ override: { sourceMutationRequested: true } }),
      'COVER_LOCK_001',
      'sourceMutationRequested',
    );
  });

  it('rejects unresolved template-token syntax at the final boundary', () => {
    const item = source(1, {
      output: { id: '{{unresolved}}' as ReturnType<typeof source>['output']['id'] },
    });
    expectFailure(coverInput({ count: 1, saleImages: [item] }), 'COVER_VAR_001', 'promptText');
  });

  it.each([
    [
      'bad template version',
      { templateVersion: 'latest', generatorVersion: '1.0.0', moduleVersion: '1.0.0' },
    ],
    [
      'bad generator version',
      { templateVersion: '1.0.0', generatorVersion: 'v1', moduleVersion: '1.0.0' },
    ],
    [
      'bad module version',
      { templateVersion: '1.0.0', generatorVersion: '1.0.0', moduleVersion: '' },
    ],
  ])('rejects %s', (_name, versions) => {
    expectFailure(coverInput({ override: { versions } }), 'COVER_META_001');
  });

  it('rejects a non-UTC generatedAt value', () => {
    expectFailure(coverInput({ override: { generatedAt: '19 July 2026' } }), 'COVER_META_001');
  });

  it('rejects an impossible calendar instant even when its shape is ISO-like', () => {
    expectFailure(
      coverInput({ override: { generatedAt: '2026-02-30T20:00:00.000Z' } }),
      'COVER_META_001',
    );
  });
});
