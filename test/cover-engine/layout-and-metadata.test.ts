import { describe, expect, it } from 'vitest';
import {
  Audience,
  CoverLayout,
  DisplayMethod,
  GarmentView,
  SeasonKind,
} from '../../src/shared/domain-model';
import { composeCover } from '../../src/engines/cover-engine';
import { COLORS, NAVY, PRODUCT_A, PRODUCT_B, SAND, WHITE, coverInput, source } from './fixtures';

describe('Cover Engine deterministic layout', () => {
  it.each([
    [1, CoverLayout.Single, 1, 1, 'full-bleed'],
    [2, CoverLayout.Duo, 2, 1, '1x1'],
    [3, CoverLayout.Triptych, 3, 1, '1x1'],
    [4, CoverLayout.Grid2x2, 2, 2, '1x1'],
    [5, CoverLayout.Grid2x3, 2, 3, '1x1'],
    [6, CoverLayout.Grid2x3, 2, 3, '1x1'],
    [7, CoverLayout.Grid3x3, 3, 3, '1x1'],
    [8, CoverLayout.Grid3x3, 3, 3, '2x2'],
    [9, CoverLayout.Grid3x3, 3, 3, '2x2'],
    [10, CoverLayout.Mosaic, 4, 3, '2x2'],
    [12, CoverLayout.Mosaic, 4, 3, '2x2'],
    [20, CoverLayout.Mosaic, 5, 4, '2x2'],
    [30, CoverLayout.Mosaic, 6, 5, '2x2'],
    [40, CoverLayout.Mosaic, 7, 6, '2x2'],
    [50, CoverLayout.Mosaic, 8, 7, '2x2'],
    [60, CoverLayout.Mosaic, 8, 8, '2x2'],
  ] as const)(
    'maps %i images to the authoritative layout',
    (count, layout, columns, rows, span) => {
      const result = composeCover(coverInput({ count }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.layout).toBe(layout);
      expect(result.composition.layout).toMatchObject({ layout, columns, rows, heroSpan: span });
      expect(result.value.sourceSaleImageIds).toHaveLength(count);
    },
  );

  it('balances trailing cells without inventing or duplicating images', () => {
    const result = composeCover(coverInput({ count: 7 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.layout.capacity).toBe(9);
    expect(result.value.promptText).toContain('2 trailing empty cell(s)');
    expect(result.value.promptText).toContain('never invent or duplicate images');
    expect(new Set(result.value.sourceSaleImageIds).size).toBe(7);
  });

  it('keeps the hero at a 2x2 span for large bundles', () => {
    const result = composeCover(coverInput({ count: 50 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.layout.heroSpan).toBe('2x2');
    expect(result.value.promptText).toContain('hero image occupies a 2x2 span');
    expect(result.value.promptText).toContain('hero remains the largest image');
  });
});

describe('Cover Engine metadata and priority', () => {
  it('computes product, color, and view modes and ignores hostile seed primaries', () => {
    const sources = [
      source(1, { productId: PRODUCT_B, output: { color: NAVY, view: GarmentView.Back } }),
      source(2, { productId: PRODUCT_A, output: { color: WHITE, view: GarmentView.Front } }),
      source(3, { productId: PRODUCT_A, output: { color: WHITE, view: GarmentView.Front } }),
    ];
    const base = coverInput({ count: 3, saleImages: sources });
    const result = composeCover({
      ...base,
      metadata: {
        ...base.metadata,
        primaryProduct: PRODUCT_B,
        primaryColor: SAND,
        primaryView: GarmentView.Back,
        primaryAudience: Audience.Unisex,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readMetadata).toMatchObject({
      primaryProduct: PRODUCT_A,
      primaryColor: WHITE,
      primaryView: GarmentView.Front,
      primaryAudience: Audience.Unisex,
    });
  });

  it('uses the lexicographically smallest value for every mode tie', () => {
    const sources = [
      source(1, { productId: PRODUCT_B, output: { color: SAND, view: GarmentView.Side } }),
      source(2, { productId: PRODUCT_A, output: { color: NAVY, view: GarmentView.Back } }),
    ];
    const result = composeCover(coverInput({ count: 2, saleImages: sources }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readMetadata.primaryProduct).toBe(PRODUCT_A);
    expect(result.value.readMetadata.primaryColor).toBe(NAVY);
    expect(result.value.readMetadata.primaryView).toBe(GarmentView.Back);
  });

  it('orders the primary color first and every remaining locked color lexicographically', () => {
    const sources = [
      source(1, { output: { color: SAND } }),
      source(2, { output: { color: SAND } }),
      source(3, { output: { color: WHITE } }),
    ];
    const result = composeCover(coverInput({ count: 3, saleImages: sources }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.orderedColorIds).toEqual([SAND, NAVY, WHITE]);
  });

  it('selects the exact primary match as hero, then uses scene order and id', () => {
    const sources = [
      source(3, {
        productId: PRODUCT_A,
        sceneOrder: 3,
        displayMethod: DisplayMethod.Hanger,
        output: { color: WHITE, view: GarmentView.Front },
      }),
      source(2, {
        productId: PRODUCT_A,
        sceneOrder: 2,
        displayMethod: DisplayMethod.OnModel,
        output: { color: WHITE, view: GarmentView.Front },
      }),
      source(1, {
        productId: PRODUCT_B,
        sceneOrder: 1,
        displayMethod: DisplayMethod.OnModel,
        output: { color: NAVY, view: GarmentView.Back },
      }),
    ];
    const result = composeCover(coverInput({ count: 3, saleImages: sources }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.heroImageId).toBe('2A');
    expect(result.composition.supportImageIds).toEqual(['3A', '1A']);
  });

  it('selects the best available back view for an all-back-view session', () => {
    const sources = [1, 2, 3].map((index) =>
      source(index, {
        productId: PRODUCT_A,
        output: { color: WHITE, view: GarmentView.Back },
        displayMethod: index === 2 ? DisplayMethod.OnModel : DisplayMethod.Hanger,
      }),
    );
    const result = composeCover(coverInput({ count: 3, saleImages: sources }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readMetadata.primaryView).toBe(GarmentView.Back);
    expect(result.composition.heroImageId).toBe('1A');
  });

  it('uses the manifest product name and primary plus More for multiple products', () => {
    const result = composeCover(coverInput({ count: 4 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain('Manifest Alpha Tee & More Mockup Bundle');
    expect(result.value.promptText).toContain('Product: Manifest Alpha Tee & More');
  });

  it('uses a neutral Studio label for Minimal Studio', () => {
    const result = composeCover(coverInput({ count: 2, seasonKind: SeasonKind.MinimalStudio }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain('Season: Studio');
    expect(result.value.promptText).toContain('Minimal Studio uses the cleanest neutral styling');
    expect(result.value.promptText).not.toContain('Season: Minimal Studio');
  });

  it('derives all dynamic counts from authoritative inputs', () => {
    const result = composeCover(coverInput({ count: 8 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readMetadata.mockupCount).toBe(8);
    expect(result.value.readMetadata.productIds).toHaveLength(2);
    expect(result.value.readMetadata.colors).toEqual([NAVY, SAND, WHITE]);
    expect(result.value.readMetadata.views).toEqual([GarmentView.Back, GarmentView.Front]);
    expect(result.value.promptText).toContain('8 mockups; 2 views; 3 colors');
  });

  it('reads color names and values only from the supplied locked manifests', () => {
    const custom = COLORS.map((color) =>
      color.id === WHITE ? { ...color, name: 'Manifest White' } : color,
    );
    const result = composeCover(coverInput({ lockedColors: custom }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain('Manifest White (#FFFFFF)');
  });
});
