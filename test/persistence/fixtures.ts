import {
  PersistenceMode,
  RetentionPolicyKind,
  type IsoTimestamp,
  type Project,
  type ProjectId,
} from '../../src/shared/domain-model';

export const T0 = '2026-07-16T10:00:00.000Z' as IsoTimestamp;
export const T1 = '2026-07-16T11:00:00.000Z' as IsoTimestamp;
export const T2 = '2026-07-16T12:00:00.000Z' as IsoTimestamp;
export const PROJECT_ID = 'project-001' as ProjectId;

export function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    schemaVersion: 1,
    name: 'Deterministic Project',
    createdAt: T0,
    updatedAt: T0,
    sessions: {},
    sessionOrder: [],
    currentVersionId: null,
    versionHistory: {},
    versionOrder: [],
    isDigitalProduct: true,
    persistenceMode: PersistenceMode.LocalSingleUser,
    retention: { kind: RetentionPolicyKind.KeepAll },
    artworks: {},
    ...overrides,
  };
}

export const TRANSPARENT_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

export function createNestedProject(overrides: Partial<Project> = {}): Project {
  const projectId = (overrides.id ?? PROJECT_ID) as ProjectId;
  const sessionId = 'جلسة-001';
  const sceneId = 'scene-001';
  const outputAId = 'sale-image-001';
  const validationId = 'validation-001';
  const groupId = 'group-001';
  const nested = {
    id: projectId,
    schemaVersion: 1,
    name: 'Nested Project',
    createdAt: T0,
    updatedAt: T0,
    sessions: {
      [sessionId]: {
        id: sessionId,
        projectId,
        name: 'جلسة اختبار',
        createdAt: T0,
        updatedAt: T0,
        season: 'season-001',
        audience: 'adult',
        productIds: ['product-001'],
        colorSelection: { colorIds: ['color-001'], locked: true },
        requestedSceneCount: 1,
        scenes: {
          [sceneId]: {
            id: sceneId,
            sessionId,
            templateId: 'template-001',
            productId: 'product-001',
            locationId: 'location-001',
            lightingId: 'lighting-001',
            decorIds: [],
            propIds: [],
            cameraId: 'camera-001',
            compositionId: 'composition-001',
            poseId: 'pose-001',
            displayMethod: 'flat_lay',
            paletteColorId: 'color-001',
            seasonId: 'season-001',
            printAreaRulesRef: 'print-area-001',
            view: 'front',
            dedupSignature: {
              sceneTemplateId: 'template-001',
              poseId: 'pose-001',
              cameraAngle: 'top_down',
              compositionId: 'composition-001',
              hash: 'dedup-hash',
            },
            outputA: {
              id: outputAId,
              sceneId,
              garment: 'tee',
              color: 'color-001',
              view: 'front',
              status: 'pending',
              forbidden: ['artwork', 'logo', 'watermark', 'typography'],
              promptText: '',
              contentHash: 'output-a-content',
              generatedAt: null,
              promptHash: 'output-a-prompt',
              renderHash: null,
              promptMeta: null,
            },
            outputB: null,
            sceneVersion: 1,
            sceneHash: 'scene-hash',
            sceneFingerprint: 'scene-fingerprint',
          },
        },
        sceneOrder: [sceneId],
        groups: {
          [groupId]: {
            id: groupId,
            sessionId,
            groupBy: 'product',
            key: 'product-001',
            sceneIds: [sceneId],
            groupPromptText: null,
          },
        },
        cover: null,
        status: 'draft',
        validationResultId: validationId,
        validationResults: {
          [validationId]: {
            id: validationId,
            sessionId,
            evaluatedAt: T0,
            passed: true,
            checks: [{ check: 'season', passed: true }],
            failures: [],
          },
        },
        dedupLedger: { seen: ['dedup-hash'], combinationSpaceSize: 1 },
        generationProgress: {
          totalScenes: 1,
          outputAGenerated: 0,
          outputBGenerated: 0,
          coverGenerated: false,
          allOutputAReady: false,
        },
        fingerprint: {
          hash: 'session-fingerprint',
          components: {
            season: 'season-001',
            audience: 'adult',
            productIds: ['product-001'],
            colorIds: ['color-001'],
            colorLocked: true,
            requestedSceneCount: 1,
            sceneFingerprints: ['scene-fingerprint'],
            artworkContentHashes: [],
            ruleSetVersions: {},
            isDigitalProduct: true,
          },
        },
      },
    },
    sessionOrder: [sessionId],
    currentVersionId: null,
    versionHistory: {},
    versionOrder: [],
    isDigitalProduct: true,
    persistenceMode: PersistenceMode.LocalSingleUser,
    retention: { kind: RetentionPolicyKind.KeepAll },
    artworks: {},
    ...overrides,
  };
  return nested as unknown as Project;
}
