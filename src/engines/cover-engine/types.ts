import type {
  CoverColorManifest,
  CoverEngineInput,
  CoverEngineVersions,
  CoverProductManifest,
  CoverProjectManifest,
  CoverSeasonManifest,
  CoverSourceImage,
} from '../../shared/contracts';
import type {
  ColorId,
  CoverLayout,
  MainCover,
  OutputAId,
  ValidationFailure,
} from '../../shared/domain-model';

export type {
  CoverColorManifest,
  CoverEngineInput,
  CoverEngineVersions,
  CoverProductManifest,
  CoverProjectManifest,
  CoverSeasonManifest,
  CoverSourceImage,
};

export interface CoverLayoutPlan {
  readonly layout: CoverLayout;
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
  readonly heroSpan: 'full-bleed' | '1x1' | '2x2';
}

export interface CoverCompositionPlan {
  readonly layout: CoverLayoutPlan;
  readonly heroImageId: OutputAId;
  readonly supportImageIds: readonly OutputAId[];
  readonly orderedColorIds: readonly ColorId[];
  readonly badges: readonly string[];
  readonly cacheHit: boolean;
}

export type CoverEngineResult =
  | {
      readonly ok: true;
      readonly value: MainCover;
      readonly composition: CoverCompositionPlan;
    }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };
