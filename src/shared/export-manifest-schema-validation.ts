/**
 * ExportManifest JSON-Schema validation - 09_EXPORT_ENGINE §13, schemas/export-manifest.schema.json.
 *
 * Mirrors `rule-schema-validation.ts`: the domain schema bundle is imported as a
 * static JSON module (no runtime filesystem read) and compiled once via Ajv.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import domainSchema from '../../schemas/domain.schema.json';
import type { ExportManifest } from './domain-model';

export interface ExportManifestSchemaIssue {
  readonly jsonPointer: string;
  readonly keyword: string;
  readonly message: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
  messages: true,
});
ajv.addSchema(domainSchema);

const validateExportManifestSchema: ValidateFunction<ExportManifest> = ajv.compile<ExportManifest>({
  $ref: 'https://mpd.local/schemas/domain.schema.json#/$defs/ExportManifest',
});

function pointerForError(error: ErrorObject): string {
  let path = error.instancePath || '/';
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path = `${path === '/' ? '' : path}/${error.params.missingProperty}`;
  } else if (
    error.keyword === 'additionalProperties' &&
    typeof error.params.additionalProperty === 'string'
  ) {
    path = `${path === '/' ? '' : path}/${error.params.additionalProperty}`;
  }
  return path || '/';
}

function issues(
  errors: readonly ErrorObject[] | null | undefined,
): readonly ExportManifestSchemaIssue[] {
  return (errors ?? []).map((error) => ({
    jsonPointer: pointerForError(error),
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed.',
  }));
}

export function validateExportManifestShape(value: unknown): readonly ExportManifestSchemaIssue[] {
  return validateExportManifestSchema(value) ? [] : issues(validateExportManifestSchema.errors);
}
