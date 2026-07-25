import { describe, expect, it } from 'vitest';
import { composeCover } from '../../src/engines/cover-engine';
import { OutputStatus } from '../../src/shared/domain-model';
import { PRODUCTS, coverInput, deepFreeze } from './fixtures';

describe('Cover Engine determinism, caching, and immutability', () => {
  it('returns byte-identical prompt text and hashes for identical inputs', () => {
    const input = coverInput({ count: 20 });
    const first = composeCover(input);
    const second = composeCover(structuredClone(input));
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.promptText).toBe(second.value.promptText);
    expect(first.value.coverHash).toBe(second.value.coverHash);
    expect(first.value.promptHash).toBe(second.value.promptHash);
    expect(first.value.promptMeta?.promptChecksum).toBe(second.value.promptMeta?.promptChecksum);
  });

  it('is invariant to source, manifest, and locked-color input permutations', () => {
    const base = coverInput({ count: 12 });
    const permuted = {
      ...base,
      saleImages: [...base.saleImages].reverse(),
      products: [...base.products].reverse(),
      lockedColors: [...base.lockedColors].reverse(),
      metadata: {
        ...base.metadata,
        productIds: [...base.metadata.productIds].reverse(),
        colors: [...base.metadata.colors].reverse(),
        views: [...base.metadata.views].reverse(),
      },
    };
    const first = composeCover(base);
    const second = composeCover(permuted);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.promptText).toBe(first.value.promptText);
    expect(second.value.coverHash).toBe(first.value.coverHash);
    expect(second.value.promptHash).toBe(first.value.promptHash);
    expect(second.composition).toEqual(first.composition);
  });

  it('excludes generatedAt from coverHash, promptHash, and promptChecksum', () => {
    const firstInput = coverInput();
    const secondInput = { ...firstInput, generatedAt: '2030-01-01T00:00:00.000Z' };
    const first = composeCover(firstInput);
    const second = composeCover(secondInput);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.coverHash).toBe(first.value.coverHash);
    expect(second.value.promptHash).toBe(first.value.promptHash);
    expect(second.value.promptMeta?.promptChecksum).toBe(first.value.promptMeta?.promptChecksum);
    expect(second.value.promptMeta?.generatedAt).not.toBe(first.value.promptMeta?.generatedAt);
  });

  it('changes prompt identity when a manifest name changes without corrupting cover identity', () => {
    const base = coverInput();
    const renamed = coverInput({
      products: PRODUCTS.map((product) =>
        product.id === base.metadata.primaryProduct
          ? { ...product, name: 'Renamed Manifest Product' }
          : product,
      ),
    });
    const first = composeCover(base);
    const second = composeCover(renamed);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.coverHash).toBe(first.value.coverHash);
    expect(second.value.promptHash).not.toBe(first.value.promptHash);
    expect(second.value.promptMeta?.promptChecksum).not.toBe(
      first.value.promptMeta?.promptChecksum,
    );
  });

  it('changes coverHash when a source identity changes', () => {
    const base = coverInput();
    const changedSource = {
      ...base,
      saleImages: base.saleImages.map((item, index) =>
        index === 0
          ? { ...item, output: { ...item.output, id: 'replacement-a' as typeof item.output.id } }
          : item,
      ),
    };
    const first = composeCover(base);
    const second = composeCover(changedSource);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.coverHash).not.toBe(first.value.coverHash);
    expect(second.value.promptHash).not.toBe(first.value.promptHash);
  });

  it('reports and returns a valid cached composition when all content identities match', () => {
    const base = coverInput();
    const first = composeCover(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = composeCover({ ...base, cachedCover: first.value });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.composition.cacheHit).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(second.value).not.toBe(first.value);
  });

  it('does not reuse a stale but runtime-valid cache entry', () => {
    const base = coverInput();
    const first = composeCover(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const changed = coverInput({
      products: PRODUCTS.map((p) => ({ ...p, name: `${p.name} Updated` })),
    });
    const second = composeCover({ ...changed, cachedCover: first.value });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.composition.cacheHit).toBe(false);
    expect(second.value.promptHash).not.toBe(first.value.promptHash);
  });

  it('does not reuse a composition explicitly marked stale even when its hashes match', () => {
    const base = coverInput();
    const first = composeCover(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale = { ...first.value, status: OutputStatus.Stale };
    const second = composeCover({ ...base, cachedCover: stale });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.composition.cacheHit).toBe(false);
    expect(second.value.status).toBe(OutputStatus.Pending);
  });

  it('does not mutate ordinary caller input', () => {
    const input = coverInput({ count: 8 });
    const before = structuredClone(input);
    expect(composeCover(input).ok).toBe(true);
    expect(input).toEqual(before);
  });

  it('accepts deeply frozen input and returns deeply frozen owned output', () => {
    const input = deepFreeze(coverInput({ count: 8 }));
    const result = composeCover(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.readMetadata)).toBe(true);
    expect(Object.isFrozen(result.value.sourceSaleImageIds)).toBe(true);
    expect(Object.isFrozen(result.value.promptMeta)).toBe(true);
    expect(Object.isFrozen(result.value.promptMeta?.moduleVersions)).toBe(true);
    expect(Object.isFrozen(result.composition)).toBe(true);
    expect(Object.isFrozen(result.composition.supportImageIds)).toBe(true);
    expect(Object.isFrozen(result.composition.orderedColorIds)).toBe(true);
  });

  it('returns a deeply immutable typed failure result', () => {
    const result = composeCover(coverInput({ override: { allOutputAReady: false } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.failures)).toBe(true);
    expect(Object.isFrozen(result.failures[0])).toBe(true);
  });

  it('does not share mutable metadata or arrays with caller inputs', () => {
    const input = coverInput();
    const result = composeCover(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readMetadata).not.toBe(input.metadata);
    expect(result.value.sourceSaleImageIds).not.toBe(input.saleImages);
    expect(result.value.readMetadata.colors).not.toBe(input.metadata.colors);
  });
});
