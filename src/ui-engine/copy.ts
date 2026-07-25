import type { ClipboardPort, PromptViewModel, UiFailure } from './types';

export function canonicalPromptOrder(
  prompts: readonly PromptViewModel[],
): readonly PromptViewModel[] {
  return [...prompts].sort((a, b) => {
    const scene = a.sceneId < b.sceneId ? -1 : a.sceneId > b.sceneId ? 1 : 0;
    if (scene !== 0) return scene;
    return a.kind === b.kind ? 0 : a.kind === 'A' ? -1 : 1;
  });
}

export function formatPromptBundle(prompts: readonly PromptViewModel[]): string {
  return canonicalPromptOrder(prompts)
    .map((prompt) => `===== ${prompt.id} =====\n${prompt.promptText}`)
    .join('\n\n');
}

export async function copyExact(clipboard: ClipboardPort, text: string): Promise<UiFailure | null> {
  try {
    await clipboard.writeText(text);
    return null;
  } catch {
    return {
      code: 'UI_CLIPBOARD_FAILED',
      field: 'clipboard',
      messageAr: 'تعذر النسخ إلى الحافظة.',
      severity: 'blocking',
      source: 'clipboard',
    };
  }
}
