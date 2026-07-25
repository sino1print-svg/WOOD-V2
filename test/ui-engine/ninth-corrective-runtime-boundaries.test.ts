import { describe, expect, it } from 'vitest';
import { UiController } from '../../src/ui-engine/controller';
import { createInitialUiState, transitionUiState } from '../../src/ui-engine/state';
import { validateSceneCollection } from '../../src/ui-engine/generated-validation';
import type { UiTransitionEvent } from '../../src/ui-engine/state';
import { catalog, ports, scene, validDraft } from './fixtures';

describe('Phase 6 Ninth Corrective reconstructed hostile-runtime boundaries', () => {
  it('rejects non-enumerable authoritative Scene fields instead of normalizing them', () => {
    const candidate = structuredClone(scene) as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, 'sceneHash', {
      value: candidate.sceneHash,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });

  it('rejects hostile transition-event proxies with a typed failure', () => {
    const state = createInitialUiState(validDraft());
    const hostile = new Proxy(
      { type: 'VALIDATION_STARTED' },
      {
        ownKeys() {
          throw new Error('hostile ownKeys');
        },
      },
    ) as UiTransitionEvent;
    const result = transitionUiState(state, hostile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('UI_TRANSITION_INVALID');
    expect(state.phase).toBe('idle');
  });

  it('does not execute accessor-backed transition event fields', () => {
    const state = createInitialUiState(validDraft());
    let reads = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, 'type', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 'VALIDATION_STARTED';
      },
    });
    const result = transitionUiState(state, hostile as UiTransitionEvent);
    expect(result.ok).toBe(false);
    expect(reads).toBe(0);
  });

  it('converts hostile controller input into a deterministic typed state and recovers', async () => {
    const controller = new UiController(ports(), catalog);
    const hostile = new Proxy(createInitialUiState(validDraft()), {
      ownKeys() {
        throw new Error('hostile state');
      },
    });
    const failed = await controller.generate(hostile);
    expect(failed.phase).toBe('invalid');
    expect(failed.failures[0]?.code).toBe('UI_RUNTIME_INPUT_INVALID');

    const recovered = await controller.generate(createInitialUiState(validDraft()));
    expect(recovered.phase).toBe('prompts-ready');
  });
});
