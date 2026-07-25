/** Arabic-only UI catalog — authoritative 07_UI_ENGINE contract. */
export const AR = {
  appName: 'موجّه جلسات الموك أب',
  appTagline: 'إدارة جلسة احترافية حتمية من الإعداد حتى البرومبت',
  nav: {
    home: 'الرئيسية',
    session: 'الجلسة',
    planner: 'مخطط الجلسة',
    prompts: 'معاينة البرومبت',
    execution: 'مركز التنفيذ',
  },
  status: {
    editing: 'تم تغيير الإعدادات — يلزم التحقق والتوليد',
    ready: 'الإعدادات جاهزة',
    stale: 'النتائج الحالية قديمة وتحتاج إلى إعادة توليد',
    empty: 'لم يتم التوليد بعد',
  },
  actions: {
    validate: 'التحقق',
    generate: 'توليد البرومبتات',
    save: 'حفظ',
    restore: 'استرجاع',
    clear: 'مسح النتائج',
    reset: 'إعادة ضبط',
    copy: 'نسخ',
    addProduct: 'إضافة منتج',
  },
  fields: {
    title: 'اسم الجلسة',
    season: 'الموسم / الستايل',
    audience: 'الفئة المستهدفة',
    countMode: 'وضع الإجمالي',
    targetCount: 'إجمالي الموكابات المستهدف',
    colors: 'ألوان الملابس',
    products: 'توزيع المنتجات',
    customScene: 'وصف مشهد مخصص',
    placement: 'موضع الطباعة',
    includeB: 'إنشاء معاينة B مطابقة',
  },
  sections: {
    configuration: 'إعدادات الجلسة',
    products: 'توزيع الجلسة حسب المنتج',
    validation: 'التحقق',
    outputs: 'المخرجات',
    summary: 'الملخص السريع',
  },
  promptLtrNote: 'يبقى نص البرومبت باللغة الإنجليزية ومعزولًا من اليسار إلى اليمين.',
} as const;
export type ArabicCatalog = typeof AR;
