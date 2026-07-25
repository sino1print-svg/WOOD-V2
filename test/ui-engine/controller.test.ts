import { describe, expect, it } from 'vitest';
import { UiController, createInitialUiState } from '../../src/ui-engine';
import { catalog, failure, ports, validDraft } from './fixtures';

describe('Phase 6 engine orchestration', () => {
  it('invokes approved ports in authoritative order', async () => {
    const log: string[] = [];
    const controller = new UiController(ports(log), catalog);
    const result = await controller.generate(createInitialUiState(validDraft()));
    expect(log).toEqual(['validation', 'rule', 'palette', 'print-area', 'scene', 'prompt']);
    expect(result.phase).toBe('prompts-ready');
    expect(result.prompts.map((item) => item.id)).toEqual(['1A', '1B']);
  });

  it('halts at the first failing engine', () => {
    const log: string[] = [];
    const base = ports(log);
    const controller = new UiController(
      {
        ...base,
        validation: {
          validate: () => {
            log.push('validation');
            return { ok: false, failures: [failure()] };
          },
        },
      },
      catalog,
    );
    const result = controller.validate(createInitialUiState(validDraft()));
    expect(log).toEqual(['validation']);
    expect(result.phase).toBe('invalid');
    expect(result.failures[0]?.code).toBe('RULE_TEST_001');
  });

  it('does not invoke domain ports when local validation fails', async () => {
    const log: string[] = [];
    const controller = new UiController(ports(log), catalog);
    const result = await controller.generate(
      createInitialUiState({ ...validDraft(), targetCount: -1 }),
    );
    expect(log).toEqual([]);
    expect(result.phase).toBe('invalid');
  });

  it('preserves an immutable input snapshot', async () => {
    const draft = validDraft();
    const frozen = Object.freeze({
      ...createInitialUiState(Object.freeze(draft)),
      draft: Object.freeze(draft),
    });
    const result = await new UiController(ports(), catalog).generate(frozen);
    expect(result.phase).toBe('prompts-ready');
    expect(frozen.scenes).toEqual([]);
    expect(frozen.prompts).toEqual([]);
  });

  it('is deterministic across repeated controllers and structured clones', async () => {
    const first = await new UiController(ports(), catalog).generate(
      createInitialUiState(validDraft()),
    );
    const second = await new UiController(ports(), catalog).generate(
      structuredClone(createInitialUiState(validDraft())),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('blocks rapid duplicate generation on the same controller', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const base = ports();
    const controller = new UiController(
      {
        ...base,
        scene: {
          generate: async () => {
            calls += 1;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return { ok: true, value: [] };
          },
        },
      },
      catalog,
    );
    const state = createInitialUiState(validDraft());
    const first = controller.generate(state);
    const second = await controller.generate(state);
    expect(second).toBe(state);
    expect(calls).toBe(1);
    release?.();
    await first;
  });
});
