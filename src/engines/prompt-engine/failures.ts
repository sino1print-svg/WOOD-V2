import {
  EngineId,
  RuleDomain,
  RulePriorityClass,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';

const MESSAGES: Readonly<Record<string, readonly [string, string]>> = {
  PROMPT_SRC_001: [
    'صورة البيع (A) المصدر غير مرفقة.',
    'Output B source Sale Image (A) is not attached.',
  ],
  PROMPT_PNG_001: ['ملف التصميم PNG غير مرفوع.', 'PNG artwork is not attached.'],
  PROMPT_PRD_001: ['المنتج غير صالح أو غير معروف.', 'Invalid product.'],
  PROMPT_VIEW_001: ['زاوية العرض غير مدعومة لهذا المنتج.', 'View not supported by product.'],
  PROMPT_COLOR_001: ['لون القطعة خارج الألوان المختارة.', 'Garment color outside selection.'],
  PROMPT_COLLAGE_001: [
    'طلب كولاج أو عدة صور غير مسموح.',
    'Collage or multi-image request is not allowed.',
  ],
  PROMPT_ART_001: [
    'لا يُسمح باختراع أو استبدال التصميم.',
    'Artwork invention or replacement is not allowed.',
  ],
  PROMPT_VAR_001: ['متغيّر برومبت غير محلول.', 'Unresolved prompt variable.'],
  PROMPT_MOD_001: ['إصدار وحدة البرومبت غير صالح.', 'Invalid prompt module version.'],
  PROMPT_AUD_001: [
    'لا يُسمح للبالغين بارتداء منتجات الأطفال.',
    'Adults may not wear Kids products.',
  ],
  PROMPT_TXT_001: ['لا يُسمح بنص مقروء داخل المشهد.', 'Readable scene text is not allowed.'],
  PROMPT_INPUT_001: ['بيانات محرك البرومبت غير صالحة.', 'Invalid Prompt Engine input.'],
  PROMPT_INPUT_UNSAFE: [
    'تحتوي البيانات على بنية غير آمنة.',
    'Prompt input contains an unsafe runtime shape.',
  ],
  PROMPT_INPUT_LIMIT: ['تجاوزت البيانات الحدود الآمنة.', 'Prompt input exceeds safe bounds.'],
};

export function promptFailure(code: string, field: string): ValidationFailure {
  const [ar, en] = MESSAGES[code] ?? MESSAGES.PROMPT_INPUT_001!;
  return {
    check: ValidationCheck.PrintRules,
    field,
    code,
    message: `${ar} / ${en}`,
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: RulePriorityClass.PrintArea,
    domain: RuleDomain.Prompt,
    originEngine: EngineId.Prompt,
  };
}
