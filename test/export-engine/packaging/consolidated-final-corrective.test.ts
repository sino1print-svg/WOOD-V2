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
import type { ExportPackageInput, ExportPackageResult } from '../../../src/export/packaging';
import { writeDeterministicZip } from '../../../src/export/packaging/zip-writer';
import { registeredExportFailure } from '../../../src/export/failures';
import type { ExportPlan, ExportPlanOmission } from '../../../src/shared/contracts/export-planning';
import {
  ExportScope,
  GroupBy,
  ValidationSeverity,
  type GroupId,
  type OutputAId,
  type OutputBId,
  type Project,
  type SceneId,
  type SessionId,
  type ValidationFailure,
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

/**
 * Deficiency Closure §12 - exact required helper shape: asserts exact array
 * equality on `failures`/`warnings`/`omissions` (never `.some(code)`), plus
 * the absence of every success-only field.
 */
function expectBlockingFailure(
  result: ExportPackageResult,
  expected: {
    readonly failures: readonly ValidationFailure[];
    readonly warnings: readonly ValidationFailure[];
    readonly omissions: readonly ExportPlanOmission[];
  },
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.failures).toEqual(expected.failures);
  expect(result.warnings).toEqual(expected.warnings);
  expect(result.omissions).toEqual(expected.omissions);
  expect('zipBytes' in result).toBe(false);
  expect('zipSha256' in result).toBe(false);
  expect('manifestBytes' in result).toBe(false);
  expect('checksumsBytes' in result).toBe(false);
  expect('entries' in result).toBe(false);
}

/** Derives the exact `expectBlockingFailure` expectation from the mutated plan actually fed to `packageExport`, rather than guessing at warnings/omissions. */
function blockingFailureFor(
  plan: ExportPlan,
  code: string,
  field: string,
): {
  readonly failures: readonly ValidationFailure[];
  readonly warnings: readonly ValidationFailure[];
  readonly omissions: readonly ExportPlanOmission[];
} {
  const failure = registeredExportFailure(code, field);
  expect(failure).not.toBeNull();
  return {
    failures: [failure!],
    warnings: plan.issues.filter((issue) => issue.severity === ValidationSeverity.Warning),
    omissions: plan.omissions,
  };
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

/** A real `output_b` scope plan (single session, single scene, no Output A selected). */
function outputBOnlyPlan() {
  const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[1]! });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  return structuredClone(planResult.value);
}

/** A real `session` scope plan spanning the two real, distinct canonical multi-scene scenes. */
function sessionMultiScenePlan() {
  const planResult = createExportPlan({
    ...createCanonicalMultiSceneExportInput(),
    scope: {
      baseScope: ExportScope.Session,
      scopeDetail: 'session',
      sessionId: CANONICAL_SESSION_ID,
    },
  });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  expect(planResult.value.selection.outputsA.length).toBe(2);
  expect(planResult.value.selection.outputsB.length).toBe(2);
  return structuredClone(planResult.value);
}

/**
 * A real `session` scope plan spanning THREE distinct scenes in one session -
 * needed for the "middle position" and "reordered (not merely reversed)"
 * mandatory matrix cases, which are indistinguishable from their two-scene
 * counterparts with fewer than three real identities.
 */
function threeSceneSessionPlan() {
  const base = createCanonicalMultiSceneExportInput();
  const project = structuredClone(base.source.project) as Project;
  const session = project.sessions[CANONICAL_SESSION_ID]!;
  const templateSceneId = session.sceneOrder[0]!;
  const templateScene = session.scenes[templateSceneId]!;
  const thirdSceneId = 'scene-third' as SceneId;
  const thirdOutputAId = 'output-a-third' as OutputAId;
  const thirdOutputBId = 'output-b-third' as OutputBId;
  const thirdScene = {
    ...templateScene,
    id: thirdSceneId,
    outputA: { ...templateScene.outputA, id: thirdOutputAId, sceneId: thirdSceneId },
    outputB: {
      ...templateScene.outputB!,
      id: thirdOutputBId,
      sceneId: thirdSceneId,
      sourceOutputAId: thirdOutputAId,
    },
  };
  const updatedSession = {
    ...session,
    scenes: { ...session.scenes, [thirdSceneId]: thirdScene },
    sceneOrder: [...session.sceneOrder, thirdSceneId],
    requestedSceneCount: session.sceneOrder.length + 1,
  };
  project.sessions = { ...project.sessions, [CANONICAL_SESSION_ID]: updatedSession };
  const planResult = createExportPlan({
    ...base,
    source: { ...base.source, project },
    scope: {
      baseScope: ExportScope.Session,
      scopeDetail: 'session',
      sessionId: CANONICAL_SESSION_ID,
    },
  });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  expect(planResult.value.numbering.length).toBe(3);
  expect(planResult.value.selection.outputsA.length).toBe(3);
  expect(planResult.value.selection.outputsB.length).toBe(3);
  return structuredClone(planResult.value);
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

describe('Deficiency Closure §5/F3 - independent numbering identity/scene-membership matrix', () => {
  it('fake scene in a valid session, canonical A/B id sequence unchanged: rejected, no bytes', () => {
    // Independent Audit F3 reproduction 1: only the row's own `sceneId` is
    // forged to a scene that does not exist for this session - `outputAId`/
    // `outputBId` (and therefore `scope.outputAIds`/`outputBIds`'s exact
    // sequence) are left untouched, so only the independent scene-membership
    // check (not the canonical-order check) can catch this.
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      numbering: plan.numbering.map((entry) => ({
        ...entry,
        sceneId: 'scene-fake-in-session' as SceneId,
      })),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('duplicate (sessionId, sceneId) numbering identity, distinct canonical A ids preserved: rejected, no bytes', () => {
    // Independent Audit F3 reproduction 2: two genuine numbering rows (their
    // own outputAId/outputBId left exactly as-is, so `scope.outputAIds`'s
    // exact sequence is undisturbed) are forged to share the same
    // `(sessionId, sceneId)` identity - only the independent duplicate-
    // identity check (not the canonical-order check) can catch this.
    const plan = sessionMultiScenePlan();
    expect(plan.numbering.length).toBe(2);
    const [first, second] = plan.numbering;
    const mutated: ExportPlan = {
      ...plan,
      numbering: [first!, { ...second!, sceneId: first!.sceneId }],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('out-of-scope scene row at the first position (real, preserved canonical id): rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const mutated: ExportPlan = {
      ...plan,
      numbering: plan.numbering.map((entry, index) =>
        index === 0 ? { ...entry, sceneId: 'scene-out-of-scope' as SceneId } : entry,
      ),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('out-of-scope scene row at the middle position (real, preserved canonical id): rejected, no bytes', () => {
    const plan = threeSceneSessionPlan();
    const mutated: ExportPlan = {
      ...plan,
      numbering: plan.numbering.map((entry, index) =>
        index === 1 ? { ...entry, sceneId: 'scene-out-of-scope' as SceneId } : entry,
      ),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('out-of-scope scene row at the last position (real, preserved canonical id): rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const mutated: ExportPlan = {
      ...plan,
      numbering: plan.numbering.map((entry, index) =>
        index === plan.numbering.length - 1
          ? { ...entry, sceneId: 'scene-out-of-scope' as SceneId }
          : entry,
      ),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('extra fabricated numbering row injected in the middle position: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const extra = {
      ...plan.numbering[0]!,
      sceneId: 'scene-injected' as SceneId,
      sceneNumber: 99,
      outputAId: 'output-a-injected' as OutputAId,
      outputALabel: '99A' as never,
      outputBId: 'output-b-injected' as OutputBId,
      outputBLabel: '99B' as never,
    };
    const mutated: ExportPlan = {
      ...plan,
      numbering: [plan.numbering[0]!, extra, plan.numbering[1]!],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });
});

describe('Deficiency Closure §6/F4 - partial selection and omission evidence matrix', () => {
  it('pair: remove selected Output B and clear omissions/issues: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsB: [] },
      omissions: [],
      issues: [],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('pair: remove selected Output A and Output B and clear omissions/issues: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsA: [], outputsB: [] },
      omissions: [],
      issues: [],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('output_b: remove selected Output B and clear omissions/issues: rejected, no bytes', () => {
    const plan = outputBOnlyPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsB: [] },
      omissions: [],
      issues: [],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('session: remove one selected Output A and clear omissions/issues: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const [firstOutputA] = plan.selection.outputsA;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: plan.selection.outputsA.filter((outputA) => outputA.id !== firstOutputA!.id),
      },
      omissions: [],
      issues: [],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('session: remove one selected Output B and clear omissions/issues: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const [firstOutputB] = plan.selection.outputsB;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.filter((outputB) => outputB.id !== firstOutputB!.id),
      },
      omissions: [],
      issues: [],
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('real partial pair (planner-produced, genuine B omission): succeeds, exact omission preserved, no B/pair file', () => {
    // "Do not treat absence as implicit omission" cuts both ways: a real,
    // planner-produced omission (never fabricated by this test) must still
    // be accepted, not merely a hostile absence rejected.
    const result = packageExport(
      createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds).not.toContain('prompt_b');
    expect(kinds).not.toContain('prompt_pair');
    expect(result.omissions).toEqual([
      {
        artifactKind: 'output_b',
        entityId: 'scene-001:output_b',
        field: 'source.project.sessions.جلسة-001.scenes.scene-001.outputB',
        code: 'EXPORT_SCOPE_002',
      },
    ]);
  });
});

describe('Deficiency Closure §7/F5 - selected Output A exact field/order reconciliation matrix', () => {
  it('sceneNumber changed only (label left agreeing with the real numbering row): rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: plan.selection.outputsA.map((outputA) => ({
          ...outputA,
          sceneNumber: outputA.sceneNumber + 8,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('label changed only: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: plan.selection.outputsA.map((outputA) => ({
          ...outputA,
          label: '9A' as never,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('sceneNumber and label changed together (self-consistent, disagrees with the real numbering row): rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: plan.selection.outputsA.map((outputA) => ({
          ...outputA,
          sceneNumber: 9,
          label: '9A' as never,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('selected Output A array reversed: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsA: [...plan.selection.outputsA].reverse() },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('selected Output A array reordered with the same id set (not a simple reversal): rejected, no bytes', () => {
    const plan = threeSceneSessionPlan();
    const [first, second, third] = plan.selection.outputsA;
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsA: [third!, first!, second!] },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });
});

describe('Deficiency Closure §8/F6 - selected Output B exact field/order reconciliation matrix', () => {
  it('sceneNumber changed only: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((outputB) => ({
          ...outputB,
          sceneNumber: outputB.sceneNumber + 8,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('label changed only: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((outputB) => ({
          ...outputB,
          label: '9B' as never,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('sourceOutputALabel changed only: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((outputB) => ({
          ...outputB,
          sourceOutputALabel: '9A' as never,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('all three display fields changed together (self-consistent, disagrees with the real numbering row): rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((outputB) => ({
          ...outputB,
          sceneNumber: 9,
          label: '9B' as never,
          sourceOutputALabel: '9A' as never,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('selected Output B array reversed: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsB: [...plan.selection.outputsB].reverse() },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });
});

describe('Deficiency Closure §9/F7 - group numbering exactness against authoritative group metadata', () => {
  it('groupNumber changed with both Output A and Output B labels updated consistently: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated: ExportPlan = {
      ...plan,
      groupNumbering: plan.groupNumbering.map((row) => ({
        ...row,
        groupNumber: 9,
        outputALabel: `9.${row.groupSceneNumber}-A` as never,
        ...(row.outputBLabel !== undefined
          ? { outputBLabel: `9.${row.groupSceneNumber}-B` as never }
          : {}),
      })),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_GROUP_001', 'packaging.groupNumbering'),
    );
  });

  it('groupSceneNumber changed with both Output A and Output B labels updated consistently: rejected, no bytes', () => {
    // Independent Audit F7: the pre-existing "wrong groupSceneNumber" test
    // only updated the A label, so its rejection did not actually prove the
    // authoritative ordinal (not merely the row's own A/B self-consistency)
    // was checked - this variant updates both labels together.
    const { plan } = twoSceneGroupPlan();
    const mutated: ExportPlan = {
      ...plan,
      groupNumbering: plan.groupNumbering.map((row, index) =>
        index === 0
          ? {
              ...row,
              groupSceneNumber: 9,
              outputALabel: `${row.groupNumber}.9-A` as never,
              ...(row.outputBLabel !== undefined
                ? { outputBLabel: `${row.groupNumber}.9-B` as never }
                : {}),
            }
          : row,
      ),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_GROUP_001', 'packaging.groupNumbering'),
    );
  });

  it('two valid group-numbering rows physically reversed: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    expect(plan.groupNumbering.length).toBe(2);
    const mutated: ExportPlan = {
      ...plan,
      groupNumbering: [...plan.groupNumbering].reverse(),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_GROUP_001', 'packaging.groupNumbering'),
    );
  });
});

describe('Deficiency Closure §10/F10 - public ZIP writer hostile-runtime boundary', () => {
  /** Calls `fn` and proves no exception escapes, regardless of what it returns. */
  function callNeverThrows(fn: () => unknown): unknown {
    let outcome: { readonly threw: false; readonly value: unknown } | { readonly threw: true };
    try {
      outcome = { threw: false, value: fn() };
    } catch (error) {
      outcome = { threw: true };
      expect.fail(`writeDeterministicZip threw: ${String(error)}`);
    }
    return outcome.threw ? undefined : outcome.value;
  }

  it('null entries: typed failure, never throws', () => {
    const result = callNeverThrows(() => writeDeterministicZip(null as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('non-array entries: typed failure, never throws', () => {
    const hostile = { length: 1, 0: { path: 'a', bytes: new Uint8Array() } };
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('sparse entry array: typed failure, never throws', () => {
    const sparse: unknown[] = new Array(2);
    sparse[1] = { path: 'a', bytes: new Uint8Array() };
    const result = callNeverThrows(() => writeDeterministicZip(sparse as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('entry with a throwing path getter: typed failure, never throws', () => {
    const hostile = [
      {
        get path(): string {
          throw new Error('boom');
        },
        bytes: new Uint8Array(),
      },
    ];
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('throwing Proxy entry: typed failure, never throws', () => {
    const hostile = [
      new Proxy(
        {},
        {
          get(): never {
            throw new Error('boom');
          },
        },
      ),
    ];
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('throwing Proxy-wrapped entries array: typed failure, never throws', () => {
    const real = [{ path: 'a', bytes: new Uint8Array([1, 2, 3]) }];
    const hostile = new Proxy(real, {
      get(target, property): unknown {
        if (property === 'length') throw new Error('boom');
        return Reflect.get(target, property);
      },
    });
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('entry with a non-string path: typed failure, never throws', () => {
    const hostile = [{ path: 123, bytes: new Uint8Array() }];
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('entry with non-Uint8Array bytes: typed failure, never throws', () => {
    const hostile = [{ path: 'a', bytes: 'not-bytes' }];
    const result = callNeverThrows(() => writeDeterministicZip(hostile as never, 100, 1_000_000));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('entry with inherited (not own) path/bytes fields: never throws', () => {
    const proto = { path: 'a/inherited.txt', bytes: new Uint8Array([1, 2, 3]) };
    const entry = Object.create(proto) as { path: string; bytes: Uint8Array };
    const result = callNeverThrows(() => writeDeterministicZip([entry] as never, 100, 1_000_000));
    expect(typeof (result as { ok: boolean }).ok).toBe('boolean');
  });
});
