import {
  EngineId,
  RuleDomain,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../shared/domain-model';
import { ERROR_BY_CODE } from '../shared/errors';

export type FormatterFailureCode = 'EXPORT_CORRUPT_001' | 'EXPORT_STORAGE_001';

function defaultCheck(domain: RuleDomain | null): ValidationCheck {
  if (domain === RuleDomain.Cover) return ValidationCheck.CoverData;
  if (domain === RuleDomain.Output || domain === RuleDomain.Artwork) {
    return ValidationCheck.Products;
  }
  if (domain === RuleDomain.Prompt) return ValidationCheck.Products;
  return ValidationCheck.SceneCount;
}

/** Build formatter failures from registered Export codes only. */
export function formatterFailure(code: FormatterFailureCode, field: string): ValidationFailure {
  const fallback = ERROR_BY_CODE.EXPORT_CORRUPT_001;
  const candidate = ERROR_BY_CODE[code];
  const entry =
    candidate?.namespace === 'EXPORT' && candidate.originEngine === EngineId.Export
      ? candidate
      : fallback;
  if (!entry) {
    return {
      check: ValidationCheck.SceneCount,
      field: 'formatter',
      code: 'EXPORT_CORRUPT_001',
      message: 'نسخة احتياطية/مشروع تالف.',
      severity: ValidationSeverity.Blocking,
      ruleId: null,
      priorityClass: null,
      domain: RuleDomain.Export,
      originEngine: EngineId.Export,
    };
  }
  return {
    check: entry.check ?? defaultCheck(entry.domain),
    field,
    code: entry.code,
    message: entry.messageAr,
    severity: entry.severity,
    ruleId: null,
    priorityClass: entry.priorityClass,
    domain: entry.domain,
    originEngine: EngineId.Export,
  };
}

export function registeredExportFailure(code: string, field: string): ValidationFailure | null {
  const entry = ERROR_BY_CODE[code];
  if (!entry || entry.namespace !== 'EXPORT' || entry.originEngine !== EngineId.Export) return null;
  return {
    check: entry.check ?? defaultCheck(entry.domain),
    field,
    code: entry.code,
    message: entry.messageAr,
    severity: entry.severity,
    ruleId: null,
    priorityClass: entry.priorityClass,
    domain: entry.domain,
    originEngine: EngineId.Export,
  };
}
