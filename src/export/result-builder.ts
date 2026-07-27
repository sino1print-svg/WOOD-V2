import type { BuiltTextDocument } from './document-builder';
import { formatterFailure } from './failures';
import type {
  ExportFormatResult,
  ExportSuggestedExtension,
  ExportTextDocumentFormat,
} from './format-result';
import type { PreparedFormatterSource } from './projection';
import { freezeOwned } from './runtime';
import type { ExportArtifactMediaType } from '../shared/contracts/export-contracts';

export function successfulFormat(
  prepared: PreparedFormatterSource,
  built: BuiltTextDocument,
  format: ExportTextDocumentFormat,
  mediaType: ExportArtifactMediaType,
  suggestedExtension: ExportSuggestedExtension,
): ExportFormatResult {
  return freezeOwned({
    ok: true,
    value: {
      format,
      mediaType,
      suggestedExtension,
      text: built.text,
      bytes: built.bytes,
      byteLength: built.byteLength,
      metadata: {
        schemaVersion: 1,
        baseScope: prepared.plan.scope.baseScope,
        scopeDetail: prepared.plan.scope.scopeDetail,
        partial: prepared.plan.partial,
      },
    },
  });
}

export function formattingLimitFailure(field: string): ExportFormatResult {
  return freezeOwned({
    ok: false,
    failures: [formatterFailure('EXPORT_STORAGE_001', field)],
  });
}
