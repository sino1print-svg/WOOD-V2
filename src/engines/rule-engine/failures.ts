import {
  EngineId,
  RuleDomain,
  RulePriorityClass,
  ValidationCheck,
  ValidationSeverity,
  type RuleId,
  type ValidationFailure,
} from '../../shared/domain-model';
import { ERROR_BY_CODE } from '../../shared/errors';

export type LocalRuleFailureCode =
  | 'RE_INTERNAL_CONFLICT'
  | 'RE_INTERNAL_LIMIT'
  | 'RE_INTERNAL_CYCLE';

const LOCAL_MESSAGES: Record<LocalRuleFailureCode, { ar: string; en: string }> = {
  RE_INTERNAL_CONFLICT: {
    ar: 'تعارضت قواعد متساوية الأولوية بصورة لا يمكن حسمها دون تغيير المواصفات.',
    en: 'Equal-priority rules conflict irreconcilably under the documented algorithm.',
  },
  RE_INTERNAL_LIMIT: {
    ar: 'تجاوز إدخال محرك القواعد حد الأمان المسموح.',
    en: 'Rule Engine input exceeded a configured safety limit.',
  },
  RE_INTERNAL_CYCLE: {
    ar: 'يحتوي إدخال محرك القواعد على مرجع دائري غير مسموح.',
    en: 'Rule Engine input contains a forbidden cyclic reference.',
  },
};

export function failureFromCode(
  code: string,
  field: string,
  ruleId: RuleId | null,
  overrides: {
    priority?: RulePriorityClass | null;
    domain?: RuleDomain | null;
    detail?: string;
  } = {},
): ValidationFailure {
  const entry = ERROR_BY_CODE[code];
  if (entry) {
    return {
      check: entry.check ?? ValidationCheck.Products,
      field,
      code,
      message: entry.messageAr,
      severity: entry.severity,
      ruleId,
      priorityClass: overrides.priority ?? entry.priorityClass,
      domain: overrides.domain ?? entry.domain,
      originEngine: EngineId.Rule,
    };
  }
  const local = LOCAL_MESSAGES[code as LocalRuleFailureCode] ?? LOCAL_MESSAGES.RE_INTERNAL_CONFLICT;
  return {
    check: ValidationCheck.Products,
    field,
    code,
    message: overrides.detail ? `${local.ar} (${overrides.detail})` : local.ar,
    severity: ValidationSeverity.Blocking,
    ruleId,
    priorityClass: overrides.priority ?? null,
    domain: overrides.domain ?? null,
    originEngine: EngineId.Rule,
  };
}

export function bilingualForCode(code: string): {
  readonly messageAr: string;
  readonly messageEn: string;
  readonly severity: ValidationSeverity | null;
} {
  const entry = ERROR_BY_CODE[code];
  if (entry) {
    return { messageAr: entry.messageAr, messageEn: entry.messageEn, severity: entry.severity };
  }
  const local = LOCAL_MESSAGES[code as LocalRuleFailureCode];
  return local
    ? { messageAr: local.ar, messageEn: local.en, severity: ValidationSeverity.Blocking }
    : { messageAr: '', messageEn: '', severity: null };
}
