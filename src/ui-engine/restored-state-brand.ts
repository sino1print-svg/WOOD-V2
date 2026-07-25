import type { UiState } from './types';

export type ValidatedRestoredUiState = UiState & {
  readonly __validatedRestoredUiState: unique symbol;
};
const validatedStates = new WeakSet<object>();

export function markValidatedRestoredState(state: UiState): ValidatedRestoredUiState {
  validatedStates.add(state);
  return state as ValidatedRestoredUiState;
}
export function isValidatedRestoredState(value: unknown): value is ValidatedRestoredUiState {
  return typeof value === 'object' && value !== null && validatedStates.has(value);
}
