/**
 * Consolidated Final Corrective §20 - mandatory consolidated test oracle.
 *
 * This is the complete table-driven acceptance oracle.  It intentionally
 * repeats frozen categories that also have focused regression tests: a
 * consolidated acceptance decision must not depend on coverage elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport, writeDeterministicZip } from '../../../src/export/packaging';
import type { ExportPackageInput, ExportPackageResult } from '../../../src/export/packaging';
import { registeredExportFailure } from '../../../src/export/failures';
import { makeEntry, type PackageEntry } from '../../../src/export/packaging/package-entry';
import { validatePackagePlanIntegrity } from '../../../src/export/packaging/package-plan';
import type { ExportPlanOmission } from '../../../src/shared/contracts/export-planning';
import type { ExportArtifactKind } from '../../../src/shared/contracts/export-contracts';
import {
  ExportScope,
  GroupBy,
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

function expectStrictFailure(
  result: ExportPackageResult,
  code: string,
  field = code === 'EXPORT_GROUP_001'
    ? 'packaging.groupNumbering'
    : code === 'EXPORT_SCOPE_001'
      ? 'packaging.scope.policy'
      : 'packaging.numbering',
): void {
  expectBlockingFailure(result, {
    failures: [registeredExportFailure(code, field)!],
    warnings: [],
    omissions: [],
  });
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

describe('Deficiency Closure §12 - all supported and rejected scopes in one exact oracle', () => {
  type EntryTuple = readonly [ExportArtifactKind, string];
  const base = (rows: readonly EntryTuple[], root = 'project-001') =>
    rows.map(([kind, relativePath]) => ({ kind, path: `${root}/${relativePath}` }));
  const commonA: readonly EntryTuple[] = [
    ['readme', 'README.md'],
    ['checksums', 'checksums.sha256'],
    ['manifest', 'manifest.json'],
    ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
    ['validation', 'session-01/metadata/validation.json'],
    ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
  ];
  const commonB: readonly EntryTuple[] = [
    ['readme', 'README.md'],
    ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
    ['checksums', 'checksums.sha256'],
    ['manifest', 'manifest.json'],
    ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
    ['validation', 'session-01/metadata/validation.json'],
    ['prompt_b', 'session-01/prompts/B/001_output-b-canonical_B.txt'],
  ];
  const complete: readonly EntryTuple[] = [
    ['readme', 'README.md'],
    ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
    ['checksums', 'checksums.sha256'],
    ['manifest', 'manifest.json'],
    ['project', 'project/project.json'],
    ['cover_metadata', 'session-01/cover/cover-metadata.json'],
    ['cover_prompt', 'session-01/cover/cover-prompt.txt'],
    ['execution_plan', 'session-01/execution-plan.txt'],
    ['group_plan', 'session-01/groups/group-01.txt'],
    ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
    ['validation', 'session-01/metadata/validation.json'],
    ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
    ['prompt_b', 'session-01/prompts/B/001_tee-front_B.txt'],
    ['prompt_pair', 'session-01/prompts/pairs/001_pair_execution.md'],
    ['session_summary', 'session-01/session-summary.md'],
  ];
  const cases: readonly {
    readonly name: string;
    readonly scopeIndex: number;
    readonly entries: readonly { readonly kind: ExportArtifactKind; readonly path: string }[];
  }[] = [
    { name: 'output_a', scopeIndex: 0, entries: base(commonA) },
    { name: 'output_b', scopeIndex: 1, entries: base(commonB) },
    {
      name: 'pair',
      scopeIndex: 2,
      entries: base([
        ['readme', 'README.md'],
        ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
        ['checksums', 'checksums.sha256'],
        ['manifest', 'manifest.json'],
        ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
        ['validation', 'session-01/metadata/validation.json'],
        ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
        ['prompt_b', 'session-01/prompts/B/001_tee-front_B.txt'],
        ['prompt_pair', 'session-01/prompts/pairs/001_pair_execution.md'],
      ]),
    },
    {
      name: 'group',
      scopeIndex: 3,
      entries: base([
        ['readme', 'README.md'],
        ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
        ['checksums', 'checksums.sha256'],
        ['manifest', 'manifest.json'],
        ['group_plan', 'session-01/groups/group-01.txt'],
        ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
        ['validation', 'session-01/metadata/validation.json'],
        ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
        ['prompt_b', 'session-01/prompts/B/001_tee-front_B.txt'],
        ['prompt_pair', 'session-01/prompts/pairs/001_pair_execution.md'],
      ]),
    },
    { name: 'group_a', scopeIndex: 4, entries: base(commonA) },
    { name: 'group_b', scopeIndex: 5, entries: base(commonB) },
    {
      name: 'cover',
      scopeIndex: 6,
      entries: base([
        ['readme', 'README.md'],
        ['checksums', 'checksums.sha256'],
        ['manifest', 'manifest.json'],
        ['cover_metadata', 'session-01/cover/cover-metadata.json'],
        ['cover_prompt', 'session-01/cover/cover-prompt.txt'],
        ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
        ['validation', 'session-01/metadata/validation.json'],
      ]),
    },
    {
      name: 'session',
      scopeIndex: 7,
      entries: base([
        ['readme', 'README.md'],
        ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
        ['checksums', 'checksums.sha256'],
        ['manifest', 'manifest.json'],
        ['cover_metadata', 'session-01/cover/cover-metadata.json'],
        ['cover_prompt', 'session-01/cover/cover-prompt.txt'],
        ['execution_plan', 'session-01/execution-plan.txt'],
        ['group_plan', 'session-01/groups/group-01.txt'],
        ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
        ['validation', 'session-01/metadata/validation.json'],
        ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
        ['prompt_b', 'session-01/prompts/B/001_tee-front_B.txt'],
        ['prompt_pair', 'session-01/prompts/pairs/001_pair_execution.md'],
        ['session_summary', 'session-01/session-summary.md'],
      ]),
    },
    {
      name: 'execution_plan',
      scopeIndex: 8,
      entries: base([
        ['readme', 'README.md'],
        ['checksums', 'checksums.sha256'],
        ['manifest', 'manifest.json'],
        ['execution_plan', 'session-01/execution-plan.txt'],
        ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
        ['validation', 'session-01/metadata/validation.json'],
      ]),
    },
    { name: 'complete_project', scopeIndex: 9, entries: base(complete, 'item-09598bb4fca1') },
    { name: 'all', scopeIndex: 15, entries: base(complete, 'item-09598bb4fca1') },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}: exact ordered path/kind/count and double-run digest`, () => {
      const input = createPackageFixture({ scope: CANONICAL_SCOPES[testCase.scopeIndex]! });
      const first = packageExport(input);
      const second = packageExport(input);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error('expected supported scope success');
      expect(first.entries.map(({ kind, path }) => ({ kind, path }))).toEqual(testCase.entries);
      expect(first.entries).toHaveLength(testCase.entries.length);
      expect(second.zipSha256).toBe(first.zipSha256);
      expect(second.zipBytes).toEqual(first.zipBytes);
    });
  }

  for (const testCase of [
    { name: 'full-project backup', scopeIndex: 10 },
    { name: 'session backup', scopeIndex: 11 },
    { name: 'version snapshot', scopeIndex: 12 },
    { name: 'all-project prompt pack', scopeIndex: 13 },
    { name: 'session prompt pack', scopeIndex: 14 },
  ] as const) {
    it(`${testCase.name}: exact rejected-scope failure and no bytes`, () => {
      expectBlockingFailure(
        packageExport(createPackageFixture({ scope: CANONICAL_SCOPES[testCase.scopeIndex]! })),
        {
          failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope')!],
          warnings: [],
          omissions: [],
        },
      );
    });
  }
});

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

describe('Deficiency Closure §3-§8 - validated index, exact fields, omissions, and A/B order', () => {
  function exactFailure(plan: ReturnType<typeof pairPlan>, code: string, field: string): void {
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: plan })), {
      failures: [registeredExportFailure(code, field)!],
      warnings: [],
      omissions: [],
    });
  }

  it('returns the required nested runtime-read-only validated index', () => {
    const plan = pairPlan();
    const validation = validatePackagePlanIntegrity(plan, createPackageFixture().limits);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error('expected validated index');
    const row = plan.numbering[0]!;
    const trustedRow = validation.value.numberingBySessionAndScene
      .get(row.sessionId)
      ?.get(row.sceneId);
    const trustedA = validation.value.outputABySessionAndScene.get(row.sessionId)?.get(row.sceneId);
    const trustedB = validation.value.outputBBySessionAndScene.get(row.sessionId)?.get(row.sceneId);
    expect(trustedRow).toStrictEqual(row);
    expect(trustedRow).not.toBe(row);
    expect(trustedA).toStrictEqual(plan.selection.outputsA[0]);
    expect(trustedA).not.toBe(plan.selection.outputsA[0]);
    expect(trustedB).toStrictEqual(plan.selection.outputsB[0]);
    expect(trustedB).not.toBe(plan.selection.outputsB[0]);
    expect(
      (validation.value.numberingBySessionAndScene as unknown as { set?: unknown }).set,
    ).toBeUndefined();
  });

  const SCOPE_ARRAY_CASES = [
    {
      name: 'sessionIds',
      source: pairPlan,
      mutate: (plan: ReturnType<typeof pairPlan>) => ({
        ...plan,
        scope: { ...plan.scope, sessionIds: [...plan.scope.sessionIds, plan.scope.sessionIds[0]!] },
      }),
    },
    {
      name: 'groupIds',
      source: groupPlan,
      mutate: (plan: ReturnType<typeof pairPlan>) => ({
        ...plan,
        scope: { ...plan.scope, groupIds: [...plan.scope.groupIds, plan.scope.groupIds[0]!] },
      }),
    },
    {
      name: 'sceneIds',
      source: pairPlan,
      mutate: (plan: ReturnType<typeof pairPlan>) => ({
        ...plan,
        scope: { ...plan.scope, sceneIds: [...plan.scope.sceneIds, plan.scope.sceneIds[0]!] },
      }),
    },
    {
      name: 'outputAIds',
      source: pairPlan,
      mutate: (plan: ReturnType<typeof pairPlan>) => ({
        ...plan,
        scope: { ...plan.scope, outputAIds: [...plan.scope.outputAIds, plan.scope.outputAIds[0]!] },
      }),
    },
    {
      name: 'outputBIds',
      source: pairPlan,
      mutate: (plan: ReturnType<typeof pairPlan>) => ({
        ...plan,
        scope: { ...plan.scope, outputBIds: [...plan.scope.outputBIds, plan.scope.outputBIds[0]!] },
      }),
    },
  ] as const;

  for (const testCase of SCOPE_ARRAY_CASES) {
    it(`maps duplicate ${testCase.name} to its exact scope field`, () => {
      const plan = testCase.mutate(testCase.source());
      exactFailure(plan, 'EXPORT_SCOPE_001', `packaging.scope.${testCase.name}`);
    });
  }

  for (const testCase of [
    { name: 'coverIds', scope: CANONICAL_SCOPES[6]! },
    { name: 'versionIds', scope: CANONICAL_SCOPES[12]! },
  ] as const) {
    it(`maps duplicate ${testCase.name} to its exact scope field`, () => {
      const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: testCase.scope });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) throw new Error('unreachable');
      const plan = structuredClone(planResult.value);
      const mutated = {
        ...plan,
        scope: {
          ...plan.scope,
          [testCase.name]: [...plan.scope[testCase.name], plan.scope[testCase.name][0]!],
        },
      };
      const validation = validatePackagePlanIntegrity(mutated, createPackageFixture().limits);
      expect(validation).toEqual({
        ok: false,
        failures: [
          registeredExportFailure('EXPORT_SCOPE_001', `packaging.scope.${testCase.name}`)!,
        ],
      });
    });
  }

  it('rejects a fake scene in a valid session at the numbering stage even with later evidence removed', () => {
    const plan = pairPlan();
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((row) => ({
        ...row,
        sceneId: 'fake-scene' as SceneId,
      })),
      groupNumbering: [],
      selection: {
        ...plan.selection,
        outputsA: [],
        outputsB: [],
        groups: [],
        groupPlans: [],
      },
    };
    exactFailure(mutated, 'EXPORT_LINK_001', 'packaging.numbering');
  });

  it('rejects duplicate session/scene numbering identity while distinct canonical output IDs remain', () => {
    const result = createExportPlan(createCanonicalMultiSceneExportInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const plan = structuredClone(result.value);
    const first = plan.numbering[0]!;
    const mutated = {
      ...plan,
      numbering: plan.numbering.map((row, index) =>
        index === 1 ? { ...row, sessionId: first.sessionId, sceneId: first.sceneId } : row,
      ),
      groupNumbering: [],
      selection: {
        ...plan.selection,
        outputsA: [],
        outputsB: [],
        groups: [],
        groupPlans: [],
      },
    };
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
      failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.numbering')!],
      warnings: [],
      omissions: [],
    });
  });

  for (const position of ['first', 'middle', 'last'] as const) {
    it(`rejects an extra out-of-scope numbering row in ${position} position`, () => {
      const result = createExportPlan(createCanonicalMultiSceneExportInput());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      const plan = structuredClone(result.value);
      const fake = {
        ...plan.numbering[0]!,
        sceneId: `fake-scene-${position}` as SceneId,
        sceneNumber: 99,
        outputAId: `fake-a-${position}` as OutputAId,
        outputALabel: '99A' as const,
        outputBId: `fake-b-${position}` as OutputBId,
        outputBLabel: '99B' as const,
      };
      const insertAt = position === 'first' ? 0 : position === 'last' ? plan.numbering.length : 1;
      const insert = <T>(values: readonly T[], value: T): readonly T[] => [
        ...values.slice(0, insertAt),
        value,
        ...values.slice(insertAt),
      ];
      const mutated = {
        ...plan,
        scope: {
          ...plan.scope,
          outputAIds: insert(plan.scope.outputAIds, fake.outputAId),
          outputBIds: insert(plan.scope.outputBIds, fake.outputBId),
        },
        numbering: insert(plan.numbering, fake),
        groupNumbering: [],
        selection: {
          ...plan.selection,
          outputsA: [],
          outputsB: [],
          groups: [],
          groupPlans: [],
        },
      };
      expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
        failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.numbering')!],
        warnings: [],
        omissions: [],
      });
    });
  }

  const A_FIELD_CASES = [
    {
      name: 'sceneNumber only',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsA'][number]) => ({
        ...output,
        sceneNumber: output.sceneNumber + 8,
      }),
    },
    {
      name: 'label only',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsA'][number]) => ({
        ...output,
        label: '9A' as const,
      }),
    },
    {
      name: 'sceneNumber and label together',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsA'][number]) => ({
        ...output,
        sceneNumber: 9,
        label: '9A' as const,
      }),
    },
  ] as const;
  for (const testCase of A_FIELD_CASES) {
    it(`rejects selected A ${testCase.name} at the exact A field`, () => {
      const plan = pairPlan();
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsA: plan.selection.outputsA.map(testCase.mutate),
        },
      };
      exactFailure(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA');
    });
  }

  const B_FIELD_CASES = [
    {
      name: 'sceneNumber only',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsB'][number]) => ({
        ...output,
        sceneNumber: output.sceneNumber + 8,
      }),
    },
    {
      name: 'label only',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsB'][number]) => ({
        ...output,
        label: '9B' as const,
      }),
    },
    {
      name: 'sourceOutputALabel only',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsB'][number]) => ({
        ...output,
        sourceOutputALabel: '9A' as const,
      }),
    },
    {
      name: 'all display fields together',
      mutate: (output: ReturnType<typeof pairPlan>['selection']['outputsB'][number]) => ({
        ...output,
        sceneNumber: 9,
        label: '9B' as const,
        sourceOutputALabel: '9A' as const,
      }),
    },
  ] as const;
  for (const testCase of B_FIELD_CASES) {
    it(`rejects selected B ${testCase.name} at the exact B field`, () => {
      const plan = pairPlan();
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsB: plan.selection.outputsB.map(testCase.mutate),
        },
      };
      exactFailure(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB');
    });
  }

  it('rejects reversed selected A order while the canonical ID set is unchanged', () => {
    const planResult = createExportPlan(createCanonicalMultiSceneExportInput());
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    const plan = structuredClone(planResult.value);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsA: [...plan.selection.outputsA].reverse() },
    };
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
      failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.selection.outputsA')!],
      warnings: [],
      omissions: [],
    });
  });

  it('rejects reversed selected B order while the canonical ID set is unchanged', () => {
    const planResult = createExportPlan(createCanonicalMultiSceneExportInput());
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    const plan = structuredClone(planResult.value);
    const mutated = {
      ...plan,
      selection: { ...plan.selection, outputsB: [...plan.selection.outputsB].reverse() },
    };
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
      failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.selection.outputsB')!],
      warnings: [],
      omissions: [],
    });
  });

  const OMISSION_CASES = [
    {
      name: 'pair missing B',
      scope: CANONICAL_SCOPES[2]!,
      removeA: false,
      removeB: true,
      field: 'packaging.selection.outputsB',
    },
    {
      name: 'pair missing A and B',
      scope: CANONICAL_SCOPES[2]!,
      removeA: true,
      removeB: true,
      field: 'packaging.selection.outputsA',
    },
    {
      name: 'output_b missing B',
      scope: CANONICAL_SCOPES[1]!,
      removeA: false,
      removeB: true,
      field: 'packaging.selection.outputsB',
    },
  ] as const;
  for (const testCase of OMISSION_CASES) {
    it(`${testCase.name} with omissions/issues cleared fails closed`, () => {
      const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: testCase.scope });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) throw new Error('unreachable');
      const plan = structuredClone(planResult.value);
      const mutated = {
        ...plan,
        omissions: [],
        issues: [],
        partial: false,
        selection: {
          ...plan.selection,
          outputsA: testCase.removeA ? [] : plan.selection.outputsA,
          outputsB: testCase.removeB ? [] : plan.selection.outputsB,
        },
      };
      expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
        failures: [registeredExportFailure('EXPORT_LINK_001', testCase.field)!],
        warnings: [],
        omissions: [],
      });
    });
  }

  for (const artifact of ['outputsA', 'outputsB'] as const) {
    it(`session scope cannot silently remove one selected ${artifact === 'outputsA' ? 'A' : 'B'}`, () => {
      const planResult = createExportPlan(createCanonicalMultiSceneExportInput());
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) throw new Error('unreachable');
      const plan = structuredClone(planResult.value);
      const mutated = {
        ...plan,
        omissions: [],
        issues: [],
        partial: false,
        selection: {
          ...plan.selection,
          [artifact]: plan.selection[artifact].slice(1),
        },
      };
      expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
        failures: [
          registeredExportFailure(
            'EXPORT_LINK_001',
            `packaging.selection.${artifact === 'outputsA' ? 'outputsB' : artifact}`,
          )!,
        ],
        warnings: [],
        omissions: [],
      });
    });
  }

  it('a real partial pair succeeds with exact omission and no B/pair file', () => {
    const input = createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] });
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) throw new Error('unreachable');
    const result = packageExport(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected real partial success');
    expect(result.omissions).toEqual(input.planResult.value.omissions);
    expect(result.warnings).toEqual(
      input.planResult.value.issues.filter((issue) => issue.severity === 'warning'),
    );
    expect(result.entries.some((entry) => entry.kind === 'prompt_b')).toBe(false);
    expect(result.entries.some((entry) => entry.kind === 'prompt_pair')).toBe(false);
  });
});

describe('Deficiency Closure §9 - authoritative ordered group-numbering rows', () => {
  const HOSTILE_GROUP_CASES = [
    {
      name: 'hostile groupNumber with internally matching labels',
      mutate: (rows: ReturnType<typeof twoSceneGroupPlan>['plan']['groupNumbering']) =>
        rows.map((row) => ({
          ...row,
          groupNumber: 9,
          outputALabel: `9.${row.groupSceneNumber}-A` as never,
          ...(row.outputBId === undefined
            ? {}
            : { outputBLabel: `9.${row.groupSceneNumber}-B` as never }),
        })),
    },
    {
      name: 'hostile groupSceneNumber with internally matching labels',
      mutate: (rows: ReturnType<typeof twoSceneGroupPlan>['plan']['groupNumbering']) =>
        rows.map((row, index) =>
          index === 0
            ? {
                ...row,
                groupSceneNumber: 9,
                outputALabel: `${row.groupNumber}.9-A` as never,
                ...(row.outputBId === undefined
                  ? {}
                  : { outputBLabel: `${row.groupNumber}.9-B` as never }),
              }
            : row,
        ),
    },
    {
      name: 'reversed complete row sequence',
      mutate: (rows: ReturnType<typeof twoSceneGroupPlan>['plan']['groupNumbering']) =>
        [...rows].reverse(),
    },
  ] as const;
  for (const testCase of HOSTILE_GROUP_CASES) {
    it(`rejects ${testCase.name}`, () => {
      const { plan } = twoSceneGroupPlan();
      const mutated = { ...plan, groupNumbering: testCase.mutate(plan.groupNumbering) };
      expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
        failures: [registeredExportFailure('EXPORT_GROUP_001', 'packaging.groupNumbering')!],
        warnings: [],
        omissions: [],
      });
    });
  }
});

describe('Deficiency Closure §10 - public ZIP writer hostile-runtime matrix', () => {
  const bytes = new TextEncoder().encode('safe');
  const valid = makeEntry(
    'project/file.txt',
    'readme',
    'markdown',
    'text/markdown;charset=utf-8',
    bytes,
  );
  const sparse: PackageEntry[] = [];
  sparse.length = 1;
  const inherited = Object.create(valid) as PackageEntry;
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, 'path', {
    enumerable: true,
    get() {
      throw new Error('accessor must not run');
    },
  });
  const throwingProxy = new Proxy([] as PackageEntry[], {
    getPrototypeOf() {
      throw new Error('proxy trap');
    },
  });
  const cases: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: 'null', value: null },
    { name: 'non-array', value: {} },
    { name: 'sparse array', value: sparse },
    { name: 'accessor-backed entry', value: [accessor] },
    { name: 'throwing proxy', value: throwingProxy },
    { name: 'non-string path', value: [{ ...valid, path: 4 }] },
    { name: 'non-Uint8Array bytes', value: [{ ...valid, bytes: 'bytes' }] },
    { name: 'inherited fields', value: [inherited] },
  ];
  for (const testCase of cases) {
    it(`returns a typed no-bytes failure for ${testCase.name}`, () => {
      let result: ReturnType<typeof writeDeterministicZip> | undefined;
      expect(() => {
        result = writeDeterministicZip(testCase.value as readonly PackageEntry[], 100, 1_000_000);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      expect(result && 'bytes' in result).toBe(false);
    });
  }
});

describe('Deficiency Closure §12 - complete scope-policy injection matrix', () => {
  function scopedPlan(scopeIndex: number) {
    const result = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: CANONICAL_SCOPES[scopeIndex]!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return structuredClone(result.value);
  }

  const cases = [
    {
      name: 'projectMetadata/project',
      base: 0,
      donor: 9,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        project: donor.selection.project,
      }),
    },
    {
      name: 'sessionMetadata/sessions',
      base: 0,
      donor: 7,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        sessions: donor.selection.sessions,
      }),
    },
    {
      name: 'sceneMetadata/scenes',
      base: 0,
      donor: 7,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        scenes: donor.selection.scenes,
      }),
    },
    {
      name: 'outputA/outputsA',
      base: 1,
      donor: 0,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        outputsA: donor.selection.outputsA,
      }),
    },
    {
      name: 'outputB/outputsB',
      base: 0,
      donor: 1,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        outputsB: donor.selection.outputsB,
      }),
    },
    {
      name: 'groupMetadata/groups',
      base: 0,
      donor: 3,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        groups: donor.selection.groups,
      }),
    },
    {
      name: 'groupPlans/groupPlans',
      base: 0,
      donor: 3,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        groupPlans: donor.selection.groupPlans,
      }),
    },
    {
      name: 'executionPlans/executionPlans',
      base: 0,
      donor: 8,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        executionPlans: donor.selection.executionPlans,
      }),
    },
    {
      name: 'cover/covers',
      base: 0,
      donor: 6,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        covers: donor.selection.covers,
      }),
    },
    {
      name: 'artworkMetadata/artworks',
      base: 0,
      donor: 1,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        artworks: donor.selection.artworks,
      }),
    },
    {
      name: 'validationResults/validationResults',
      base: 0,
      donor: 7,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        validationResults: donor.selection.validationResults,
      }),
    },
    {
      name: 'versionMetadata/versions',
      base: 0,
      donor: 12,
      inject: (base: ReturnType<typeof scopedPlan>, donor: ReturnType<typeof scopedPlan>) => ({
        ...base.selection,
        versions: donor.selection.versions,
      }),
    },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.name}: exact policy failure and no bytes`, () => {
      const base = scopedPlan(testCase.base);
      const donor = scopedPlan(testCase.donor);
      const mutated = {
        ...base,
        selection: testCase.inject(base, donor),
      };
      expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
        failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope.policy')!],
        warnings: [],
        omissions: [],
      });
    });
  }

  it('rejects a disabled required policy flag even after the matching selection is removed', () => {
    const base = scopedPlan(0);
    const mutated = {
      ...base,
      scope: {
        ...base.scope,
        policy: { ...base.scope.policy, outputA: false },
      },
      selection: {
        ...base.selection,
        outputsA: [],
        ordered: base.selection.ordered.filter((entry) => entry.kind !== 'output_a'),
      },
    };
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
      failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope.policy')!],
      warnings: [],
      omissions: [],
    });
  });

  it('rejects an enabled forbidden policy flag even when no matching content is injected', () => {
    const base = scopedPlan(0);
    const mutated = {
      ...base,
      scope: {
        ...base.scope,
        policy: { ...base.scope.policy, cover: true },
      },
    };
    expectBlockingFailure(packageExport(packageInputFor({ ok: true, value: mutated })), {
      failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope.policy')!],
      warnings: [],
      omissions: [],
    });
  });
});
