import { describe, expect, it } from 'vitest';
import { planScenes } from '../../src/engines/scene-engine';
import { Audience, GarmentView, GroupBy } from '../../src/shared/domain-model';
import type { ArtworkId, ColorId, ProductId } from '../../src/shared/domain-model';
import { input, product } from './fixtures';

describe('Scene Engine — full pipeline integration (§2)', () => {
  it('produces exactly the requested number of scenes', () => {
    const result = planScenes(input({ requestedSceneCount: 6 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scenes.length).toBe(6);
      expect(result.value.sceneOrder.length).toBe(6);
      expect(result.value.generationProgress.totalScenes).toBe(6);
    }
  });

  it('guarantees hard uniqueness across the session (§8.1)', () => {
    const result = planScenes(input({ requestedSceneCount: 10 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hashes = result.value.scenes.map((s) => s.dedupSignature.hash);
      expect(new Set(hashes).size).toBe(hashes.length);
    }
  });

  it('halts with RULE_CNT_001 when unique space < requested count (§6.4)', () => {
    // Library allows only 54 unique tuples; request more.
    const result = planScenes(input({ requestedSceneCount: 200 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CNT_001');
  });

  it('orders hero scenes first, giving them the flagship (first) color (§14.2 + §10.1)', () => {
    const result = planScenes(
      input({ requestedSceneCount: 4, colorIds: ['color-black', 'color-white'] as ColorId[] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // hero count for 4 = 2; color round-robin over sorted [black, white].
      expect(result.value.scenes[0]!.paletteColorId).toBe('color-black');
      expect(result.value.scenes[0]!.view).toBe(GarmentView.Front);
    }
  });

  it('creates a mandatory Output A for every scene (§17.1)', () => {
    const result = planScenes(input({ requestedSceneCount: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scenes.every((s) => s.outputA !== null && s.outputA !== undefined)).toBe(
        true,
      );
      expect(result.value.scenes.every((s) => s.outputA.status === 'pending')).toBe(true);
      // Output A is blank — no artwork/logo/watermark/typography.
      expect(result.value.scenes.every((s) => s.outputA.forbidden.length === 4)).toBe(true);
    }
  });

  it('leaves Output B null with a RULE_PRV_001 warning when no artwork is present (§17.2)', () => {
    const result = planScenes(input({ requestedSceneCount: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scenes.every((s) => s.outputB === null)).toBe(true);
      expect(result.warnings.some((w) => w.code === 'RULE_PRV_001')).toBe(true);
    }
  });

  it('links Output B to its source Output A when an artwork exists (§17.1)', () => {
    const artwork = new Map<ProductId, string>([['prod-tee' as ProductId, 'art-1']]);
    const result = planScenes(input({ requestedSceneCount: 4, artworkIdsByProduct: artwork }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const scene = result.value.scenes[0]!;
      expect(scene.outputB).not.toBeNull();
      expect(scene.outputB!.sourceOutputAId).toBe(scene.outputA.id);
      expect(scene.outputB!.onlyArtworkChanges).toBe(true);
      expect(scene.outputB!.artworkId).toBe('art-1' as ArtworkId);
    }
  });

  it('plans groups partitioned by the chosen GroupBy dimension (§18)', () => {
    const twoProducts = [
      product({ id: 'prod-a' as ProductId }),
      product({ id: 'prod-b' as ProductId }),
    ];
    const result = planScenes(
      input({
        requestedSceneCount: 8,
        products: twoProducts,
        productIds: ['prod-a', 'prod-b'] as ProductId[],
        groupBy: GroupBy.Product,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.groups.length).toBeGreaterThanOrEqual(1);
      // Every scene in a group shares the group key on the groupBy dimension.
      for (const group of result.value.groups) {
        const scenes = group.sceneIds.map((id) => result.value.scenes.find((s) => s.id === id)!);
        expect(scenes.every((s) => s.productId === group.key)).toBe(true);
      }
      // Groups ordered lexicographically by key.
      const keys = result.value.groups.map((g) => g.key as string);
      expect([...keys].sort()).toEqual(keys);
    }
  });

  it('prepares cover metadata from Sale Images only, with deterministic primaries (§19)', () => {
    const result = planScenes(input({ requestedSceneCount: 8 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cover = result.value.coverMetadata;
      expect(cover.mockupCount).toBe(8);
      expect(cover.seasonId).toBe('season-fall');
      expect(cover.primaryAudience).toBe(Audience.Adult);
      expect(cover.productIds).toContain('prod-tee');
      // No cover object is built here (metadata only).
      expect(cover).not.toHaveProperty('layout');
    }
  });

  it('emits a SceneCreated event per scene with its fingerprint (§5 Step S7)', () => {
    const result = planScenes(input({ requestedSceneCount: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const created = result.value.events.filter((e) => e.type === 'SceneCreated');
      expect(created.length).toBe(4);
      expect(created.every((e) => e.sceneFingerprint.length > 0)).toBe(true);
    }
  });

  it('extends the dedup ledger with the session\u2019s used signatures (§8.1)', () => {
    const result = planScenes(input({ requestedSceneCount: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const used = result.value.scenes.map((s) => s.dedupSignature.hash);
      for (const hash of used) expect(result.value.dedupLedger.seen).toContain(hash);
    }
  });

  it('weighted scoring favors higher-visibility candidates (§7.2)', () => {
    // The observer gives top-down cameras 0.9 visibility vs 0.5 otherwise; with a small
    // session the top scenes should trend toward the higher-visibility camera angle.
    const result = planScenes(input({ requestedSceneCount: 2 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // At least one of the top-2 scenes should use the high-visibility (top-down) camera.
      const anglesUsed = result.value.scenes.map((s) => s.dedupSignature.cameraAngle);
      expect(anglesUsed).toContain('top_down');
    }
  });
});
