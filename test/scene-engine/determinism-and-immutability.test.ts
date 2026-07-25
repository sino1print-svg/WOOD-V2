import { describe, expect, it } from 'vitest';
import { planScenes } from '../../src/engines/scene-engine';
import type { ColorId, ProductId } from '../../src/shared/domain-model';
import { input, product } from './fixtures';

describe('Scene Engine — determinism (§21)', () => {
  it('identical inputs reproduce an identical plan, scene-for-scene', () => {
    const a = planScenes(input({ requestedSceneCount: 8 }));
    const b = planScenes(input({ requestedSceneCount: 8 }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.scenes.map((s) => s.sceneHash)).toEqual(
        b.value.scenes.map((s) => s.sceneHash),
      );
      expect(a.value.sceneOrder).toEqual(b.value.sceneOrder);
      expect(a.value.coverMetadata).toEqual(b.value.coverMetadata);
    }
  });

  it('scene fingerprints are stable across runs', () => {
    const a = planScenes(input({ requestedSceneCount: 5 }));
    const b = planScenes(input({ requestedSceneCount: 5 }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.scenes.map((s) => s.sceneFingerprint)).toEqual(
        b.value.scenes.map((s) => s.sceneFingerprint),
      );
    }
  });

  it('color order does not affect output (colors are sorted internally)', () => {
    const a = planScenes(
      input({ requestedSceneCount: 4, colorIds: ['color-white', 'color-black'] as ColorId[] }),
    );
    const b = planScenes(
      input({ requestedSceneCount: 4, colorIds: ['color-black', 'color-white'] as ColorId[] }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.scenes.map((s) => s.paletteColorId)).toEqual(
        b.value.scenes.map((s) => s.paletteColorId),
      );
    }
  });

  it('product order does not affect the resulting scene set', () => {
    const products = [
      product({ id: 'prod-a' as ProductId }),
      product({ id: 'prod-b' as ProductId }),
    ];
    const a = planScenes(
      input({ requestedSceneCount: 6, products, productIds: ['prod-a', 'prod-b'] as ProductId[] }),
    );
    const b = planScenes(
      input({ requestedSceneCount: 6, products, productIds: ['prod-b', 'prod-a'] as ProductId[] }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.scenes.map((s) => s.sceneHash).sort()).toEqual(
        b.value.scenes.map((s) => s.sceneHash).sort(),
      );
    }
  });
});

describe('Scene Engine — immutability (§21)', () => {
  it('returned scenes are frozen', () => {
    const result = planScenes(input({ requestedSceneCount: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const scene of result.value.scenes) {
        expect(Object.isFrozen(scene)).toBe(true);
        expect(Object.isFrozen(scene.outputA)).toBe(true);
      }
    }
  });

  it('does not mutate the caller\u2019s input objects', () => {
    const original = input({ requestedSceneCount: 4 });
    const constraintsSnapshot = JSON.stringify(original.constraints);
    const ledgerSnapshot = JSON.stringify(original.dedupLedger);
    const librarySnapshot = JSON.stringify(original.library);
    planScenes(original);
    expect(JSON.stringify(original.constraints)).toBe(constraintsSnapshot);
    expect(JSON.stringify(original.dedupLedger)).toBe(ledgerSnapshot);
    expect(JSON.stringify(original.library)).toBe(librarySnapshot);
  });

  it('returns a new dedup ledger rather than mutating the input ledger', () => {
    const original = input({ requestedSceneCount: 4 });
    const result = planScenes(original);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dedupLedger).not.toBe(original.dedupLedger);
      expect(original.dedupLedger.seen.length).toBe(0);
    }
  });
});
