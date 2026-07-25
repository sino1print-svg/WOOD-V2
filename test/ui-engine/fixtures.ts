import { Audience, DisplayMethod, GarmentView } from '../../src/shared/domain-model';
import type {
  ColorId,
  ProductId,
  Scene,
  SeasonId,
  ValidationFailure,
} from '../../src/shared/domain-model';
import type { PromptViewModel, SessionDraft, UiCatalog, UiEnginePorts } from '../../src/ui-engine';

export const productId = 'product-bella-3001' as ProductId;
export const colorId = 'color-white' as ColorId;
export const seasonId = 'season-halloween' as SeasonId;

export const catalog: UiCatalog = {
  products: [
    {
      id: productId,
      nameAr: 'Bella Canvas 3001',
      allowedViews: [GarmentView.Front, GarmentView.Back],
      allowedDisplayMethods: [DisplayMethod.OnModel, DisplayMethod.Hanger],
      allowedAudiences: [Audience.All, Audience.Adult, Audience.Unisex],
      allowedColorIds: [colorId],
    },
  ],
  colors: [{ id: colorId, nameAr: 'أبيض', hex: '#ffffff' }],
  seasons: [{ id: seasonId, nameAr: 'هالوين' }],
};

export function validDraft(): SessionDraft {
  return {
    title: 'جلسة اختبار',
    mode: 'advanced',
    seasonId,
    audience: Audience.All,
    countMode: 'fixed',
    targetCount: 1,
    products: [
      {
        productId,
        quantity: 1,
        selectedViews: [GarmentView.Front],
        displayMethods: [DisplayMethod.OnModel],
      },
    ],
    colorIds: [colorId],
    placement: 'center_chest',
    customSceneDescription: 'إضاءة دافئة وخلفية محايدة',
    groupBy: 'product',
    includeOutputB: true,
  };
}

export const scene = Object.freeze({
  id: 'scene-1',
  sessionId: 'session-1',
  templateId: 'template-1',
  productId,
  locationId: 'location-1',
  lightingId: 'lighting-1',
  decorIds: [],
  propIds: [],
  cameraId: 'camera-1',
  compositionId: 'composition-1',
  poseId: 'pose-1',
  displayMethod: DisplayMethod.OnModel,
  paletteColorId: colorId,
  seasonId,
  printAreaRulesRef: 'profile-1',
  view: GarmentView.Front,
  dedupSignature: {
    sceneTemplateId: 'template-1',
    poseId: 'pose-1',
    cameraAngle: 'eye_level',
    compositionId: 'composition-1',
    hash: 'dedup-hash',
  },
  outputA: {
    id: '1A',
    sceneId: 'scene-1',
    garment: 'shirt',
    color: colorId,
    view: GarmentView.Front,
    status: 'generated',
    forbidden: ['artwork', 'logo', 'watermark', 'typography'],
    promptText: 'Output A exact',
    contentHash: 'content-a',
    generatedAt: null,
    promptHash: 'hash-a',
    renderHash: null,
    promptMeta: null,
  },
  outputB: {
    id: '1B',
    sceneId: 'scene-1',
    sourceOutputAId: '1A',
    artworkId: 'artwork-1',
    onlyArtworkChanges: true,
    sourceContentHash: 'content-a',
    status: 'generated',
    promptText: 'Output B exact',
    generatedAt: null,
    promptHash: 'hash-b',
    renderHash: null,
    sourceHash: 'hash-a',
    contentHash: 'content-b',
    promptMeta: null,
  },
  sceneVersion: 1,
  sceneHash: 'scene-hash',
  sceneFingerprint: 'scene-fingerprint',
}) as unknown as Scene;
export const prompts: readonly PromptViewModel[] = Object.freeze([
  Object.freeze({
    id: '1A',
    sceneId: 'scene-1',
    kind: 'A',
    sourceOutputAId: null,
    sourceHash: null,
    sourceContentHash: null,
    artworkId: null,
    promptText: 'Output A exact',
    promptHash: 'hash-a',
    productId,
    colorId,
    view: 'front',
    placement: 'center_chest',
    printAreaProfileId: 'profile-1',
  }),
  Object.freeze({
    id: '1B',
    sceneId: 'scene-1',
    kind: 'B',
    sourceOutputAId: '1A',
    sourceHash: 'hash-a',
    sourceContentHash: 'content-a',
    artworkId: 'artwork-1',
    promptText: 'Output B exact',
    promptHash: 'hash-b',
    productId,
    colorId,
    view: 'front',
    placement: 'center_chest',
    printAreaProfileId: 'profile-1',
  }),
]);

export function failure(code = 'RULE_TEST_001'): ValidationFailure {
  return {
    code,
    field: 'draft',
    message: 'فشل اختباري',
    severity: 'blocking',
  } as ValidationFailure;
}

export function ports(log: string[] = []): UiEnginePorts {
  return {
    validation: {
      validate: () => {
        log.push('validation');
        return { ok: true, value: true };
      },
    },
    rule: {
      evaluate: () => {
        log.push('rule');
        return { ok: true, value: [] };
      },
    },
    palette: {
      resolve: () => {
        log.push('palette');
        return { ok: true, value: [colorId] };
      },
    },
    printArea: {
      resolve: () => {
        log.push('print-area');
        return { ok: true, value: { profileId: 'profile-1' } };
      },
    },
    scene: {
      generate: () => {
        log.push('scene');
        return { ok: true, value: [scene] };
      },
    },
    prompt: {
      generate: () => {
        log.push('prompt');
        return { ok: true, value: prompts };
      },
    },
  };
}
