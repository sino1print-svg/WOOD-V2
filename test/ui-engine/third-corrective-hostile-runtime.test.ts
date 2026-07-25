import { describe, expect, it, vi } from 'vitest';
import { UiController } from '../../src/ui-engine/controller';
import {
  validatePromptCollection,
  validateSceneCollection,
} from '../../src/ui-engine/generated-validation';
import { createInitialUiState } from '../../src/ui-engine/state';
import type { UiEnginePorts } from '../../src/ui-engine/types';
import { catalog, ports, prompts, scene, validDraft } from './fixtures';

function cloneScene(): Record<string, unknown> {
  return structuredClone(scene) as unknown as Record<string, unknown>;
}
function clonePrompts(): Record<string, unknown>[] {
  return structuredClone(prompts) as unknown as Record<string, unknown>[];
}
function path(root: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  let current = root;
  for (const key of keys) current = current[key] as Record<string, unknown>;
  return current;
}
function addSymbol(root: Record<string, unknown>, keys: readonly string[]): unknown {
  const target = path(root, keys);
  Reflect.set(target, Symbol('hidden'), 'forged');
  return root;
}

const sceneSymbolPaths: readonly (readonly string[])[] = [
  [],
  ['dedupSignature'],
  ['outputA'],
  ['outputB'],
];
const sceneArraySymbolPaths: readonly string[] = ['decorIds', 'propIds'];

describe('Phase 6 Third Corrective — symbol and hidden-key rejection', () => {
  it.each(sceneSymbolPaths.map((keys) => [keys] as const))('rejects Scene symbol at %j', (keys) => {
    expect(validateSceneCollection([addSymbol(cloneScene(), keys)], true).ok).toBe(false);
  });
  it.each(sceneArraySymbolPaths)('rejects symbol metadata on Scene array %s', (key) => {
    const candidate = cloneScene();
    Reflect.set(candidate[key] as object, Symbol('hidden'), true);
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });
  it('rejects symbol metadata on the Scene collection', () => {
    const values = [cloneScene()];
    Reflect.set(values, Symbol('hidden'), true);
    expect(validateSceneCollection(values, true).ok).toBe(false);
  });
  it.each(Array.from({ length: 20 }, (_, index) => index))(
    'rejects distinct Scene symbol identity %i',
    (index) => {
      const candidate = cloneScene();
      Reflect.set(candidate, Symbol(`hidden-${index}`), index);
      expect(validateSceneCollection([candidate], true).ok).toBe(false);
    },
  );
  it.each(Array.from({ length: 15 }, (_, index) => index))(
    'rejects distinct Prompt symbol identity %i',
    (index) => {
      const candidate = clonePrompts();
      Reflect.set(candidate[index % candidate.length], Symbol(`hidden-${index}`), index);
      expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
    },
  );
  it('rejects symbol metadata on Prompt collection', () => {
    const candidate = clonePrompts();
    Reflect.set(candidate, Symbol('hidden'), true);
    expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
  });
  it.each([
    ['scene top', [], 'hidden'],
    ['dedup nested', ['dedupSignature'], 'hidden'],
    ['output A nested', ['outputA'], 'hidden'],
    ['output B nested', ['outputB'], 'hidden'],
  ] as const)('rejects non-enumerable extra field: %s', (_name, keys, field) => {
    const candidate = cloneScene();
    Object.defineProperty(path(candidate, keys), field, { value: true, enumerable: false });
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });
  it('rejects hidden metadata on arrays', () => {
    const candidate = cloneScene();
    Object.defineProperty(candidate.decorIds as object, 'hidden', {
      value: true,
      enumerable: false,
    });
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });
});

const sceneAccessorCases = [
  ['id', []],
  ['sceneHash', []],
  ['sceneVersion', []],
  ['sceneTemplateId', ['dedupSignature']],
  ['hash', ['dedupSignature']],
  ['id', ['outputA']],
  ['promptHash', ['outputA']],
  ['sourceOutputAId', ['outputB']],
  ['sourceHash', ['outputB']],
  ['contentHash', ['outputB']],
  ['paletteColorId', []],
  ['view', []],
  ['printAreaRulesRef', []],
  ['displayMethod', []],
  ['outputA', []],
] as const;
const promptAccessorCases = [
  'id',
  'sceneId',
  'kind',
  'sourceOutputAId',
  'sourceHash',
  'sourceContentHash',
  'artworkId',
  'promptText',
  'promptHash',
  'productId',
] as const;

describe('descriptor-aware validation', () => {
  it.each(sceneAccessorCases)(
    'rejects Scene accessor %s at %j without execution',
    (field, keys) => {
      const candidate = cloneScene();
      const target = path(candidate, keys);
      const original = target[field];
      let reads = 0;
      Object.defineProperty(target, field, {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1;
          return original;
        },
      });
      expect(validateSceneCollection([candidate], true).ok).toBe(false);
      expect(reads).toBe(0);
    },
  );
  it.each(promptAccessorCases)('rejects Prompt accessor %s without execution', (field) => {
    const candidate = clonePrompts();
    const original = candidate[0][field];
    let reads = 0;
    Object.defineProperty(candidate[0], field, {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return original;
      },
    });
    expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
    expect(reads).toBe(0);
  });
  it('rejects a throwing getter without invoking it', () => {
    const candidate = cloneScene();
    let reads = 0;
    Object.defineProperty(candidate, 'sceneHash', {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error('must not run');
      },
    });
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
    expect(reads).toBe(0);
  });
  it('rejects setter-only and getter/setter fields', () => {
    for (const descriptor of [
      { set(_value: unknown) {} },
      {
        get() {
          return 'scene-hash';
        },
        set(_value: unknown) {},
      },
    ]) {
      const candidate = cloneScene();
      Object.defineProperty(candidate, 'sceneHash', {
        enumerable: true,
        configurable: true,
        ...descriptor,
      });
      expect(validateSceneCollection([candidate], true).ok).toBe(false);
    }
  });
  it('rejects an accessor-backed array index without execution', () => {
    const candidate = cloneScene();
    candidate.decorIds = ['decor'];
    let reads = 0;
    Object.defineProperty(candidate.decorIds as object, '0', {
      enumerable: true,
      get() {
        reads += 1;
        return 'decor';
      },
    });
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
    expect(reads).toBe(0);
  });
});

describe('inheritance and canonical arrays', () => {
  it.each([
    'Scene class instance',
    'Scene modified prototype',
    'Scene null prototype with inherited requirement',
    'boxed primitive',
    'Prompt class instance',
  ])('%s is rejected', (name) => {
    if (name === 'Prompt class instance') {
      class PromptRecord {
        constructor(source: object) {
          Object.assign(this, source);
        }
      }
      const candidate = clonePrompts();
      candidate[0] = new PromptRecord(candidate[0]) as unknown as Record<string, unknown>;
      expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
      return;
    }
    if (name === 'boxed primitive') {
      expect(validateSceneCollection([new String('scene')], true).ok).toBe(false);
      return;
    }
    const candidate = cloneScene();
    if (name === 'Scene class instance') {
      class SceneRecord {
        constructor(source: object) {
          Object.assign(this, source);
        }
      }
      expect(validateSceneCollection([new SceneRecord(candidate)], true).ok).toBe(false);
    } else if (name === 'Scene modified prototype') {
      Object.setPrototypeOf(candidate, { inherited: true });
      expect(validateSceneCollection([candidate], true).ok).toBe(false);
    } else {
      const proto = { id: candidate.id };
      delete candidate.id;
      Object.setPrototypeOf(candidate, proto);
      expect(validateSceneCollection([candidate], true).ok).toBe(false);
    }
  });
  it.each([
    ['sparse Scene collection', () => new Array(1)],
    ['extra Scene array property', () => Object.assign([cloneScene()], { extra: true })],
    [
      'subclassed Scene array',
      () => {
        class Scenes extends Array<unknown> {}
        return new Scenes(cloneScene());
      },
    ],
    [
      'accessor Scene index',
      () => {
        const a = [cloneScene()];
        Object.defineProperty(a, '0', { enumerable: true, get: () => cloneScene() });
        return a;
      },
    ],
    [
      'deleted Prompt index',
      () => {
        const a = clonePrompts();
        delete a[0];
        return a;
      },
    ],
  ] as const)('rejects hostile array: %s', (_name, make) => {
    const candidate = make();
    const result = _name.includes('Prompt')
      ? validatePromptCollection(candidate, [scene], true)
      : validateSceneCollection(candidate, true);
    expect(result.ok).toBe(false);
  });
});

function throwingProxy<T extends object>(
  target: T,
  trap: 'getPrototypeOf' | 'ownKeys' | 'getOwnPropertyDescriptor',
): T {
  return new Proxy(target, {
    [trap]() {
      throw new Error(`hostile ${trap}`);
    },
  } as ProxyHandler<T>);
}

describe('hostile Proxy fail-closed behavior', () => {
  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'rejects Scene proxy throwing from %s',
    (trap) => {
      expect(validateSceneCollection([throwingProxy(cloneScene(), trap)], true).ok).toBe(false);
    },
  );
  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'rejects Prompt proxy throwing from %s',
    (trap) => {
      const candidate = clonePrompts();
      candidate[0] = throwingProxy(candidate[0], trap);
      expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
    },
  );
  it('rejects nested Output A proxy', () => {
    const candidate = cloneScene();
    candidate.outputA = throwingProxy(candidate.outputA as object, 'ownKeys');
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });
  it('rejects nested Output B proxy', () => {
    const candidate = cloneScene();
    candidate.outputB = throwingProxy(candidate.outputB as object, 'getOwnPropertyDescriptor');
    expect(validateSceneCollection([candidate], true).ok).toBe(false);
  });
  it('rejects Proxy array', () => {
    expect(validateSceneCollection(throwingProxy([cloneScene()], 'ownKeys'), true).ok).toBe(false);
  });
});

describe('ownership and controller exception conversion', () => {
  it('owns and deeply freezes accepted collections', () => {
    const external = [cloneScene()];
    const result = validateSceneCollection(external, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(external);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value[0])).toBe(true);
    external[0].sceneHash = 'mutated';
    expect(result.value[0].sceneHash).toBe('scene-hash');
  });
  it.each([
    'scene clone failure',
    'prompt clone failure',
    'scene hidden symbol before clone',
    'prompt hidden symbol before clone',
    'frozen valid input',
  ] as const)('%s', (name) => {
    if (name === 'frozen valid input') {
      expect(validateSceneCollection(Object.freeze([scene]), true).ok).toBe(true);
      return;
    }
    if (name.includes('hidden symbol')) {
      if (name.startsWith('scene')) {
        const candidate = cloneScene();
        Reflect.set(candidate, Symbol('hidden'), true);
        expect(validateSceneCollection([candidate], true).ok).toBe(false);
      } else {
        const candidate = clonePrompts();
        Reflect.set(candidate[0], Symbol('hidden'), true);
        expect(validatePromptCollection(candidate, [scene], true).ok).toBe(false);
      }
      return;
    }
    const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    const result = name.startsWith('scene')
      ? validateSceneCollection([scene], true)
      : validatePromptCollection(prompts, [scene], true);
    expect(result.ok).toBe(false);
    spy.mockRestore();
  });

  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'controller converts hostile Scene %s into typed state',
    async (trap) => {
      let promptCalled = false;
      const hostilePorts: UiEnginePorts = {
        ...ports(),
        scene: {
          generate: () => ({ ok: true, value: [throwingProxy(cloneScene(), trap)] as never }),
        },
        prompt: {
          generate: () => {
            promptCalled = true;
            return { ok: true, value: prompts };
          },
        },
      };
      const controller = new UiController(hostilePorts, catalog);
      const before = createInitialUiState(validDraft());
      const result = await controller.generate(before);
      expect(result.phase).not.toBe('prompts-ready');
      expect(result.failures[0]?.code).toBe('INVALID_SCENE_RESULT');
      expect(promptCalled).toBe(false);
      expect(before.phase).toBe('idle');
    },
  );
  it.each(['ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'controller converts hostile Prompt %s into typed state',
    async (trap) => {
      const candidate = clonePrompts();
      candidate[0] = throwingProxy(candidate[0], trap);
      const hostilePorts: UiEnginePorts = {
        ...ports(),
        prompt: { generate: () => ({ ok: true, value: candidate as never }) },
      };
      const result = await new UiController(hostilePorts, catalog).generate(
        createInitialUiState(validDraft()),
      );
      expect(result.phase).not.toBe('prompts-ready');
      expect(result.failures[0]?.code).toBe('INVALID_PROMPT_RESULT');
    },
  );
});
