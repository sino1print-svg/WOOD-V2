// @vitest-environment jsdom
/**
 * Phase 10.5 — AppShell integration tests (real DOM via jsdom).
 * The complete primary workflow runs against the real engines: fill the form,
 * Generate, see Output A and Output B separately, copy each independently,
 * and download real formatter bytes with deterministic names and revoked
 * Object URLs. No production mocks — only browser APIs jsdom lacks
 * (clipboard, Object URLs) are provided by the test environment.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppShell } from '../../src/ui/app-shell/AppShell';
import { UI_TEXT } from '../../src/ui/components';
import { AR } from '../../src/shared/i18n';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

interface Harness {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly clipboardWrites: string[];
  readonly createdUrls: string[];
  readonly revokedUrls: string[];
  readonly downloadedBlobs: Blob[];
  readonly downloadNames: string[];
}

let harness: Harness | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mount(options: { clipboard?: 'ok' | 'failing' | 'missing' } = {}): Promise<Harness> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no SubtleCrypto; the real browser provides it natively.
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);

  const clipboardWrites: string[] = [];
  const clipboardMode = options.clipboard ?? 'ok';
  if (clipboardMode === 'missing') {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  } else {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          if (clipboardMode === 'failing') throw new Error('clipboard denied');
          clipboardWrites.push(text);
        },
      },
      configurable: true,
    });
  }

  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const downloadedBlobs: Blob[] = [];
  const downloadNames: string[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:phase105-${createdUrls.length}`;
    createdUrls.push(url);
    downloadedBlobs.push(blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
    downloadNames.push(this.download);
  };
  const cleanupClick = () => {
    HTMLAnchorElement.prototype.click = originalClick;
  };
  const root = createRoot(container);
  await act(async () => {
    root.render(<AppShell />);
  });
  harness = {
    container,
    root,
    clipboardWrites,
    createdUrls,
    revokedUrls,
    downloadedBlobs,
    downloadNames,
  };
  (harness as { cleanupClick?: () => void }).cleanupClick = cleanupClick;
  return harness;
}

function q<T extends Element>(selector: string): T {
  const found = harness!.container.querySelector<T>(selector);
  if (!found) throw new Error(`element not found: ${selector}`);
  return found;
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = [...harness!.container.querySelectorAll('button')];
  const found = buttons.find((button) => button.textContent?.trim() === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor!.set!.call(element, value);
}

async function fillValidForm(): Promise<void> {
  const title = q<HTMLInputElement>('.form-grid input');
  await act(async () => {
    setNativeValue(title, 'جلسة اختبار متكاملة');
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const seasonSelect = q<HTMLSelectElement>('.form-grid select');
  await act(async () => {
    setNativeValue(seasonSelect, 'season-halloween');
    seasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const targetCount = q<HTMLInputElement>('input[type="number"]');
  await act(async () => {
    setNativeValue(targetCount, '1');
    targetCount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const addProduct = q<HTMLSelectElement>('select[aria-label="إضافة منتج"]');
  await act(async () => {
    setNativeValue(addProduct, 'product-bella-3001');
    addProduct.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const whiteSwatch = [...harness!.container.querySelectorAll('button.swatch')][0]!;
  await act(async () => {
    (whiteSwatch as HTMLButtonElement).click();
  });
  // Disable Output B for the artwork-free flow (checkbox defaults on/off per draft).
  const includeB = q<HTMLInputElement>('input[type="checkbox"]');
  if (includeB.checked) {
    await act(async () => {
      includeB.click();
    });
  }
}

async function generate(): Promise<void> {
  const generateButton = buttonByText(AR.actions.generate);
  expect(generateButton.disabled).toBe(false);
  await act(async () => {
    generateButton.click();
  });
  await flush();
  await flush();
}

afterEach(() => {
  if (harness) {
    (harness as { cleanupClick?: () => void }).cleanupClick?.();
    harness.root.unmount();
    harness.container.remove();
    harness = null;
  }
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('Phase 10.5 AppShell — primary workflow (real engines)', () => {
  it('shows the empty state before generation', async () => {
    await mount();
    expect(harness!.container.textContent).toContain(UI_TEXT.emptyResults);
  });

  it('keeps Generate disabled while the form is invalid', async () => {
    await mount();
    const generateButton = buttonByText(AR.actions.generate);
    expect(generateButton.disabled).toBe(true);
  });

  it('completes Generate and renders Output A separately (A-only session)', async () => {
    await mount();
    await fillValidForm();
    await generate();
    const textareas = [...harness!.container.querySelectorAll('textarea.prompt-text')];
    expect(textareas.length).toBe(1);
    expect((textareas[0] as HTMLTextAreaElement).value).toContain('[Output A]');
    expect(harness!.container.textContent).toContain(UI_TEXT.outputA);
  });

  it('renders Output A and Output B separately after uploading a real PNG', async () => {
    await mount();
    await fillValidForm();
    const includeB = q<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      includeB.click();
    });
    const { tinyPngBytes } = await import('../app/fixtures');
    const bytes = tinyPngBytes();
    const file = new File([new Uint8Array(bytes)], 'design.png', { type: 'image/png' });
    const fileInput = q<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(harness!.container.textContent).toContain('design.png');
    await generate();
    const textareas = [...harness!.container.querySelectorAll('textarea.prompt-text')];
    expect(textareas.length).toBe(2);
    expect((textareas[0] as HTMLTextAreaElement).value).toContain('[Output A]');
    expect((textareas[1] as HTMLTextAreaElement).value).toContain('[Output B]');
    expect((textareas[0] as HTMLTextAreaElement).value).not.toContain('[Output B]');
    expect((textareas[1] as HTMLTextAreaElement).value).not.toContain('[Output A]');
  });

  it('blocks generation with a visible typed failure when Output B lacks an artwork', async () => {
    await mount();
    await fillValidForm();
    const includeB = q<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      includeB.click();
    });
    await generate();
    expect(harness!.container.textContent).toContain('UI_ARTWORK_REQUIRED');
    expect([...harness!.container.querySelectorAll('textarea.prompt-text')]).toHaveLength(0);
  });

  it('Copy A places only the A prompt in the clipboard, and Copy B only the B prompt', async () => {
    await mount();
    await fillValidForm();
    await generate();
    const textarea = q<HTMLTextAreaElement>('textarea.prompt-text');
    const copyA = q<HTMLButtonElement>('button[data-copy-kind="A"]');
    await act(async () => {
      copyA.click();
    });
    await flush();
    expect(harness!.clipboardWrites).toEqual([textarea.value]);
    expect(harness!.clipboardWrites[0]).toContain('[Output A]');
    expect(harness!.clipboardWrites[0]).not.toContain('[Output B]');
    expect(harness!.container.textContent).toContain(UI_TEXT.copied);
  });

  it('shows a visible clipboard failure when the Clipboard API rejects', async () => {
    await mount({ clipboard: 'failing' });
    await fillValidForm();
    await generate();
    const copyA = q<HTMLButtonElement>('button[data-copy-kind="A"]');
    await act(async () => {
      copyA.click();
    });
    await flush();
    expect(harness!.container.textContent).toContain(UI_TEXT.copyFailed);
  });

  it('clears previous results on input change and regenerates fresh results', async () => {
    await mount();
    await fillValidForm();
    await generate();
    const first = q<HTMLTextAreaElement>('textarea.prompt-text').value;
    expect(first).toContain('halloween');
    const seasonSelect = q<HTMLSelectElement>('.form-grid select');
    await act(async () => {
      setNativeValue(seasonSelect, 'season-minimal');
      seasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The approved state machine never presents old outputs as current:
    // editing clears the previous results before the next explicit Generate.
    expect([...harness!.container.querySelectorAll('textarea.prompt-text')]).toHaveLength(0);
    expect(harness!.container.textContent).toContain(UI_TEXT.emptyResults);
    await generate();
    const second = q<HTMLTextAreaElement>('textarea.prompt-text').value;
    expect(second).not.toBe(first);
    expect(second).toContain('minimal studio');
  });
});

describe('Phase 10.5 AppShell — export downloads', () => {
  it('keeps export buttons disabled before a valid result exists', async () => {
    await mount();
    for (const button of harness!.container.querySelectorAll('button[data-export-kind]')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('downloads TXT, Markdown, and JSON with exact formatter bytes and revoked URLs', async () => {
    await mount();
    await fillValidForm();
    await generate();
    for (const kind of ['txt', 'markdown', 'readable_json']) {
      const button = q<HTMLButtonElement>(`button[data-export-kind="${kind}"]`);
      expect(button.disabled).toBe(false);
      await act(async () => {
        button.click();
      });
    }
    expect(harness!.downloadNames).toEqual([
      'prompt-pack.txt',
      'prompt-pack.md',
      'prompt-pack.json',
    ]);
    expect(harness!.revokedUrls).toEqual(harness!.createdUrls);
    const txtBytes = new Uint8Array(await harness!.downloadedBlobs[0]!.arrayBuffer());
    const decoded = new TextDecoder().decode(txtBytes);
    expect(decoded).toContain('[Output A]');
    expect(txtBytes[0]).not.toBe(0xef);
    const jsonBytes = new Uint8Array(await harness!.downloadedBlobs[2]!.arrayBuffer());
    expect(() => JSON.parse(new TextDecoder().decode(jsonBytes))).not.toThrow();
  });

  it('downloads identical bytes for the same inputs across two generations', async () => {
    await mount();
    await fillValidForm();
    await generate();
    await act(async () => {
      q<HTMLButtonElement>('button[data-export-kind="txt"]').click();
    });
    const seasonSelect = q<HTMLSelectElement>('.form-grid select');
    await act(async () => {
      setNativeValue(seasonSelect, 'season-halloween');
      seasonSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await generate();
    await act(async () => {
      q<HTMLButtonElement>('button[data-export-kind="txt"]').click();
    });
    const first = new Uint8Array(await harness!.downloadedBlobs[0]!.arrayBuffer());
    const second = new Uint8Array(await harness!.downloadedBlobs[1]!.arrayBuffer());
    expect(second).toEqual(first);
  });
});
