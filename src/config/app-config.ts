/**
 * Application configuration defaults — 12_IMPLEMENTATION_GUIDE §20.
 * Data only. Config never mutates saved sessions and never affects engine
 * outputs/determinism (§20; AC-12). No logic here.
 */
import {
  ExportFormat,
  ExportScope,
  PersistenceMode,
  RetentionPolicyKind,
} from '../shared/domain-model';
import type { ExportSafetyLimits } from '../shared/contracts';

export interface AppConfig {
  readonly applicationVersion: string;
  readonly generatorVersion: string;
  readonly persistenceMode: PersistenceMode;
  readonly schemaVersions: {
    readonly project: number;
    readonly product: number;
    readonly season: number;
    readonly palette: number;
    readonly promptModule: number;
    readonly ruleSet: number;
  };
  readonly retentionDefault: {
    readonly kind: RetentionPolicyKind;
    readonly keepN?: number;
  };
  readonly autosave: {
    readonly enabled: boolean;
    readonly intervalMs: number;
  };
  readonly exportDefaults: {
    readonly scope: ExportScope;
    readonly format: ExportFormat;
  };
  readonly limits: {
    readonly maxPathSegment: number;
    readonly maxPathLength: number;
    readonly paletteEngine: {
      readonly maxColors: number;
      readonly maxPalettes: number;
      readonly maxConstraints: number;
      readonly maxIdLength: number;
    };
    readonly ruleEngine: {
      readonly maxConditionDepth: number;
      readonly maxNumericExpressionDepth: number;
      readonly maxRules: number;
      readonly maxTargetsPerRule: number;
      readonly maxContextPathLength: number;
    };
    readonly pngAsset: {
      readonly maxFileBytes: number;
      readonly maxWidth: number;
      readonly maxHeight: number;
      readonly maxPixels: number;
      readonly maxChunkCount: number;
      readonly maxChunkLength: number;
      readonly maxMetadataChunkBytes: number;
      readonly maxCrcBytes: number;
    };
    readonly export: ExportSafetyLimits;
  };
}

/** Frozen Phase 0 defaults (aggregate schema versions per DM §16). */
export const APP_CONFIG: Readonly<AppConfig> = Object.freeze({
  applicationVersion: '0.1.0',
  generatorVersion: '0.0.0',
  persistenceMode: PersistenceMode.LocalSingleUser,
  schemaVersions: {
    project: 1,
    product: 1,
    season: 1,
    palette: 1,
    promptModule: 1,
    ruleSet: 3,
  },
  retentionDefault: {
    kind: RetentionPolicyKind.KeepAll,
  },
  autosave: {
    enabled: true,
    intervalMs: 60_000,
  },
  exportDefaults: {
    scope: ExportScope.Session,
    format: ExportFormat.Zip,
  },
  limits: {
    maxPathSegment: 60,
    maxPathLength: 200,
    paletteEngine: {
      maxColors: 10_000,
      maxPalettes: 1_000,
      maxConstraints: 10_000,
      maxIdLength: 512,
    },
    ruleEngine: {
      maxConditionDepth: 64,
      maxNumericExpressionDepth: 64,
      maxRules: 10_000,
      maxTargetsPerRule: 1_000,
      maxContextPathLength: 512,
    },
    pngAsset: {
      maxFileBytes: 128 * 1024 * 1024,
      maxWidth: 20_000,
      maxHeight: 20_000,
      maxPixels: 100_000_000,
      maxChunkCount: 10_000,
      maxChunkLength: 64 * 1024 * 1024,
      maxMetadataChunkBytes: 1 * 1024 * 1024,
      maxCrcBytes: 128 * 1024 * 1024,
    },
    export: {
      maxPathSegment: 60,
      maxPathLength: 200,
      maxArtifactBytes: 128 * 1024 * 1024,
      maxJsonBytes: 128 * 1024 * 1024,
      maxJsonDepth: 64,
      maxZipEntries: 10_000,
      maxArchiveBytes: 256 * 1024 * 1024,
      maxUncompressedBytes: 512 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxClipboardBytes: 16 * 1024 * 1024,
    },
  },
});
