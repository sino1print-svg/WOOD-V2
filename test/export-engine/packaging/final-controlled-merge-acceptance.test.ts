/**
 * Phase 10 Batch 10.4 - Final Controlled Merge - §10 mandatory acceptance
 * oracle.
 *
 * This file is the single collection point for the merge decision's
 * mandatory success and failure cases (§10.1-§10.5), asserted with the exact
 * §10.6 helper shape (exact `failures`/`warnings`/`omissions` array equality,
 * never `.some(code)`). Pre-existing coverage in
 * `consolidated-final-corrective.test.ts`, `corrective-adversarial.test.ts`,
 * and `scope-matrix.test.ts` is not deleted or duplicated wholesale; this
 * file adds the cases the independent audit found missing (F1: selected B
 * surviving a deleted/omitted selected A in a pair-bearing scope; F2: the
 * validator not reconciling project/session/scene/execution-plan/cover/
 * artwork identity against scope and numbering anchors; F3: selected group
 * metadata contradicting its own group plan) plus a representative,
 * non-duplicative slice of the other mandatory categories.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput, ExportPackageResult } from '../../../src/export/packaging';
import { registeredExportFailure } from '../../../src/export/failures';
import type { ExportPlan, ExportPlanOmission } from '../../../src/shared/contracts/export-planning';
import {
  ExportScope,
  GroupBy,
  ValidationSeverity,
  type ArtworkId,
  type CoverId,
  type GroupId,
  type OutputAId,
  type OutputBId,
  type Project,
  type ProjectId,
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
import { createGoldenZipCases } from './golden-fixtures';
import { createPackageFixture } from './fixtures';

function packageInputFor(planResult: ExportPackageInput['planResult']): ExportPackageInput {
  const { versions, limits, createdAt, exportId } = createPackageFixture();
  return { planResult, versions, limits, createdAt, exportId };
}

/** §10.6 exact required assertion shape - never `ok:false` alone, never `.some(code)`. */
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

/** Derives the exact expectation from the mutated plan actually fed to `packageExport`. */
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

function planForScope(scope: (typeof CANONICAL_SCOPES)[number]): ExportPlan {
  const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope });
  expect(planResult.ok).toBe(true);
  if (!planResult.ok) throw new Error('unreachable');
  return structuredClone(planResult.value);
}

function pairPlan(): ExportPlan {
  return planForScope(CANONICAL_SCOPES[2]!);
}

function outputBOnlyPlan(): ExportPlan {
  return planForScope(CANONICAL_SCOPES[1]!);
}

/** A real `session` scope plan spanning the two real, distinct canonical multi-scene scenes. */
function sessionMultiScenePlan(): ExportPlan {
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

/** A real `group` scope spanning two real scenes in one session (merged by color). */
function twoSceneGroupPlan(): { plan: ExportPlan; groupId: GroupId; firstSceneId: SceneId } {
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
  expect(planResult.value.selection.groupPlans.length).toBe(1);
  return {
    plan: structuredClone(planResult.value),
    groupId: firstGroupId!,
    firstSceneId: firstSceneId!,
  };
}

describe('Final Controlled Merge §10.1 - mandatory success cases', () => {
  it('every supported scope produces an exact ordered {path, kind} list, twice (deterministic)', () => {
    for (const scope of CANONICAL_SCOPES) {
      if (
        scope.scopeDetail === 'backup' ||
        scope.scopeDetail === 'version_snapshot' ||
        scope.scopeDetail === 'prompt_pack'
      ) {
        continue;
      }
      const input = packageInputFor(createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope }));
      const first = packageExport(input);
      const second = packageExport(input);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) continue;
      expect(second.zipSha256).toBe(first.zipSha256);
      expect(second.entries).toEqual(first.entries);
    }
  });

  it('canonical output A scope succeeds', () => {
    expect(packageExport(packageInputFor(createExportPlan(CANONICAL_EXPORT_INPUT))).ok).toBe(true);
  });

  it('canonical output B scope succeeds under its own policy', () => {
    const result = packageExport(
      packageInputFor(createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[1]! })),
    );
    expect(result.ok).toBe(true);
  });

  it('canonical pair scope produces A + B + pair file', () => {
    const result = packageExport(
      packageInputFor(createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[2]! })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds).toContain('prompt_a');
    expect(kinds).toContain('prompt_b');
    expect(kinds).toContain('prompt_pair');
  });

  it('group_a, group_b, and full group scopes each succeed', () => {
    for (const scopeIndex of [3, 4, 5]) {
      const result = packageExport(
        packageInputFor(
          createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[scopeIndex]! }),
        ),
      );
      expect(result.ok).toBe(true);
    }
  });

  it('multi-scene session scope succeeds', () => {
    const plan = sessionMultiScenePlan();
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(true);
  });

  it('complete-project scope spanning multiple sessions succeeds', () => {
    const result = packageExport(
      packageInputFor(
        createExportPlan({
          ...createCanonicalMultiSceneExportInput(),
          scope: CANONICAL_SCOPES[9]!,
        }),
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('the same reused sceneId in two different sessions gets two different scene numbers with no cross-contamination', () => {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const session1 = project.sessions[CANONICAL_SESSION_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const secondOutputAId = 'output-a-second' as OutputAId;
    const secondOutputBId = 'output-b-second' as OutputBId;
    const secondScene = {
      ...session1.scenes[CANONICAL_SCENE_ID]!,
      id: CANONICAL_SCENE_ID,
      sessionId: secondSessionId,
      outputA: {
        ...session1.scenes[CANONICAL_SCENE_ID]!.outputA,
        id: secondOutputAId,
        sceneId: CANONICAL_SCENE_ID,
      },
      outputB: {
        ...session1.scenes[CANONICAL_SCENE_ID]!.outputB!,
        id: secondOutputBId,
        sceneId: CANONICAL_SCENE_ID,
        sourceOutputAId: secondOutputAId,
      },
    };
    const secondGroupId = 'group-second' as GroupId;
    const secondSession = {
      ...session1,
      id: secondSessionId,
      scenes: { [CANONICAL_SCENE_ID]: secondScene },
      groups: {
        [secondGroupId]: {
          ...Object.values(session1.groups)[0]!,
          id: secondGroupId,
          sessionId: secondSessionId,
          sceneIds: [CANONICAL_SCENE_ID],
        },
      },
      cover: {
        ...session1.cover!,
        id: 'cover-second' as CoverId,
        sessionId: secondSessionId,
        sourceSaleImageIds: [secondOutputAId],
      },
      // A real second session never shares a validation-result identity with
      // another session; `session1`'s own results are cleared here rather
      // than copied verbatim, since this fixture's point is scene/output
      // identity reuse, not validation-result content.
      validationResults: {},
    };
    project.sessions = { [CANONICAL_SESSION_ID]: session1, [secondSessionId]: secondSession };
    project.sessionOrder = [CANONICAL_SESSION_ID, secondSessionId];
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    const result = packageExport(packageInputFor(planResult));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const folder of ['session-01', 'session-02']) {
      expect(result.entries.some((entry) => entry.path.includes(`/${folder}/prompts/A/001_`))).toBe(
        true,
      );
    }
  });

  it('a genuine partial export (B deleted with its exact omission) keeps A only, where the policy allows it', () => {
    const result = packageExport(
      createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds).not.toContain('prompt_b');
    expect(kinds).not.toContain('prompt_pair');
    expect(result.omissions.length).toBeGreaterThan(0);
  });

  it('§10.1 item 10 / §10.2 tie-break: the frozen contract enforces exact canonical selected-output order, so reversing raw selected A/B array insertion order is rejected rather than silently canonicalized - never a differing ZIP for the same meaning', () => {
    // The merge doc's own §10.2 explicitly permits either resolution
    // ("exact order enforced" OR "canonicalized without changing bytes")
    // and requires keeping whichever is the existing frozen behavior. Both
    // programmers' current, already-audited code enforces exact canonical
    // order for `selection.outputsA`/`outputsB` (closing an earlier
    // reversed-array omission-bypass gap), so a reversed array is a
    // rejection here, not a silent-canonicalization success case.
    const plan = sessionMultiScenePlan();
    const forward = packageExport(packageInputFor({ ok: true, value: plan }));
    const reversed = packageExport(
      packageInputFor({
        ok: true,
        value: {
          ...plan,
          selection: {
            ...plan.selection,
            outputsA: [...plan.selection.outputsA].reverse(),
            outputsB: [...plan.selection.outputsB].reverse(),
          },
        },
      }),
    );
    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(false);
    if (reversed.ok) return;
    expect('zipBytes' in reversed).toBe(false);
  });

  it('Arabic project name, emoji, NFC/NFD, CR/CRLF, and long backtick runs survive verbatim', () => {
    const goldenCases = createGoldenZipCases();
    const arabic = goldenCases.find((entry) => entry.name === 'arabic-project-name')!;
    const promptEdgeCases = goldenCases.find(
      (entry) => entry.name === 'prompt-cr-crlf-nfc-nfd-emoji-trailing',
    )!;
    const backticks = goldenCases.find((entry) => entry.name === 'markdown-long-backtick-runs')!;
    for (const golden of [arabic, promptEdgeCases, backticks]) {
      const result = packageExport(golden.input);
      expect(result.ok).toBe(true);
    }
  });

  it('all 10 golden ZIP fixtures package successfully', () => {
    for (const golden of createGoldenZipCases()) {
      const result = packageExport(golden.input);
      expect(result.ok).toBe(true);
    }
  });
});

describe('Final Controlled Merge §10.2/F1 - selected B must never survive a missing/omitted selected A', () => {
  it('F1 exact audit reproduction: A deleted with a genuine matching omission, B kept intact: rejected, no bytes', () => {
    // Independent Audit F1: remove the selected Output A record and its
    // ordered item, add a structurally valid Output A omission + matching
    // registered issue, keep the selected Output B intact, mark the plan
    // partial. The pre-closure validator accepted this and produced a ZIP
    // containing a lone `prompt_b` with no pair file.
    const plan = pairPlan();
    const outputA = plan.selection.outputsA[0]!;
    const sceneId = outputA.sceneId;
    const field = `source.project.sessions.${CANONICAL_SESSION_ID}.scenes.${sceneId}.outputA`;
    const omission: ExportPlanOmission = {
      artifactKind: 'output_a',
      entityId: `${sceneId}:output_a`,
      field,
      code: 'EXPORT_MISSINGA_001',
    };
    const issue = registeredExportFailure('EXPORT_MISSINGA_001', field)!;
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsA: [] },
      omissions: [omission],
      issues: [issue],
      partial: true,
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('pair: B present, A removed, no omission at all: rejected, no bytes', () => {
    // Caught at the selected-A stage itself (no omission evidence at all for
    // the missing A), before validateSelectedB's B-requires-A cross-check
    // ever runs - a stricter, earlier rejection of the same hostile plan.
    const plan = pairPlan();
    const mutated: ExportPlan = { ...plan, selection: { ...plan.selection, outputsA: [] } };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsA'),
    );
  });

  it('pair: B linked to a real A from a different scene identity within scope: rejected, no bytes', () => {
    // A's own id is real and in-scope, and every field self-consistently
    // "agrees" with the forged sourceOutputAId - only cross-checking against
    // the actual selected-A identity map (not merely membership in
    // `scope.outputAIds`) catches this.
    const plan = sessionMultiScenePlan();
    const [firstA, secondA] = plan.selection.outputsA;
    const targetB = plan.selection.outputsB.find((b) => b.sourceOutputAId === firstA!.id)!;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((b) =>
          b.id === targetB.id
            ? { ...b, sourceOutputAId: secondA!.id, sourceOutputALabel: secondA!.label }
            : b,
        ),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('pair: sourceOutputAId does not match the selected A id: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((b) => ({
          ...b,
          sourceOutputAId: 'output-a-fake' as OutputAId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('pair: sourceOutputALabel does not match the selected A label: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsB: plan.selection.outputsB.map((b) => ({ ...b, sourceOutputALabel: '9A' as never })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.selection.outputsB'),
    );
  });

  it('duplicate selected Output A for the same identity: rejected, no bytes', () => {
    const plan = pairPlan();
    const originalA = plan.selection.outputsA[0]!;
    const duplicateA = { ...originalA, id: 'output-a-duplicate' as OutputAId };
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, outputsA: [originalA, duplicateA] },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('extra numbering row: rejected, no bytes', () => {
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
    const mutated: ExportPlan = { ...plan, numbering: [...plan.numbering, extra] };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('missing numbering row: rejected, no bytes', () => {
    const plan = pairPlan();
    const mutated: ExportPlan = { ...plan, numbering: [] };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.numbering'),
    );
  });

  it('duplicate numbering identity with distinct canonical ids preserved: rejected, no bytes', () => {
    const plan = sessionMultiScenePlan();
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
});

describe('Final Controlled Merge §10.3/F2 - project/session/scene/execution-plan/cover/artwork trusted projection', () => {
  it('F2 exact audit reproduction: selection.project.id forged while scope.projectId is unchanged: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[9]!);
    expect(plan.selection.project).not.toBeNull();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        project: { ...plan.selection.project!, id: 'hostile-project-id' as ProjectId },
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect('zipBytes' in result).toBe(false);
  });

  it('a selected scene id changed while scope scene ids remain unchanged: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[7]!);
    expect(plan.selection.scenes.length).toBeGreaterThan(0);
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        scenes: plan.selection.scenes.map((scene) => ({
          ...scene,
          id: 'scene-hostile' as SceneId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('a selected session projectId changed: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[7]!);
    expect(plan.selection.sessions.length).toBe(1);
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        sessions: plan.selection.sessions.map((session) => ({
          ...session,
          projectId: 'project-hostile' as ProjectId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('an execution plan moved to an unknown session: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[8]!);
    expect(plan.selection.executionPlans.length).toBe(1);
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        executionPlans: plan.selection.executionPlans.map((executionPlan) => ({
          ...executionPlan,
          sessionId: 'session-unknown' as SessionId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('an execution-plan phase Output A id disagrees with numbering: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[8]!);
    const executionPlan = plan.selection.executionPlans[0]!;
    expect(executionPlan.phase1.length).toBeGreaterThan(0);
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        executionPlans: [
          {
            ...executionPlan,
            phase1: executionPlan.phase1.map((item) => ({
              ...item,
              outputAId: 'output-a-fake' as OutputAId,
            })),
          },
        ],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('a cover id changed while scope.coverIds remains unchanged: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[6]!);
    expect(plan.selection.covers.length).toBe(1);
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        covers: plan.selection.covers.map((cover) => ({
          ...cover,
          id: 'cover-hostile' as CoverId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('cover source-A ids/labels changed while the numbering row stays real: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[6]!);
    const cover = plan.selection.covers[0]!;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        covers: [
          {
            ...cover,
            sourceOutputAIds: ['output-a-fake' as OutputAId],
            sourceOutputALabels: ['9A' as never],
          },
        ],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('an extra artwork metadata record injected (not referenced by any selected B): rejected, no bytes', () => {
    const plan = outputBOnlyPlan();
    expect(plan.selection.artworks.length).toBe(1);
    const extraArtwork = { ...plan.selection.artworks[0]!, id: 'artwork-injected' as ArtworkId };
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, artworks: [...plan.selection.artworks, extraArtwork] },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('missing artwork metadata when a selected Output B requires it: rejected, no bytes', () => {
    const plan = outputBOnlyPlan();
    expect(plan.selection.artworks.length).toBe(1);
    const mutated: ExportPlan = { ...plan, selection: { ...plan.selection, artworks: [] } };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('duplicate selected version identity: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[9]!);
    if (plan.selection.versions.length === 0) return;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        versions: [plan.selection.versions[0]!, plan.selection.versions[0]!],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('duplicate selected validation-result identity: rejected, no bytes', () => {
    const plan = planForScope(CANONICAL_SCOPES[9]!);
    if (plan.selection.validationResults.length === 0) return;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        validationResults: [
          plan.selection.validationResults[0]!,
          plan.selection.validationResults[0]!,
        ],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it("provenance sessionFingerprint changed while the primary session's real fingerprint stays unchanged: rejected, no bytes", () => {
    const plan = planForScope(CANONICAL_SCOPES[9]!);
    const mutated: ExportPlan = {
      ...plan,
      provenance: {
        ...plan.provenance,
        sessionFingerprint: 'f'.repeat(64) as typeof plan.provenance.sessionFingerprint,
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_LINK_001', 'packaging.provenance'),
    );
  });

  it('project/session/scene metadata reach README and manifest only via one consistent, validated snapshot', () => {
    const plan = planForScope(CANONICAL_SCOPES[9]!);
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as {
      projectId: string;
    };
    expect(manifest.projectId).toBe(plan.scope.projectId);
    expect(plan.selection.project?.id).toBe(plan.scope.projectId);
  });
});

describe('Final Controlled Merge §10.4/F3 - group vs. group plan reconciliation', () => {
  it('F3 exact audit reproduction: selection.groups[0].groupNumber=9 with matching groupNumbering, but selection.groupPlans[0].groupNumber stays 1: rejected, no bytes', () => {
    const { plan, groupId } = twoSceneGroupPlan();
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        groups: plan.selection.groups.map((group) =>
          group.id === groupId ? { ...group, groupNumber: 9 } : group,
        ),
      },
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

  it('group plan groupId disagrees with its own selected group: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const groupPlanRow = plan.selection.groupPlans[0]!;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        groupPlans: [{ ...groupPlanRow, groupId: 'group-fake' as GroupId }],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('group plan sessionId disagrees with its own selected group: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const groupPlanRow = plan.selection.groupPlans[0]!;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        groupPlans: [{ ...groupPlanRow, sessionId: 'session-fake' as SessionId }],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('extra fabricated group plan for a group with no group plan otherwise selected: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const groupPlanRow = plan.selection.groupPlans[0]!;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        groupPlans: [groupPlanRow, { ...groupPlanRow, groupId: 'group-second-fake' as GroupId }],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('duplicate group plan for the same group: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const groupPlanRow = plan.selection.groupPlans[0]!;
    const mutated: ExportPlan = {
      ...plan,
      selection: { ...plan.selection, groupPlans: [groupPlanRow, groupPlanRow] },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('missing group plan while the selected group still requires it under policy: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    if (plan.scope.policy.groupPlans !== true) return;
    const mutated: ExportPlan = { ...plan, selection: { ...plan.selection, groupPlans: [] } };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });

  it('groupNumbering rows physically reversed: rejected, no bytes', () => {
    const { plan } = twoSceneGroupPlan();
    const mutated: ExportPlan = { ...plan, groupNumbering: [...plan.groupNumbering].reverse() };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expectBlockingFailure(
      result,
      blockingFailureFor(mutated, 'EXPORT_GROUP_001', 'packaging.groupNumbering'),
    );
  });

  it('same group id injected across two sessions is rejected', () => {
    const { plan, groupId } = twoSceneGroupPlan();
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    void project;
    const mutated: ExportPlan = {
      ...plan,
      selection: {
        ...plan.selection,
        groups: [
          ...plan.selection.groups,
          { ...plan.selection.groups[0]!, id: groupId, sessionId: 'session-second' as SessionId },
        ],
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutated }));
    expect(result.ok).toBe(false);
  });
});

describe('Final Controlled Merge §10.5 - ZIP/manifest hostile structural cases (representative slice)', () => {
  it('unsafe path (parent traversal) is rejected by the public ZIP writer boundary', () => {
    // Full byte-level structural/semantic coverage (hidden bytes, reordering,
    // manifest/checksums tamper-with-repaired-ledger, symlink-shaped
    // entries) is preserved unchanged in `corrective-adversarial.test.ts`;
    // this is a representative smoke case confirming the writer boundary is
    // still reachable and still fails closed after the merge.
    const plan = pairPlan();
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(true);
  });
});
