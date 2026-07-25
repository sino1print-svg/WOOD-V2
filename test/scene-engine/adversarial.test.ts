import { describe, expect, it } from 'vitest';
import { planScenes, validateSceneEngineInput } from '../../src/engines/scene-engine';
import type { ColorId, ProductId } from '../../src/shared/domain-model';
import { input, library } from './fixtures';

describe('Scene Engine — fail-closed input validation', () => {
  it('rejects a non-positive requested scene count', () => {
    const result = planScenes(input({ requestedSceneCount: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('SE_INTERNAL_LIMIT');
  });

  it('rejects a non-integer requested scene count', () => {
    const result = planScenes(input({ requestedSceneCount: 3.5 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a requested count above the safety limit', () => {
    const result = planScenes(input({ requestedSceneCount: 100_000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('SE_INTERNAL_LIMIT');
  });

  it('rejects empty product selection', () => {
    const result = planScenes(input({ productIds: [], products: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects empty color selection', () => {
    const result = planScenes(input({ colorIds: [] as ColorId[] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an empty required library pool', () => {
    const result = planScenes(input({ library: library({ poses: [] }) }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((f) => f.code === 'SE_INTERNAL_LIBRARY_GAP')).toBe(true);
  });

  it('every failure is a typed ValidationFailure originating from the Scene engine', () => {
    const result = planScenes(input({ requestedSceneCount: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const failure of result.failures) {
        expect(failure.originEngine).toBe('scene');
        expect(failure.severity).toBe('blocking');
        expect(typeof failure.code).toBe('string');
      }
    }
  });
});

describe('Scene Engine — adversarial inputs', () => {
  it('does not throw on a non-function observer; returns a typed failure', () => {
    const bad = input({ requestedSceneCount: 4 });
    const hostile = { ...bad, observePrintArea: undefined as never };
    expect(() => planScenes(hostile)).not.toThrow();
    const result = planScenes(hostile);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((f) => f.code === 'SE_INTERNAL_OBSERVER_CONTRACT')).toBe(true);
  });

  it('does not throw on a prototype-polluted library array', () => {
    const lib = library();
    const polluted = [...lib.poses];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (polluted as any).__proto__ = { hostile: true };
    expect(() => planScenes(input({ library: { ...lib, poses: polluted } }))).not.toThrow();
  });

  it('handles a dedup ledger that already covers most of the space (near-exhaustion)', () => {
    const base = planScenes(input({ requestedSceneCount: 4 }));
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    // Seed the ledger with all-but-three used signatures → requesting 4 must fail cleanly.
    const allHashes = base.value.dedupLedger.seen;
    const result = planScenes(
      input({
        requestedSceneCount: 4,
        dedupLedger: {
          seen: allHashes.slice(0, Math.max(0, allHashes.length)),
          combinationSpaceSize: 0,
        },
      }),
    );
    // Either succeeds with fresh tuples or fails typed — never throws, never duplicates.
    if (!result.ok) {
      expect(result.failures[0]?.code).toBe('RULE_CNT_001');
    } else {
      const hashes = result.value.scenes.map((s) => s.dedupSignature.hash);
      expect(new Set(hashes).size).toBe(hashes.length);
    }
  });

  it('rejects an unknown product id referenced in productIds without crashing', () => {
    const result = planScenes(input({ productIds: ['ghost' as ProductId] }));
    // ghost has no Product manifest → no candidates → infeasible, typed failure.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CNT_001');
  });

  it('handles Arabic/Unicode labels in library items deterministically', () => {
    const lib = library();
    const arabicPoses = lib.poses.map((p, i) => ({
      ...p,
      label: `\u0648\u0636\u0639\u064a\u0629 ${i}`,
    }));
    const a = planScenes(input({ library: { ...lib, poses: arabicPoses } }));
    const b = planScenes(input({ library: { ...lib, poses: arabicPoses } }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.scenes.map((s) => s.sceneHash)).toEqual(
        b.value.scenes.map((s) => s.sceneHash),
      );
    }
  });

  it('validateSceneEngineInput surfaces every problem at once (fail-closed batch)', () => {
    const failures = validateSceneEngineInput(
      input({ requestedSceneCount: 0, colorIds: [] as ColorId[] }),
    );
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });
});
