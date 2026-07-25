import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/shared/domain-model';
import { validateProjectDocument } from '../../src/persistence';
import { createNestedProject, createProject, PROJECT_ID, T0 } from './fixtures';

function clone(project: Project): Record<string, unknown> {
  return structuredClone(project) as unknown as Record<string, unknown>;
}

function issues(
  result: ReturnType<typeof validateProjectDocument>,
): readonly Record<string, unknown>[] {
  if (result.ok) return [];
  const value = result.error.details?.issues;
  return Array.isArray(value) ? (value as readonly Record<string, unknown>[]) : [];
}

function expectPath(project: unknown, path: string): void {
  const result = validateProjectDocument(project);
  expect(result.ok).toBe(false);
  expect(issues(result).some((issue) => issue.jsonPointer === path)).toBe(true);
}

function sessionOf(project: Record<string, unknown>): Record<string, unknown> {
  return (project.sessions as Record<string, Record<string, unknown>>)['جلسة-001'];
}

function sceneOf(session: Record<string, unknown>): Record<string, unknown> {
  return (session.scenes as Record<string, Record<string, unknown>>)['scene-001'];
}

describe('complete Project JSON Schema + referential validation', () => {
  it('accepts a complete nested Project', () => {
    expect(validateProjectDocument(createNestedProject()).ok).toBe(true);
  });

  it('rejects an incomplete session with an exact AJV path', () => {
    const project = clone(createNestedProject());
    (project.sessions as Record<string, unknown>)['جلسة-001'] = { id: 'جلسة-001' };
    expectPath(project, '/sessions/جلسة-001/projectId');
  });

  it('rejects an incomplete scene recursively', () => {
    const project = clone(createNestedProject());
    const session = sessionOf(project);
    (session.scenes as Record<string, unknown>)['scene-001'] = { id: 'scene-001' };
    expectPath(project, '/sessions/جلسة-001/scenes/scene-001/sessionId');
  });

  it('rejects invalid sceneOrder and sessionOrder references', () => {
    const badSceneOrder = clone(createNestedProject());
    sessionOf(badSceneOrder).sceneOrder = ['missing-scene'];
    expectPath(badSceneOrder, '/sessions/جلسة-001/sceneOrder');

    const badSessionOrder = clone(createNestedProject());
    badSessionOrder.sessionOrder = ['missing-session'];
    expectPath(badSessionOrder, '/sessionOrder');
  });

  it('rejects OutputB linkage that does not point to the parent OutputA', () => {
    const project = clone(createNestedProject());
    const session = sessionOf(project);
    const scene = sceneOf(session);
    project.artworks = {
      'artwork-001': {
        id: 'artwork-001',
        projectId: PROJECT_ID,
        fileName: 'artwork.png',
        pngAssetRef: 'opaque-asset-ref',
        uploadedAt: T0,
        format: 'png',
        hasTransparency: true,
        widthPx: 1,
        heightPx: 1,
        aspectRatio: 1,
        contentHash: 'content-hash',
      },
    };
    scene.outputB = {
      id: 'preview-image-001',
      sceneId: 'scene-001',
      sourceOutputAId: 'wrong-output-a',
      artworkId: 'artwork-001',
      onlyArtworkChanges: true,
      sourceContentHash: 'output-a-content',
      status: 'pending',
      promptText: '',
      generatedAt: null,
      promptHash: 'output-b-prompt',
      renderHash: null,
      sourceHash: 'output-a-content',
      contentHash: 'output-b-content',
      promptMeta: null,
    };
    expectPath(project, '/sessions/جلسة-001/scenes/scene-001/outputB/sourceOutputAId');
  });

  it('rejects a MainCover source that is not a real OutputA in the same session', () => {
    const project = clone(createNestedProject());
    sessionOf(project).cover = {
      id: 'cover-001',
      sessionId: 'جلسة-001',
      sourceSaleImageIds: ['missing-output-a'],
      layout: 'single',
      readMetadata: {
        productIds: ['product-001'],
        colors: ['color-001'],
        mockupCount: 1,
        views: ['front'],
        seasonId: 'season-001',
        digitalProductStatus: true,
        primaryProduct: 'product-001',
        primaryColor: 'color-001',
        primaryView: 'front',
        primaryAudience: 'adult',
      },
      status: 'pending',
      promptText: '',
      generatedAt: null,
      promptHash: 'cover-prompt',
      renderHash: null,
      coverHash: 'cover-hash',
      promptMeta: null,
    };
    expectPath(project, '/sessions/جلسة-001/cover/sourceSaleImageIds/0');
  });

  it('rejects missing validationResultId and currentVersionId targets', () => {
    const validation = clone(createNestedProject());
    sessionOf(validation).validationResultId = 'missing-validation';
    expectPath(validation, '/sessions/جلسة-001/validationResultId');

    const version = clone(createProject());
    version.currentVersionId = 'missing-version';
    expectPath(version, '/currentVersionId');
  });

  it('rejects Artwork belonging to another project', () => {
    const project = clone(createProject());
    project.artworks = {
      a: {
        id: 'a',
        projectId: 'other-project',
        fileName: 'a.png',
        pngAssetRef: 'opaque-ref',
        uploadedAt: T0,
        format: 'png',
        hasTransparency: false,
        widthPx: 1,
        heightPx: 1,
        aspectRatio: 1,
        contentHash: 'hash',
      },
    };
    expectPath(project, '/artworks/a/projectId');
  });

  it('rejects runtime-only objects and unexpected nested fields', () => {
    const runtime = clone(createNestedProject());
    sceneOf(sessionOf(runtime)).evaluationContext = { project: {} };
    expectPath(runtime, '/sessions/جلسة-001/scenes/scene-001/evaluationContext');

    const unexpected = clone(createNestedProject());
    sceneOf(sessionOf(unexpected)).unexpected = true;
    expectPath(unexpected, '/sessions/جلسة-001/scenes/scene-001/unexpected');
  });

  it('rejects malformed schemaVersion values', () => {
    const malformed = clone(createProject());
    malformed.schemaVersion = 1.5;
    expectPath(malformed, '/schemaVersion');
  });
});
