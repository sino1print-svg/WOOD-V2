import type { ExportFormatResult, ExportFormatterInput } from './format-result';
import { serializeExportJson } from './json-serializer';
import { prepareFormatterInput } from './projection';
import { formattingLimitFailure, successfulFormat } from './result-builder';

/** Minified recursive canonical JSON for the checksum stage in Batch 10.4. */
export function formatCanonicalJson(input: ExportFormatterInput): ExportFormatResult {
  const prepared = prepareFormatterInput(input);
  if (!prepared.ok) return prepared;
  const built = serializeExportJson(prepared.value.canonicalJson, {
    indentation: 0,
    trailingLf: false,
    maximumBytes: prepared.value.limits.maxJsonBytes,
    maximumDepth: prepared.value.limits.maxJsonDepth,
    maximumArrayLength: prepared.value.limits.maxZipEntries,
  });
  return built
    ? successfulFormat(prepared.value, built, 'canonical_json', 'application/json', 'json')
    : formattingLimitFailure('formatter.canonicalJson');
}

/** Typed byte-producing alias kept separate for checksum consumers. */
export function encodeCanonicalJson(input: ExportFormatterInput): ExportFormatResult {
  return formatCanonicalJson(input);
}
