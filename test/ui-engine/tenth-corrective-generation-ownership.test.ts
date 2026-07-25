import { describe, expect, it } from 'vitest';
import { UiController, createInitialUiState, type GenerationOwnership } from '../../src/ui-engine';
import type { UiEnginePorts, UiState } from '../../src/ui-engine/types';
import { catalog, ports, validDraft } from './fixtures';

async function expectRecovery(controller: UiController): Promise<void> {
  const recovered = await controller.generate(createInitialUiState(validDraft()));
  expect(recovered.phase).toBe('prompts-ready');
}

function expectOwnershipFailure(result: UiState, field: string): void {
  expect(result.phase).toBe('invalid');
  expect(result.step).toBe('validation');
  expect(result.activeRequestSequence).toBeNull();
  expect(result.failures).toEqual([
    expect.objectContaining({
      code: 'UI_GENERATION_OWNERSHIP_INVALID',
      field,
      severity: 'blocking',
      source: 'ui',
    }),
  ]);
}

describe('Phase 6 Tenth Corrective — GenerationOwnership boundary', () => {
  it('converts a throwing initial publishPending into a typed failure and recovers', async () => {
    let sceneCalls = 0;
    const base = ports();
    const controller = new UiController(
      {
        ...base,
        scene: {
          generate: (plan) => {
            sceneCalls += 1;
            return base.scene.generate(plan);
          },
        },
      },
      catalog,
    );
    const current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () => current,
      publishPending: () => {
        throw new Error('hostile initial publishPending');
      },
      publishFailure: () => undefined,
    };

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(sceneCalls).toBe(0);
    await expectRecovery(controller);
  });

  it('guards hostile publishPending property access and recovers', async () => {
    const controller = new UiController(ports(), catalog);
    const current = createInitialUiState(validDraft());
    let propertyReads = 0;
    const ownership = {
      getCurrentState: () => current,
      publishFailure: () => undefined,
    } as unknown as GenerationOwnership;
    Object.defineProperty(ownership, 'publishPending', {
      enumerable: true,
      configurable: true,
      get() {
        propertyReads += 1;
        throw new Error('hostile publishPending accessor');
      },
    });

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(propertyReads).toBe(1);
    await expectRecovery(controller);
  });

  it('converts a throwing getCurrentState into a typed failure and recovers', async () => {
    const controller = new UiController(ports(), catalog);
    let current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () => {
        throw new Error('hostile getCurrentState');
      },
      publishPending: (next) => {
        current = next;
      },
      publishFailure: () => undefined,
    };

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    await expectRecovery(controller);
  });

  it('rejects an accessor-backed state returned by getCurrentState without executing it', async () => {
    const controller = new UiController(ports(), catalog);
    let current = createInitialUiState(validDraft());
    let phaseReads = 0;
    const ownership: GenerationOwnership = {
      getCurrentState: () => {
        const hostile = structuredClone(current) as unknown as Record<string, unknown>;
        Object.defineProperty(hostile, 'phase', {
          enumerable: true,
          configurable: true,
          get() {
            phaseReads += 1;
            throw new Error('hostile phase accessor');
          },
        });
        return hostile as unknown as UiState;
      },
      publishPending: (next) => {
        current = next;
      },
      publishFailure: () => undefined,
    };

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    expect(phaseReads).toBe(0);
    await expectRecovery(controller);
  });

  it('rejects a hostile Proxy returned by getCurrentState and recovers', async () => {
    const controller = new UiController(ports(), catalog);
    let current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () =>
        new Proxy(current, {
          ownKeys() {
            throw new Error('hostile current-state Proxy');
          },
        }),
      publishPending: (next) => {
        current = next;
      },
      publishFailure: () => undefined,
    };

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    await expectRecovery(controller);
  });

  it('converts a throwing second publishPending before PromptPort and recovers', async () => {
    let promptCalls = 0;
    const base = ports();
    const guardedPorts: UiEnginePorts = {
      ...base,
      prompt: {
        generate: (scenes, plan) => {
          promptCalls += 1;
          return base.prompt.generate(scenes, plan);
        },
      },
    };
    const controller = new UiController(guardedPorts, catalog);
    let current = createInitialUiState(validDraft());
    let publications = 0;
    const ownership: GenerationOwnership = {
      getCurrentState: () => current,
      publishPending: (next) => {
        publications += 1;
        if (publications === 2) throw new Error('hostile second publishPending');
        current = next;
      },
      publishFailure: () => undefined,
    };

    const result = await controller.generate(current, ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(publications).toBe(2);
    expect(promptCalls).toBe(0);
    await expectRecovery(controller);
    expect(promptCalls).toBe(1);
  });
});
