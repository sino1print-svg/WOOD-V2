/**
 * Phase 10 — Batch 10.4 — Final Controlled Merge acceptance oracle.
 *
 * This file is intentionally frozen before implementation changes. It joins
 * the retained consolidated/ZIP suites with the residual controlled-merge
 * contract: complete trusted projection, B→A dependency, exact relational
 * metadata, immutable snapshots, and the ten reviewed golden ZIP fixtures.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput, ExportPackageResult } from '../../../src/export/packaging';
import { registeredExportFailure } from '../../../src/export/failures';
import { validatePackagePlanIntegrity } from '../../../src/export/packaging/package-plan';
import type { ExportPlan, ExportPlanOmission } from '../../../src/shared/contracts/export-planning';
import type { ExportArtifactKind } from '../../../src/shared/contracts/export-contracts';
import type { ValidationFailure } from '../../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_SCOPES,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { createPackageFixture, packageInputFromFormatter } from './fixtures';
import { createGoldenZipCases, GOLDEN_ZIP_CASE_NAMES } from './golden-fixtures';
import { GOLDEN_ZIP_DIGESTS } from './golden-digests';

type Entry = Readonly<{ path: string; kind: ExportArtifactKind }>;

function planForScope(scopeIndex: number): ExportPlan {
  const result = createExportPlan({
    ...CANONICAL_EXPORT_INPUT,
    scope: CANONICAL_SCOPES[scopeIndex]!,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected canonical plan');
  return structuredClone(result.value);
}

function packageInputFor(plan: ExportPlan): ExportPackageInput {
  const { limits, versions, createdAt, exportId } = createPackageFixture();
  return { planResult: { ok: true, value: plan }, limits, versions, createdAt, exportId };
}

function expectExactFailure(
  result: ExportPackageResult,
  code: string,
  field: string,
  warnings: readonly ValidationFailure[] = [],
  omissions: readonly ExportPlanOmission[] = [],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.failures).toEqual([registeredExportFailure(code, field)!]);
  expect(result.warnings).toEqual(warnings);
  expect(result.omissions).toEqual(omissions);
  expect('zipBytes' in result).toBe(false);
  expect('zipSha256' in result).toBe(false);
  expect('manifestBytes' in result).toBe(false);
  expect('checksumsBytes' in result).toBe(false);
  expect('entries' in result).toBe(false);
}

function rootEntries(
  root: string,
  rows: readonly (readonly [ExportArtifactKind, string])[],
): Entry[] {
  return rows.map(([kind, path]) => ({ kind, path: `${root}/${path}` }));
}

const A_ROWS = [
  ['readme', 'README.md'],
  ['checksums', 'checksums.sha256'],
  ['manifest', 'manifest.json'],
  ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
  ['validation', 'session-01/metadata/validation.json'],
  ['prompt_a', 'session-01/prompts/A/001_tee-front_A.txt'],
] as const;

const B_ROWS = [
  ['readme', 'README.md'],
  ['artwork_metadata', 'assets/artwork-metadata/artwork-canonical.json'],
  ['checksums', 'checksums.sha256'],
  ['manifest', 'manifest.json'],
  ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
  ['validation', 'session-01/metadata/validation.json'],
  ['prompt_b', 'session-01/prompts/B/001_output-b-canonical_B.txt'],
] as const;

const FULL_ROWS = [
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
] as const;

const SUPPORTED_SCOPES: readonly {
  name: string;
  scopeIndex: number;
  expected: readonly Entry[];
}[] = [
  { name: 'output_a', scopeIndex: 0, expected: rootEntries('project-001', A_ROWS) },
  { name: 'output_b', scopeIndex: 1, expected: rootEntries('project-001', B_ROWS) },
  {
    name: 'pair',
    scopeIndex: 2,
    expected: rootEntries('project-001', [
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
    expected: rootEntries('project-001', [
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
  { name: 'group_a', scopeIndex: 4, expected: rootEntries('project-001', A_ROWS) },
  { name: 'group_b', scopeIndex: 5, expected: rootEntries('project-001', B_ROWS) },
  {
    name: 'cover',
    scopeIndex: 6,
    expected: rootEntries('project-001', [
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
    expected: rootEntries(
      'project-001',
      FULL_ROWS.filter(([kind]) => kind !== 'project'),
    ),
  },
  {
    name: 'execution_plan',
    scopeIndex: 8,
    expected: rootEntries('project-001', [
      ['readme', 'README.md'],
      ['checksums', 'checksums.sha256'],
      ['manifest', 'manifest.json'],
      ['execution_plan', 'session-01/execution-plan.txt'],
      ['prompt_metadata', 'session-01/metadata/prompt-metadata.json'],
      ['validation', 'session-01/metadata/validation.json'],
    ]),
  },
  {
    name: 'complete_project',
    scopeIndex: 9,
    expected: rootEntries('item-09598bb4fca1', FULL_ROWS),
  },
  { name: 'all', scopeIndex: 15, expected: rootEntries('item-09598bb4fca1', FULL_ROWS) },
];

describe('Final Controlled Merge — exact successful scope and golden ZIP oracle', () => {
  for (const testCase of SUPPORTED_SCOPES) {
    it(`${testCase.name}: exact ordered {path, kind} and deterministic bytes`, () => {
      const input = packageInputFor(planForScope(testCase.scopeIndex));
      const first = packageExport(input);
      const second = packageExport(input);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.entries.map(({ path, kind }) => ({ path, kind }))).toEqual(testCase.expected);
      expect(second.zipBytes).toEqual(first.zipBytes);
      expect(second.zipSha256).toBe(first.zipSha256);
    });
  }

  it('locks and executes all ten reviewed golden ZIP fixtures', () => {
    const fixtures = createGoldenZipCases();
    expect(fixtures.map(({ name }) => name)).toEqual(GOLDEN_ZIP_CASE_NAMES);
    expect(fixtures).toHaveLength(10);
    for (const fixture of fixtures) {
      const result = packageExport(fixture.input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const expected = GOLDEN_ZIP_DIGESTS[fixture.name];
      expect(result.zipSha256).toBe(expected.zipSha256);
      expect(result.entries.map(({ path, kind }) => ({ path, kind }))).toEqual(
        expected.entries.map(({ path, kind }) => ({ path, kind })),
      );
    }
  });

  it('canonicalizes source-map insertion order without changing ZIP bytes', () => {
    const forwardInput = createCanonicalMultiSceneExportInput();
    const sourceCopy = structuredClone(forwardInput.source);
    const sessionId = sourceCopy.project.sessionOrder[0]!;
    const session = sourceCopy.project.sessions[sessionId]!;
    const reversedSessions = Object.fromEntries(
      Object.entries(sourceCopy.project.sessions).reverse(),
    );
    reversedSessions[sessionId] = {
      ...session,
      scenes: Object.fromEntries(Object.entries(session.scenes).reverse()),
      groups: Object.fromEntries(Object.entries(session.groups).reverse()),
    };
    const reversedInput = {
      ...forwardInput,
      source: {
        ...sourceCopy,
        project: { ...sourceCopy.project, sessions: reversedSessions },
      },
    };
    const forwardPlan = createExportPlan(forwardInput);
    const reversedPlan = createExportPlan(reversedInput);
    expect(forwardPlan.ok).toBe(true);
    expect(reversedPlan.ok).toBe(true);
    if (!forwardPlan.ok || !reversedPlan.ok) return;
    const first = packageExport(
      packageInputFromFormatter({ planResult: forwardPlan, limits: forwardInput.limits }),
    );
    const second = packageExport(
      packageInputFromFormatter({ planResult: reversedPlan, limits: reversedInput.limits }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.zipBytes).toEqual(first.zipBytes);
    expect(second.zipSha256).toBe(first.zipSha256);
  });

  it('accepts the real partial pair only when B itself has exact omission evidence', () => {
    const input = createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] });
    const result = packageExport(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.some(({ kind }) => kind === 'prompt_a')).toBe(true);
    expect(result.entries.some(({ kind }) => kind === 'prompt_b')).toBe(false);
    expect(result.entries.some(({ kind }) => kind === 'prompt_pair')).toBe(false);
    expect(result.omissions).toEqual(input.planResult.ok ? input.planResult.value.omissions : []);
  });

  it('preserves Arabic, emoji, NFC/NFD, CR/CRLF, backticks, and trailing spaces verbatim', () => {
    const fixture = createGoldenZipCases().find(
      ({ name }) => name === 'prompt-cr-crlf-nfc-nfd-emoji-trailing',
    )!;
    const result = packageExport(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zipSha256).toBe(
      GOLDEN_ZIP_DIGESTS['prompt-cr-crlf-nfc-nfd-emoji-trailing'].zipSha256,
    );
  });
});

describe('Final Controlled Merge — B requires matching selected A in pair-bearing scopes', () => {
  function missingAPlan(withApprovedOmission: boolean): ExportPlan {
    const plan = planForScope(2);
    const outputA = plan.selection.outputsA[0]!;
    const field = `source.project.sessions.${outputA.sessionId}.scenes.${outputA.sceneId}.outputA`;
    const omission: ExportPlanOmission = {
      artifactKind: 'output_a',
      entityId: `${outputA.sceneId}:output_a`,
      field,
      code: 'EXPORT_MISSINGA_001',
    };
    return {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: [],
        ordered: plan.selection.ordered.filter(({ kind }) => kind !== 'output_a'),
      },
      omissions: withApprovedOmission ? [omission] : [],
      issues: withApprovedOmission ? [registeredExportFailure(omission.code, field)!] : [],
      partial: withApprovedOmission,
    };
  }

  for (const withApprovedOmission of [false, true]) {
    it(`rejects selected B when selected A is absent${withApprovedOmission ? ' even with an A omission' : ''}`, () => {
      const plan = missingAPlan(withApprovedOmission);
      expectExactFailure(
        packageExport(packageInputFor(plan)),
        'EXPORT_LINK_001',
        'packaging.selection.outputsB',
        [],
        plan.omissions,
      );
    });
  }

  for (const scopeIndex of [2, 3, 7, 9, 15]) {
    it(`enforces B→A in pair-bearing scope ${CANONICAL_SCOPES[scopeIndex]!.scopeDetail}`, () => {
      const plan = planForScope(scopeIndex);
      expect(plan.selection.outputsB.length).toBeGreaterThan(0);
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsA: [],
          ordered: plan.selection.ordered.filter(({ kind }) => kind !== 'output_a'),
        },
      };
      expectExactFailure(
        packageExport(packageInputFor(mutated)),
        'EXPORT_LINK_001',
        'packaging.selection.outputsB',
      );
    });
  }

  it('retains the canonical B-only output_b policy exception', () => {
    const plan = planForScope(1);
    expect(plan.selection.outputsA).toEqual([]);
    const result = packageExport(packageInputFor(plan));
    expect(result.ok).toBe(true);
  });
});

describe('Final Controlled Merge — complete trusted metadata reconciliation', () => {
  const cases: readonly {
    name: string;
    code: string;
    field: string;
    mutate: (plan: ExportPlan) => ExportPlan;
  }[] = [
    {
      name: 'project id differs from scope projectId',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.project',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          project: { ...plan.selection.project!, id: 'hostile-project' as never },
        },
      }),
    },
    {
      name: 'project session order differs from scope',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.project',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          project: {
            ...plan.selection.project!,
            sessionIds: [...plan.selection.project!.sessionIds, 'extra-session' as never],
          },
        },
      }),
    },
    {
      name: 'session projectId differs from trusted project',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.sessions',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          sessions: plan.selection.sessions.map((session) => ({
            ...session,
            projectId: 'hostile-project' as never,
          })),
        },
      }),
    },
    {
      name: 'selected session is outside scope',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.sessions',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          sessions: plan.selection.sessions.map((session) => ({
            ...session,
            id: 'hostile-session' as never,
          })),
        },
      }),
    },
    {
      name: 'selected session scene membership differs from scope',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.sessions',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          sessions: plan.selection.sessions.map((session) => ({
            ...session,
            sceneIds: [...session.sceneIds, 'hostile-scene' as never],
          })),
        },
      }),
    },
    {
      name: 'selected scene is outside its trusted session',
      code: 'EXPORT_SCOPE_001',
      field: 'packaging.selection.scenes',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          scenes: plan.selection.scenes.map((scene) => ({
            ...scene,
            id: 'hostile-scene' as never,
          })),
        },
      }),
    },
    {
      name: 'group plan has a conflicting group number',
      code: 'EXPORT_GROUP_001',
      field: 'packaging.groupNumbering',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          groupPlans: plan.selection.groupPlans.map((groupPlan) => ({
            ...groupPlan,
            groupNumber: groupPlan.groupNumber + 8,
          })),
        },
      }),
    },
    {
      name: 'group plan has a conflicting group id',
      code: 'EXPORT_GROUP_001',
      field: 'packaging.groupNumbering',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          groupPlans: plan.selection.groupPlans.map((groupPlan) => ({
            ...groupPlan,
            groupId: 'hostile-group' as never,
          })),
        },
      }),
    },
    {
      name: 'group plan is missing',
      code: 'EXPORT_GROUP_001',
      field: 'packaging.groupNumbering',
      mutate: (plan) => ({
        ...plan,
        selection: { ...plan.selection, groupPlans: [] },
      }),
    },
    {
      name: 'group plan is duplicated',
      code: 'EXPORT_GROUP_001',
      field: 'packaging.groupNumbering',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          groupPlans: [...plan.selection.groupPlans, { ...plan.selection.groupPlans[0]! }],
        },
      }),
    },
    {
      name: 'execution plan belongs to an unknown session',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.executionPlans',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          executionPlans: plan.selection.executionPlans.map((executionPlan) => ({
            ...executionPlan,
            sessionId: 'hostile-session' as never,
          })),
        },
      }),
    },
    {
      name: 'execution phase A id differs from numbering',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.executionPlans',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          executionPlans: plan.selection.executionPlans.map((executionPlan) => ({
            ...executionPlan,
            phase1: executionPlan.phase1.map((entry) => ({
              ...entry,
              outputAId: 'hostile-output-a' as never,
            })),
          })),
        },
      }),
    },
    {
      name: 'execution phase B source label differs from numbering',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.executionPlans',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          executionPlans: plan.selection.executionPlans.map((executionPlan) => ({
            ...executionPlan,
            phase2: executionPlan.phase2.map((entry) => ({
              ...entry,
              sourceOutputALabel: '9A' as never,
            })),
          })),
        },
      }),
    },
    {
      name: 'cover id is outside scope',
      code: 'EXPORT_COVER_001',
      field: 'packaging.selection.covers',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          covers: plan.selection.covers.map((cover) => ({
            ...cover,
            id: 'hostile-cover' as never,
          })),
        },
      }),
    },
    {
      name: 'cover source A id differs from numbering',
      code: 'EXPORT_COVER_001',
      field: 'packaging.selection.covers',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          covers: plan.selection.covers.map((cover) => ({
            ...cover,
            sourceOutputAIds: ['hostile-output-a' as never],
          })),
        },
      }),
    },
    {
      name: 'cover source A label differs from numbering',
      code: 'EXPORT_COVER_001',
      field: 'packaging.selection.covers',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          covers: plan.selection.covers.map((cover) => ({
            ...cover,
            sourceOutputALabels: ['9A' as never],
          })),
        },
      }),
    },
    {
      name: 'artwork metadata is missing for selected B',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.artworks',
      mutate: (plan) => ({
        ...plan,
        selection: { ...plan.selection, artworks: [] },
      }),
    },
    {
      name: 'extra artwork metadata is injected',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.artworks',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          artworks: [
            ...plan.selection.artworks,
            { ...plan.selection.artworks[0]!, id: 'hostile-artwork' as never },
          ],
        },
      }),
    },
    {
      name: 'artwork metadata project differs from scope',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.artworks',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          artworks: plan.selection.artworks.map((artwork) => ({
            ...artwork,
            projectId: 'hostile-project' as never,
          })),
        },
      }),
    },
    {
      name: 'validation result is duplicated',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.validationResults',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          validationResults: [
            ...plan.selection.validationResults,
            { ...plan.selection.validationResults[0]! },
          ],
        },
      }),
    },
    {
      name: 'ordered selection points at an untrusted entity',
      code: 'EXPORT_LINK_001',
      field: 'packaging.selection.ordered',
      mutate: (plan) => ({
        ...plan,
        selection: {
          ...plan.selection,
          ordered: plan.selection.ordered.map((entry, index) =>
            index === 0 ? { ...entry, entityId: 'hostile-entity' } : entry,
          ),
        },
      }),
    },
    {
      name: 'provenance session fingerprint differs from selected session anchor',
      code: 'EXPORT_LINK_001',
      field: 'packaging.provenance',
      mutate: (plan) => ({
        ...plan,
        provenance: { ...plan.provenance, sessionFingerprint: 'f'.repeat(64) as never },
      }),
    },
    {
      name: 'provenance scene fingerprints are duplicated',
      code: 'EXPORT_LINK_001',
      field: 'packaging.provenance',
      mutate: (plan) => ({
        ...plan,
        provenance: {
          ...plan.provenance,
          sceneFingerprints: [
            ...plan.provenance.sceneFingerprints,
            plan.provenance.sceneFingerprints[0]!,
          ],
        },
      }),
    },
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name} with the exact code and field`, () => {
      const plan = testCase.mutate(planForScope(9));
      expectExactFailure(packageExport(packageInputFor(plan)), testCase.code, testCase.field);
    });
  }

  it('rejects a duplicate selected version identity at the typed boundary', () => {
    const plan = planForScope(12);
    const mutated = {
      ...plan,
      selection: {
        ...plan.selection,
        versions: [...plan.selection.versions, { ...plan.selection.versions[0]! }],
      },
    };
    const result = validatePackagePlanIntegrity(mutated, createPackageFixture().limits);
    expect(result).toEqual({
      ok: false,
      failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.selection.versions')!],
    });
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects reversed selected A/B arrays instead of deriving different bytes', () => {
    const planResult = createExportPlan(createCanonicalMultiSceneExportInput());
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const plan = structuredClone(planResult.value);
    const reversed = {
      ...plan,
      selection: {
        ...plan.selection,
        outputsA: [...plan.selection.outputsA].reverse(),
        outputsB: [...plan.selection.outputsB].reverse(),
      },
    };
    expectExactFailure(
      packageExport(packageInputFor(reversed)),
      'EXPORT_LINK_001',
      'packaging.selection.outputsA',
    );
  });
});

describe('Final Controlled Merge — immutable projection and hostile metadata boundary', () => {
  it('returns detached, deeply frozen snapshots behind runtime-read-only maps', () => {
    const plan = planForScope(9);
    const result = validatePackagePlanIntegrity(plan, createPackageFixture().limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trustedPlan = (result.value as unknown as { readonly plan?: ExportPlan }).plan;
    expect(trustedPlan).toBeDefined();
    if (trustedPlan === undefined) return;
    expect(trustedPlan).not.toBe(plan);
    expect(Object.isFrozen(trustedPlan)).toBe(true);
    expect(Object.isFrozen(trustedPlan.selection)).toBe(true);
    expect(Object.isFrozen(trustedPlan.selection.sessions)).toBe(true);
    expect(Object.isFrozen(trustedPlan.selection.sessions[0])).toBe(true);
    expect((result.value.sessionsById as unknown as { set?: unknown }).set).toBeUndefined();
    expect(result.value.sessionsById.get(plan.scope.sessionIds[0]!)).not.toBe(
      plan.selection.sessions[0],
    );
  });

  it('rejects a hostile project getter without invoking it and reports the project field', () => {
    const input = structuredClone(packageInputFor(planForScope(9)));
    if (!input.planResult.ok || input.planResult.value.selection.project === null) {
      throw new Error('expected project');
    }
    let calls = 0;
    Object.defineProperty(input.planResult.value.selection.project, 'id', {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error('must not execute');
      },
    });
    expectExactFailure(packageExport(input), 'EXPORT_CORRUPT_001', 'packaging.selection.project');
    expect(calls).toBe(0);
  });

  it('rejects a sparse artworks array at the exact category boundary', () => {
    const plan = planForScope(9);
    const sparse = plan.selection.artworks.slice();
    sparse.length += 1;
    const input = packageInputFor({
      ...plan,
      selection: { ...plan.selection, artworks: sparse },
    });
    expectExactFailure(packageExport(input), 'EXPORT_CORRUPT_001', 'packaging.selection.artworks');
  });

  it('rejects a metadata cycle at the exact provenance boundary', () => {
    const input = structuredClone(packageInputFor(planForScope(9)));
    if (!input.planResult.ok) throw new Error('expected plan');
    const hostile = input.planResult.value.provenance as unknown as Record<string, unknown>;
    hostile.cycle = hostile;
    expectExactFailure(packageExport(input), 'EXPORT_CORRUPT_001', 'packaging.provenance');
  });
});
