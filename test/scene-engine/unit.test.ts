import { describe, expect, it } from 'vitest';
import {
  assignColors,
  assignViews,
  buildConstraintIndex,
  computeSessionSizeProfile,
  computeSoftCap,
  generateCandidates,
  uniqueDedupSpaceSize,
} from '../../src/engines/scene-engine';
import { Audience, GarmentView, RuleDomain } from '../../src/shared/domain-model';
import type { ColorId, ResolvedConstraint } from '../../src/shared/domain-model';
import { library, product, SEASON } from './fixtures';

function genInput(overrides: Partial<Parameters<typeof generateCandidates>[0]> = {}) {
  const lib = overrides.library ?? library();
  const prod = product();
  return {
    season: SEASON as string,
    audience: Audience.Adult as string,
    productIds: [prod.id],
    products: new Map([[prod.id, prod]]),
    vocabularies: {} as never,
    library: lib,
    constraintIndex: overrides.constraintIndex ?? buildConstraintIndex([]),
    seenDedupHashes: overrides.seenDedupHashes ?? new Set<string>(),
    ...overrides,
  };
}

describe('Scene Engine — candidate generation (§5, §6)', () => {
  it('produces a non-empty candidate space for a valid library', () => {
    const result = generateCandidates(genInput());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('enumerates deterministically (identical inputs → identical candidate order)', () => {
    const a = generateCandidates(genInput());
    const b = generateCandidates(genInput());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.candidates.map((c) => c.dedupHash)).toEqual(b.candidates.map((c) => c.dedupHash));
    }
  });

  it('unique dedup tuples equal template×pose×camera×composition count (§8.1)', () => {
    const result = generateCandidates(genInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2 templates × 3 poses × 3 cameras × 3 compositions = 54 distinct dedup tuples.
      expect(uniqueDedupSpaceSize(result.candidates)).toBe(54);
    }
  });

  it('rejects empty product selection with a typed failure', () => {
    const result = generateCandidates(genInput({ productIds: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('SE_INTERNAL_LIBRARY_GAP');
  });
});

describe('Scene Engine — impossible-combination rejection (§6.3)', () => {
  it('drops candidates whose dimension value is Forbidden by a rule', () => {
    const forbidPose: ResolvedConstraint = {
      bucketKey: 'pose-a',
      domain: RuleDomain.Model,
      target: 'pose-a',
      forbidden: true,
      lockedTo: null,
      limit: null,
      required: false,
      winningRuleIds: [],
    };
    const withForbid = generateCandidates(
      genInput({ constraintIndex: buildConstraintIndex([forbidPose]) }),
    );
    const without = generateCandidates(genInput());
    expect(withForbid.ok && without.ok).toBe(true);
    if (withForbid.ok && without.ok) {
      expect(withForbid.candidates.length).toBeLessThan(without.candidates.length);
      expect(withForbid.candidates.every((c) => c.poseId !== 'pose-a')).toBe(true);
    }
  });

  it('drops candidates that reuse a dedup hash already in the ledger', () => {
    const base = generateCandidates(genInput());
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const oneHash = base.candidates[0]!.dedupHash;
    const filtered = generateCandidates(genInput({ seenDedupHashes: new Set([oneHash]) }));
    expect(filtered.ok).toBe(true);
    if (filtered.ok) {
      expect(filtered.candidates.every((c) => c.dedupHash !== oneHash)).toBe(true);
    }
  });

  it('rejects a candidate when two chosen items are mutually exclusive (§4 exclusions)', () => {
    const lib = library({
      compositions: [
        { ...library().compositions[0]!, exclusions: ['pose-a' as never] },
        ...library().compositions.slice(1),
      ],
    });
    const withExclusion = generateCandidates(genInput({ library: lib }));
    expect(withExclusion.ok).toBe(true);
    if (withExclusion.ok) {
      const bad = withExclusion.candidates.filter(
        (c) =>
          (c.compositionId as string) === (library().compositions[0]!.id as string) &&
          c.poseId === 'pose-a',
      );
      expect(bad.length).toBe(0);
    }
  });

  it('rejects a candidate whose requiredCompanion is forbidden (§4 requiredCompanions)', () => {
    const lib = library({
      poses: [
        { ...library().poses[0]!, requiredCompanions: ['dec-leaves' as never] },
        ...library().poses.slice(1),
      ],
    });
    const forbidDecor: ResolvedConstraint = {
      bucketKey: 'dec-leaves',
      domain: RuleDomain.Decor,
      target: 'dec-leaves',
      forbidden: true,
      lockedTo: null,
      limit: null,
      required: false,
      winningRuleIds: [],
    };
    const result = generateCandidates(
      genInput({ library: lib, constraintIndex: buildConstraintIndex([forbidDecor]) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // pose-a requires dec-leaves which is forbidden → no candidate may use pose-a.
      expect(result.candidates.every((c) => c.poseId !== 'pose-a')).toBe(true);
    }
  });

  it('excludes print-area-unsafe decor/props that intersect the print area (§16)', () => {
    const lib = library({ decors: [{ ...library().decors[0]!, printAreaSafe: false }] });
    const result = generateCandidates(genInput({ library: lib }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates.every((c) => c.decorIds.length === 0)).toBe(true);
    }
  });
});

describe('Scene Engine — palette lock filtering (§14; RE §6)', () => {
  it('drops colors outside a locked garment-color set', () => {
    // Palette lock is applied at assignment, not candidate generation (color is not a
    // candidate dimension); this test guards the ConstraintIndex lock lookup instead.
    const lock: ResolvedConstraint = {
      bucketKey: 'color-black',
      domain: RuleDomain.GarmentColor,
      target: 'color-black',
      forbidden: false,
      lockedTo: ['color-black'],
      limit: null,
      required: false,
      winningRuleIds: [],
    };
    const index = buildConstraintIndex([lock]);
    const locked = index.lockedValues(RuleDomain.GarmentColor);
    expect(locked).not.toBeNull();
    expect(locked!.has('color-black')).toBe(true);
    expect(locked!.has('color-white')).toBe(false);
  });
});

describe('Scene Engine — session sizing (§10.1)', () => {
  it.each([
    [4, 2],
    [8, 3],
    [12, 4],
    [20, 6],
    [40, 10],
    [50, 12],
  ])('documented size %i → %i hero scenes', (count, hero) => {
    expect(computeSessionSizeProfile(count).heroCount).toBe(hero);
  });

  it('non-documented size uses round(count × 0.3)', () => {
    expect(computeSessionSizeProfile(10).heroCount).toBe(3);
    expect(computeSessionSizeProfile(6).heroCount).toBe(2);
  });

  it('hero + support always equals the requested count', () => {
    for (const count of [4, 6, 8, 10, 12, 20, 40, 50]) {
      const profile = computeSessionSizeProfile(count);
      expect(profile.heroCount + profile.supportCount).toBe(count);
    }
  });

  it('soft cap = ceil(count / distinct) (§8.3)', () => {
    expect(computeSoftCap(20, 4)).toBe(5);
    expect(computeSoftCap(20, 3)).toBe(7);
    expect(computeSoftCap(4, 0)).toBe(4); // distinct clamped to >= 1
  });
});

describe('Scene Engine — color allocation (§14.2)', () => {
  it('round-robins over lexicographically sorted colors', () => {
    const colors = assignColors(5, ['color-white', 'color-black'] as ColorId[]);
    expect(colors).toEqual([
      'color-black',
      'color-white',
      'color-black',
      'color-white',
      'color-black',
    ]);
  });

  it('single color assigns to every scene', () => {
    const colors = assignColors(3, ['color-only'] as ColorId[]);
    expect(colors).toEqual(['color-only', 'color-only', 'color-only']);
  });

  it('is deterministic', () => {
    const a = assignColors(7, ['b', 'a', 'c'] as ColorId[]);
    const b = assignColors(7, ['b', 'a', 'c'] as ColorId[]);
    expect(a).toEqual(b);
    expect(a[0]).toBe('a');
  });
});

describe('Scene Engine — view allocation (§15.2)', () => {
  it('hero scenes default to Front (V-1)', () => {
    const result = assignViews([
      { isHero: true, allowedViews: [GarmentView.Front, GarmentView.Back] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.views[0]).toBe(GarmentView.Front);
  });

  it('support scenes fill back/side/detail from the deterministic pool (V-2..V-4)', () => {
    const result = assignViews([
      {
        isHero: false,
        allowedViews: [GarmentView.Front, GarmentView.Back, GarmentView.FlatDetail],
      },
      {
        isHero: false,
        allowedViews: [GarmentView.Front, GarmentView.Back, GarmentView.FlatDetail],
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // support pool prioritizes Back before Side before FlatDetail.
      expect(
        result.views.every((v) => v === GarmentView.Back || v === GarmentView.FlatDetail),
      ).toBe(true);
    }
  });

  it('never assigns a view outside allowedViews (V-6) and fails typed when none allowed', () => {
    const result = assignViews([{ isHero: true, allowedViews: [] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PRD_003');
  });
});
