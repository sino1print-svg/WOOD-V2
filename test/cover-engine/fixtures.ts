import {
  Audience,
  DisplayMethod,
  GarmentView,
  OutputStatus,
  SeasonKind,
  type ColorId,
  type CoverMetadata,
  type OutputA,
  type ProductId,
} from '../../src/shared/domain-model';
import type {
  CoverColorManifest,
  CoverEngineInput,
  CoverProductManifest,
  CoverSourceImage,
} from '../../src/engines/cover-engine';
import { COVER_PROMPT_MODULE } from '../../src/shared/prompt-modules';

const hash = (character: string): OutputA['contentHash'] =>
  character.repeat(64).slice(0, 64) as OutputA['contentHash'];

export const PRODUCT_A = 'product-alpha' as ProductId;
export const PRODUCT_B = 'product-beta' as ProductId;
export const WHITE = 'color-white' as ColorId;
export const NAVY = 'color-navy' as ColorId;
export const SAND = 'color-sand' as ColorId;

export const COLORS: readonly CoverColorManifest[] = [
  { id: WHITE, name: 'White', hex: '#FFFFFF' as CoverColorManifest['hex'] },
  { id: NAVY, name: 'Navy', hex: '#1F2A44' as CoverColorManifest['hex'] },
  { id: SAND, name: 'Sand', hex: '#D9C3A3' as CoverColorManifest['hex'] },
];

export const PRODUCTS: readonly CoverProductManifest[] = [
  { id: PRODUCT_A, name: 'Manifest Alpha Tee' },
  { id: PRODUCT_B, name: 'Manifest Beta Hoodie' },
];

export function source(
  index: number,
  overrides: Omit<Partial<CoverSourceImage>, 'output'> & {
    readonly output?: Partial<OutputA>;
  } = {},
): CoverSourceImage {
  const productId = overrides.productId ?? (index % 3 === 0 ? PRODUCT_B : PRODUCT_A);
  const color = index % 3 === 0 ? NAVY : index % 2 === 0 ? SAND : WHITE;
  const view = index % 4 === 0 ? GarmentView.Back : GarmentView.Front;
  const output: OutputA = {
    id: `${index}A` as OutputA['id'],
    sceneId: `scene-${index}` as OutputA['sceneId'],
    garment: 'Blank garment',
    color,
    view,
    status: OutputStatus.Generated,
    forbidden: ['artwork', 'logo', 'watermark', 'typography'],
    promptText: `Output A prompt ${index}`,
    contentHash: hash(index % 2 === 0 ? 'a' : 'b'),
    generatedAt: null,
    promptHash: hash(index % 2 === 0 ? 'c' : 'd'),
    renderHash: null,
    promptMeta: null,
    ...overrides.output,
  };
  return {
    output,
    productId,
    displayMethod:
      overrides.displayMethod ??
      (index === 1
        ? DisplayMethod.OnModel
        : index % 5 === 0
          ? DisplayMethod.Hanger
          : DisplayMethod.FlatLay),
    sceneOrder: overrides.sceneOrder ?? index,
  };
}

interface InputOptions {
  readonly count?: number;
  readonly saleImages?: readonly CoverSourceImage[];
  readonly lockedColors?: readonly CoverColorManifest[];
  readonly products?: readonly CoverProductManifest[];
  readonly digital?: boolean;
  readonly seasonKind?: SeasonKind;
  readonly metadata?: CoverMetadata;
  readonly override?: Partial<CoverEngineInput>;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort();
}

export function coverInput(options: InputOptions = {}): CoverEngineInput {
  const saleImages =
    options.saleImages ??
    Array.from({ length: options.count ?? 4 }, (_, index) => source(index + 1));
  const lockedColors = options.lockedColors ?? COLORS;
  const productIds = uniqueSorted(saleImages.map((item) => item.productId));
  const views = uniqueSorted(saleImages.map((item) => item.output.view));
  const metadata: CoverMetadata = options.metadata ?? {
    productIds,
    colors: uniqueSorted(lockedColors.map((color) => color.id)),
    mockupCount: saleImages.length,
    views,
    seasonId: 'season-cover' as CoverMetadata['seasonId'],
    digitalProductStatus: options.digital ?? true,
    primaryProduct: productIds[0]!,
    primaryColor: lockedColors[0]!.id,
    primaryView: views[0]!,
    primaryAudience: Audience.Adult,
  };
  return {
    coverId: 'cover-phase7' as CoverEngineInput['coverId'],
    sessionId: 'session-phase7' as CoverEngineInput['sessionId'],
    saleImages,
    metadata,
    project: {
      id: 'project-phase7' as CoverEngineInput['project']['id'],
      isDigitalProduct: metadata.digitalProductStatus,
    },
    products: options.products ?? PRODUCTS,
    season: {
      id: metadata.seasonId,
      name:
        options.seasonKind === SeasonKind.MinimalStudio ? 'Minimal Studio' : 'Father Day Season',
      kind: options.seasonKind ?? SeasonKind.FathersDay,
    },
    lockedColors,
    promptModule: structuredClone(COVER_PROMPT_MODULE),
    allOutputAReady: true,
    versions: { templateVersion: '1.0.0', generatorVersion: '1.0.0', moduleVersion: '1.0.0' },
    generatedAt: '2026-07-19T20:00:00.000Z',
    ...options.override,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
