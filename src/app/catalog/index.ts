/**
 * Application production catalog — Phase 10.5 Runnable Application Integration.
 *
 * Deterministic, static content data consumed by the Orchestrator to drive the
 * real engines from the browser: domain products, seasons, colors, the season
 * scene library, and the closed-vocabulary resolved-text builders required by
 * the Prompt Engine. Data only — no wall clock, no randomness, no engine logic.
 */
import {
  Audience,
  CameraAngle,
  DisplayMethod,
  GarmentView,
  ProductKind,
  SeasonKind,
  VocabularyKind,
} from '../../shared/domain-model';
import type {
  Color,
  ColorId,
  HexColor,
  IsoTimestamp,
  Product,
  ProductId,
  Season,
  SeasonId,
  VocabularyId,
} from '../../shared/domain-model';
import type {
  SceneCameraLibraryItem,
  SceneLibrary,
  SceneLibraryItem,
  SceneTemplateLibraryItem,
} from '../../engines/scene-engine';
import type { PromptResolvedText, PromptVersions } from '../../engines/prompt-engine';
import type { PaletteLibrary } from '../../engines/palette-engine';
import { APP_CONFIG } from '../../config/app-config';
import type { UiCatalog } from '../../ui-engine';

/**
 * Canonical application timestamp. Every generated artifact derives its
 * timestamps from this constant so that identical inputs always produce
 * identical bytes (no wall clock anywhere in the generation path).
 */
export const CANONICAL_APP_TIME = '2026-07-01T00:00:00.000Z' as IsoTimestamp;

export const APP_PROJECT_ID = 'project-prompt-center';
export const APP_SESSION_ID = 'session-main';

export const PROMPT_VERSIONS: PromptVersions = {
  templateVersion: '1.0.0',
  generatorVersion: APP_CONFIG.generatorVersion,
  moduleVersion: '1.0.0',
};

// ---------------------------------------------------------------------------
// Domain colors (English names feed the closed prompt vocabulary).
// ---------------------------------------------------------------------------
const hexColor = (value: string): HexColor => value as HexColor;

export const DOMAIN_COLORS: readonly Color[] = [
  { id: 'color-white' as ColorId, name: 'white', hex: hexColor('#ffffff') },
  { id: 'color-black' as ColorId, name: 'black', hex: hexColor('#111111') },
  { id: 'color-gray' as ColorId, name: 'heather gray', hex: hexColor('#b8b8b8') },
  { id: 'color-sand' as ColorId, name: 'sand', hex: hexColor('#d9c3a3') },
];

const COLOR_LABELS_AR: Readonly<Record<string, string>> = {
  'color-white': 'أبيض',
  'color-black': 'أسود',
  'color-gray': 'رمادي ميلانج',
  'color-sand': 'رملي',
};

// ---------------------------------------------------------------------------
// Domain seasons.
// ---------------------------------------------------------------------------
export const DOMAIN_SEASONS: readonly Season[] = [
  {
    id: 'season-halloween' as SeasonId,
    schemaVersion: APP_CONFIG.schemaVersions.season as Season['schemaVersion'],
    kind: SeasonKind.Halloween,
    name: 'Halloween',
    sceneLibraryRef: 'library-halloween' as VocabularyId,
    decorConstraints: [],
    heroSceneConstraints: [],
    forbiddenSeasonDecor: [],
  },
  {
    id: 'season-christmas' as SeasonId,
    schemaVersion: APP_CONFIG.schemaVersions.season as Season['schemaVersion'],
    kind: SeasonKind.Christmas,
    name: 'Christmas',
    sceneLibraryRef: 'library-christmas' as VocabularyId,
    decorConstraints: [],
    heroSceneConstraints: [],
    forbiddenSeasonDecor: [],
  },
  {
    id: 'season-minimal' as SeasonId,
    schemaVersion: APP_CONFIG.schemaVersions.season as Season['schemaVersion'],
    kind: SeasonKind.MinimalStudio,
    name: 'Minimal Studio',
    sceneLibraryRef: 'library-minimal' as VocabularyId,
    decorConstraints: [],
    heroSceneConstraints: [],
    forbiddenSeasonDecor: [],
  },
];

const SEASON_LABELS_AR: Readonly<Record<string, string>> = {
  'season-halloween': 'الهالوين',
  'season-christmas': 'الكريسماس',
  'season-minimal': 'استوديو بسيط',
};

/** Closed-vocabulary season descriptions (Prompt Engine season module input). */
const SEASON_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'season-halloween': 'halloween seasonal mood with festive decor and warm lighting',
  'season-christmas': 'christmas holiday mood with festive decor and cozy warm lighting',
  'season-minimal': 'minimal studio setting with a neutral backdrop and bright clean lighting',
};

// ---------------------------------------------------------------------------
// Domain products.
// ---------------------------------------------------------------------------
export const DOMAIN_PRODUCTS: readonly Product[] = [
  {
    id: 'product-bella-3001' as ProductId,
    schemaVersion: APP_CONFIG.schemaVersions.product as Product['schemaVersion'],
    kind: ProductKind.BellaCanvas3001,
    name: 'Bella Canvas 3001',
    type: 'tshirt',
    allowedViews: [GarmentView.Front, GarmentView.Back],
    printAreaProfile: {
      id: 'print-area-bella-3001' as Product['printAreaProfile']['id'],
      position: 'center_chest',
      minSizeRatio: 0.25,
      centeringTolerance: 0.1,
      centered: true,
      maxShadowCoverage: 0.2,
      forbiddenOverlaps: [],
    },
    audienceConstraints: {},
    defaultColors: ['color-white', 'color-black', 'color-sand', 'color-gray'] as ColorId[],
    expandable: true,
  },
  {
    id: 'product-kids-tee' as ProductId,
    schemaVersion: APP_CONFIG.schemaVersions.product as Product['schemaVersion'],
    kind: ProductKind.Kids,
    name: 'Kids Tee',
    type: 'tshirt',
    allowedViews: [GarmentView.Front, GarmentView.Back],
    printAreaProfile: {
      id: 'print-area-kids-tee' as Product['printAreaProfile']['id'],
      position: 'center_chest',
      minSizeRatio: 0.25,
      centeringTolerance: 0.1,
      centered: true,
      maxShadowCoverage: 0.2,
      forbiddenOverlaps: [],
    },
    audienceConstraints: {},
    defaultColors: ['color-white', 'color-black', 'color-sand'] as ColorId[],
    expandable: true,
  },
];

const PRODUCT_LABELS_AR: Readonly<Record<string, string>> = {
  'product-bella-3001': 'Bella Canvas 3001',
  'product-kids-tee': 'تيشيرت أطفال',
};

/** Closed-vocabulary product descriptions (Prompt Engine product module input). */
const PRODUCT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'product-bella-3001':
    'blank classic unisex jersey short sleeve t shirt 3001 with soft cotton fabric and a retail fit',
  'product-kids-tee': 'blank classic kids t shirt with soft cotton fabric and a regular fit',
};

// ---------------------------------------------------------------------------
// Scene library (labels are written inside the Prompt Engine's closed scene
// vocabulary so resolved scene descriptions always canonicalize successfully).
// The dimension sizes are deliberately bounded: the Scene Engine enumerates
// the full cross-product, and the dedup tuple space (templates × poses ×
// cameras × compositions = 81) stays above the 50-scene session maximum.
// ---------------------------------------------------------------------------
function item(
  id: string,
  kind: VocabularyKind,
  label: string,
  overrides: Partial<SceneLibraryItem> = {},
): SceneLibraryItem {
  return {
    id: id as SceneLibraryItem['id'],
    kind,
    label,
    tags: overrides.tags ?? ['mood:cozy'],
    printAreaSafe: overrides.printAreaSafe ?? true,
    seasonCompatibility: overrides.seasonCompatibility ?? 'all',
    audienceCompatibility: overrides.audienceCompatibility ?? 'all',
    productCompatibility: overrides.productCompatibility ?? 'all',
    weight: overrides.weight ?? 0.5,
    priority: overrides.priority ?? 1,
    exclusions: overrides.exclusions ?? [],
    requiredCompanions: overrides.requiredCompanions ?? [],
  };
}

function template(
  id: string,
  label: string,
  overrides: Partial<SceneLibraryItem> = {},
): SceneTemplateLibraryItem {
  return { ...item(id, VocabularyKind.Pose, label, overrides), templateId: id as VocabularyId };
}

function camera(
  id: string,
  label: string,
  angle: CameraAngle,
  overrides: Partial<SceneLibraryItem> = {},
): SceneCameraLibraryItem {
  return { ...item(id, VocabularyKind.Camera, label, overrides), angle };
}

export const APP_SCENE_LIBRARY: SceneLibrary = {
  templates: [
    template('tpl-hero-front', 'hero garment scene', {
      priority: 9,
      weight: 0.9,
      tags: ['mood:cozy', 'hero'],
    }),
    template('tpl-lifestyle', 'lifestyle interior scene', {
      priority: 5,
      weight: 0.7,
      tags: ['mood:warm'],
    }),
    template('tpl-studio', 'studio scene', { priority: 3, weight: 0.6, tags: ['mood:minimal'] }),
  ],
  locations: [
    item(
      'loc-studio',
      VocabularyKind.Location,
      'clean minimal studio backdrop with a neutral wall',
      {
        tags: ['background:studio', 'mood:minimal'],
      },
    ),
    item(
      'loc-wood-table',
      VocabularyKind.Location,
      'rustic room interior with a wooden table and a warm atmosphere',
      { tags: ['background:lifestyle', 'mood:cozy'] },
    ),
  ],
  lightings: [
    item('lgt-soft-sun', VocabularyKind.Lighting, 'soft natural sunlight through the window', {
      weight: 0.8,
      tags: ['mood:warm'],
    }),
    item('lgt-studio', VocabularyKind.Lighting, 'clean studio lighting with soft shadow', {
      weight: 0.7,
      tags: ['mood:minimal'],
    }),
  ],
  decors: [
    item('dec-autumn', VocabularyKind.Decor, 'autumn pumpkins and candles decoration', {
      tags: ['mood:cozy'],
    }),
    item('dec-minimal', VocabularyKind.Decor, 'minimal neutral decor', {
      tags: ['mood:minimal'],
    }),
  ],
  props: [
    item('prop-wood', VocabularyKind.Prop, 'wooden props on the table', { tags: ['mood:cozy'] }),
  ],
  cameras: [
    camera('cam-eye', 'eye level camera angle', CameraAngle.Eye),
    camera('cam-top', 'top down overhead camera angle', CameraAngle.TopDown),
    camera('cam-three-quarter', 'three quarter camera angle', CameraAngle.ThreeQuarter),
  ],
  compositions: [
    item(
      'cmp-hero',
      VocabularyKind.Composition,
      'centered symmetrical composition with the garment dominant',
      { priority: 5, tags: ['hero'] },
    ),
    item('cmp-medium', VocabularyKind.Composition, 'medium frame balanced composition', {
      priority: 3,
    }),
    item('cmp-detail', VocabularyKind.Composition, 'close detail framing of the garment', {
      priority: 2,
    }),
  ],
  poses: [
    item('pose-standing', VocabularyKind.Pose, 'standing model front view', {
      tags: ['model:adult'],
    }),
    item('pose-flat', VocabularyKind.Pose, 'flat lay top down display', {
      tags: ['model:none'],
    }),
    item('pose-hanger', VocabularyKind.Pose, 'hanging display on a hanger', {
      tags: ['model:none'],
    }),
  ],
};

export const APP_PALETTE_LIBRARY: PaletteLibrary = {
  colors: DOMAIN_COLORS,
  palettes: [],
};

// ---------------------------------------------------------------------------
// UI catalog projection (Arabic labels for the form).
// ---------------------------------------------------------------------------
export const APP_UI_CATALOG: UiCatalog = {
  products: DOMAIN_PRODUCTS.map((product) => ({
    id: product.id,
    nameAr: PRODUCT_LABELS_AR[product.id] ?? product.name,
    allowedViews: product.allowedViews,
    allowedDisplayMethods: [
      DisplayMethod.OnModel,
      DisplayMethod.Hanger,
      DisplayMethod.FlatLay,
      DisplayMethod.Folded,
    ],
    allowedAudiences:
      product.kind === ProductKind.Kids
        ? [Audience.Kids, Audience.All]
        : [Audience.Adult, Audience.Unisex, Audience.All],
    allowedColorIds: product.defaultColors,
  })),
  colors: DOMAIN_COLORS.map((color) => ({
    id: color.id,
    nameAr: COLOR_LABELS_AR[color.id] ?? color.name,
    hex: color.hex,
  })),
  seasons: DOMAIN_SEASONS.map((season) => ({
    id: season.id,
    nameAr: SEASON_LABELS_AR[season.id] ?? season.name,
  })),
};

// ---------------------------------------------------------------------------
// Lookup helpers (pure, deterministic).
// ---------------------------------------------------------------------------
export function findDomainProduct(productId: string): Product | null {
  return DOMAIN_PRODUCTS.find((product) => product.id === productId) ?? null;
}

export function findDomainSeason(seasonId: string): Season | null {
  return DOMAIN_SEASONS.find((season) => season.id === seasonId) ?? null;
}

export function findDomainColor(colorId: string): Color | null {
  return DOMAIN_COLORS.find((color) => color.id === colorId) ?? null;
}

function libraryLabel(items: readonly SceneLibraryItem[], id: string): string {
  return items.find((entry) => entry.id === id)?.label ?? '';
}

const DISPLAY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [DisplayMethod.OnModel]: 'worn by a standing model',
  [DisplayMethod.FlatLay]: 'flat lay display on a table top',
  [DisplayMethod.Hanger]: 'hanging on a hanger display',
  [DisplayMethod.Folded]: 'folded display on a table',
  [DisplayMethod.GhostMannequin]: 'ghost mannequin display',
  [DisplayMethod.Hanging]: 'hanging display',
};

const PLACEMENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  center_chest: 'centered chest placement on the front printable area',
  full_front: 'large centered front placement zone',
  left_chest: 'left chest placement position',
  center_back: 'centered back placement zone',
};

const PRINT_AREA_ZONES: Readonly<Record<string, string>> = {
  center_chest: 'center chest print area',
  full_front: 'large front printable panel',
  left_chest: 'left chest print zone',
  center_back: 'center back print area',
};

const VIEW_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [GarmentView.Front]: 'front view',
  [GarmentView.Back]: 'back view',
  [GarmentView.Side]: 'side profile view',
  [GarmentView.FlatDetail]: 'close detail view',
};

export interface ResolvedTextSceneFacts {
  readonly productId: string;
  readonly seasonId: string;
  readonly paletteColorId: string;
  readonly locationId: string;
  readonly lightingId: string;
  readonly decorIds: readonly string[];
  readonly propIds: readonly string[];
  readonly cameraId: string;
  readonly compositionId: string;
  readonly view: string;
  readonly displayMethod: string;
}

/**
 * Builds the Prompt Engine resolved-text block from catalog data for one scene.
 * Every sentence is composed inside the engine's closed field vocabularies.
 */
export function buildResolvedText(
  scene: ResolvedTextSceneFacts,
  placement: string,
): PromptResolvedText {
  const sceneClauses = [
    libraryLabel(APP_SCENE_LIBRARY.locations, scene.locationId),
    libraryLabel(APP_SCENE_LIBRARY.lightings, scene.lightingId),
    ...scene.decorIds.map((id) => libraryLabel(APP_SCENE_LIBRARY.decors, id)),
    ...scene.propIds.map((id) => libraryLabel(APP_SCENE_LIBRARY.props, id)),
  ].filter(Boolean);
  const cameraClause = [
    libraryLabel(APP_SCENE_LIBRARY.cameras, scene.cameraId),
    libraryLabel(APP_SCENE_LIBRARY.compositions, scene.compositionId),
  ]
    .filter(Boolean)
    .join(' with ');
  return {
    productDescription: PRODUCT_DESCRIPTIONS[scene.productId] ?? 'blank classic garment',
    garmentColorName: findDomainColor(scene.paletteColorId)?.name ?? 'white',
    seasonDescription: SEASON_DESCRIPTIONS[scene.seasonId] ?? 'minimal studio setting',
    sceneDescription: sceneClauses.join('. '),
    displayMethodDescription: DISPLAY_DESCRIPTIONS[scene.displayMethod] ?? 'flat lay display',
    cameraCompositionDescription: cameraClause || 'eye level camera angle',
    placementDescription: PLACEMENT_DESCRIPTIONS[placement] ?? PLACEMENT_DESCRIPTIONS.center_chest!,
    viewDescription: VIEW_DESCRIPTIONS[scene.view] ?? 'front view',
    printAreaZone: PRINT_AREA_ZONES[placement] ?? PRINT_AREA_ZONES.center_chest!,
  };
}
