/**
 * Phase 10 — Batch 10.4 — Final Residual Corrective acceptance oracle.
 *
 * Frozen before implementation changes. These tests close only:
 * F1 — scope-kind field allowlists,
 * F2 — generated-cover source completeness and canonical order,
 * F3 — session counter/flag reconciliation with trusted entities.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput, ExportPackageResult } from '../../../src/export/packaging';
import { registeredExportFailure } from '../../../src/export/failures';
import type { ExportPlan } from '../../../src/shared/contracts/export-planning';
import type { ValidationFailure } from '../../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_SCOPES,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { clonePackageInput, createPackageFixture, packageInputFromFormatter } from './fixtures';

const SCOPE_ARRAY_FIELDS = [
  'sessionIds',
  'groupIds',
  'sceneIds',
  'outputAIds',
  'outputBIds',
  'coverIds',
  'versionIds',
] as const;

type ScopeArrayField = (typeof SCOPE_ARRAY_FIELDS)[number];

interface ScopeMatrixCase {
  readonly name: ExportPlan['scope']['scopeDetail'];
  readonly scopeIndex: number;
  readonly allowed: ReadonlySet<ScopeArrayField>;
  readonly packageSupported: boolean;
}

const allowed = (...fields: readonly ScopeArrayField[]): ReadonlySet<ScopeArrayField> =>
  new Set(fields);

const SCOPE_MATRIX: readonly ScopeMatrixCase[] = [
  {
    name: 'output_a',
    scopeIndex: 0,
    allowed: allowed('sessionIds', 'sceneIds', 'outputAIds'),
    packageSupported: true,
  },
  {
    name: 'output_b',
    scopeIndex: 1,
    allowed: allowed('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
    packageSupported: true,
  },
  {
    name: 'pair',
    scopeIndex: 2,
    allowed: allowed('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
    packageSupported: true,
  },
  {
    name: 'group',
    scopeIndex: 3,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds'),
    packageSupported: true,
  },
  {
    name: 'group_a',
    scopeIndex: 4,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds'),
    packageSupported: true,
  },
  {
    name: 'group_b',
    scopeIndex: 5,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds'),
    packageSupported: true,
  },
  {
    name: 'cover',
    scopeIndex: 6,
    allowed: allowed('sessionIds', 'sceneIds', 'outputAIds', 'coverIds'),
    packageSupported: true,
  },
  {
    name: 'session',
    scopeIndex: 7,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds', 'coverIds'),
    packageSupported: true,
  },
  {
    name: 'execution_plan',
    scopeIndex: 8,
    allowed: allowed('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
    packageSupported: true,
  },
  {
    name: 'complete_project',
    scopeIndex: 9,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds', 'coverIds'),
    packageSupported: true,
  },
  {
    name: 'version_snapshot',
    scopeIndex: 12,
    allowed: allowed('versionIds'),
    packageSupported: false,
  },
  {
    name: 'all',
    scopeIndex: 15,
    allowed: allowed('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds', 'coverIds'),
    packageSupported: true,
  },
];

function planForScope(scopeIndex: number): ExportPlan {
  const result = createExportPlan({
    ...CANONICAL_EXPORT_INPUT,
    scope: CANONICAL_SCOPES[scopeIndex]!,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected canonical export plan');
  return structuredClone(result.value);
}

function multiScenePlan(): ExportPlan {
  const result = createExportPlan(createCanonicalMultiSceneExportInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected canonical multi-scene export plan');
  return structuredClone(result.value);
}

function packageInputFor(plan: ExportPlan): ExportPackageInput {
  const fixture = createPackageFixture();
  return {
    planResult: { ok: true, value: plan },
    limits: fixture.limits,
    versions: fixture.versions,
    createdAt: fixture.createdAt,
    exportId: fixture.exportId,
  };
}

function expectExactFailure(result: ExportPackageResult, code: string, field: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected package failure');
  expect(result.failures).toEqual([registeredExportFailure(code, field)!]);
  expect(result).not.toHaveProperty('zipBytes');
  expect(result).not.toHaveProperty('zipSha256');
  expect(result).not.toHaveProperty('manifestBytes');
  expect(result).not.toHaveProperty('checksumsBytes');
  expect(result).not.toHaveProperty('entries');
}

function withScopeField(
  plan: ExportPlan,
  field: ScopeArrayField,
  values: readonly string[],
): ExportPlan {
  const clone = structuredClone(plan);
  const scope = clone.scope as unknown as Record<string, unknown>;
  scope[field] = [...values];
  return clone;
}

function replaceCovers(
  plan: ExportPlan,
  update: (
    cover: ExportPlan['selection']['covers'][number],
  ) => ExportPlan['selection']['covers'][number],
): ExportPlan {
  return {
    ...plan,
    selection: {
      ...plan.selection,
      covers: plan.selection.covers.map(update),
    },
  };
}

function replaceSessions(
  plan: ExportPlan,
  update: (
    session: ExportPlan['selection']['sessions'][number],
  ) => ExportPlan['selection']['sessions'][number],
): ExportPlan {
  return {
    ...plan,
    selection: {
      ...plan.selection,
      sessions: plan.selection.sessions.map(update),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('F1 — exact scope-kind field matrix', () => {
  for (const matrixCase of SCOPE_MATRIX) {
    it(`${matrixCase.name}: canonical resolver emits no non-empty disallowed fields`, () => {
      const plan = planForScope(matrixCase.scopeIndex);
      expect(plan.scope.scopeDetail).toBe(matrixCase.name);
      expect(plan.scope.projectId.length).toBeGreaterThan(0);
      for (const field of SCOPE_ARRAY_FIELDS) {
        if (!matrixCase.allowed.has(field)) expect(plan.scope[field]).toEqual([]);
      }
      const result = packageExport(packageInputFor(plan));
      if (matrixCase.packageSupported) expect(result.ok).toBe(true);
      else expectExactFailure(result, 'EXPORT_SCOPE_001', 'packaging.scope');
    });

    for (const field of SCOPE_ARRAY_FIELDS.filter(
      (candidate) => !matrixCase.allowed.has(candidate),
    )) {
      it(`${matrixCase.name}: rejects non-empty disallowed ${field} (single, multiple, duplicate)`, () => {
        const values: readonly (readonly string[])[] = [
          ['forbidden-id-1'],
          ['forbidden-id-1', 'forbidden-id-2'],
          ['forbidden-id-1', 'forbidden-id-1'],
        ];
        for (const ids of values) {
          const result = packageExport(
            packageInputFor(withScopeField(planForScope(matrixCase.scopeIndex), field, ids)),
          );
          expectExactFailure(result, 'EXPORT_SCOPE_001', `packaging.scope.${field}`);
        }
      });
    }
  }

  it('permits a legal empty outputBIds field for a pair with no real Output B', () => {
    const input = createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] });
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) throw new Error('expected partial pair plan');
    expect(input.planResult.value.scope.outputBIds).toEqual([]);
    expect(packageExport(input).ok).toBe(true);
  });

  it('scope own-property insertion order does not affect ZIP bytes or SHA-256', () => {
    const plan = planForScope(7);
    const reorderedScope = Object.fromEntries(
      Object.entries(plan.scope).reverse(),
    ) as unknown as ExportPlan['scope'];
    const reordered: ExportPlan = { ...plan, scope: reorderedScope };
    const first = packageExport(packageInputFor(plan));
    const second = packageExport(packageInputFor(reordered));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
    expect(second.zipSha256).toBe(first.zipSha256);
  });
});

describe('F2 — generated cover requires the complete canonical Output A set', () => {
  it('rejects a generated cover with zero sources', () => {
    const plan = replaceCovers(planForScope(7), (cover) => ({
      ...cover,
      sourceOutputAIds: [],
      sourceOutputALabels: [],
      metadata: { ...cover.metadata, mockupCount: 0 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVERCOUNT_001',
      'packaging.selection.covers.0.sourceOutputAIds',
    );
  });

  it('rejects an IDs/labels length mismatch', () => {
    const plan = replaceCovers(planForScope(7), (cover) => ({
      ...cover,
      sourceOutputALabels: [],
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVERCOUNT_001',
      'packaging.selection.covers.0.sourceOutputALabels',
    );
  });

  it('rejects a mockupCount/source count mismatch', () => {
    const plan = replaceCovers(planForScope(7), (cover) => ({
      ...cover,
      metadata: { ...cover.metadata, mockupCount: cover.metadata.mockupCount + 1 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVERCOUNT_001',
      'packaging.selection.covers.0.metadata.mockupCount',
    );
  });

  it('rejects an unknown Output A source', () => {
    const plan = replaceCovers(planForScope(7), (cover) => ({
      ...cover,
      sourceOutputAIds: ['unknown-output-a'] as unknown as typeof cover.sourceOutputAIds,
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      'packaging.selection.covers.0.sourceOutputAIds',
    );
  });

  it('rejects duplicate Output A sources', () => {
    const plan = replaceCovers(multiScenePlan(), (cover) => ({
      ...cover,
      sourceOutputAIds: [cover.sourceOutputAIds[0]!, cover.sourceOutputAIds[0]!],
      sourceOutputALabels: [cover.sourceOutputALabels[0]!, cover.sourceOutputALabels[0]!],
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      'packaging.selection.covers.0.sourceOutputAIds',
    );
  });

  it('rejects duplicate Output A labels', () => {
    const plan = replaceCovers(multiScenePlan(), (cover) => ({
      ...cover,
      sourceOutputALabels: [cover.sourceOutputALabels[0]!, cover.sourceOutputALabels[0]!],
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      'packaging.selection.covers.0.sourceOutputALabels',
    );
  });

  it('rejects an incomplete expected Output A set', () => {
    const plan = replaceCovers(multiScenePlan(), (cover) => ({
      ...cover,
      sourceOutputAIds: [cover.sourceOutputAIds[0]!],
      sourceOutputALabels: [cover.sourceOutputALabels[0]!],
      metadata: { ...cover.metadata, mockupCount: 1 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      'packaging.selection.covers.0.sourceOutputAIds',
    );
  });

  it('rejects an Output B reference in generated-cover provenance', () => {
    const base = planForScope(7);
    const outputBId = base.numbering[0]!.outputBId!;
    const plan = replaceCovers(base, (cover) => ({
      ...cover,
      sourceOutputAIds: [outputBId] as unknown as typeof cover.sourceOutputAIds,
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      'packaging.selection.covers.0.sourceOutputAIds',
    );
  });

  it('accepts a valid generated cover with the complete Output A set', () => {
    expect(packageExport(packageInputFor(multiScenePlan())).ok).toBe(true);
  });

  it('canonicalizes equivalent cover-source order to identical ZIP bytes and SHA-256', () => {
    const plan = multiScenePlan();
    const reordered = replaceCovers(plan, (cover) => ({
      ...cover,
      sourceOutputAIds: [...cover.sourceOutputAIds].reverse(),
      sourceOutputALabels: [...cover.sourceOutputALabels].reverse(),
    }));
    const first = packageExport(packageInputFor(plan));
    const second = packageExport(packageInputFor(reordered));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
    expect(second.zipSha256).toBe(first.zipSha256);
  });

  it('accepts a deeply frozen valid cover plan without mutation', () => {
    const input = deepFreeze(packageInputFor(multiScenePlan()));
    const before = structuredClone(input);
    expect(packageExport(input).ok).toBe(true);
    expect(input).toEqual(before);
  });
});

describe('F3 — session counters and readiness flags match trusted entities', () => {
  const sessionField = (suffix: string): string =>
    `packaging.selection.sessions.جلسة-001.${suffix}`;

  it('rejects requestedSceneCount mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      requestedSceneCount: 999,
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('requestedSceneCount'),
    );
  });

  it('rejects generationProgress.totalScenes mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, totalScenes: 999 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('generationProgress.totalScenes'),
    );
  });

  it('rejects outputAGenerated overflow above totalScenes', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, outputAGenerated: 2 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('generationProgress.outputAGenerated'),
    );
  });

  it('rejects outputBGenerated overflow above totalScenes', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, outputBGenerated: 2 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('generationProgress.outputBGenerated'),
    );
  });

  it('rejects generated Output A count mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, outputAGenerated: 50 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('generationProgress.outputAGenerated'),
    );
  });

  it('rejects generated Output B count mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, outputBGenerated: 0 },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_NUM_001',
      sessionField('generationProgress.outputBGenerated'),
    );
  });

  it('rejects coverGenerated mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, coverGenerated: false },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_COVER_001',
      sessionField('generationProgress.coverGenerated'),
    );
  });

  it('rejects allOutputAReady mismatch', () => {
    const plan = replaceSessions(planForScope(7), (session) => ({
      ...session,
      generationProgress: { ...session.generationProgress, allOutputAReady: false },
    }));
    expectExactFailure(
      packageExport(packageInputFor(plan)),
      'EXPORT_MISSINGA_001',
      sessionField('generationProgress.allOutputAReady'),
    );
  });

  it('accepts a valid canonical session', () => {
    expect(packageExport(packageInputFor(planForScope(7))).ok).toBe(true);
  });

  it('reordered equivalent source records produce identical session package bytes', () => {
    const firstInput = createCanonicalMultiSceneExportInput();
    const project = structuredClone(firstInput.source.project);
    const sessionId = project.sessionOrder[0]!;
    const session = project.sessions[sessionId]!;
    const reorderedSession = {
      ...session,
      scenes: Object.fromEntries(Object.entries(session.scenes).reverse()) as typeof session.scenes,
      groups: Object.fromEntries(Object.entries(session.groups).reverse()) as typeof session.groups,
    };
    const reorderedSessions = Object.fromEntries(
      Object.entries(project.sessions)
        .reverse()
        .map(([id, value]) => [id, id === sessionId ? reorderedSession : value]),
    ) as typeof project.sessions;
    const secondInput = {
      ...firstInput,
      source: {
        ...firstInput.source,
        project: { ...project, sessions: reorderedSessions },
      },
    };

    const firstPlan = createExportPlan(firstInput);
    const secondPlan = createExportPlan(secondInput);
    expect(firstPlan.ok).toBe(true);
    expect(secondPlan.ok).toBe(true);
    if (!firstPlan.ok || !secondPlan.ok) return;

    const first = packageExport(
      packageInputFromFormatter({ planResult: firstPlan, limits: firstInput.limits }),
    );
    const second = packageExport(
      packageInputFromFormatter({ planResult: secondPlan, limits: secondInput.limits }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
    expect(second.zipSha256).toBe(first.zipSha256);
  });

  it('does not mutate a hostile counter input while rejecting it', () => {
    const input = clonePackageInput(packageInputFor(planForScope(7)));
    if (!input.planResult.ok) throw new Error('expected successful plan');
    const hostile = replaceSessions(input.planResult.value, (session) => ({
      ...session,
      requestedSceneCount: 999,
    }));
    const frozenInput = deepFreeze({ ...input, planResult: { ok: true as const, value: hostile } });
    const before = structuredClone(frozenInput);
    const result = packageExport(frozenInput);
    expectExactFailure(result, 'EXPORT_NUM_001', sessionField('requestedSceneCount'));
    expect(frozenInput).toEqual(before);
  });
});

describe('oracle helper integrity', () => {
  it('uses exact registered failures for all new assertions', () => {
    const failures: readonly ValidationFailure[] = [
      registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope.outputBIds')!,
      registeredExportFailure(
        'EXPORT_COVERCOUNT_001',
        'packaging.selection.covers.0.sourceOutputAIds',
      )!,
      registeredExportFailure(
        'EXPORT_NUM_001',
        'packaging.selection.sessions.جلسة-001.requestedSceneCount',
      )!,
    ];
    expect(failures.every((failure) => failure.severity === 'blocking')).toBe(true);
  });
});
