/**
 * Scene Engine test fixtures. A small but real, deterministic season library with
 * enough distinct (template, pose, camera, composition) combinations to satisfy
 * feasibility for multi-scene sessions. No randomness; every builder is a pure
 * function with sensible defaults and shallow overrides.
 */
import {
  Audience,
  CameraAngle,
  GarmentView,
  GroupBy,
  ProductKind,
  VocabularyKind,
} from '../../src/shared/domain-model';
import type {
  ColorId,
  DedupLedger,
  Product,
  ProductId,
  ResolvedConstraint,
  SeasonId,
  SessionId,
} from '../../src/shared/domain-model';
import type {
  PrintAreaObserver,
  SceneEngineInput,
  SceneLibrary,
  SceneLibraryItem,
} from '../../src/engines/scene-engine';
import type { PrintAreaObservation } from '../../src/engines/print-area-engine';

export const SEASON = 'season-fall' as SeasonId;
export const SESSION = 'session-1' as SessionId;

function item(
  id: string,
  kind: VocabularyKind,
  overrides: Partial<SceneLibraryItem> = {},
): SceneLibraryItem {
  return {
    id: id as SceneLibraryItem['id'],
    kind,
    label: id,
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

function camera(
  id: string,
  angle: CameraAngle,
  overrides: Partial<SceneLibraryItem> = {},
): SceneLibraryItem & { readonly angle: CameraAngle } {
  return { ...item(id, VocabularyKind.Camera, overrides), angle };
}

/**
 * Default library: 2 templates × 3 poses × 3 cameras (distinct angles) × 3
 * compositions → 54 distinct dedup tuples, comfortably above the sizes tested.
 */
export function library(overrides: Partial<SceneLibrary> = {}): SceneLibrary {
  return {
    templates: overrides.templates ?? [
      {
        ...item('tpl-hero', VocabularyKind.Pose, {
          priority: 9,
          weight: 0.9,
          tags: ['mood:cozy', 'hero'],
        }),
        templateId: 'tpl-hero' as never,
      },
      {
        ...item('tpl-support', VocabularyKind.Pose, {
          priority: 3,
          weight: 0.6,
          tags: ['mood:cozy'],
        }),
        templateId: 'tpl-support' as never,
      },
    ],
    locations: overrides.locations ?? [
      item('loc-studio', VocabularyKind.Location, { tags: ['background:studio'] }),
      item('loc-lifestyle', VocabularyKind.Location, { tags: ['background:lifestyle'] }),
    ],
    lightings: overrides.lightings ?? [
      item('lgt-soft', VocabularyKind.Lighting, { weight: 0.8, tags: ['mood:cozy'] }),
      item('lgt-warm', VocabularyKind.Lighting, { weight: 0.6, tags: ['mood:warm'] }),
    ],
    decors: overrides.decors ?? [item('dec-leaves', VocabularyKind.Decor, { tags: ['mood:cozy'] })],
    props: overrides.props ?? [item('prop-mug', VocabularyKind.Prop, { tags: ['mood:cozy'] })],
    cameras: overrides.cameras ?? [
      camera('cam-eye', CameraAngle.Eye),
      camera('cam-high', CameraAngle.High),
      camera('cam-top', CameraAngle.TopDown),
    ],
    compositions: overrides.compositions ?? [
      item('cmp-hero', VocabularyKind.Composition, { priority: 5, tags: ['hero'] }),
      item('cmp-wide', VocabularyKind.Composition, { priority: 2 }),
      item('cmp-detail', VocabularyKind.Composition, { priority: 1 }),
    ],
    poses: overrides.poses ?? [
      item('pose-a', VocabularyKind.Pose, { tags: ['model:adult'] }),
      item('pose-b', VocabularyKind.Pose, { tags: ['model:adult'] }),
      item('pose-c', VocabularyKind.Pose, { tags: ['model:none'] }),
    ],
  };
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: (overrides.id ?? 'prod-tee') as ProductId,
    schemaVersion: 1 as Product['schemaVersion'],
    kind: overrides.kind ?? ProductKind.ClassicTShirt,
    name: overrides.name ?? 'Classic Tee',
    type: overrides.type ?? 'tshirt',
    allowedViews: overrides.allowedViews ?? [
      GarmentView.Front,
      GarmentView.Back,
      GarmentView.FlatDetail,
    ],
    printAreaProfile:
      overrides.printAreaProfile ??
      ({
        id: 'pa-center' as Product['printAreaProfile']['id'],
        position: 'center_chest',
        minSizeRatio: 0.2,
        centeringTolerance: 0.1,
        centered: true,
        maxShadowCoverage: 0.2,
        forbiddenOverlaps: [],
      } as Product['printAreaProfile']),
    audienceConstraints: overrides.audienceConstraints ?? {},
    defaultColors: overrides.defaultColors ?? [],
    expandable: true,
    metadata: overrides.metadata,
  };
}

/** Deterministic observer: high visibility for top-down (flat-lay-like), lower otherwise. */
export const observePrintArea: PrintAreaObserver = (context): PrintAreaObservation => {
  const topDown = context.cameraAngle === CameraAngle.TopDown;
  return {
    overlaps: [],
    sizeRatio: topDown ? 0.9 : 0.5,
    centeringOffset: 0.05,
    shadowCoverage: 0.05,
  };
};

export function dedupLedger(overrides: Partial<DedupLedger> = {}): DedupLedger {
  return {
    seen: overrides.seen ?? [],
    combinationSpaceSize: overrides.combinationSpaceSize ?? 0,
  };
}

export interface InputOverrides {
  readonly requestedSceneCount?: number;
  readonly audience?: Audience;
  readonly productIds?: readonly ProductId[];
  readonly colorIds?: readonly ColorId[];
  readonly colorLocked?: boolean;
  readonly constraints?: readonly ResolvedConstraint[];
  readonly products?: readonly Product[];
  readonly library?: SceneLibrary;
  readonly dedupLedger?: DedupLedger;
  readonly groupBy?: GroupBy;
  readonly isDigitalProduct?: boolean;
  readonly observePrintArea?: PrintAreaObserver;
  readonly artworkIdsByProduct?: ReadonlyMap<ProductId, string>;
}

export function input(overrides: InputOverrides = {}): SceneEngineInput {
  const products = overrides.products ?? [product()];
  return {
    session: {
      sessionId: SESSION,
      season: SEASON,
      audience: overrides.audience ?? Audience.Adult,
      productIds: overrides.productIds ?? products.map((p) => p.id),
      colorSelection: {
        colorIds: overrides.colorIds ?? (['color-black', 'color-white'] as ColorId[]),
        locked: overrides.colorLocked ?? false,
      },
      requestedSceneCount: overrides.requestedSceneCount ?? 4,
      groupBy: overrides.groupBy ?? GroupBy.Product,
      isDigitalProduct: overrides.isDigitalProduct ?? false,
    },
    constraints: overrides.constraints ?? [],
    products,
    vocabularies: {
      locations: {} as never,
      lightings: {} as never,
      decors: {} as never,
      props: {} as never,
      compositions: {} as never,
      poses: {} as never,
      cameras: {} as never,
    },
    library: overrides.library ?? library(),
    dedupLedger: overrides.dedupLedger ?? dedupLedger(),
    observePrintArea: overrides.observePrintArea ?? observePrintArea,
    artworkIdsByProduct: overrides.artworkIdsByProduct as never,
  };
}
