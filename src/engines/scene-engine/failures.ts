/**
 * Scene Engine typed failures. Mirrors src/engines/rule-engine/failures.ts exactly:
 * shared, already-approved RULE_* codes are looked up from the shared registry
 * (never redefined); only truly Scene-Engine-internal safety-limit codes are local.
 */
import {
  EngineId,
  RuleDomain,
  RulePriorityClass,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';
import { ERROR_BY_CODE } from '../../shared/errors';

export type LocalSceneFailureCode =
  | 'SE_INTERNAL_LIMIT'
  | 'SE_INTERNAL_LIBRARY_GAP'
  | 'SE_INTERNAL_OBSERVER_CONTRACT';

const LOCAL_MESSAGES: Record<LocalSceneFailureCode, { ar: string; en: string }> = {
  SE_INTERNAL_LIMIT: {
    ar: 'تجاوز إدخال محرك المشاهد حد الأمان المسموح.',
    en: 'Scene Engine input exceeded a configured safety limit.',
  },
  SE_INTERNAL_LIBRARY_GAP: {
    ar: 'مكتبة المشهد لا تحتوي على عناصر كافية لتلبية القيود المطلوبة.',
    en: 'Scene library does not contain enough items to satisfy the required constraints.',
  },
  SE_INTERNAL_OBSERVER_CONTRACT: {
    ar: 'أعاد راصد منطقة الطباعة قيمة غير صالحة أو غير حتمية.',
    en: 'The print-area observer returned an invalid or non-deterministic value.',
  },
};

export function sceneFailureFromCode(
  code: string,
  field: string,
  overrides: {
    priority?: RulePriorityClass | null;
    domain?: RuleDomain | null;
    detail?: string;
  } = {},
): ValidationFailure {
  const entry = ERROR_BY_CODE[code];
  if (entry) {
    return {
      check: entry.check ?? ValidationCheck.SceneCount,
      field,
      code,
      message: entry.messageAr,
      severity: entry.severity,
      ruleId: null,
      priorityClass: overrides.priority ?? entry.priorityClass,
      domain: overrides.domain ?? entry.domain,
      originEngine: EngineId.Scene,
    };
  }
  const local = LOCAL_MESSAGES[code as LocalSceneFailureCode] ?? LOCAL_MESSAGES.SE_INTERNAL_LIMIT;
  return {
    check: ValidationCheck.SceneCount,
    field,
    code,
    message: overrides.detail ? `${local.ar} (${overrides.detail})` : local.ar,
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: overrides.priority ?? null,
    domain: overrides.domain ?? RuleDomain.Composition,
    originEngine: EngineId.Scene,
  };
}
