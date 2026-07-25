import {
  Audience,
  DisplayMethod,
  GarmentView,
  OutputStatus,
  PrintAreaObstruction,
  ProductKind,
  type ColorId,
  type PrintAreaProfile,
  type PrintAreaRuleSetId,
  type Product,
  type ProductId,
  type Scene,
  type SceneId,
  type SessionId,
} from '../../src/shared/domain-model';
import type { PrintAreaEngineInput } from '../../src/engines/print-area-engine';

export const PROFILE_ID = 'pa-profile-tee' as PrintAreaRuleSetId;
export const PRODUCT_ID = 'product-tee' as ProductId;

export function profile(overrides: Partial<PrintAreaProfile> = {}): PrintAreaProfile {
  return {
    id: PROFILE_ID,
    position: 'center_chest',
    minSizeRatio: 0.35,
    centeringTolerance: 0.05,
    centered: true,
    maxShadowCoverage: 0.1,
    forbiddenOverlaps: [
      PrintAreaObstruction.Hands,
      PrintAreaObstruction.Hair,
      PrintAreaObstruction.Props,
      PrintAreaObstruction.DeepFolds,
      PrintAreaObstruction.Shadows,
    ],
    ...overrides,
  };
}

export function product(overrides: Partial<Product> = {}): Product {
  const printAreaProfile = overrides.printAreaProfile ?? profile();
  return {
    id: PRODUCT_ID,
    schemaVersion: 1,
    kind: ProductKind.ClassicTShirt,
    name: 'Tee',
    type: 'tee',
    allowedViews: [GarmentView.Front, GarmentView.Back],
    printAreaProfile,
    audienceConstraints: { allowedAudiences: [Audience.Adult] },
    defaultColors: ['white' as ColorId],
    expandable: true,
    ...overrides,
  };
}

export function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-pa-1' as SceneId,
    sessionId: 'session-pa-1' as SessionId,
    templateId: 'template-pa-1' as Scene['templateId'],
    productId: PRODUCT_ID,
    locationId: 'location-1' as Scene['locationId'],
    lightingId: 'lighting-1' as Scene['lightingId'],
    decorIds: [],
    propIds: [],
    cameraId: 'camera-1' as Scene['cameraId'],
    compositionId: 'composition-1' as Scene['compositionId'],
    poseId: 'pose-1' as Scene['poseId'],
    displayMethod: DisplayMethod.FlatLay,
    paletteColorId: 'white' as ColorId,
    seasonId: 'season-1' as Scene['seasonId'],
    printAreaRulesRef: PROFILE_ID,
    view: GarmentView.Front,
    dedupSignature: {
      sceneTemplateId: 'template-pa-1' as Scene['templateId'],
      poseId: 'pose-1' as Scene['poseId'],
      cameraAngle: 'top_down' as Scene['dedupSignature']['cameraAngle'],
      compositionId: 'composition-1' as Scene['compositionId'],
      hash: 'dedup-pa-1' as Scene['dedupSignature']['hash'],
    },
    outputA: {
      id: 'output-a-pa-1' as Scene['outputA']['id'],
      sceneId: 'scene-pa-1' as SceneId,
      garment: 'tee',
      color: 'white' as ColorId,
      view: GarmentView.Front,
      status: OutputStatus.Pending,
      forbidden: ['artwork', 'logo', 'watermark', 'typography'],
      promptText: '',
      contentHash: 'content-pa-1' as Scene['outputA']['contentHash'],
      generatedAt: null,
      promptHash: 'prompt-pa-1' as Scene['outputA']['promptHash'],
      renderHash: null,
      promptMeta: null,
    },
    outputB: null,
    sceneVersion: 1,
    sceneHash: 'scene-hash-pa-1' as Scene['sceneHash'],
    sceneFingerprint: 'scene-fingerprint-pa-1' as Scene['sceneFingerprint'],
    ...overrides,
  };
}

export function input(overrides: Partial<PrintAreaEngineInput> = {}): PrintAreaEngineInput {
  const p = overrides.profile ?? profile();
  const prod = overrides.product ?? product({ printAreaProfile: p });
  return {
    scene: overrides.scene ?? scene({ productId: prod.id, printAreaRulesRef: p.id }),
    product: prod,
    profile: p,
    observation: {
      overlaps: [],
      sizeRatio: 0.5,
      centeringOffset: 0.02,
      shadowCoverage: 0.03,
    },
    constraints: [],
    ...overrides,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
