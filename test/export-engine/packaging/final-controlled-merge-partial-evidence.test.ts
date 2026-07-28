import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import { registeredExportFailure } from '../../../src/export/failures';
import type { Project } from '../../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { packageInputFromFormatter } from './fixtures';

function packagePlan(planResult: ReturnType<typeof createExportPlan>) {
  return packageExport(
    packageInputFromFormatter({
      planResult,
      limits: CANONICAL_EXPORT_INPUT.limits,
    }),
  );
}

describe('Final Controlled Merge — exact partial-evidence reconciliation', () => {
  it('accepts a metadata-bearing session when unusable A closes dependent B, execution, and cover with exact evidence', () => {
    const project = structuredClone(CANONICAL_EXPORT_INPUT.source.project) as Project;
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    const scene = session.scenes[session.sceneOrder[0]!]!;
    scene.outputA.promptText = 'Hostile unresolved {{variable}}';
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: CANONICAL_SCOPES[7]!,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(new Set(planResult.value.omissions.map((omission) => omission.artifactKind))).toEqual(
      new Set(['output_a', 'output_b', 'execution_plan', 'cover']),
    );
    const result = packagePlan(planResult);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.omissions).toEqual(planResult.value.omissions);
    expect(
      result.entries.some((entry) =>
        ['prompt_a', 'prompt_b', 'prompt_pair', 'execution_plan', 'cover_prompt'].includes(
          entry.kind,
        ),
      ),
    ).toBe(false);
  });

  it('accepts one valid group while preserving exact omissions for an invalid peer', () => {
    const input = createCanonicalMultiSceneExportInput();
    const project = structuredClone(input.source.project) as Project;
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    session.groups['group-supplementary' as keyof typeof session.groups]!.key =
      'wrong-product' as never;
    const planResult = createExportPlan({
      ...input,
      source: { ...input.source, project },
      scope: CANONICAL_SCOPES[7]!,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.value.omissions).toContainEqual(
      expect.objectContaining({
        artifactKind: 'group',
        entityId: 'group-supplementary',
      }),
    );
    const result = packagePlan(planResult);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.omissions).toEqual(planResult.value.omissions);
    expect(result.entries.filter((entry) => entry.kind === 'group_plan')).toHaveLength(1);
  });

  it('accepts a missing session cover only with its exact omission evidence', () => {
    const project = structuredClone(CANONICAL_EXPORT_INPUT.source.project) as Project;
    project.sessions[CANONICAL_SESSION_ID]!.cover = null;
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: CANONICAL_SCOPES[7]!,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.value.omissions).toContainEqual(
      expect.objectContaining({ artifactKind: 'cover' }),
    );
    const result = packagePlan(planResult);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.some((entry) => entry.kind === 'cover_prompt')).toBe(false);
    expect(result.entries.some((entry) => entry.kind === 'cover_metadata')).toBe(false);
  });

  it('rejects a missing cover after its omission and registered issue are removed', () => {
    const project = structuredClone(CANONICAL_EXPORT_INPUT.source.project) as Project;
    project.sessions[CANONICAL_SESSION_ID]!.cover = null;
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: CANONICAL_SCOPES[7]!,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const plan = structuredClone(planResult.value);
    const coverFields = new Set(
      plan.omissions
        .filter((omission) => omission.artifactKind === 'cover')
        .map((omission) => `${omission.code}\u0000${omission.field}`),
    );
    const mutated = {
      ...plan,
      omissions: plan.omissions.filter((omission) => omission.artifactKind !== 'cover'),
      issues: plan.issues.filter((issue) => !coverFields.has(`${issue.code}\u0000${issue.field}`)),
      partial: false,
    };
    const result = packagePlan({ ok: true, value: mutated });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toEqual([
      registeredExportFailure('EXPORT_COVER_001', 'packaging.selection.covers')!,
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.omissions).toEqual([]);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects an out-of-scope supporting-metadata omission even with a matching issue', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: CANONICAL_SCOPES[7]!,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const plan = structuredClone(planResult.value);
    const field = 'source.products.hostile-product';
    const issue = registeredExportFailure('EXPORT_CORRUPT_001', field)!;
    const mutated = {
      ...plan,
      omissions: [
        ...plan.omissions,
        {
          artifactKind: 'product_metadata' as const,
          entityId: 'hostile-product',
          field,
          code: 'EXPORT_CORRUPT_001' as const,
        },
      ],
      issues: [...plan.issues, issue],
      partial: true,
    };
    const result = packagePlan({ ok: true, value: mutated });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toEqual([
      registeredExportFailure('EXPORT_LINK_001', 'packaging.selection.products')!,
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.omissions).toEqual(mutated.omissions);
    expect('zipBytes' in result).toBe(false);
  });
});
