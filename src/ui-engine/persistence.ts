import { canonicalStringify } from './canonical';
import { createInitialUiState, transitionUiState, validateUiStateInvariant } from './state';
import { validatePersistedUiState } from './runtime-validation';
import type { PersistencePort, UiFailure, UiState } from './types';
import type { ValidatedRestoredUiState } from './restored-state-brand';

function invalid(messageAr: string): { readonly ok: false; readonly failure: UiFailure } {
  return {
    ok: false,
    failure: {
      code: 'UI_PERSISTED_STATE_INVALID',
      field: 'persistedState',
      messageAr,
      severity: 'blocking',
      source: 'persistence',
    },
  };
}
export function serializeUiState(state: UiState): string {
  const failures = validateUiStateInvariant(state);
  if (failures.length) throw new TypeError(failures[0].messageAr);
  return canonicalStringify(state);
}
export function parseUiState(
  text: string,
): { readonly ok: true; readonly value: ValidatedRestoredUiState } | ReturnType<typeof invalid> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('بيانات الجلسة المحفوظة غير صالحة.');
  }
  return validatePersistedUiState(value);
}
export async function saveUiState(port: PersistencePort, state: UiState): Promise<UiState> {
  const started = transitionUiState(state, { type: 'SAVE_STARTED' });
  if (!started.ok) return { ...state, phase: 'failure', failures: [started.failure] };
  const result = await port.save(serializeUiState(started.value));
  if (!result.ok) {
    const failures = result.failures.map((item) => ({
      code: item.code,
      field: item.field,
      messageAr: item.message,
      severity: 'blocking' as const,
      source: 'persistence' as const,
    }));
    const failed = transitionUiState(started.value, { type: 'SAVE_FAILED', failures });
    return failed.ok ? failed.value : { ...state, phase: 'failure', failures: [failed.failure] };
  }
  const completed = transitionUiState(started.value, { type: 'SAVE_SUCCEEDED' });
  return completed.ok
    ? completed.value
    : { ...state, phase: 'failure', failures: [completed.failure] };
}
export async function restoreUiState(port: PersistencePort): Promise<UiState> {
  const result = await port.load();
  if (!result.ok)
    return {
      ...createInitialUiState(),
      phase: 'failure',
      failures: result.failures.map((item) => ({
        code: item.code,
        field: item.field,
        messageAr: item.message,
        severity: 'blocking' as const,
        source: 'persistence' as const,
      })),
    };
  const parsed = parseUiState(result.value);
  if (!parsed.ok)
    return { ...createInitialUiState(), phase: 'failure', failures: [parsed.failure] };
  const restored = transitionUiState(createInitialUiState(), {
    type: 'SESSION_RESTORED',
    validatedState: parsed.value,
  });
  return restored.ok
    ? restored.value
    : { ...createInitialUiState(), phase: 'failure', failures: [restored.failure] };
}
