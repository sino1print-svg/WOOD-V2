/**
 * Consolidated Final Corrective §20 - mandatory consolidated test oracle.
 *
 * Focuses on coverage genuinely new to this corrective: the numbering
 * matrix (§20.5/§8), the group-numbering matrix (§20.7/§11), the mandatory
 * same-sceneId-different-ordinal fixture (§12.1), and the remaining
 * policy-injection combinations (§20.3) not already exercised in
 * `corrective-adversarial.test.ts` or `scope-matrix.test.ts`. Per §22, prior
 * adversarial tests are not deleted or duplicated here - this file adds to,
 * not replaces, that existing coverage.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput } from '../../../src/export/packaging';
import {
  ExportScope,
  GroupBy,
  type GroupId,
  type OutputAId,
  type OutputBId,
  type Project,
  type SceneId,
  type SessionId,
} from '../../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { createPackageFixture } from './fixtures';

function packageInputFor(planResult: ExportPackageInput['planResult']): ExportPackageInput {
  const { versions, limits, createdAt, exportId } = createPackageFixture();
  return { planResult, versions, limits, createdAt, exportId };
}

/** §20.10 strict failure-assertion template - exact code, and absence of every byte/entry field. */
function expectStrictFailure(result: ReturnType<typeof packageExport>, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.some((failure) => failure.code === code)).toBe(true);
  expect('zipBytes' in result).toBe(false);
  expect('zipSha256' in result).toBe(false);
  expect('manifestBytes' in result).toBe(false);
  expect('checksumsBytes' in result).toBe(false);
  expect('entries' in result).toBe(false);
}

function pairPlan() {
  const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[2]! });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  return structuredClone(planResult.value);
}

function groupPlan() {
  const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[3]! });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  return structuredClone(planResult.value);
}

/** A real `group` scope spanning two real scenes in one session (merged by color). */
function twoSceneGroupPlan() {
  const base = createCanonicalMultiSceneExportInput();
  const project = structuredClone(base.source.project) as Project;
  const session = project.sessions[CANONICAL_SESSION_ID]!;
  const [firstGroupId] = Object.keys(session.groups) as GroupId[];
  const [firstSceneId, secondSceneId] = session.sceneOrder;
  const mergedGroup = {
    ...session.groups[firstGroupId!]!,
    groupBy: GroupBy.Color,
    key: CANONICAL_SCENE.paletteColorId,
    sceneIds: [firstSceneId!, secondSceneId!],
  };
  project.sessions = {
    [CANONICAL_SESSION_ID]: { ...session, groups: { [firstGroupId!]: mergedGroup } },
  };
  const planResult = createExportPlan({
    ...base,
    source: { ...base.source, project },
    scope: {
      baseScope: ExportScope.Group,
      scopeDetail: 'group',
      sessionId: CANONICAL_SESSION_ID,
      groupId: firstGroupId!,
    },
  });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  expect(planResult.value.groupNumbering.length).toBe(2);
  return {
    plan: structuredClone(planResult.value),
    groupId: firstGroupId!,
    firstSceneId: firstSceneId!,
  };
}

describe('Consolidated Final Corrective §8/§20.5 - numbering matrix', () => {
  it('canonical one-scene: numbering exactly matches the canonical scope A/B sequences', () => {
    const plan = pairPlan();
    expect(plan.numbering.map((entry) => entry.outputAId)).toEqual(plan.scope.outputAIds);
    expect(
      plan.numbering
        .filter((entry) => entry.outputBId !== undefined)
        .map((entry) => entry.outputBId),
    ).toEqual(plan.scope.outputBIds);
  });

  it('canonical multi-scene: numbering exactly matches the canonical scope A/B sequences', () => {
    const planResult = createExportPlan(createCanonicalMultiSceneExportInput());
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    const plan = planResult.value;
    expect(plan.numbering.length).toBeGreaterThan(1);
    expect(plan.numbering.map((entry) => entry.outputAId)).toEqual(plan.scope.outputAIds);
  });

  it('§12.1 mandatory fixture: same sceneId string reused across two sessions with different scene ordinals - session 1 never inherits session 2 labels', () => {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const session1 = project.sessions[CANONICAL_SESSION_ID]!;
    const scene1 = session1.scenes[CANONICAL_SCENE_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const sceneExtraId = 'scene-extra' as SceneId;
    const sharedOutputAId = 'output-a-shared2' as OutputAId;
    const sharedOutputBId = 'output-b-shared2' as OutputBId;
    const extraOutputAId = 'output-a-extra' as OutputAId;
    const extraOutputBId = 'output-b-extra' as OutputBId;

    const sceneExtra = {
      ...scene1,
      id: sceneExtraId,
      sessionId: secondSessionId,
      outputA: { ...scene1.outputA, id: extraOutputAId, sceneId: sceneExtraId },
      outputB: {
        ...scene1.outputB!,
        id: extraOutputBId,
        sceneId: sceneExtraId,
        sourceOutputAId: extraOutputAId,
      },
    };
    const sceneSharedInSession2 = {
      ...scene1,
      id: CANONICAL_SCENE_ID,
      sessionId: secondSessionId,
      outputA: { ...scene1.outputA, id: sharedOutputAId, sceneId: CANONICAL_SCENE_ID },
      outputB: {
        ...scene1.outputB!,
        id: sharedOutputBId,
        sceneId: CANONICAL_SCENE_ID,
        sourceOutputAId: sharedOutputAId,
      },
    };
    const secondGroupId = 'group-second' as GroupId;
    const session2 = {
      ...session1,
      id: secondSessionId,
      requestedSceneCount: 2,
      scenes: { [sceneExtraId]: sceneExtra, [CANONICAL_SCENE_ID]: sceneSharedInSession2 },
      sceneOrder: [sceneExtraId, CANONICAL_SCENE_ID],
      groups: {
        [secondGroupId]: {
          ...Object.values(session1.groups)[0]!,
          id: secondGroupId,
          sessionId: secondSessionId,
          sceneIds: [sceneExtraId, CANONICAL_SCENE_ID],
        },
      },
      cover: {
        ...session1.cover!,
        id: 'cover-second' as never,
        sessionId: secondSessionId,
        sourceSaleImageIds: [extraOutputAId],
      },
    };
    project.sessions = { [CANONICAL_SESSION_ID]: session1, [secondSessionId]: session2 };
    project.sessionOrder = [CANONICAL_SESSION_ID, secondSessionId];

    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');

    const numbering = planResult.value.numbering;
    const session1Shared = numbering.find(
      (entry) => entry.sessionId === CANONICAL_SESSION_ID && entry.sceneId === CANONICAL_SCENE_ID,
    )!;
    const session2Extra = numbering.find(
      (entry) => entry.sessionId === secondSessionId && entry.sceneId === sceneExtraId,
    )!;
    const session2Shared = numbering.find(
      (entry) => entry.sessionId === secondSessionId && entry.sceneId === CANONICAL_SCENE_ID,
    )!;
    expect(session1Shared.sceneNumber).toBe(1);
    expect(session1Shared.outputALabel).toBe('1A');
    expect(session2Extra.sceneNumber).toBe(1);
    expect(session2Extra.outputALabel).toBe('1A');
    expect(session2Shared.sceneNumber).toBe(2);
    expect(session2Shared.outputALabel).toBe('2A');

    const result = packageExport(packageInputFor(planResult));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const paths = new Set(result.entries.map((entry) => entry.path));
    const suffix = (path: string) => [...paths].some((entry) => entry.endsWith(path));
    expect(suffix('session-01/prompts/A/001_tee-front_A.txt')).toBe(true);
    expect(suffix('session-01/prompts/B/001_tee-front_B.txt')).toBe(true);
    expect(suffix('session-01/prompts/pairs/001_pair_execution.md')).toBe(true);
    expect(suffix('session-02/prompts/A/001_tee-front_A.txt')).toBe(true);
    expect(suffix('session-02/prompts/B/001_tee-front_B.txt')).toBe(true);
    expect(suffix('session-02/prompts/pairs/001_pair_execution.md')).toBe(true);
    expect(suffix('session-02/prompts/A/002_tee-front_A.txt')).toBe(true);
    expect(suffix('session-02/prompts/B/002_tee-front_B.txt')).toBe(true);
    expect(suffix('session-02/prompts/pairs/002_pair_execution.md')).toBe(true);
  });

  it('extra numbering row injected first: rejected, no bytes', () => {
    const plan = pairPlan();
    const extra = {
      ...plan.numbering[0]!,
      sceneId: 'scene-injected' as SceneId,
      sceneNumber: 99,
      outputAId: 'output-a-injected' as OutputAId,
      outputALabel: '99A' as never,
      outputBId: 'output-b-injected' as OutputBId,
      outputBLabel: '99B' as never,
    };
    const mutated = { ...plan, numbering: [extra, ...plan.numbering] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('extra numbering row injected last: rejected, no bytes', () => {
    const plan = pairPlan();
    const extra = {
      ...plan.numbering[0]!,
      sceneId: 'scene-injected' as SceneId,
      sceneNumber: 99,
      outputAId: 'output-a-injected' as OutputAId,
      outputALabel: '99A' as never,
      outputBId: 'output-b-injected' as OutputBId,
      outputBLabel: '99B' as never,
    };
    const mutated = { ...plan, numbering: [...plan.numbering, extra] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('missing numbering row: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = { ...plan, numbering: [] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('duplicate numbering row: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = { ...plan, numbering: [...plan.numbering, plan.numbering[0]!] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('numbering row outside plan.scope.sessionIds: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({
        ...entry,
        sessionId: 'session-not-in-scope' as SessionId,
      })),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('fake (out-of-scope) Output A id in numbering: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({
        ...entry,
        outputAId: 'output-a-fake' as OutputAId,
      })),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('fake (out-of-scope) Output B id in numbering: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({
        ...entry,
        outputBId: 'output-b-fake' as OutputBId,
      })),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('changed outputALabel (disagrees with sceneNumber): rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({ ...entry, outputALabel: '999A' as never })),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('changed sceneNumber (label now disagrees with the new number): rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({ ...entry, sceneNumber: entry.sceneNumber + 1 })),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_LINK_001',
    );
  });

  it('output_a scope: numbering legitimately carries source-B data without expanding package scope - no B or pair file, package still succeeds', () => {
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[0]! });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    expect(planResult.value.numbering.some((entry) => entry.outputBId !== undefined)).toBe(true);
    expect(planResult.value.scope.outputBIds).toEqual([]);
    const result = packageExport(packageInputFor(planResult));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.some((entry) => entry.kind === 'prompt_b')).toBe(false);
    expect(result.entries.some((entry) => entry.kind === 'prompt_pair')).toBe(false);
  });
});

describe('Consolidated Final Corrective §11/§20.7 - group-numbering matrix', () => {
  it('canonical group A/B rows pass (single-scene group)', () => {
    const plan = groupPlan();
    expect(plan.groupNumbering.length).toBeGreaterThan(0);
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(true);
  });

  it('canonical two-scene group: exactly one group-numbering row per scene, correct group-scene numbers', () => {
    const { plan } = twoSceneGroupPlan();
    expect(plan.groupNumbering.map((row) => row.groupSceneNumber).sort()).toEqual([1, 2]);
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(true);
  });

  it('duplicate group-numbering row: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated = { ...plan, groupNumbering: [...plan.groupNumbering, plan.groupNumbering[0]!] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('extra (fabricated) group-numbering row: rejected, no bytes', () => {
    const { plan, groupId } = twoSceneGroupPlan();
    const fabricated = {
      ...plan.groupNumbering[0]!,
      sceneId: 'scene-injected' as SceneId,
      groupId,
      groupSceneNumber: 99,
      outputAId: 'output-a-injected' as OutputAId,
      outputALabel: `${plan.groupNumbering[0]!.groupNumber}.99-A` as never,
    };
    const mutated = { ...plan, groupNumbering: [...plan.groupNumbering, fabricated] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('missing group-numbering row (removed while group metadata still selects the scene): rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated = { ...plan, groupNumbering: [plan.groupNumbering[0]!] };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('group-numbering A id mismatch against its own numbering row: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated = {
      ...plan,
      groupNumbering: plan.groupNumbering.map((row, index) =>
        index === 0 ? { ...row, outputAId: 'output-a-fake' as OutputAId } : row,
      ),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('group-numbering row for a scene outside its own selected group sceneIds: rejected, no bytes', () => {
    const { plan, groupId, firstSceneId } = twoSceneGroupPlan();
    const mutated = {
      ...plan,
      selection: {
        ...plan.selection,
        groups: plan.selection.groups.map((group) =>
          group.id === groupId ? { ...group, sceneIds: [firstSceneId] } : group,
        ),
      },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('wrong groupSceneNumber: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated = {
      ...plan,
      groupNumbering: plan.groupNumbering.map((row, index) =>
        index === 0
          ? { ...row, groupSceneNumber: 5, outputALabel: `${row.groupNumber}.5-A` as never }
          : row,
      ),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });

  it('wrong outputALabel (disagrees with groupNumber.groupSceneNumber): rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated = {
      ...plan,
      groupNumbering: plan.groupNumbering.map((row, index) =>
        index === 0 ? { ...row, outputALabel: '9.9-A' as never } : row,
      ),
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_GROUP_001',
    );
  });
});

describe('Consolidated Final Corrective §20.3 - remaining policy-injection combinations', () => {
  function planForScope(scope: (typeof CANONICAL_SCOPES)[number]) {
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    return structuredClone(planResult.value);
  }

  it('B injected into output_a: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[0]!);
    const pairSource = planForScope(CANONICAL_SCOPES[2]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsB: pairSource.selection.outputsB },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('B injected into group_a: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[4]!);
    const pairSource = planForScope(CANONICAL_SCOPES[2]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsB: pairSource.selection.outputsB },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('B injected into cover: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[6]!);
    const pairSource = planForScope(CANONICAL_SCOPES[2]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsB: pairSource.selection.outputsB },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('B injected into execution_plan: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[8]!);
    const pairSource = planForScope(CANONICAL_SCOPES[2]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsB: pairSource.selection.outputsB },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('group plan injected into group_a: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[4]!);
    const groupSource = groupPlan();
    const mutated = {
      ...plan,
      selection: { ...plan.selection, groupPlans: groupSource.selection.groupPlans },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('group plan injected into group_b: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[5]!);
    const groupSource = groupPlan();
    const mutated = {
      ...plan,
      selection: { ...plan.selection, groupPlans: groupSource.selection.groupPlans },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('cover injected into output_a (a non-cover-policy scope): rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[0]!);
    const coverSource = planForScope(CANONICAL_SCOPES[6]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, covers: coverSource.selection.covers },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('project metadata injected into a scope whose policy forbids it (output_a): rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[0]!);
    const projectSource = planForScope(CANONICAL_SCOPES[9]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, project: projectSource.selection.project },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('session metadata injected into a scope whose policy forbids it (output_a): rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[0]!);
    const sessionSource = planForScope(CANONICAL_SCOPES[7]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, sessions: sessionSource.selection.sessions },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });

  it('scene metadata injected into a scope whose policy forbids it (output_a): rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[0]!);
    const sessionSource = planForScope(CANONICAL_SCOPES[7]!);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, scenes: sessionSource.selection.scenes },
    };
    expectStrictFailure(
      packageExport(packageInputFor({ ok: true, value: mutated })),
      'EXPORT_SCOPE_001',
    );
  });
});
