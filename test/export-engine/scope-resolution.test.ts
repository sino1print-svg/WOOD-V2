import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import type { ExportEngineInput } from '../../src/shared/contracts';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_GROUP_ID,
  CANONICAL_SCENE,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION,
  CANONICAL_SESSION_ID,
} from './fixtures';

function inputFor(scope: ExportEngineInput['scope']): ExportEngineInput {
  return { ...CANONICAL_EXPORT_INPUT, scope };
}

describe('Export scope resolution — EX §3', () => {
  it.each(CANONICAL_SCOPES)('resolves $scopeDetail deterministically', (scope) => {
    const first = createExportPlan(inputFor(scope));
    const second = createExportPlan(inputFor(scope));

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.scope.baseScope).toBe(scope.baseScope);
    expect(first.value.scope.scopeDetail).toBe(scope.scopeDetail);
  });

  it('resolves singular Output A, Output B, pair, group, and cover selectors exactly', () => {
    const outputA = createExportPlan(inputFor(CANONICAL_SCOPES[0]));
    const outputB = createExportPlan(inputFor(CANONICAL_SCOPES[1]));
    const pair = createExportPlan(inputFor(CANONICAL_SCOPES[2]));
    const group = createExportPlan(inputFor(CANONICAL_SCOPES[3]));
    const cover = createExportPlan(inputFor(CANONICAL_SCOPES[6]));

    expect(outputA.ok && outputA.value.scope.outputAIds).toEqual([CANONICAL_SCENE.outputA.id]);
    expect(outputB.ok && outputB.value.scope.outputBIds).toEqual([CANONICAL_SCENE.outputB?.id]);
    expect(pair.ok && pair.value.selection.ordered.map((item) => item.kind)).toEqual([
      'output_a',
      'output_b',
    ]);
    expect(group.ok && group.value.scope.groupIds).toEqual([CANONICAL_GROUP_ID]);
    expect(cover.ok && cover.value.scope.coverIds).toEqual([CANONICAL_SESSION.cover?.id]);
  });

  it('resolves session and project scopes from persisted order arrays', () => {
    for (const index of [7, 8, 9, 13, 14, 15]) {
      const result = createExportPlan(inputFor(CANONICAL_SCOPES[index]!));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.scope.sessionIds).toEqual([CANONICAL_SESSION_ID]);
      expect(result.value.scope.sceneIds).toEqual([CANONICAL_SCENE_ID]);
    }
  });

  it('resolves backup scopes without packaging or restore behavior', () => {
    const full = createExportPlan(inputFor(CANONICAL_SCOPES[10]));
    const session = createExportPlan(inputFor(CANONICAL_SCOPES[11]));
    const version = createExportPlan(inputFor(CANONICAL_SCOPES[12]));

    expect(full.ok).toBe(true);
    expect(session.ok).toBe(true);
    expect(version.ok).toBe(true);
    if (!full.ok || !session.ok || !version.ok) return;
    expect(full.value.scope.policy.backupResolutionOnly).toBe(true);
    expect(session.value.scope.policy.backupResolutionOnly).toBe(true);
    expect(version.value.scope.policy.backupResolutionOnly).toBe(true);
    expect(full.value.selection.outputsA).toEqual([]);
    expect(full.value.selection.outputsB).toEqual([]);
    expect(full.value.selection.covers).toEqual([]);
    expect(full.value.selection.versions).toHaveLength(1);
    expect(session.value.selection.versions).toEqual([]);
    expect(version.value.selection.versions).toHaveLength(1);
  });

  it('fails closed for a mismatched selector instead of widening the scope', () => {
    const result = createExportPlan(
      inputFor({
        ...CANONICAL_SCOPES[0],
        outputAId: 'not-the-selected-output' as typeof CANONICAL_SCENE.outputA.id,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_SCOPE_001']);
  });
});
