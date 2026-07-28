import type { ExportFormatResult, ExportFormatterInput } from './format-result';
import { serializeExportJson } from './json-serializer';
import { prepareFormatterInput } from './projection';
import { formattingLimitFailure, successfulFormat } from './result-builder';

/** Human-readable, recursively key-sorted JSON with two-space indentation. */
export function formatReadableJson(input: ExportFormatterInput): ExportFormatResult {
  const prepared = prepareFormatterInput(input);
  if (!prepared.ok) return prepared;
  const built = serializeExportJson(prepared.value.readableJson, {
    indentation: 2,
    trailingLf: true,
    maximumBytes: prepared.value.limits.maxJsonBytes,
    maximumDepth: prepared.value.limits.maxJsonDepth,
    maximumArrayLength: prepared.value.limits.maxZipEntries,
  });
  return built
    ? successfulFormat(prepared.value, built, 'readable_json', 'application/json', 'json')
    : formattingLimitFailure('formatter.readableJson');
}
