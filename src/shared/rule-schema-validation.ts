import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import domainSchema from '../../schemas/domain.schema.json';
import type { Rule, RuleSet } from './domain-model';

export interface RuleSchemaIssue {
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

function compileDef<T>(name: 'Rule' | 'RuleSet'): ValidateFunction<T> {
  return ajv.compile<T>({
    $ref: `https://mpd.local/schemas/domain.schema.json#/$defs/${name}`,
  });
}

const validateRuleSchema = compileDef<Rule>('Rule');
const validateRuleSetSchema = compileDef<RuleSet>('RuleSet');

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

function issues(errors: readonly ErrorObject[] | null | undefined): readonly RuleSchemaIssue[] {
  return (errors ?? []).map((error) => ({
    jsonPointer: pointerForError(error),
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed.',
  }));
}

export function validateRuleShape(value: unknown): readonly RuleSchemaIssue[] {
  return validateRuleSchema(value) ? [] : issues(validateRuleSchema.errors);
}

export function validateRuleSetShape(value: unknown): readonly RuleSchemaIssue[] {
  return validateRuleSetSchema(value) ? [] : issues(validateRuleSetSchema.errors);
}
