import { describe, expect, it } from 'vitest';
import { UiController, createInitialUiState, type GenerationOwnership } from '../../src/ui-engine';
import type { UiEnginePorts, UiState } from '../../src/ui-engine/types';
import { catalog, ports, validDraft } from './fixtures';

interface StateBox {
  current: UiState;
}

type RuntimePublication = (next: UiState, call: number, box: StateBox) => unknown;
type RuntimeRead = (current: UiState, call: number) => unknown;

interface HarnessOptions {
  readonly publishPending?: RuntimePublication;
  readonly publishFailure?: RuntimePublication;
  readonly getCurrentState?: RuntimeRead;
}

interface Harness {
  readonly controller: UiController;
  readonly box: StateBox;
  readonly ownership: GenerationOwnership;
  readonly calls: {
    pending: number;
    failure: number;
    current: number;
    scene: number;
    prompt: number;
  };
}

function validOwnership(box: StateBox): GenerationOwnership {
  return {
    getCurrentState: () => box.current,
    publishPending: (next) => {
      box.current = next;
    },
    publishFailure: (next) => {
      box.current = next;
    },
  };
}

function createHarness(options: HarnessOptions = {}): Harness {
  const box: StateBox = { current: createInitialUiState(validDraft()) };
  const calls = { pending: 0, failure: 0, current: 0, scene: 0, prompt: 0 };
  const base = ports();
  const guardedPorts: UiEnginePorts = {
    ...base,
    scene: {
      generate: (plan) => {
        calls.scene += 1;
        return base.scene.generate(plan);
      },
    },
    prompt: {
      generate: (scenes, plan) => {
        calls.prompt += 1;
        return base.prompt.generate(scenes, plan);
      },
    },
  };
  const ownership: GenerationOwnership = {
    getCurrentState: () => {
      calls.current += 1;
      return (
        options.getCurrentState ? options.getCurrentState(box.current, calls.current) : box.current
      ) as UiState;
    },
    publishPending: (next) => {
      calls.pending += 1;
      if (!options.publishPending) {
        box.current = next;
        return undefined;
      }
      return options.publishPending(next, calls.pending, box) as void | Promise<void>;
    },
    publishFailure: (next) => {
      calls.failure += 1;
      if (!options.publishFailure) {
        box.current = next;
        return undefined;
      }
      return options.publishFailure(next, calls.failure, box) as void | Promise<void>;
    },
  };
  return {
    controller: new UiController(guardedPorts, catalog),
    box,
    ownership,
    calls,
  };
}

function expectOwnershipFailure(result: UiState, field = 'ownership.publishPending'): void {
  expect(result.phase).toBe('invalid');
  expect(result.step).toBe('validation');
  expect(result.activeRequestSequence).toBeNull();
  expect(result.persisted).toBe(false);
  expect(result.prompts).toEqual([]);
  expect(result.failures).toEqual([
    expect.objectContaining({
      code: 'UI_GENERATION_OWNERSHIP_INVALID',
      field,
      severity: 'blocking',
      source: 'ui',
    }),
  ]);
}

async function expectLaterValidRequest(controller: UiController): Promise<void> {
  const later: StateBox = { current: createInitialUiState(validDraft()) };
  const result = await controller.generate(later.current, validOwnership(later));
  expect(result.phase).toBe('prompts-ready');
}

describe('Phase 6 Eleventh Corrective — atomic ownership reconciliation', () => {
  it.each([
    ['initial synchronous throw', 1, false, 'throw'],
    ['second synchronous throw', 2, false, 'throw'],
    ['initial mutate-then-throw', 1, true, 'throw'],
    ['second mutate-then-throw', 2, true, 'throw'],
    ['initial asynchronous rejection', 1, false, 'reject'],
    ['second asynchronous rejection', 2, false, 'reject'],
    ['initial mutate-then-reject', 1, true, 'reject'],
    ['second mutate-then-reject', 2, true, 'reject'],
  ] as const)(
    'reconciles %s and retries from authoritative current',
    async (_name, target, mutate, kind) => {
      const harness = createHarness({
        publishPending: (next, call, box) => {
          if (call !== target) {
            box.current = next;
            return undefined;
          }
          if (mutate) box.current = next;
          if (kind === 'throw') throw new Error('hostile synchronous publication');
          return Promise.reject(new Error('hostile asynchronous publication'));
        },
      });

      const result = await harness.controller.generate(harness.box.current, harness.ownership);

      expectOwnershipFailure(result);
      expect(harness.calls.failure).toBe(1);
      expect(harness.box.current).toEqual(result);
      expect(harness.calls.scene).toBe(target === 1 ? 0 : 1);
      expect(harness.calls.prompt).toBe(0);

      const retry = await harness.controller.generate(
        harness.box.current,
        validOwnership(harness.box),
      );
      expect(retry.phase).toBe('prompts-ready');
    },
  );

  it.each([
    ['synchronous undefined', undefined],
    ['resolved Promise<void>', Promise.resolve()],
  ] as const)('accepts %s from both publication callbacks', async (_name, returned) => {
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        return returned;
      },
      publishFailure: (next, _call, box) => {
        box.current = next;
        return returned;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expect(result.phase).toBe('prompts-ready');
    expect(harness.calls.failure).toBe(0);
    expect(harness.calls.scene).toBe(1);
    expect(harness.calls.prompt).toBe(1);
  });

  it('waits for delayed pending publication before calling ScenePort', async () => {
    let release!: () => void;
    let first = true;
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        if (!first) return undefined;
        first = false;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    const pending = harness.controller.generate(harness.box.current, harness.ownership);
    await Promise.resolve();
    expect(harness.calls.scene).toBe(0);
    release();
    const result = await pending;

    expect(result.phase).toBe('prompts-ready');
    expect(harness.calls.scene).toBe(1);
  });

  it('waits for delayed pending rejection, then reconciles without continuation', async () => {
    let reject!: (reason: unknown) => void;
    const harness = createHarness({
      publishPending: (next, call, box) => {
        box.current = next;
        if (call !== 1) return undefined;
        return new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        });
      },
    });

    const pending = harness.controller.generate(harness.box.current, harness.ownership);
    await Promise.resolve();
    expect(harness.calls.scene).toBe(0);
    expect(harness.calls.prompt).toBe(0);
    reject(new Error('delayed ownership rejection'));

    const result = await pending;
    expectOwnershipFailure(result);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
    expect(harness.calls.prompt).toBe(0);
    expect(harness.box.current).toEqual(result);

    const retry = await harness.controller.generate(
      harness.box.current,
      validOwnership(harness.box),
    );
    expect(retry.phase).toBe('prompts-ready');
  });

  it.each([
    ['null', null],
    ['boolean', true],
    ['number', 1],
    ['empty string', ''],
    ['non-empty string', 'completed'],
    ['plain object', {}],
    ['array', []],
    ['symbol', Symbol('invalid')],
    ['bigint', BigInt(1)],
    ['Promise with non-void fulfillment', Promise.resolve(1)],
  ] as const)('rejects malformed publishPending return: %s', async (_name, returned) => {
    const harness = createHarness({
      publishPending: (next, call, box) => {
        box.current = next;
        return call === 1 ? returned : undefined;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
    expect(harness.calls.prompt).toBe(0);
  });

  it('rejects a throwing then getter without executing ScenePort', async () => {
    const hostile = Object.defineProperty({}, 'then', {
      configurable: true,
      get() {
        throw new Error('hostile then accessor');
      },
    });
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        return hostile;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.scene).toBe(0);
  });

  it('rejects a then function that throws', async () => {
    const hostile = {
      then() {
        throw new Error('hostile then function');
      },
    };
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        return hostile;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.scene).toBe(0);
  });

  it('uses deterministic first settlement when a thenable resolves then throws', async () => {
    const thenable = {
      then(resolve: (value: undefined) => void) {
        resolve(undefined);
        throw new Error('ignored after resolution');
      },
    };
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        return thenable;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expect(result.phase).toBe('prompts-ready');
    expect(harness.calls.failure).toBe(0);
  });

  it('uses deterministic first settlement when a thenable rejects then resolves', async () => {
    const thenable = {
      then(resolve: (value: undefined) => void, reject: (reason: unknown) => void) {
        reject(new Error('first settlement rejects'));
        resolve(undefined);
      },
    };
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        return thenable;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.scene).toBe(0);
  });

  const failedPublishFailureCases: ReadonlyArray<readonly [string, () => unknown]> = [
    [
      'synchronous throw',
      () => {
        throw new Error('failure publication throws');
      },
    ],
    ['rejected Promise', () => Promise.reject(new Error('failure publication rejects'))],
    ['malformed numeric return', () => 1],
    ['malformed null return', () => null],
    ['malformed object return', () => ({})],
    ['malformed array return', () => []],
    ['Promise with non-void fulfillment', () => Promise.resolve(1)],
    [
      'hostile thenable',
      () =>
        Object.defineProperty({}, 'then', {
          get() {
            throw new Error('failure then accessor');
          },
        }),
    ],
  ];

  it.each(failedPublishFailureCases)(
    'fails closed when publishFailure has a %s',
    async (_name, failureBehavior) => {
      const harness = createHarness({
        publishPending: (next, _call, box) => {
          box.current = next;
          throw new Error('primary pending failure');
        },
        publishFailure: () => failureBehavior(),
      });

      const result = await harness.controller.generate(harness.box.current, harness.ownership);

      expectOwnershipFailure(result, 'ownership.publishPending');
      expect(harness.calls.failure).toBe(1);
      expect(harness.box.current.phase).toBe('generating-scenes');
      expect(harness.calls.scene).toBe(0);
      expect(harness.calls.prompt).toBe(0);
      await expectLaterValidRequest(harness.controller);
    },
  );

  it('awaits a resolved publishFailure Promise and verifies authoritative reconciliation', async () => {
    const harness = createHarness({
      publishPending: () => {
        throw new Error('primary pending failure');
      },
      publishFailure: (next, _call, box) => {
        box.current = next;
        return Promise.resolve();
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.failure).toBe(1);
    expect(harness.box.current).toEqual(result);
    const retry = await harness.controller.generate(
      harness.box.current,
      validOwnership(harness.box),
    );
    expect(retry.phase).toBe('prompts-ready');
  });

  it('waits for delayed publishFailure settlement before returning', async () => {
    let release!: () => void;
    let settled = false;
    const harness = createHarness({
      publishPending: () => {
        throw new Error('primary pending failure');
      },
      publishFailure: (next, _call, box) => {
        box.current = next;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    const pending = harness.controller
      .generate(harness.box.current, harness.ownership)
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.calls.failure).toBe(1);
    release();

    const result = await pending;
    expectOwnershipFailure(result);
    expect(settled).toBe(true);
  });

  it('protects publishFailure property access and preserves the Primary Failure', async () => {
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        throw new Error('primary pending failure');
      },
    });
    let reads = 0;
    Object.defineProperty(harness.ownership, 'publishFailure', {
      configurable: true,
      get() {
        reads += 1;
        throw new Error('hostile publishFailure accessor');
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(reads).toBe(1);
    expect(harness.calls.failure).toBe(0);
    await expectLaterValidRequest(harness.controller);
  });

  it('rejects a non-callable publishFailure without replacing the Primary Failure', async () => {
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        throw new Error('primary pending failure');
      },
    });
    Object.defineProperty(harness.ownership, 'publishFailure', {
      configurable: true,
      value: 1,
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(harness.calls.failure).toBe(0);
    expect(harness.box.current.phase).toBe('generating-scenes');
    await expectLaterValidRequest(harness.controller);
  });

  it('does not claim reconciliation when getCurrentState fails after publishFailure', async () => {
    const harness = createHarness({
      publishPending: () => {
        throw new Error('primary pending failure');
      },
      getCurrentState: () => {
        throw new Error('verification failed');
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.current).toBe(1);
    await expectLaterValidRequest(harness.controller);
  });

  it('does not claim reconciliation when authoritative failure state mismatches', async () => {
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        box.current = next;
        throw new Error('primary pending failure');
      },
      publishFailure: () => undefined,
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(harness.calls.failure).toBe(1);
    expect(harness.box.current.phase).toBe('generating-scenes');
    await expectLaterValidRequest(harness.controller);
  });

  it('detects a successful callback that did not publish the expected state', async () => {
    const harness = createHarness({
      publishPending: () => undefined,
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
    expect(harness.box.current).toEqual(result);
  });

  it('verifies the second pending publication before executing PromptPort', async () => {
    const harness = createHarness({
      publishPending: (next, call, box) => {
        if (call === 1) box.current = next;
        return undefined;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.publishPending');
    expect(harness.calls.pending).toBe(2);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(1);
    expect(harness.calls.prompt).toBe(0);
    expect(harness.box.current).toEqual(result);
  });

  it('protects initial publishPending property access and reconciles once', async () => {
    const harness = createHarness();
    let reads = 0;
    Object.defineProperty(harness.ownership, 'publishPending', {
      configurable: true,
      get() {
        reads += 1;
        throw new Error('hostile pending accessor');
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(reads).toBe(1);
    expect(harness.calls.pending).toBe(0);
    expect(harness.calls.failure).toBe(1);
    expect(harness.box.current).toEqual(result);
  });

  it('protects changing publishPending property access on the second publication', async () => {
    const harness = createHarness();
    let reads = 0;
    Object.defineProperty(harness.ownership, 'publishPending', {
      configurable: true,
      get() {
        reads += 1;
        if (reads === 1)
          return (next: UiState) => {
            harness.box.current = next;
          };
        throw new Error('hostile second pending accessor');
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(reads).toBe(2);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(1);
    expect(harness.calls.prompt).toBe(0);
    expect(harness.box.current).toEqual(result);
  });

  it('rejects a non-callable initial publishPending and reconciles once', async () => {
    const harness = createHarness();
    Object.defineProperty(harness.ownership, 'publishPending', {
      configurable: true,
      value: null,
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result);
    expect(harness.calls.pending).toBe(0);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
  });

  it('protects getCurrentState property access during post-publication verification', async () => {
    const harness = createHarness();
    let reads = 0;
    Object.defineProperty(harness.ownership, 'getCurrentState', {
      configurable: true,
      get() {
        reads += 1;
        throw new Error('hostile current-state accessor');
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    expect(reads).toBe(2);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
  });

  it('attributes malformed getCurrentState to the read boundary and fails closed', async () => {
    const harness = createHarness({
      getCurrentState: () => null,
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(0);
  });

  it('fails closed when getCurrentState fails after PromptPort and reconciles once', async () => {
    const harness = createHarness({
      getCurrentState: (current, call) => {
        if (call === 4) throw new Error('post-prompt authoritative read failed');
        return current;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expectOwnershipFailure(result, 'ownership.getCurrentState');
    expect(harness.calls.pending).toBe(2);
    expect(harness.calls.failure).toBe(1);
    expect(harness.calls.scene).toBe(1);
    expect(harness.calls.prompt).toBe(1);
    expect(harness.box.current).toEqual(result);
    expect(result.prompts).toEqual([]);

    const retry = await harness.controller.generate(
      harness.box.current,
      validOwnership(harness.box),
    );
    expect(retry.phase).toBe('prompts-ready');
  });

  it('consumes a rejected Promise returned by getCurrentState and fails closed', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const harness = createHarness({
        getCurrentState: () => Promise.reject(new Error('invalid asynchronous state')),
      });

      const result = await harness.controller.generate(harness.box.current, harness.ownership);
      await Promise.resolve();
      await Promise.resolve();

      expectOwnershipFailure(result, 'ownership.getCurrentState');
      expect(harness.calls.failure).toBe(1);
      expect(harness.calls.scene).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('passes immutable controller-owned states to both publication callbacks', async () => {
    const observed: UiState[] = [];
    const harness = createHarness({
      publishPending: (next, _call, box) => {
        observed.push(next);
        box.current = next;
        return undefined;
      },
    });

    const result = await harness.controller.generate(harness.box.current, harness.ownership);

    expect(result.phase).toBe('prompts-ready');
    expect(observed).toHaveLength(2);
    for (const state of observed) {
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.draft)).toBe(true);
      expect(Object.isFrozen(state.draft.products)).toBe(true);
      expect(Object.isFrozen(state.failures)).toBe(true);
    }
  });

  it('consumes rejected publication Promises without unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const harness = createHarness({
        publishPending: (next, _call, box) => {
          box.current = next;
          return Promise.reject(new Error('must be consumed by controller'));
        },
      });

      const result = await harness.controller.generate(harness.box.current, harness.ownership);
      await Promise.resolve();
      await Promise.resolve();

      expectOwnershipFailure(result);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
