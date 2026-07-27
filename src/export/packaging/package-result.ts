/**
 * Packaging public result contract - EX section 3.11.
 */
import type { Sha256 } from '../../shared/domain-model';
import type {
  ExportArtifactKind,
  ExportEngineVersions,
  ExportSafetyLimits,
} from '../../shared/contracts/export-contracts';
import type { ExportPlanOmission, ExportPlanResult } from '../../shared/contracts/export-planning';
import type { ValidationFailure } from '../../shared/domain-model';

export interface ExportPackageInput {
  readonly planResult: ExportPlanResult;
  readonly limits: ExportSafetyLimits;
  readonly versions: ExportEngineVersions;
  /** Canonical, caller-supplied export time. Never read from the wall clock here. */
  readonly createdAt: string;
  /** Caller-supplied identity. Packaging never mints a random UUID. */
  readonly exportId: string;
}

export interface PackageEntrySummary {
  readonly path: string;
  readonly kind: ExportArtifactKind;
  readonly byteLength: number;
  readonly checksum: Sha256;
}

export type ExportPackageResult =
  | {
      readonly ok: true;
      readonly zipBytes: Uint8Array;
      readonly zipSha256: Sha256;
      readonly manifestBytes: Uint8Array;
      readonly checksumsBytes: Uint8Array;
      readonly entries: readonly PackageEntrySummary[];
      readonly warnings: readonly ValidationFailure[];
      readonly omissions: readonly ExportPlanOmission[];
    }
  | {
      readonly ok: false;
      readonly failures: readonly ValidationFailure[];
      readonly warnings: readonly ValidationFailure[];
      readonly omissions: readonly ExportPlanOmission[];
    };
