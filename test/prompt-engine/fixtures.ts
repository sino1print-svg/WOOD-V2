import { SeasonKind, type Artwork, type Season } from '../../src/shared/domain-model';
import type { ComposeOutputAInput, ComposeOutputBInput } from '../../src/engines/prompt-engine';
import { product, scene } from '../print-area-engine/fixtures';

export function season(): Season {
  return {
    id: 'season-1' as Season['id'],
    schemaVersion: 1,
    kind: SeasonKind.Halloween,
    name: 'Halloween',
    sceneLibraryRef: 'scene-library-halloween' as Season['sceneLibraryRef'],
    decorConstraints: [],
    heroSceneConstraints: [],
    forbiddenSeasonDecor: [],
  };
}

export function artwork(): Artwork {
  return {
    id: 'artwork-1' as Artwork['id'],
    projectId: 'project-1' as Artwork['projectId'],
    fileName: 'design.png',
    pngAssetRef: 'asset-1' as Artwork['pngAssetRef'],
    uploadedAt: '2026-07-18T12:00:00.000Z' as Artwork['uploadedAt'],
    format: 'png',
    hasTransparency: true,
    widthPx: 4500,
    heightPx: 5400,
    dpi: 300,
    aspectRatio: 4500 / 5400,
    contentHash: 'artwork-content-hash' as Artwork['contentHash'],
  };
}

export function inputA(): ComposeOutputAInput {
  const p = product();
  const s = scene();
  return {
    scene: s,
    product: p,
    season: season(),
    selectedColorIds: ['white' as ComposeOutputAInput['selectedColorIds'][number]],
    resolved: {
      productDescription: 'A blank classic crew-neck t-shirt with natural cotton drape.',
      garmentColorName: 'White',
      seasonDescription: 'Premium cozy Halloween setting with warm autumn lighting.',
      sceneDescription: 'Rustic studio background with pumpkins and candles behind the garment.',
      displayMethodDescription: 'top-down flat lay, no model',
      cameraCompositionDescription: 'top-down commercial composition with the product dominant',
      placementDescription: 'centered garment placement',
      viewDescription: 'front view',
      printAreaZone: 'center chest printable area',
    },
    versions: { templateVersion: '1.0.0', generatorVersion: '1.0.0', moduleVersion: '1.0.0' },
    generatedAt: '2026-07-18T12:00:00.000Z',
    constraints: [],
    customNotes: [],
    outputNumber: 1,
  };
}

export function inputB(): ComposeOutputBInput {
  const a = inputA();
  const art = artwork();
  const outputB = {
    id: 'output-b-pa-1',
    sceneId: a.scene.id,
    sourceOutputAId: a.scene.outputA.id,
    artworkId: art.id,
    onlyArtworkChanges: true as const,
    sourceContentHash: a.scene.outputA.contentHash,
    status: a.scene.outputA.status,
    promptText: '',
    generatedAt: null,
    promptHash: 'prompt-b-pa-1',
    renderHash: null,
    sourceHash: a.scene.outputA.contentHash,
    contentHash: 'content-hash-b-pa-1',
    promptMeta: null,
  } as NonNullable<ComposeOutputBInput['scene']['outputB']>;
  return {
    ...a,
    scene: { ...a.scene, outputB },
    sourceImageAttached: true,
    artworkAttached: true,
    artwork: art,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
