import type {
  PrintAreaObstruction,
  PrintAreaProfile,
  Product,
  ProductId,
  ResolvedConstraint,
  Scene,
  ValidationFailure,
} from '../../shared/domain-model';
import type { PrintAreaMeasurement } from '../../shared/contracts';

export interface PrintAreaObservation {
  readonly overlaps: readonly PrintAreaObstruction[];
  readonly sizeRatio: number;
  readonly centeringOffset: number;
  readonly shadowCoverage: number;
}

export interface PrintAreaEngineInput {
  readonly scene: Scene;
  readonly product: Product;
  readonly profile: PrintAreaProfile;
  readonly observation: PrintAreaObservation;
  /** Runtime Rule output may be supplied as context; the measurement leaf never re-evaluates it. */
  readonly constraints?: readonly ResolvedConstraint[];
  /** Optional assertion; when present it must equal the product manifest profile position. */
  readonly requestedPosition?: PrintAreaProfile['position'];
}

export interface PrintAreaDiagnostic {
  readonly code: 'measurement.normalized' | 'constraints.ignored';
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface PrintAreaResolution {
  readonly productId: ProductId;
  readonly profileId: PrintAreaProfile['id'];
  readonly position: PrintAreaProfile['position'];
  readonly measurement: PrintAreaMeasurement;
  readonly diagnostics: readonly PrintAreaDiagnostic[];
}

export type PrintAreaEngineResult =
  | { readonly ok: true; readonly value: PrintAreaResolution }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };
