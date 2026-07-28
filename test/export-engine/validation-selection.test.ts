import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import {
  ExportScope,
  OutputStatus,
  type OutputAId,
  type Project,
} from '../../src/shared/domain-model';
import type { ExportEngineInput } from '../../src/shared/contracts';
import { ERROR_BY_CODE } from '../../src/shared/errors';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from './fixtures';

function inputWithProject(
  project: Project,
  scope: ExportEngineInput['scope'] = CANONICAL_SCOPES[7],
): ExportEngineInput {
  return {
    ...CANONICAL_EXPORT_INPUT,
    source: { ...CANONICAL_EXPORT_INPUT.source, project },
    scope,
  };
}

function canonicalProject(): Project {
  return structuredClone(CANONICAL_PROJECT);
}

function failureCodes(result: ReturnType<typeof createExportPlan>): readonly string[] {
  return result.ok
    ? result.value.issues.map((issue) => issue.code)
    : result.failures.map((item) => item.code);
}

describe('Export-specific validation — EX §17', () => {
  it('blocks a missing required Output A prompt', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    scene.outputA = {
      ...scene.outputA,
      status: OutputStatus.Pending,
      promptText: '',
      generatedAt: null,
    };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[0]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_MISSINGA_001']);
  });

  it('rejects Output B without A using EXPORT_MISSINGA_001', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    (scene as unknown as { outputA: unknown }).outputA = null;

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[1]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_MISSINGA_001']);
  });

  it('maps a structurally absent A to EXPORT_MISSINGA_001', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    delete (scene as unknown as { outputA?: unknown }).outputA;

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[1]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_MISSINGA_001']);
  });

  it('blocks a broken A/B reference with EXPORT_LINK_001', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    scene.outputB = {
      ...scene.outputB!,
      sourceOutputAId: 'different-output-a' as OutputAId,
    };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[1]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_LINK_001']);
  });

  it('blocks unresolved variables with the approved registry code', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    scene.outputA = { ...scene.outputA, promptText: 'Generate {{missing_variable}}.' };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[0]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_PROMPTVAR_001']);
  });

  it('blocks invalid group membership with EXPORT_GROUP_001', () => {
    const project = canonicalProject();
    const groupId = CANONICAL_SCOPES[3].groupId;
    project.sessions[CANONICAL_SESSION_ID]!.groups[groupId]!.key =
      'different-product' as typeof CANONICAL_SCENE.productId;

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[3]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_GROUP_001']);
  });

  it('blocks a cover that references Output B', () => {
    const project = canonicalProject();
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    session.cover = {
      ...session.cover!,
      sourceSaleImageIds: [CANONICAL_SCENE.outputB!.id as unknown as OutputAId],
    };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[6]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_COVER_001']);
  });

  it('blocks a cover whose declared mockup count differs from its A sources', () => {
    const project = canonicalProject();
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    session.cover = {
      ...session.cover!,
      readMetadata: { ...session.cover!.readMetadata, mockupCount: 2 },
    };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[6]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_COVERCOUNT_001']);
  });

  it('refuses cover export before the all-Output-A barrier', () => {
    const project = canonicalProject();
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    session.generationProgress = {
      ...session.generationProgress,
      allOutputAReady: false,
    };

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[6]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_SCOPE_002']);
  });
});

describe('Partial export and explicit omissions — EX §18', () => {
  it('exports A and explicitly omits a missing B', () => {
    const project = canonicalProject();
    project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!.outputB = null;

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.outputsA).toHaveLength(1);
    expect(result.value.selection.outputsB).toEqual([]);
    expect(result.value.partial).toBe(true);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({
        artifactKind: 'output_b',
        code: 'EXPORT_SCOPE_002',
      }),
    );
  });

  it('allows a partial pair while listing its absent B', () => {
    const project = canonicalProject();
    project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!.outputB = null;

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[2]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.outputsA).toHaveLength(1);
    expect(result.value.selection.outputsB).toEqual([]);
    expect(result.value.omissions.map((omission) => omission.artifactKind)).toEqual(['output_b']);
  });

  it('omits stale B explicitly while retaining independently valid A', () => {
    const project = canonicalProject();
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    scene.outputB = { ...scene.outputB!, status: OutputStatus.Stale };

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.outputsA).toHaveLength(1);
    expect(result.value.selection.outputsB).toEqual([]);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({ artifactKind: 'output_b', code: 'EXPORT_STALE_001' }),
    );
    expect(result.value.issues.find((issue) => issue.code === 'EXPORT_STALE_001')?.severity).toBe(
      'warning',
    );
  });

  it('omits B and artwork metadata explicitly when PNG metadata is absent', () => {
    const project = canonicalProject();
    project.artworks = {};

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.outputsA).toHaveLength(1);
    expect(result.value.selection.outputsB).toEqual([]);
    expect(result.value.selection.artworks).toEqual([]);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({ artifactKind: 'output_b', code: 'EXPORT_PNG_001' }),
    );
  });

  it('lists the upstream-null group plan without inventing content', () => {
    const project = canonicalProject();
    const groupId = CANONICAL_SCOPES[3].groupId;
    project.sessions[CANONICAL_SESSION_ID]!.groups[groupId]!.groupPromptText = null;

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.groupPlans).toEqual([]);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({
        artifactKind: 'group_plan',
        entityId: groupId,
        code: 'EXPORT_SCOPE_002',
      }),
    );
  });

  it('exports one valid group while explicitly rejecting another', () => {
    const input = createCanonicalMultiSceneExportInput();
    const project = structuredClone(input.source.project) as Project;
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    session.groups['group-supplementary' as keyof typeof session.groups]!.key =
      'wrong-product' as (typeof session.groups)[keyof typeof session.groups]['key'];

    const result = createExportPlan({
      ...input,
      source: { ...input.source, project },
      scope: {
        baseScope: ExportScope.Session,
        scopeDetail: 'session',
        sessionId: CANONICAL_SESSION_ID,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.groups.map((group) => group.id)).toEqual(['group-private-use']);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({
        artifactKind: 'group',
        entityId: 'group-supplementary',
        code: 'EXPORT_GROUP_001',
      }),
    );
  });

  it('exports session metadata without cover and lists the omission', () => {
    const project = canonicalProject();
    project.sessions[CANONICAL_SESSION_ID]!.cover = null;

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.sessions).toHaveLength(1);
    expect(result.value.selection.covers).toEqual([]);
    expect(result.value.omissions).toContainEqual(
      expect.objectContaining({ artifactKind: 'cover', code: 'EXPORT_SCOPE_002' }),
    );
  });

  it('blocks a singular B scope when no independently valid artifact remains', () => {
    const project = canonicalProject();
    project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!.outputB = null;

    const result = createExportPlan(inputWithProject(project, CANONICAL_SCOPES[1]));
    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual(['EXPORT_SCOPE_002']);
  });

  it('accounts for every requested B as selected or explicitly omitted', () => {
    const input = createCanonicalMultiSceneExportInput();
    const project = structuredClone(input.source.project) as Project;
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    const secondSceneId = session.sceneOrder[1]!;
    session.scenes[secondSceneId]!.outputB = null;

    const result = createExportPlan({
      ...input,
      source: { ...input.source, project },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const selected = result.value.selection.outputsB.length;
    const omitted = result.value.omissions.filter(
      (omission) => omission.artifactKind === 'output_b',
    ).length;
    expect(selected + omitted).toBe(session.sceneOrder.length);
  });
});

describe('Allowlisted artifact selection — EX §10.2/§21', () => {
  it('excludes owner tokens, AssetRef, filenames, snapshot state, and artwork bytes', () => {
    const project = canonicalProject();
    project.ownerRef = 'hidden-owner-token';
    const artwork = Object.values(project.artworks)[0]!;
    artwork.fileName = 'private-local-name.png';
    artwork.pngAssetRef = '/private/local/artwork.png' as typeof artwork.pngAssetRef;

    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const encoded = JSON.stringify(result.value.selection);
    for (const forbidden of [
      'ownerRef',
      'hidden-owner-token',
      'pngAssetRef',
      '/private/local/artwork.png',
      'fileName',
      'private-local-name.png',
      'projectState',
      'asset-canonical',
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    expect(result.value.selection.artworks[0]).toEqual({
      id: artwork.id,
      projectId: artwork.projectId,
      uploadedAt: artwork.uploadedAt,
      format: 'png',
      hasTransparency: true,
      widthPx: 4500,
      heightPx: 5400,
      dpi: 300,
      aspectRatio: 4500 / 5400,
      contentHash: artwork.contentHash,
    });
  });

  it('returns owned projections instead of source entity references', () => {
    const project = canonicalProject();
    const result = createExportPlan(inputWithProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.sessions[0]).not.toBe(project.sessions[CANONICAL_SESSION_ID]);
    expect(result.value.selection.outputsA[0]).not.toBe(
      project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!.outputA,
    );
  });

  it('uses only codes present in the approved registry', () => {
    const projects = [
      canonicalProject(),
      (() => {
        const project = canonicalProject();
        project.artworks = {};
        return project;
      })(),
    ];
    const codes = projects.flatMap((project) =>
      failureCodes(createExportPlan(inputWithProject(project))),
    );

    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(ERROR_BY_CODE[code]).toBeDefined();
  });
});
