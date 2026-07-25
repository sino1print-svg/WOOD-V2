import { describe, expect, it } from 'vitest';
import {
  createInitialUiState,
  deterministicFingerprint,
  transitionUiState,
} from '../../src/ui-engine';
import { validDraft } from './fixtures';

describe('Phase 6 first corrective transition matrix', () => {
  it('does not export an unrestricted setStep API', async () => {
    const api = await import('../../src/ui-engine');
    expect('setStep' in api).toBe(false);
  });
  it('rejects idle to review/prompts-ready equivalents', () => {
    const state = createInitialUiState(validDraft());
    expect(transitionUiState(state, { type: 'PROMPT_GENERATION_STARTED' }).ok).toBe(false);
    expect(transitionUiState(state, { type: 'SAVE_SUCCEEDED' }).ok).toBe(false);
  });
  it('rejects invalid to generation', () => {
    const state = { ...createInitialUiState(validDraft()), phase: 'invalid' as const };
    expect(
      transitionUiState(state, { type: 'SCENE_GENERATION_STARTED', requestSequence: 1 }).ok,
    ).toBe(false);
  });
  it('rejects generating scenes directly to prompts-ready', () => {
    const fp = deterministicFingerprint(validDraft());
    const state = {
      ...createInitialUiState(validDraft()),
      phase: 'generating-scenes' as const,
      step: 'generation' as const,
      validatedFingerprint: fp,
      requestSequence: 1,
      activeRequestSequence: 1,
    };
    expect(transitionUiState(state, { type: 'PROMPT_GENERATION_STARTED' }).ok).toBe(false);
  });
  it('rejects scenes-ready to saved and saved while dirty', () => {
    const fp = deterministicFingerprint(validDraft());
    const state = {
      ...createInitialUiState(validDraft()),
      phase: 'scenes-ready' as const,
      step: 'generation' as const,
      validatedFingerprint: fp,
      generatedFingerprint: fp,
    };
    expect(transitionUiState(state, { type: 'SAVE_SUCCEEDED' }).ok).toBe(false);
  });
});
