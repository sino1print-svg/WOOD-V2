import type {
  ExportArtifactMediaType,
  ExportSafetyLimits,
} from '../shared/contracts/export-contracts';
import type { ExportPlanResult } from '../shared/contracts/export-planning';
import type { ExportScope, ValidationFailure } from '../shared/domain-model';

export type ExportTextDocumentFormat = 'txt' | 'markdown' | 'readable_json' | 'canonical_json';

export type ExportSuggestedExtension = 'txt' | 'md' | 'json';

export type ExportFormatterLimits = ExportSafetyLimits;

/** A formatter accepts only the approved Batch 10.2 result plus approved limits. */
export interface ExportFormatterInput {
  readonly planResult: ExportPlanResult;
  readonly limits: ExportFormatterLimits;
}

export interface ExportFormattedMetadata {
  readonly schemaVersion: number;
  readonly baseScope: ExportScope;
  readonly scopeDetail: string;
  readonly partial: boolean;
}

export interface ExportFormattedDocument {
  readonly format: ExportTextDocumentFormat;
  readonly mediaType: ExportArtifactMediaType;
  readonly suggestedExtension: ExportSuggestedExtension;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly metadata: ExportFormattedMetadata;
}

export type ExportFormatResult =
  | { readonly ok: true; readonly value: ExportFormattedDocument }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };
