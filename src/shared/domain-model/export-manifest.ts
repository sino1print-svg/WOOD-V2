/**
 * ExportManifest data contract — 09_EXPORT_ENGINE §13. Declarative types only.
 *
 * LAYER BOUNDARY: this persisted domain type references ONLY persisted/domain-safe
 * types. `exportFormats` uses the persisted `ExportFormat` enum (txt/json/zip).
 * Operational delivery refinements (clipboard/markdown) are an export/contracts
 * layer concern and live in `src/shared/contracts/export-refinements.ts`. They must
 * NOT widen the persisted enum here (03_DATA_MODELS_FINAL §2.1; IMPL §5).
 */
import type { IsoTimestamp, SchemaVersion, SemVer, Sha256 } from './primitives';
import type { ProjectId, RuleSetId, SessionId } from './ids';
import { ExportFormat, ExportScope, PromptModuleType } from './enums';

export interface ExportManifestFileEntry {
  readonly path: string;
  readonly kind: string;
}

export interface ExportManifestWarning {
  readonly code: string;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface ExportManifest {
  readonly exportId: string;
  readonly schemaVersion: SchemaVersion;
  readonly projectId: ProjectId;
  readonly sessionIds: readonly SessionId[];
  readonly exportScope: ExportScope;
  readonly scopeDetail: string;
  readonly exportFormats: readonly ExportFormat[];
  readonly createdAt: IsoTimestamp;
  readonly applicationVersion: SemVer;
  readonly generatorVersion: SemVer;
  readonly ruleSetVersions: Readonly<Record<RuleSetId, SchemaVersion>>;
  readonly promptModuleVersions: Readonly<Record<PromptModuleType, SemVer>>;
  readonly includedFiles: readonly ExportManifestFileEntry[];
  readonly fileSizes: Readonly<Record<string, number>>;
  readonly checksums: Readonly<Record<string, Sha256>>;
  readonly warnings: readonly ExportManifestWarning[];
  readonly sourceFingerprints: {
    readonly sessionFingerprint: Sha256;
    readonly sceneFingerprints?: readonly Sha256[];
    readonly coverHash?: Sha256;
  };
}

export interface MigrationRecord {
  readonly aggregate: 'project' | 'product' | 'season' | 'palette' | 'rule_set' | 'prompt_module';
  readonly fromVersion: SchemaVersion;
  readonly toVersion: SchemaVersion;
  readonly appliedAt: IsoTimestamp;
}
