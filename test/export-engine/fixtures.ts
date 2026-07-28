import { APP_CONFIG } from '../../src/config/app-config';
import {
  Audience,
  CoverLayout,
  DomainEventType,
  EngineId,
  ExportFormat,
  ExportScope,
  GarmentView,
  GroupBy,
  OutputStatus,
  ProductKind,
  PromptModuleType,
  SeasonKind,
  SessionStatus,
  type ArtworkId,
  type AssetRef,
  type Color,
  type CoverId,
  type GroupId,
  type IsoTimestamp,
  type Product,
  type ProductId,
  type Project,
  type RuleSetId,
  type SceneId,
  type Season,
  type SemVer,
  type SerializedProjectState,
  type Sha256,
  type VersionId,
} from '../../src/shared/domain-model';
import type {
  ExportArtifact,
  ExportAuditEvent,
  ExportEngineInput,
  ExportEngineResult,
  ExportOperationalScope,
} from '../../src/engines/export-engine';
import { createNestedProject } from '../persistence/fixtures';

export const CANONICAL_EXPORT_TIME = '2026-07-26T10:00:00.000Z' as IsoTimestamp;
const digest = (character: string): Sha256 => character.repeat(64).slice(0, 64) as Sha256;
const version = (value: string): SemVer => value as SemVer;

const baseProject = createNestedProject({
  name: 'مشروع التصدير المعياري',
});
const baseSessionId = baseProject.sessionOrder[0]!;
const baseSession = baseProject.sessions[baseSessionId]!;
const baseSceneId = baseSession.sceneOrder[0]!;
const baseScene = baseSession.scenes[baseSceneId]!;
const baseGroupId = Object.keys(baseSession.groups)[0] as keyof typeof baseSession.groups;
const canonicalArtworkId = 'artwork-canonical' as ArtworkId;
const canonicalVersionId = 'version-canonical' as VersionId;

const canonicalOutputA = {
  ...baseScene.outputA,
  status: OutputStatus.Generated,
  promptText: 'Create one premium sale image of a blank white T-shirt.',
  contentHash: digest('1'),
  generatedAt: CANONICAL_EXPORT_TIME,
  promptHash: digest('2'),
};
const canonicalOutputB: NonNullable<typeof baseScene.outputB> = {
  id: 'output-b-canonical' as NonNullable<typeof baseScene.outputB>['id'],
  sceneId: baseSceneId,
  sourceOutputAId: canonicalOutputA.id,
  artworkId: canonicalArtworkId,
  onlyArtworkChanges: true,
  sourceContentHash: canonicalOutputA.contentHash,
  status: OutputStatus.Generated,
  promptText: 'Edit only the printable area using the supplied transparent PNG.',
  generatedAt: CANONICAL_EXPORT_TIME,
  promptHash: digest('3'),
  renderHash: null,
  sourceHash: canonicalOutputA.contentHash,
  contentHash: digest('4'),
  promptMeta: null,
};
const canonicalScene = {
  ...baseScene,
  outputA: canonicalOutputA,
  outputB: canonicalOutputB,
  sceneHash: digest('5'),
  sceneFingerprint: digest('6'),
};
const canonicalGroup = {
  ...baseSession.groups[baseGroupId]!,
  groupPromptText: 'Execute all group A prompts before their matching group B prompts.',
};
const canonicalCover = {
  id: 'cover-canonical' as CoverId,
  sessionId: baseSessionId,
  sourceSaleImageIds: [canonicalOutputA.id],
  layout: CoverLayout.Single,
  readMetadata: {
    productIds: [canonicalScene.productId],
    colors: [canonicalScene.paletteColorId],
    mockupCount: 1,
    views: [canonicalScene.view],
    seasonId: baseSession.season,
    digitalProductStatus: true,
    primaryProduct: canonicalScene.productId,
    primaryColor: canonicalScene.paletteColorId,
    primaryView: canonicalScene.view,
    primaryAudience: Audience.Adult,
  },
  status: OutputStatus.Generated,
  promptText: 'Create one cover image using the supplied Output A sale image only.',
  generatedAt: CANONICAL_EXPORT_TIME,
  promptHash: digest('7'),
  renderHash: null,
  coverHash: digest('8'),
  promptMeta: null,
} satisfies NonNullable<typeof baseSession.cover>;
const canonicalSession = {
  ...baseSession,
  scenes: { [baseSceneId]: canonicalScene },
  groups: { [baseGroupId]: canonicalGroup },
  cover: canonicalCover,
  status: SessionStatus.Ready,
  generationProgress: {
    totalScenes: 1,
    outputAGenerated: 1,
    outputBGenerated: 1,
    coverGenerated: true,
    allOutputAReady: true,
  },
  fingerprint: {
    hash: digest('9'),
    components: {
      ...baseSession.fingerprint.components,
      sceneFingerprints: [canonicalScene.sceneFingerprint],
      artworkContentHashes: [digest('a')],
      ruleSetVersions: { 'rule-set-export-v3': 3 },
    },
  },
};

export const CANONICAL_PROJECT: Project = {
  ...baseProject,
  sessions: { [baseSessionId]: canonicalSession },
  currentVersionId: canonicalVersionId,
  versionHistory: {
    [canonicalVersionId]: {
      versionId: canonicalVersionId,
      projectId: baseProject.id,
      timestamp: CANONICAL_EXPORT_TIME,
      parentVersionId: null,
      projectState: '{"schemaVersion":1}' as SerializedProjectState,
      reason: 'manual_save',
      stateHash: digest('b'),
    },
  },
  versionOrder: [canonicalVersionId],
  artworks: {
    [canonicalArtworkId]: {
      id: canonicalArtworkId,
      projectId: baseProject.id,
      fileName: 'canonical-design.png',
      pngAssetRef: 'asset-canonical' as AssetRef,
      uploadedAt: CANONICAL_EXPORT_TIME,
      format: 'png',
      hasTransparency: true,
      widthPx: 4500,
      heightPx: 5400,
      dpi: 300,
      aspectRatio: 4500 / 5400,
      contentHash: digest('a'),
    },
  },
};
export const CANONICAL_SESSION_ID = CANONICAL_PROJECT.sessionOrder[0]!;
export const CANONICAL_SESSION = CANONICAL_PROJECT.sessions[CANONICAL_SESSION_ID]!;
export const CANONICAL_SCENE_ID = CANONICAL_SESSION.sceneOrder[0]!;
export const CANONICAL_SCENE = CANONICAL_SESSION.scenes[CANONICAL_SCENE_ID]!;
export const CANONICAL_GROUP_ID = baseGroupId;
export const CANONICAL_RULE_SET_ID = 'rule-set-export-v3' as RuleSetId;

export const CANONICAL_PRODUCT: Product = {
  id: CANONICAL_SCENE.productId,
  schemaVersion: 1,
  kind: ProductKind.ClassicTShirt,
  name: 'Canonical Export Tee',
  type: 'tshirt',
  allowedViews: [GarmentView.Front],
  printAreaProfile: {
    id: CANONICAL_SCENE.printAreaRulesRef,
    position: 'center_chest',
    minSizeRatio: 0.25,
    centeringTolerance: 0.1,
    centered: true,
    maxShadowCoverage: 0.2,
    forbiddenOverlaps: [],
  },
  audienceConstraints: { allowedAudiences: [Audience.Adult] },
  defaultColors: [CANONICAL_SCENE.paletteColorId],
  expandable: true,
};

export const CANONICAL_SEASON: Season = {
  id: CANONICAL_SESSION.season,
  schemaVersion: 1,
  kind: SeasonKind.MinimalStudio,
  name: 'Minimal Studio',
  sceneLibraryRef: 'library-minimal-studio' as Season['sceneLibraryRef'],
  decorConstraints: [],
  heroSceneConstraints: [],
  forbiddenSeasonDecor: [],
};

export const CANONICAL_COLOR: Color = {
  id: CANONICAL_SCENE.paletteColorId,
  name: 'White',
  hex: '#FFFFFF' as Color['hex'],
};

export const CANONICAL_SCOPES = [
  {
    baseScope: ExportScope.Output,
    scopeDetail: 'output_a',
    sessionId: CANONICAL_SESSION_ID,
    sceneId: CANONICAL_SCENE_ID,
    outputAId: CANONICAL_SCENE.outputA.id,
  },
  {
    baseScope: ExportScope.Output,
    scopeDetail: 'output_b',
    sessionId: CANONICAL_SESSION_ID,
    sceneId: CANONICAL_SCENE_ID,
    outputBId: canonicalOutputB.id,
  },
  {
    baseScope: ExportScope.Output,
    scopeDetail: 'pair',
    sessionId: CANONICAL_SESSION_ID,
    sceneId: CANONICAL_SCENE_ID,
  },
  {
    baseScope: ExportScope.Group,
    scopeDetail: 'group',
    sessionId: CANONICAL_SESSION_ID,
    groupId: CANONICAL_GROUP_ID,
  },
  {
    baseScope: ExportScope.Group,
    scopeDetail: 'group_a',
    sessionId: CANONICAL_SESSION_ID,
    groupId: CANONICAL_GROUP_ID,
  },
  {
    baseScope: ExportScope.Group,
    scopeDetail: 'group_b',
    sessionId: CANONICAL_SESSION_ID,
    groupId: CANONICAL_GROUP_ID,
  },
  {
    baseScope: ExportScope.Cover,
    scopeDetail: 'cover',
    sessionId: CANONICAL_SESSION_ID,
    coverId: canonicalCover.id,
  },
  {
    baseScope: ExportScope.Session,
    scopeDetail: 'session',
    sessionId: CANONICAL_SESSION_ID,
  },
  {
    baseScope: ExportScope.Session,
    scopeDetail: 'execution_plan',
    sessionId: CANONICAL_SESSION_ID,
  },
  { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
  {
    baseScope: ExportScope.All,
    scopeDetail: 'backup',
    backupType: 'full_project',
  },
  {
    baseScope: ExportScope.All,
    scopeDetail: 'backup',
    backupType: 'session',
    sessionId: CANONICAL_SESSION_ID,
  },
  {
    baseScope: ExportScope.All,
    scopeDetail: 'version_snapshot',
    versionId: canonicalVersionId,
  },
  { baseScope: ExportScope.All, scopeDetail: 'prompt_pack' },
  {
    baseScope: ExportScope.Session,
    scopeDetail: 'prompt_pack',
    sessionId: CANONICAL_SESSION_ID,
  },
  { baseScope: ExportScope.All, scopeDetail: 'all' },
] as const satisfies readonly ExportOperationalScope[];

export const CANONICAL_EXPORT_INPUT = {
  source: {
    project: CANONICAL_PROJECT,
    products: [CANONICAL_PRODUCT],
    seasons: [CANONICAL_SEASON],
    colors: [CANONICAL_COLOR],
  },
  scope: CANONICAL_SCOPES[7],
  formats: [ExportFormat.Txt, ExportFormat.Json, 'markdown', 'clipboard'],
  createdAt: CANONICAL_EXPORT_TIME,
  versions: {
    applicationVersion: version('0.1.0'),
    generatorVersion: version('0.1.0'),
    ruleSetVersions: { [CANONICAL_RULE_SET_ID]: 3 },
    promptModuleVersions: {
      [PromptModuleType.Global]: version('1.0.0'),
      [PromptModuleType.Product]: version('1.0.0'),
      [PromptModuleType.Season]: version('1.0.0'),
      [PromptModuleType.Scene]: version('1.0.0'),
      [PromptModuleType.OutputA]: version('1.0.0'),
      [PromptModuleType.OutputB]: version('1.0.0'),
      [PromptModuleType.Cover]: version('1.0.0'),
      [PromptModuleType.Group]: version('1.0.0'),
    },
  },
  limits: APP_CONFIG.limits.export,
} as const satisfies ExportEngineInput;

/**
 * Two-scene fixture whose map insertion order, scene order, and UTF-8 group-key
 * order deliberately differ. It is the canonical oracle for EX §6–§7.
 */
export function createCanonicalMultiSceneExportInput(): ExportEngineInput {
  const project = structuredClone(CANONICAL_PROJECT);
  const session = project.sessions[CANONICAL_SESSION_ID]!;
  const supplementaryProductId = '𐀀-product' as ProductId;
  const privateUseProductId = '\uE000-product' as ProductId;
  const firstSceneId = 'scene-supplementary' as SceneId;
  const secondSceneId = 'scene-private-use' as SceneId;
  const firstOutputAId = 'output-a-supplementary' as typeof CANONICAL_SCENE.outputA.id;
  const secondOutputAId = 'output-a-private-use' as typeof CANONICAL_SCENE.outputA.id;
  const firstOutputBId = 'output-b-supplementary' as NonNullable<
    typeof CANONICAL_SCENE.outputB
  >['id'];
  const secondOutputBId = 'output-b-private-use' as NonNullable<
    typeof CANONICAL_SCENE.outputB
  >['id'];
  const firstScene = {
    ...CANONICAL_SCENE,
    id: firstSceneId,
    productId: supplementaryProductId,
    outputA: {
      ...CANONICAL_SCENE.outputA,
      id: firstOutputAId,
      sceneId: firstSceneId,
      promptText: 'Supplementary-plane product A prompt.\nLine two.',
      contentHash: digest('c'),
      promptHash: digest('d'),
    },
    outputB: {
      ...CANONICAL_SCENE.outputB!,
      id: firstOutputBId,
      sceneId: firstSceneId,
      sourceOutputAId: firstOutputAId,
      sourceContentHash: digest('c'),
      sourceHash: digest('c'),
      promptHash: digest('e'),
      contentHash: digest('f'),
    },
    sceneHash: digest('0'),
    sceneFingerprint: digest('1'),
  };
  const secondScene = {
    ...CANONICAL_SCENE,
    id: secondSceneId,
    productId: privateUseProductId,
    outputA: {
      ...CANONICAL_SCENE.outputA,
      id: secondOutputAId,
      sceneId: secondSceneId,
      promptText: 'Private-use product A prompt.',
      contentHash: digest('2'),
      promptHash: digest('3'),
    },
    outputB: {
      ...CANONICAL_SCENE.outputB!,
      id: secondOutputBId,
      sceneId: secondSceneId,
      sourceOutputAId: secondOutputAId,
      sourceContentHash: digest('2'),
      sourceHash: digest('2'),
      promptHash: digest('4'),
      contentHash: digest('5'),
    },
    sceneHash: digest('6'),
    sceneFingerprint: digest('7'),
  };
  const supplementaryGroupId = 'group-supplementary' as GroupId;
  const privateUseGroupId = 'group-private-use' as GroupId;
  const nextSession = {
    ...session,
    productIds: [supplementaryProductId, privateUseProductId],
    requestedSceneCount: 2,
    scenes: {
      [secondSceneId]: secondScene,
      [firstSceneId]: firstScene,
    },
    sceneOrder: [firstSceneId, secondSceneId],
    groups: {
      [supplementaryGroupId]: {
        id: supplementaryGroupId,
        sessionId: session.id,
        groupBy: GroupBy.Product,
        key: supplementaryProductId,
        sceneIds: [firstSceneId],
        groupPromptText: 'Supplementary group plan.',
      },
      [privateUseGroupId]: {
        id: privateUseGroupId,
        sessionId: session.id,
        groupBy: GroupBy.Product,
        key: privateUseProductId,
        sceneIds: [secondSceneId],
        groupPromptText: 'Private-use group plan.',
      },
    },
    cover: {
      ...CANONICAL_SESSION.cover!,
      sourceSaleImageIds: [firstOutputAId, secondOutputAId],
      layout: CoverLayout.Duo,
      readMetadata: {
        ...CANONICAL_SESSION.cover!.readMetadata,
        productIds: [supplementaryProductId, privateUseProductId],
        mockupCount: 2,
        primaryProduct: supplementaryProductId,
      },
      coverHash: digest('8'),
    },
    generationProgress: {
      totalScenes: 2,
      outputAGenerated: 2,
      outputBGenerated: 2,
      coverGenerated: true,
      allOutputAReady: true,
    },
    fingerprint: {
      ...session.fingerprint,
      hash: digest('9'),
      components: {
        ...session.fingerprint.components,
        productIds: [supplementaryProductId, privateUseProductId],
        requestedSceneCount: 2,
        sceneFingerprints: [firstScene.sceneFingerprint, secondScene.sceneFingerprint],
      },
    },
  };
  project.sessions = { [CANONICAL_SESSION_ID]: nextSession };
  return {
    ...CANONICAL_EXPORT_INPUT,
    source: {
      project,
      products: [
        { ...CANONICAL_PRODUCT, id: supplementaryProductId, name: 'Supplementary Product' },
        { ...CANONICAL_PRODUCT, id: privateUseProductId, name: 'Private-use Product' },
      ],
      seasons: [CANONICAL_SEASON],
      colors: [CANONICAL_COLOR],
    },
    scope: {
      baseScope: ExportScope.Session,
      scopeDetail: 'session',
      sessionId: CANONICAL_SESSION_ID,
    },
  };
}

const artifactBytes = new Uint8Array([80, 114, 111, 109, 112, 116, 10]);
const artifactPath = 'session-01/prompts/A/001_canonical_A.txt';

export const CANONICAL_EXPORT_ARTIFACT = {
  path: artifactPath,
  kind: 'prompt_a',
  format: ExportFormat.Txt,
  mediaType: 'text/plain;charset=utf-8',
  bytes: artifactBytes,
  byteLength: artifactBytes.byteLength,
  checksum: '72f3433452adc87d1aa13b874abeead739fe5cbd0176e0987be4c1c37ae241fd' as Sha256,
} as const satisfies ExportArtifact;

const eventBase = {
  occurredAt: CANONICAL_EXPORT_TIME,
  projectId: CANONICAL_PROJECT.id,
  sessionId: CANONICAL_SESSION_ID,
};
const sessionScope = CANONICAL_SCOPES[7];

export const CANONICAL_EXPORT_EVENTS = [
  {
    ...eventBase,
    eventId: 'event-export-started' as ExportAuditEvent['eventId'],
    type: DomainEventType.ExportStarted,
    emittedBy: EngineId.Export,
    exportId: 'export-canonical',
    scope: sessionScope,
    formats: CANONICAL_EXPORT_INPUT.formats,
    sessionIds: [CANONICAL_SESSION_ID],
  },
  {
    ...eventBase,
    eventId: 'event-export-completed' as ExportAuditEvent['eventId'],
    type: DomainEventType.ExportCompleted,
    emittedBy: EngineId.Export,
    exportId: 'export-canonical',
    fileCount: 1,
    totalBytes: artifactBytes.byteLength,
    manifestChecksum: digest('b'),
  },
  {
    ...eventBase,
    eventId: 'event-export-failed' as ExportAuditEvent['eventId'],
    type: DomainEventType.ExportFailed,
    emittedBy: EngineId.Export,
    exportId: 'export-canonical',
    code: 'EXPORT_SCOPE_001',
    stage: 'validation',
  },
  {
    ...eventBase,
    eventId: 'event-backup-created' as ExportAuditEvent['eventId'],
    type: DomainEventType.BackupCreated,
    emittedBy: EngineId.Export,
    exportId: 'export-canonical',
    backupType: 'full_project',
    stateHash: digest('c'),
  },
  {
    ...eventBase,
    eventId: 'event-restore-started' as ExportAuditEvent['eventId'],
    type: DomainEventType.RestoreStarted,
    emittedBy: EngineId.Export,
    backupId: 'backup-canonical',
    mode: 'merge',
  },
  {
    ...eventBase,
    eventId: 'event-restore-completed' as ExportAuditEvent['eventId'],
    type: DomainEventType.RestoreCompleted,
    emittedBy: EngineId.Persistence,
    backupId: 'backup-canonical',
    appliedChanges: 1,
  },
  {
    ...eventBase,
    eventId: 'event-restore-failed' as ExportAuditEvent['eventId'],
    type: DomainEventType.RestoreFailed,
    emittedBy: EngineId.Persistence,
    backupId: 'backup-canonical',
    code: 'EXPORT_RESTORE_001',
    rolledBack: true,
  },
  {
    ...eventBase,
    eventId: 'event-clipboard-completed' as ExportAuditEvent['eventId'],
    type: DomainEventType.ClipboardCopyCompleted,
    emittedBy: EngineId.Export,
    scope: CANONICAL_SCOPES[0],
    payloadChecksum: digest('d'),
  },
  {
    ...eventBase,
    eventId: 'event-clipboard-failed' as ExportAuditEvent['eventId'],
    type: DomainEventType.ClipboardCopyFailed,
    emittedBy: EngineId.Export,
    scope: CANONICAL_SCOPES[0],
    code: 'EXPORT_CLIP_002',
  },
] as const satisfies readonly ExportAuditEvent[];

export const CANONICAL_EXPORT_RESULT = {
  ok: true,
  value: {
    exportId: 'export-canonical',
    requestedFormats: CANONICAL_EXPORT_INPUT.formats,
    manifest: {
      exportId: 'export-canonical',
      schemaVersion: 1,
      projectId: CANONICAL_PROJECT.id,
      sessionIds: [CANONICAL_SESSION_ID],
      exportScope: ExportScope.Session,
      scopeDetail: 'session',
      exportFormats: [ExportFormat.Txt, ExportFormat.Json],
      createdAt: CANONICAL_EXPORT_TIME,
      applicationVersion: version('0.1.0'),
      generatorVersion: version('0.1.0'),
      ruleSetVersions: { [CANONICAL_RULE_SET_ID]: 3 },
      promptModuleVersions: CANONICAL_EXPORT_INPUT.versions.promptModuleVersions,
      includedFiles: [{ path: artifactPath, kind: 'A' }],
      fileSizes: { [artifactPath]: artifactBytes.byteLength },
      checksums: { [artifactPath]: CANONICAL_EXPORT_ARTIFACT.checksum },
      warnings: [],
      sourceFingerprints: {
        sessionFingerprint: CANONICAL_SESSION.fingerprint.hash,
        sceneFingerprints: [CANONICAL_SCENE.sceneFingerprint],
      },
    },
    manifestChecksum: digest('b'),
    artifacts: [CANONICAL_EXPORT_ARTIFACT],
    deliveries: [],
    omissions: [],
    warnings: [],
    partial: false,
    totalBytes: artifactBytes.byteLength,
    events: [CANONICAL_EXPORT_EVENTS[0], CANONICAL_EXPORT_EVENTS[1]],
  },
} as const satisfies ExportEngineResult;
