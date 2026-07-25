import {
  EngineId,
  RuleDomain,
  RulePriorityClass,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';

const MESSAGES: Readonly<Record<string, readonly [string, string]>> = {
  PA_INTERNAL_INPUT: [
    'بيانات قياس منطقة الطباعة غير صالحة.',
    'Invalid print-area measurement input.',
  ],
  PA_INTERNAL_PRODUCT: [
    'معرّف المنتج لا يطابق المشهد.',
    'Product identifier does not match the scene.',
  ],
  PA_INTERNAL_PROFILE: [
    'ملف منطقة الطباعة لا يطابق بيان المنتج أو المشهد.',
    'Print-area profile does not match the product manifest or scene.',
  ],
  PA_INTERNAL_POSITION: [
    'موضع الطباعة المطلوب غير مدعوم لهذا المنتج.',
    'Requested print position is unsupported for this product.',
  ],
  PA_INTERNAL_MEASUREMENT: [
    'حقائق قياس منطقة الطباعة غير صالحة.',
    'Print-area measurement facts are invalid.',
  ],
  PA_INTERNAL_CYCLE: [
    'تحتوي بيانات منطقة الطباعة على مرجع دائري أو مفتاح غير آمن.',
    'Print-area input contains a cycle or unsafe key.',
  ],
  PA_INTERNAL_LIMIT: [
    'تجاوزت بيانات منطقة الطباعة الحدود الآمنة.',
    'Print-area input exceeds safe bounds.',
  ],
};

export function printAreaFailure(code: string, field: string): ValidationFailure {
  const [ar, en] = MESSAGES[code] ?? MESSAGES.PA_INTERNAL_INPUT!;
  return {
    check: ValidationCheck.PrintRules,
    field,
    code,
    message: `${ar} / ${en}`,
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: RulePriorityClass.PrintArea,
    domain: RuleDomain.PrintArea,
    originEngine: EngineId.PrintArea,
  };
}

export function printAreaFailureMessages(code: string): { ar: string; en: string } {
  const [ar, en] = MESSAGES[code] ?? MESSAGES.PA_INTERNAL_INPUT!;
  return { ar, en };
}
