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

export type LocalPaletteFailureCode =
  | 'PE_INTERNAL_INPUT'
  | 'PE_INTERNAL_LIBRARY'
  | 'PE_INTERNAL_CONSTRAINT'
  | 'PE_INTERNAL_LIMIT'
  | 'PE_INTERNAL_CYCLE';

const LOCAL_MESSAGES: Record<LocalPaletteFailureCode, { ar: string; en: string }> = {
  PE_INTERNAL_INPUT: {
    ar: 'إدخال محرك الألوان غير صالح وفق عقد المرحلة الثالثة.',
    en: 'Palette Engine input is invalid under the Phase 3 contract.',
  },
  PE_INTERNAL_LIBRARY: {
    ar: 'مكتبة الألوان مفقودة أو تحتوي بيانات غير صالحة.',
    en: 'The palette library is missing or malformed.',
  },
  PE_INTERNAL_CONSTRAINT: {
    ar: 'قيد الألوان المحلول غير صالح أو غير متوافق مع مجاله.',
    en: 'A resolved palette constraint is malformed or incompatible with its domain.',
  },
  PE_INTERNAL_LIMIT: {
    ar: 'تجاوز إدخال محرك الألوان حد الأمان المسموح.',
    en: 'Palette Engine input exceeded a configured safety limit.',
  },
  PE_INTERNAL_CYCLE: {
    ar: 'يحتوي إدخال محرك الألوان على مرجع دائري غير مسموح.',
    en: 'Palette Engine input contains a forbidden cyclic reference.',
  },
};

export function paletteFailure(
  code: string,
  field: string,
  ruleId: RuleId | null = null,
  detail?: string,
): ValidationFailure {
  const entry = ERROR_BY_CODE[code];
  if (entry) {
    return {
      check: entry.check ?? ValidationCheck.Colors,
      field,
      code,
      message: entry.messageAr,
      severity: entry.severity,
      ruleId,
      priorityClass: entry.priorityClass,
      domain: entry.domain,
      originEngine: entry.originEngine,
    };
  }
  const local = LOCAL_MESSAGES[code as LocalPaletteFailureCode] ?? LOCAL_MESSAGES.PE_INTERNAL_INPUT;
  return {
    check: ValidationCheck.Colors,
    field,
    code,
    message: detail ? `${local.ar} (${detail})` : local.ar,
    severity: ValidationSeverity.Blocking,
    ruleId,
    priorityClass: RulePriorityClass.PaletteLock,
    domain: RuleDomain.Palette,
    originEngine: EngineId.Palette,
  };
}

export function paletteMessages(code: string): { readonly ar: string; readonly en: string } {
  const entry = ERROR_BY_CODE[code];
  if (entry) return { ar: entry.messageAr, en: entry.messageEn };
  const local = LOCAL_MESSAGES[code as LocalPaletteFailureCode] ?? LOCAL_MESSAGES.PE_INTERNAL_INPUT;
  return { ar: local.ar, en: local.en };
}
