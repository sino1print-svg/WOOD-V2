import {
  EngineId,
  RuleDomain,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';
import { ERROR_BY_CODE } from '../../shared/errors';

export type CoverFailureCode =
  | 'COVER_BARRIER_001'
  | 'COVER_SRC_001'
  | 'COVER_LOCK_001'
  | 'COVER_DUP_001'
  | 'COVER_COUNT_001'
  | 'COVER_COLOR_001'
  | 'COVER_META_001'
  | 'COVER_LAYOUT_001'
  | 'COVER_GREENBG_001'
  | 'COVER_VAR_001';

export function coverFailure(code: CoverFailureCode, field: string): ValidationFailure {
  const entry = ERROR_BY_CODE[code];
  return Object.freeze({
    check: entry?.check ?? ValidationCheck.CoverData,
    field,
    code,
    message: entry?.messageAr ?? 'بيانات الغلاف غير صالحة.',
    severity: entry?.severity ?? ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: entry?.priorityClass ?? null,
    domain: entry?.domain ?? RuleDomain.Cover,
    originEngine: EngineId.Cover,
  });
}

export function coverFailureResult(
  code: CoverFailureCode,
  field: string,
): { readonly ok: false; readonly failures: readonly ValidationFailure[] } {
  return Object.freeze({
    ok: false,
    failures: Object.freeze([coverFailure(code, field)]),
  });
}
