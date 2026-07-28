// @vitest-environment jsdom
/**
 * Phase 10.5 — runtime smoke tests (§9): the app mounts without a runtime
 * exception, the primary workflow completes end to end, no unhandled
 * rejections occur, no primary-workflow button lacks a handler, and a
 * loading-state double submit cannot start a second generation.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppShell } from '../../src/ui/app-shell/AppShell';
import { AR } from '../../src/shared/i18n';
import { UiController, type UiState } from '../../src/ui-engine';
import { createEnginePorts, APP_UI_CATALOG } from '../../src/app/orchestrator';
import { stateWithDraft, testArtwork, validAppDraft } from '../app/fixtures';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;

afterEach(() => {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  activeContainer?.remove();
  activeContainer = null;
});

async function mountShell(): Promise<HTMLElement> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => 'blob:smoke') as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AppShell />);
  });
  activeRoot = root;
  activeContainer = container;
  return container;
}

function reactPropsOf(element: Element): Record<string, unknown> | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
  if (!key) return null;
  return (element as unknown as Record<string, Record<string, unknown>>)[key] ?? null;
}

describe('Phase 10.5 runtime smoke', () => {
  it('mounts the application without a runtime exception', async () => {
    const container = await mountShell();
    expect(container.querySelector('.workspace')).not.toBeNull();
    expect(container.textContent).toContain(AR.appName);
  });

  it('has no unhandled rejection during mount and interaction', async () => {
    const rejections: unknown[] = [];
    const listener = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const container = await mountShell();
      const buttons = [...container.querySelectorAll('button')];
      for (const button of buttons) {
        if (!(button as HTMLButtonElement).disabled) {
          await act(async () => {
            (button as HTMLButtonElement).click();
          });
        }
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(rejections).toEqual([]);
  });

  it('every button in the primary workflow has a handler or a contract-based disabled state', async () => {
    const container = await mountShell();
    for (const button of container.querySelectorAll('button')) {
      const props = reactPropsOf(button);
      expect(props).not.toBeNull();
      const hasHandler = typeof props!.onClick === 'function';
      const isDisabled = props!.disabled === true;
      expect(hasHandler || isDisabled).toBe(true);
      if (isDisabled && !hasHandler) {
        // A disabled control without a handler must explain itself.
        expect(typeof props!.title === 'string' || typeof props!.onClick === 'function').toBe(true);
      }
    }
  });

  it('completes the primary workflow headlessly through the same application command', async () => {
    const controller = new UiController(createEnginePorts(testArtwork()), APP_UI_CATALOG);
    const result = await controller.generate(stateWithDraft(validAppDraft()));
    expect(result.phase).toBe('prompts-ready');
    expect(result.prompts.length).toBeGreaterThan(0);
  });

  it('prevents a double submit while a generation is in flight', async () => {
    const ports = createEnginePorts(testArtwork());
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sceneCalls = 0;
    const slowPorts = {
      ...ports,
      scene: {
        generate: async (plan: Parameters<typeof ports.scene.generate>[0]) => {
          sceneCalls += 1;
          await gate;
          return ports.scene.generate(plan);
        },
      },
    };
    const controller = new UiController(slowPorts, APP_UI_CATALOG);
    const initial = stateWithDraft(validAppDraft());
    const first = controller.generate(initial);
    const second = controller.generate(initial);
    release!();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(sceneCalls).toBe(1);
    const completed = [firstResult, secondResult].filter(
      (state: UiState) => state.phase === 'prompts-ready',
    );
    expect(completed).toHaveLength(1);
    expect([firstResult, secondResult].some((state) => state === initial)).toBe(true);
  });
});
