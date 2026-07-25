import { Audience, DisplayMethod, GarmentView } from '../shared/domain-model';
import type { SessionDraft, UiFailure, UiState } from './types';
import { validatePromptCollection, validateSceneCollection } from './generated-validation';
import { markValidatedRestoredState, type ValidatedRestoredUiState } from './restored-state-brand';
import { deterministicFingerprint } from './canonical';
import { validateUiStateInvariant } from './state';
import { inspectDenseArray, inspectExactRecord, ownValidatedClone } from './safe-runtime';

const uiPhases = new Set([
  'idle',
  'editing',
  'validating',
  'invalid',
  'ready',
  'generating-scenes',
  'scenes-ready',
  'generating-prompts',
  'prompts-ready',
  'save-pending',
  'saved',
  'failure',
]);
const uiSteps = new Set([
  'session',
  'season',
  'products',
  'colors',
  'audience',
  'count',
  'groups',
  'rules',
  'validation',
  'planning',
  'generation',
  'review',
]);
const modes = new Set(['quick', 'advanced', 'professional']);
const countModes = new Set(['fixed', 'flexible']);
const placements = new Set(['center_chest', 'full_front', 'left_chest', 'center_back']);
const groupModes = new Set(['product', 'color', 'view']);
const audiences = new Set<string>(Object.values(Audience));
const views = new Set<string>(Object.values(GarmentView));
const methods = new Set<string>(Object.values(DisplayMethod));

function string(value: unknown): value is string {
  return typeof value === 'string';
}
function uniqueStrings(values: readonly unknown[]): boolean {
  return values.every(string) && new Set(values).size === values.length;
}

function validateDraft(value: unknown, allowIncompleteFixedCount: boolean): value is SessionDraft {
  try {
    const inspected = inspectExactRecord(value, [
      'title',
      'mode',
      'seasonId',
      'audience',
      'countMode',
      'targetCount',
      'products',
      'colorIds',
      'placement',
      'customSceneDescription',
      'groupBy',
      'includeOutputB',
    ]);
    if (!inspected.ok) return false;
    const record = inspected.value;
    const products = inspectDenseArray(record.products);
    const colors = inspectDenseArray(record.colorIds);
    if (
      !string(record.title) ||
      !modes.has(String(record.mode)) ||
      !(record.seasonId === null || string(record.seasonId)) ||
      !(record.audience === null || audiences.has(String(record.audience))) ||
      !countModes.has(String(record.countMode)) ||
      !Number.isSafeInteger(record.targetCount) ||
      Number(record.targetCount) < 1 ||
      Number(record.targetCount) > 50 ||
      !products.ok ||
      !colors.ok ||
      !uniqueStrings(colors.value) ||
      !placements.has(String(record.placement)) ||
      !string(record.customSceneDescription) ||
      !groupModes.has(String(record.groupBy)) ||
      typeof record.includeOutputB !== 'boolean'
    )
      return false;
    const productIds = new Set<string>();
    let total = 0;
    for (const item of products.value) {
      const product = inspectExactRecord(item, [
        'productId',
        'quantity',
        'selectedViews',
        'displayMethods',
      ]);
      if (!product.ok) return false;
      const p = product.value;
      const selectedViews = inspectDenseArray(p.selectedViews);
      const displayMethods = inspectDenseArray(p.displayMethods);
      if (
        !string(p.productId) ||
        productIds.has(p.productId) ||
        !Number.isSafeInteger(p.quantity) ||
        Number(p.quantity) < 1 ||
        Number(p.quantity) > 50 ||
        !selectedViews.ok ||
        !uniqueStrings(selectedViews.value) ||
        !selectedViews.value.every((v) => views.has(String(v))) ||
        !displayMethods.ok ||
        !uniqueStrings(displayMethods.value) ||
        !displayMethods.value.every((v) => methods.has(String(v)))
      )
        return false;
      productIds.add(p.productId);
      total += Number(p.quantity);
    }
    return (
      allowIncompleteFixedCount || record.countMode !== 'fixed' || total === record.targetCount
    );
  } catch {
    return false;
  }
}

export function validatePersistedDraft(value: unknown): value is SessionDraft {
  return validateDraft(value, false);
}

function validateFailure(value: unknown): value is UiFailure {
  try {
    const result = inspectExactRecord(value, ['code', 'field', 'messageAr', 'severity', 'source']);
    if (!result.ok) return false;
    const record = result.value;
    return (
      string(record.code) &&
      string(record.field) &&
      string(record.messageAr) &&
      ['blocking', 'warning'].includes(String(record.severity)) &&
      ['ui', 'engine', 'persistence', 'clipboard'].includes(String(record.source))
    );
  } catch {
    return false;
  }
}

type UiStateValidationResult =
  | { readonly ok: true; readonly value: ValidatedRestoredUiState }
  | { readonly ok: false; readonly failure: UiFailure };

function validateUiState(
  value: unknown,
  allowIncompleteIdleDraft: boolean,
): UiStateValidationResult {
  const fail = (field: string, messageAr: string) => ({
    ok: false as const,
    failure: {
      code: 'UI_PERSISTED_STATE_INVALID',
      field,
      messageAr,
      severity: 'blocking' as const,
      source: 'persistence' as const,
    },
  });
  try {
    const inspected = inspectExactRecord(value, [
      'schemaVersion',
      'phase',
      'step',
      'draft',
      'validatedFingerprint',
      'generatedFingerprint',
      'scenes',
      'prompts',
      'failures',
      'selectedPromptId',
      'dirty',
      'persisted',
      'requestSequence',
      'activeRequestSequence',
    ]);
    if (!inspected.ok)
      return fail('persistedState', 'بنية الجلسة المحفوظة غير صالحة أو تحتوي حقولًا غير معروفة.');
    const record = inspected.value;
    const scenes = inspectDenseArray(record.scenes);
    const prompts = inspectDenseArray(record.prompts);
    const failures = inspectDenseArray(record.failures);
    if (
      record.schemaVersion !== 1 ||
      !uiPhases.has(String(record.phase)) ||
      !uiSteps.has(String(record.step)) ||
      !validateDraft(
        record.draft,
        allowIncompleteIdleDraft && record.phase === 'idle' && record.step === 'session',
      ) ||
      !(record.validatedFingerprint === null || string(record.validatedFingerprint)) ||
      !(record.generatedFingerprint === null || string(record.generatedFingerprint)) ||
      !scenes.ok ||
      !prompts.ok ||
      !failures.ok ||
      !failures.value.every(validateFailure) ||
      !(record.selectedPromptId === null || string(record.selectedPromptId)) ||
      typeof record.dirty !== 'boolean' ||
      typeof record.persisted !== 'boolean' ||
      !Number.isSafeInteger(record.requestSequence) ||
      Number(record.requestSequence) < 0 ||
      !(
        record.activeRequestSequence === null ||
        (Number.isSafeInteger(record.activeRequestSequence) &&
          Number(record.activeRequestSequence) > 0)
      )
    )
      return fail('persistedState', 'إصدار أو قيم الجلسة المحفوظة غير مدعومة.');
    const draft = record.draft as SessionDraft;
    const sceneValidation =
      scenes.value.length === 0
        ? { ok: true as const, value: [] as const }
        : validateSceneCollection(scenes.value, draft.includeOutputB);
    if (!sceneValidation.ok)
      return fail(sceneValidation.failure.field, sceneValidation.failure.messageAr);
    const promptValidation =
      prompts.value.length === 0
        ? { ok: true as const, value: [] as const }
        : validatePromptCollection(prompts.value, sceneValidation.value, draft.includeOutputB);
    if (!promptValidation.ok)
      return fail(promptValidation.failure.field, promptValidation.failure.messageAr);
    const candidate = {
      schemaVersion: 1 as const,
      phase: record.phase,
      step: record.step,
      draft,
      validatedFingerprint: record.validatedFingerprint,
      generatedFingerprint: record.generatedFingerprint,
      scenes: sceneValidation.value,
      prompts: promptValidation.value,
      failures: failures.value,
      selectedPromptId: record.selectedPromptId,
      dirty: record.dirty,
      persisted: record.persisted,
      requestSequence: record.requestSequence,
      activeRequestSequence: record.activeRequestSequence,
    } as UiState;
    const invariant = validateUiStateInvariant(candidate);
    if (invariant.length) return fail(invariant[0].field, invariant[0].messageAr);
    if (
      candidate.generatedFingerprint !== null &&
      ['prompts-ready', 'save-pending', 'saved'].includes(candidate.phase) &&
      candidate.generatedFingerprint !== deterministicFingerprint(candidate.draft)
    )
      return fail('generatedFingerprint', 'بصمة المخرجات لا تطابق الإعدادات.');
    const owned = ownValidatedClone(candidate);
    if (!owned.ok) return fail('persistedState', 'تعذر امتلاك الجلسة المحفوظة بأمان.');
    return { ok: true, value: markValidatedRestoredState(owned.value) };
  } catch {
    return fail('persistedState', 'تعذر فحص الجلسة المحفوظة بأمان.');
  }
}

export function validatePersistedUiState(value: unknown): UiStateValidationResult {
  return validateUiState(value, false);
}

export function validateRuntimeUiState(value: unknown): UiStateValidationResult {
  return validateUiState(value, true);
}
