import type { SessionDraft, UiCatalog, UiFailure } from './types';

const MAX_COUNT = 50;
function containsUnsafeControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}

function failure(code: string, field: string, messageAr: string): UiFailure {
  return { code, field, messageAr, severity: 'blocking', source: 'ui' };
}

export function validateDraft(draft: SessionDraft, catalog: UiCatalog): readonly UiFailure[] {
  const failures: UiFailure[] = [];
  if (!draft.title.trim())
    failures.push(failure('UI_SESSION_NAME_REQUIRED', 'title', 'اسم الجلسة مطلوب.'));
  if (containsUnsafeControl(draft.title) || containsUnsafeControl(draft.customSceneDescription)) {
    failures.push(
      failure(
        'UI_TEXT_CONTROL_INVALID',
        'customSceneDescription',
        'يحتوي النص على محارف تحكم غير مسموحة.',
      ),
    );
  }
  if (!draft.seasonId || !catalog.seasons.some((season) => season.id === draft.seasonId)) {
    failures.push(failure('UI_SEASON_REQUIRED', 'seasonId', 'اختر موسمًا صالحًا.'));
  }
  if (
    !Number.isSafeInteger(draft.targetCount) ||
    draft.targetCount < 1 ||
    draft.targetCount > MAX_COUNT
  ) {
    failures.push(
      failure(
        'UI_COUNT_INVALID',
        'targetCount',
        'عدد المشاهد يجب أن يكون عددًا صحيحًا من 1 إلى 50.',
      ),
    );
  }
  if (draft.products.length === 0)
    failures.push(failure('UI_PRODUCT_REQUIRED', 'products', 'اختر منتجًا واحدًا على الأقل.'));
  if (draft.colorIds.length === 0)
    failures.push(failure('UI_COLOR_REQUIRED', 'colorIds', 'اختر لونًا واحدًا على الأقل.'));
  const productIds = new Set<string>();
  let quantityTotal = 0;
  for (const [index, product] of draft.products.entries()) {
    if (productIds.has(product.productId))
      failures.push(
        failure('UI_PRODUCT_DUPLICATE', `products.${index}`, 'لا يجوز تكرار المنتج نفسه.'),
      );
    productIds.add(product.productId);
    const catalogProduct = catalog.products.find((item) => item.id === product.productId);
    if (!catalogProduct) {
      failures.push(
        failure('UI_PRODUCT_UNKNOWN', `products.${index}.productId`, 'المنتج المحدد غير معروف.'),
      );
      continue;
    }
    if (
      !Number.isSafeInteger(product.quantity) ||
      product.quantity < 1 ||
      product.quantity > MAX_COUNT
    ) {
      failures.push(
        failure(
          'UI_PRODUCT_QUANTITY_INVALID',
          `products.${index}.quantity`,
          'كمية المنتج غير صالحة.',
        ),
      );
    }
    quantityTotal += product.quantity;
    if (draft.audience && !catalogProduct.allowedAudiences.includes(draft.audience)) {
      failures.push(
        failure(
          'UI_AUDIENCE_INCOMPATIBLE',
          `products.${index}.productId`,
          'الجمهور غير متوافق مع المنتج.',
        ),
      );
    }
    for (const view of product.selectedViews) {
      if (!catalogProduct.allowedViews.includes(view))
        failures.push(
          failure(
            'UI_VIEW_INCOMPATIBLE',
            `products.${index}.selectedViews`,
            'زاوية العرض غير متوافقة مع المنتج.',
          ),
        );
    }
    for (const method of product.displayMethods) {
      if (!catalogProduct.allowedDisplayMethods.includes(method))
        failures.push(
          failure(
            'UI_DISPLAY_INCOMPATIBLE',
            `products.${index}.displayMethods`,
            'طريقة العرض غير متوافقة مع المنتج.',
          ),
        );
    }
    for (const colorId of draft.colorIds) {
      if (!catalogProduct.allowedColorIds.includes(colorId))
        failures.push(
          failure(
            'UI_COLOR_INCOMPATIBLE',
            `products.${index}.productId`,
            'أحد الألوان غير متوافق مع المنتج.',
          ),
        );
    }
  }
  if (draft.countMode === 'fixed' && quantityTotal !== draft.targetCount) {
    failures.push(
      failure(
        'UI_FIXED_TOTAL_MISMATCH',
        'products',
        'مجموع كميات المنتجات يجب أن يساوي العدد المستهدف.',
      ),
    );
  }
  return failures;
}
