import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import {
  ExportScope,
  type CoverId,
  type GroupId,
  type OutputAId,
  type OutputBId,
  type Project,
  type SceneId,
  type SessionId,
} from '../../src/shared/domain-model';
import type { ExportEngineInput } from '../../src/shared/contracts';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from './fixtures';

function successfulPlan() {
  const result = createExportPlan(createCanonicalMultiSceneExportInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.failures.map((failure) => failure.code).join(','));
  return result.value;
}

describe('Export canonical ordering and numbering — EX §6–§7', () => {
  it('derives the fixed {n}A/{n}B map from sceneOrder', () => {
    const plan = successfulPlan();
    expect(
      plan.numbering.map((entry) => ({
        sceneId: entry.sceneId,
        sceneNumber: entry.sceneNumber,
        outputALabel: entry.outputALabel,
        outputBLabel: entry.outputBLabel,
      })),
    ).toEqual([
      {
        sceneId: 'scene-supplementary',
        sceneNumber: 1,
        outputALabel: '1A',
        outputBLabel: '1B',
      },
      {
        sceneId: 'scene-private-use',
        sceneNumber: 2,
        outputALabel: '2A',
        outputBLabel: '2B',
      },
    ]);
  });

  it('retains stable A/B IDs and source linkage alongside display labels', () => {
    const plan = successfulPlan();
    expect(plan.selection.outputsB).toHaveLength(2);
    for (const outputB of plan.selection.outputsB) {
      const outputA = plan.selection.outputsA.find(
        (candidate) => candidate.id === outputB.sourceOutputAId,
      );
      expect(outputA).toBeDefined();
      expect(outputB.sourceOutputALabel).toBe(outputA?.label);
      expect(outputB.sceneNumber).toBe(outputA?.sceneNumber);
    }
  });

  it('orders groups by UTF-8 bytes, not insertion order or UTF-16 collation', () => {
    const plan = successfulPlan();
    expect(plan.selection.groups.map((group) => group.id)).toEqual([
      'group-private-use',
      'group-supplementary',
    ]);
    expect(plan.selection.groups.map((group) => group.groupNumber)).toEqual([1, 2]);
  });

  it('orders scenes by sceneOrder and emits every A before every B', () => {
    const plan = successfulPlan();
    expect(plan.selection.scenes.map((scene) => scene.id)).toEqual([
      'scene-supplementary',
      'scene-private-use',
    ]);
    expect(plan.selection.outputsA.map((output) => output.sceneId)).toEqual([
      'scene-supplementary',
      'scene-private-use',
    ]);
    expect(plan.selection.outputsB.map((output) => output.sceneId)).toEqual([
      'scene-supplementary',
      'scene-private-use',
    ]);
    expect(plan.selection.ordered.map((item) => item.kind)).toEqual([
      'session',
      'group',
      'group',
      'scene',
      'scene',
      'output_a',
      'output_a',
      'output_b',
      'output_b',
      'execution_plan',
      'cover',
    ]);
  });

  it('keeps cover last within the session', () => {
    const plan = successfulPlan();
    expect(plan.selection.ordered.at(-1)).toMatchObject({ kind: 'cover' });
  });

  it('orders multiple sessions strictly by Project.sessionOrder', () => {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const original = project.sessions[CANONICAL_SESSION_ID]!;
    const originalScene = original.scenes[CANONICAL_SCENE_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const secondSceneId = 'scene-second' as SceneId;
    const secondOutputAId = 'output-a-second' as OutputAId;
    const secondOutputBId = 'output-b-second' as OutputBId;
    const secondGroupId = 'group-second' as GroupId;
    const secondCoverId = 'cover-second' as CoverId;
    const secondScene = {
      ...originalScene,
      id: secondSceneId,
      sessionId: secondSessionId,
      outputA: {
        ...originalScene.outputA,
        id: secondOutputAId,
        sceneId: secondSceneId,
      },
      outputB: {
        ...originalScene.outputB!,
        id: secondOutputBId,
        sceneId: secondSceneId,
        sourceOutputAId: secondOutputAId,
      },
    };
    const secondSession = {
      ...original,
      id: secondSessionId,
      scenes: { [secondSceneId]: secondScene },
      sceneOrder: [secondSceneId],
      groups: {
        [secondGroupId]: {
          ...Object.values(original.groups)[0]!,
          id: secondGroupId,
          sessionId: secondSessionId,
          sceneIds: [secondSceneId],
        },
      },
      cover: {
        ...original.cover!,
        id: secondCoverId,
        sessionId: secondSessionId,
        sourceSaleImageIds: [secondOutputAId],
      },
      validationResultId: null,
      validationResults: {},
    };
    project.sessions = {
      [CANONICAL_SESSION_ID]: original,
      [secondSessionId]: secondSession,
    };
    project.sessionOrder = [secondSessionId, CANONICAL_SESSION_ID];

    const result = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.sessions.map((session) => session.id)).toEqual([
      secondSessionId,
      CANONICAL_SESSION_ID,
    ]);
    expect(result.value.selection.outputsA.map((output) => output.sessionId)).toEqual([
      secondSessionId,
      CANONICAL_SESSION_ID,
    ]);
    expect(
      result.value.selection.ordered
        .filter((item) => item.kind === 'cover')
        .map((item) => item.sessionId),
    ).toEqual([secondSessionId, CANONICAL_SESSION_ID]);
  });

  it('builds group numbering from canonical group and session-scene positions', () => {
    const plan = successfulPlan();
    expect(
      plan.groupNumbering.map((entry) => ({
        groupId: entry.groupId,
        sceneNumber: entry.sceneNumber,
        outputALabel: entry.outputALabel,
        outputBLabel: entry.outputBLabel,
      })),
    ).toEqual([
      {
        groupId: 'group-private-use',
        sceneNumber: 2,
        outputALabel: '1.1-A',
        outputBLabel: '1.1-B',
      },
      {
        groupId: 'group-supplementary',
        sceneNumber: 1,
        outputALabel: '2.1-A',
        outputBLabel: '2.1-B',
      },
    ]);
  });

  it('keeps a group number invariant when exporting that group alone', () => {
    const input = createCanonicalMultiSceneExportInput();
    const result = createExportPlan({
      ...input,
      scope: {
        baseScope: ExportScope.Group,
        scopeDetail: 'group',
        sessionId: CANONICAL_SESSION_ID,
        groupId: 'group-supplementary' as GroupId,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.groups[0]?.groupNumber).toBe(2);
    expect(result.value.groupNumbering[0]?.outputALabel).toBe('2.1-A');
    expect(result.value.groupNumbering[0]?.outputBLabel).toBe('2.1-B');
  });

  it('creates the execution plan in two explicit phases', () => {
    const plan = successfulPlan();
    expect(plan.selection.executionPlans).toHaveLength(1);
    expect(plan.selection.executionPlans[0]?.phase1.map((item) => item.label)).toEqual([
      '1A',
      '2A',
    ]);
    expect(plan.selection.executionPlans[0]?.phase2.map((item) => item.label)).toEqual([
      '1B',
      '2B',
    ]);
  });

  it('preserves stored prompt text without trimming or reflow', () => {
    const plan = successfulPlan();
    expect(plan.selection.outputsA[0]?.promptText).toBe(
      'Supplementary-plane product A prompt.\nLine two.',
    );
  });

  it('is independent of entity-map and library-array insertion order', () => {
    const firstInput = createCanonicalMultiSceneExportInput();
    const secondInput = createCanonicalMultiSceneExportInput();
    const sessionId = secondInput.source.project.sessionOrder[0]!;
    const session = secondInput.source.project.sessions[sessionId]!;
    const reversedScenes = Object.fromEntries(Object.entries(session.scenes).reverse());
    const reversedGroups = Object.fromEntries(Object.entries(session.groups).reverse());
    const reordered = {
      ...secondInput,
      source: {
        ...secondInput.source,
        project: {
          ...secondInput.source.project,
          sessions: {
            [sessionId]: { ...session, scenes: reversedScenes, groups: reversedGroups },
          },
        },
        products: [...secondInput.source.products].reverse(),
      },
    };

    expect(createExportPlan(reordered)).toEqual(createExportPlan(firstInput));
  });

  it('does not mutate input and returns deeply frozen owned output', () => {
    const input = createCanonicalMultiSceneExportInput();
    const before = JSON.stringify(input);
    const result = createExportPlan(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.selection.outputsA)).toBe(true);
    expect(Object.isFrozen(result.value.selection.outputsA[0])).toBe(true);
  });

  it('does not let caller timestamps change the deterministic plan', () => {
    const first = createCanonicalMultiSceneExportInput();
    const second = {
      ...createCanonicalMultiSceneExportInput(),
      createdAt: '2026-07-26T11:00:00.000Z' as ExportEngineInput['createdAt'],
    };

    expect(createExportPlan(second)).toEqual(createExportPlan(first));
  });
});
