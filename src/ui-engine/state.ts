import { Audience } from '../shared/domain-model';
import type { SessionDraft, UiFailure, UiPhase, UiState, UiStep } from './types';
import type { ValidatedPromptCollection, ValidatedSceneCollection } from './generated-validation';
import { validatePromptCollection, validateSceneCollection } from './generated-validation';
import { isValidatedRestoredState, type ValidatedRestoredUiState } from './restored-state-brand';
import { deterministicFingerprint } from './canonical';
import { inspectExactRecord } from './safe-runtime';

export const UI_STEPS: readonly UiStep[] = [
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
];

export type UiTransitionEvent =
  | { readonly type: 'EDIT_STARTED'; readonly draft: SessionDraft }
  | { readonly type: 'VALIDATION_STARTED' }
  | { readonly type: 'VALIDATION_SUCCEEDED'; readonly fingerprint: string }
  | { readonly type: 'VALIDATION_FAILED'; readonly failures: readonly UiFailure[] }
  | { readonly type: 'SCENE_GENERATION_STARTED'; readonly requestSequence: number }
  | {
      readonly type: 'SCENE_GENERATION_SUCCEEDED';
      readonly requestSequence: number;
      readonly generationFingerprint: string;
      readonly scenes: ValidatedSceneCollection;
    }
  | { readonly type: 'PROMPT_GENERATION_STARTED' }
  | {
      readonly type: 'PROMPT_GENERATION_SUCCEEDED';
      readonly requestSequence: number;
      readonly generationFingerprint: string;
      readonly prompts: ValidatedPromptCollection;
    }
  | { readonly type: 'GENERATION_FAILED'; readonly failures: readonly UiFailure[] }
  | { readonly type: 'SAVE_STARTED' }
  | { readonly type: 'SAVE_SUCCEEDED' }
  | { readonly type: 'SAVE_FAILED'; readonly failures: readonly UiFailure[] }
  | { readonly type: 'OUTPUTS_CLEARED' }
  | { readonly type: 'FORM_RESET' }
  | {
      readonly type: 'SESSION_RESTORED';
      readonly validatedState: ValidatedRestoredUiState;
    }
  | { readonly type: 'NEW_SESSION_STARTED' };

export type UiTransitionResult =
  | { readonly ok: true; readonly value: UiState }
  | { readonly ok: false; readonly failure: UiFailure };

function transitionFailure(messageAr: string): UiTransitionResult {
  return {
    ok: false,
    failure: {
      code: 'UI_TRANSITION_INVALID',
      field: 'phase',
      messageAr,
      severity: 'blocking',
      source: 'ui',
    },
  };
}

export function createInitialDraft(): SessionDraft {
  return {
    title: '',
    mode: 'quick',
    seasonId: null,
    audience: Audience.All,
    countMode: 'fixed',
    targetCount: 4,
    products: [],
    colorIds: [],
    placement: 'center_chest',
    customSceneDescription: '',
    groupBy: 'product',
    includeOutputB: true,
  };
}
export function createInitialUiState(draft: SessionDraft = createInitialDraft()): UiState {
  return {
    schemaVersion: 1,
    phase: 'idle',
    step: 'session',
    draft,
    validatedFingerprint: null,
    generatedFingerprint: null,
    scenes: [],
    prompts: [],
    failures: [],
    selectedPromptId: null,
    dirty: false,
    persisted: false,
    requestSequence: 0,
    activeRequestSequence: null,
  };
}

const generatedPhases = new Set<UiPhase>([
  'scenes-ready',
  'generating-prompts',
  'prompts-ready',
  'save-pending',
  'saved',
]);
export function validateUiStateInvariant(state: UiState): readonly UiFailure[] {
  const failures: UiFailure[] = [];
  const add = (code: string, field: string, messageAr: string) =>
    failures.push({ code, field, messageAr, severity: 'blocking', source: 'ui' });
  if (!Number.isSafeInteger(state.requestSequence) || state.requestSequence < 0)
    add('UI_STATE_REQUEST_SEQUENCE_INVALID', 'requestSequence', 'تسلسل الطلب غير صالح.');
  if (
    state.activeRequestSequence !== null &&
    (!Number.isSafeInteger(state.activeRequestSequence) ||
      state.activeRequestSequence < 1 ||
      state.activeRequestSequence > state.requestSequence)
  )
    add('UI_STATE_ACTIVE_REQUEST_INVALID', 'activeRequestSequence', 'ملكية الطلب النشط غير صالحة.');
  if (state.persisted && state.dirty)
    add(
      'UI_STATE_PERSISTENCE_CONTRADICTION',
      'persisted',
      'لا يمكن أن تكون الحالة محفوظة ومتسخة معًا.',
    );
  if (generatedPhases.has(state.phase) && state.generatedFingerprint === null)
    add('UI_STATE_GENERATED_FINGERPRINT_REQUIRED', 'generatedFingerprint', 'بصمة التوليد مطلوبة.');
  if (
    [
      'ready',
      'generating-scenes',
      'scenes-ready',
      'generating-prompts',
      'prompts-ready',
      'save-pending',
      'saved',
    ].includes(state.phase) &&
    state.validatedFingerprint === null
  )
    add('UI_STATE_VALIDATED_FINGERPRINT_REQUIRED', 'validatedFingerprint', 'بصمة التحقق مطلوبة.');
  if (
    state.phase === 'prompts-ready' ||
    state.phase === 'save-pending' ||
    state.phase === 'saved'
  ) {
    if (state.scenes.length === 0) add('UI_STATE_SCENES_REQUIRED', 'scenes', 'المشاهد مطلوبة.');
    if (state.prompts.length === 0)
      add('UI_STATE_PROMPTS_REQUIRED', 'prompts', 'البرومبتات مطلوبة.');
    if (state.step !== 'review')
      add('UI_STATE_STEP_PHASE_MISMATCH', 'step', 'خطوة المراجعة مطلوبة.');
  }
  if (state.step === 'review' && (state.scenes.length === 0 || state.prompts.length === 0))
    add('UI_STATE_REVIEW_OUTPUTS_REQUIRED', 'step', 'لا يمكن فتح المراجعة دون مخرجات.');
  const allowedStepsByPhase: Readonly<Record<UiPhase, readonly UiStep[]>> = {
    idle: ['session'],
    editing: [
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
    ],
    validating: ['validation'],
    invalid: ['validation'],
    ready: ['planning'],
    'generating-scenes': ['generation'],
    'scenes-ready': ['generation'],
    'generating-prompts': ['generation'],
    'prompts-ready': ['review'],
    'save-pending': ['review'],
    saved: ['review'],
    failure: ['session', 'validation', 'generation', 'review'],
  };
  if (!allowedStepsByPhase[state.phase].includes(state.step))
    add('UI_STATE_STEP_PHASE_MISMATCH', 'step', 'المرحلة والخطوة غير متوافقتين.');
  if (state.phase === 'generating-scenes' && state.activeRequestSequence === null)
    add(
      'UI_STATE_ACTIVE_REQUEST_REQUIRED',
      'activeRequestSequence',
      'ملكية الطلب مطلوبة أثناء التوليد.',
    );
  if (
    state.phase !== 'generating-scenes' &&
    state.phase !== 'generating-prompts' &&
    state.activeRequestSequence !== null
  )
    add(
      'UI_STATE_ACTIVE_REQUEST_UNEXPECTED',
      'activeRequestSequence',
      'ملكية طلب نشطة في مرحلة غير متوافقة.',
    );
  if (state.scenes.length > 0) {
    const sceneValidation = validateSceneCollection(state.scenes, state.draft.includeOutputB);
    if (!sceneValidation.ok)
      add(
        sceneValidation.failure.code,
        sceneValidation.failure.field,
        sceneValidation.failure.messageAr,
      );
  }
  if (state.prompts.length > 0) {
    const promptValidation = validatePromptCollection(
      state.prompts,
      state.scenes,
      state.draft.includeOutputB,
    );
    if (!promptValidation.ok)
      add(
        promptValidation.failure.code,
        promptValidation.failure.field,
        promptValidation.failure.messageAr,
      );
  }
  if (
    state.selectedPromptId !== null &&
    !state.prompts.some((p) => p.id === state.selectedPromptId)
  )
    add('UI_STATE_SELECTED_PROMPT_INVALID', 'selectedPromptId', 'المخرج المحدد غير موجود.');
  if (
    state.generatedFingerprint !== null &&
    state.phase === 'prompts-ready' &&
    state.generatedFingerprint !== deterministicFingerprint(state.draft)
  )
    add(
      'UI_STATE_STALE_AS_CURRENT',
      'generatedFingerprint',
      'المخرجات القديمة لا يجوز اعتبارها حالية.',
    );
  return failures;
}

function accept(next: UiState): UiTransitionResult {
  const failures = validateUiStateInvariant(next);
  return failures.length ? { ok: false, failure: failures[0] } : { ok: true, value: next };
}

function inspectTransitionEvent(event: unknown): UiTransitionEvent | null {
  const typeOnly = inspectExactRecord(event, ['type']);
  if (typeOnly.ok && typeof typeOnly.value.type === 'string') {
    const type = typeOnly.value.type;
    if (
      [
        'VALIDATION_STARTED',
        'PROMPT_GENERATION_STARTED',
        'SAVE_STARTED',
        'SAVE_SUCCEEDED',
        'OUTPUTS_CLEARED',
        'FORM_RESET',
        'NEW_SESSION_STARTED',
      ].includes(type)
    )
      return { type } as UiTransitionEvent;
  }
  const candidates: ReadonlyArray<readonly string[]> = [
    ['type', 'draft'],
    ['type', 'fingerprint'],
    ['type', 'failures'],
    ['type', 'requestSequence'],
    ['type', 'requestSequence', 'generationFingerprint', 'scenes'],
    ['type', 'requestSequence', 'generationFingerprint', 'prompts'],
    ['type', 'validatedState'],
  ];
  for (const keys of candidates) {
    const inspected = inspectExactRecord(event, keys);
    if (!inspected.ok || typeof inspected.value.type !== 'string') continue;
    const r = inspected.value;
    switch (r.type) {
      case 'EDIT_STARTED':
        if (keys.length === 2 && 'draft' in r)
          return { type: r.type, draft: r.draft } as UiTransitionEvent;
        break;
      case 'VALIDATION_SUCCEEDED':
        if (typeof r.fingerprint === 'string') return { type: r.type, fingerprint: r.fingerprint };
        break;
      case 'VALIDATION_FAILED':
      case 'GENERATION_FAILED':
      case 'SAVE_FAILED':
        if (Array.isArray(r.failures))
          return { type: r.type, failures: r.failures as readonly UiFailure[] };
        break;
      case 'SCENE_GENERATION_STARTED':
        if (Number.isSafeInteger(r.requestSequence))
          return { type: r.type, requestSequence: r.requestSequence as number };
        break;
      case 'SCENE_GENERATION_SUCCEEDED':
        if (
          Number.isSafeInteger(r.requestSequence) &&
          typeof r.generationFingerprint === 'string' &&
          Array.isArray(r.scenes)
        )
          return {
            type: r.type,
            requestSequence: r.requestSequence as number,
            generationFingerprint: r.generationFingerprint,
            scenes: r.scenes as unknown as ValidatedSceneCollection,
          };
        break;
      case 'PROMPT_GENERATION_SUCCEEDED':
        if (
          Number.isSafeInteger(r.requestSequence) &&
          typeof r.generationFingerprint === 'string' &&
          Array.isArray(r.prompts)
        )
          return {
            type: r.type,
            requestSequence: r.requestSequence as number,
            generationFingerprint: r.generationFingerprint,
            prompts: r.prompts as unknown as ValidatedPromptCollection,
          };
        break;
      case 'SESSION_RESTORED':
        if ('validatedState' in r)
          return { type: r.type, validatedState: r.validatedState as ValidatedRestoredUiState };
        break;
    }
  }
  return null;
}

export function transitionUiState(state: UiState, event: UiTransitionEvent): UiTransitionResult {
  const inspectedEvent = inspectTransitionEvent(event);
  if (!inspectedEvent) return transitionFailure('حدث الانتقال غير صالح أو غير آمن.');
  event = inspectedEvent;
  switch (event.type) {
    case 'EDIT_STARTED':
      return accept({
        ...state,
        phase: 'editing',
        draft: event.draft,
        dirty: true,
        persisted: false,
        failures: [],
      });
    case 'VALIDATION_STARTED':
      if (!['idle', 'editing', 'invalid', 'failure', 'ready'].includes(state.phase))
        return transitionFailure('لا يمكن بدء التحقق من المرحلة الحالية.');
      return accept({ ...state, phase: 'validating', step: 'validation', failures: [] });
    case 'VALIDATION_SUCCEEDED':
      if (state.phase !== 'validating') return transitionFailure('نجاح التحقق غير متوقع.');
      return accept({
        ...state,
        phase: 'ready',
        step: 'planning',
        validatedFingerprint: event.fingerprint,
        failures: [],
      });
    case 'VALIDATION_FAILED':
      if (state.phase !== 'validating') return transitionFailure('فشل التحقق غير متوقع.');
      return accept({
        ...state,
        phase: 'invalid',
        step: 'validation',
        failures: [...event.failures],
        activeRequestSequence: null,
      });
    case 'SCENE_GENERATION_STARTED':
      if (state.phase !== 'ready')
        return transitionFailure('لا يمكن بدء توليد المشاهد قبل الجاهزية.');
      return accept({
        ...state,
        phase: 'generating-scenes',
        step: 'generation',
        requestSequence: event.requestSequence,
        activeRequestSequence: event.requestSequence,
      });
    case 'SCENE_GENERATION_SUCCEEDED':
      if (state.phase !== 'generating-scenes')
        return transitionFailure('نتيجة المشاهد غير متوقعة.');
      if (
        state.activeRequestSequence !== event.requestSequence ||
        state.requestSequence !== event.requestSequence
      )
        return transitionFailure('ملكية طلب المشاهد غير متطابقة.');
      if (
        state.validatedFingerprint !== event.generationFingerprint ||
        deterministicFingerprint(state.draft) !== event.generationFingerprint
      )
        return transitionFailure('بصمة طلب المشاهد غير متطابقة.');
      return accept({
        ...state,
        phase: 'scenes-ready',
        step: 'generation',
        scenes: event.scenes,
        prompts: [],
        selectedPromptId: null,
        generatedFingerprint: event.generationFingerprint,
        activeRequestSequence: null,
        failures: [],
        dirty: true,
        persisted: false,
      });
    case 'PROMPT_GENERATION_STARTED':
      if (state.phase !== 'scenes-ready')
        return transitionFailure('لا يمكن بدء البرومبتات قبل اكتمال المشاهد.');
      return accept({
        ...state,
        phase: 'generating-prompts',
        activeRequestSequence: state.requestSequence,
      });
    case 'PROMPT_GENERATION_SUCCEEDED':
      if (state.phase !== 'generating-prompts')
        return transitionFailure('نتيجة البرومبتات غير متوقعة.');
      if (
        state.activeRequestSequence !== event.requestSequence ||
        state.requestSequence !== event.requestSequence
      )
        return transitionFailure('ملكية طلب البرومبتات غير متطابقة.');
      if (
        state.generatedFingerprint !== event.generationFingerprint ||
        deterministicFingerprint(state.draft) !== event.generationFingerprint
      )
        return transitionFailure('بصمة طلب البرومبتات غير متطابقة.');
      return accept({
        ...state,
        phase: 'prompts-ready',
        step: 'review',
        prompts: event.prompts,
        selectedPromptId: event.prompts[0]?.id ?? null,
        activeRequestSequence: null,
        failures: [],
        dirty: true,
        persisted: false,
      });
    case 'GENERATION_FAILED':
      if (!['generating-scenes', 'generating-prompts'].includes(state.phase))
        return transitionFailure('فشل التوليد غير متوقع.');
      return accept({
        ...state,
        phase: 'invalid',
        step: 'validation',
        failures: [...event.failures],
        activeRequestSequence: null,
      });
    case 'SAVE_STARTED':
      if (state.phase !== 'prompts-ready' || state.dirty === false)
        return transitionFailure('لا يمكن بدء الحفظ الآن.');
      return accept({ ...state, phase: 'save-pending' });
    case 'SAVE_SUCCEEDED':
      if (state.phase !== 'save-pending') return transitionFailure('نجاح الحفظ غير متوقع.');
      return accept({ ...state, phase: 'saved', persisted: true, dirty: false });
    case 'SAVE_FAILED':
      if (state.phase !== 'save-pending') return transitionFailure('فشل الحفظ غير متوقع.');
      return accept({ ...state, phase: 'failure', failures: [...event.failures] });
    case 'OUTPUTS_CLEARED':
      return accept({
        ...state,
        phase: 'editing',
        step: 'generation',
        scenes: [],
        prompts: [],
        selectedPromptId: null,
        generatedFingerprint: null,
        activeRequestSequence: null,
        dirty: true,
        persisted: false,
      });
    case 'FORM_RESET':
    case 'NEW_SESSION_STARTED':
      return { ok: true, value: createInitialUiState() };
    case 'SESSION_RESTORED':
      if (!isValidatedRestoredState(event.validatedState))
        return transitionFailure('الحالة المسترجعة غير موثقة.');
      return accept(structuredClone(event.validatedState));
  }
}

export function updateDraft(state: UiState, patch: Partial<SessionDraft>): UiState {
  const draft = { ...state.draft, ...patch };
  const result = transitionUiState(state, { type: 'EDIT_STARTED', draft });
  return result.ok ? result.value : state;
}
export function withFailures(state: UiState, failures: readonly UiFailure[]): UiState {
  return { ...state, phase: 'invalid', failures: [...failures], activeRequestSequence: null };
}
export function clearGeneratedOutputs(state: UiState): UiState {
  const r = transitionUiState(state, { type: 'OUTPUTS_CLEARED' });
  return r.ok ? r.value : state;
}
export function resetForm(_state: UiState): UiState {
  return createInitialUiState();
}
export function isOutputStale(state: UiState): boolean {
  return (
    state.generatedFingerprint !== null &&
    state.generatedFingerprint !== deterministicFingerprint(state.draft)
  );
}
