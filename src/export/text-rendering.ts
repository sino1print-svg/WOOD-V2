import type { BoundedDocumentBuilder } from './document-builder';
import { endsWithLf } from './line-endings';
import { quoteJsonString } from './json-serializer';
import { utf8ByteLength } from './utf8';

export function inlineValue(value: string | number | boolean | null): string {
  if (typeof value === 'string') return quoteJsonString(value);
  if (value === null) return 'null';
  return String(value);
}

export function appendTxtSection(
  builder: BoundedDocumentBuilder,
  title: string,
  hasPriorContent: boolean,
): boolean {
  if (hasPriorContent && !builder.appendSystemLine()) return false;
  return builder.appendSystemLine(`================ ${title} ================`);
}

export function appendTxtOpaquePrompt(
  builder: BoundedDocumentBuilder,
  label: string,
  promptText: string,
): boolean {
  const quotedLabel = inlineValue(label);
  if (!builder.appendSystemLine(`PROMPT ${quotedLabel} BYTES: ${utf8ByteLength(promptText)}`)) {
    return false;
  }
  if (!builder.appendSystemLine(`----- BEGIN PROMPT ${quotedLabel} -----`)) return false;
  if (!builder.append(promptText)) return false;
  if (!endsWithLf(promptText) && !builder.append('\n')) return false;
  return builder.appendSystemLine(`----- END PROMPT ${quotedLabel} -----`);
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === '`') {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

export function markdownFence(promptText: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(promptText) + 1));
}

export function appendMarkdownOpaquePrompt(
  builder: BoundedDocumentBuilder,
  label: string,
  promptText: string,
): boolean {
  const fence = markdownFence(promptText);
  if (!builder.appendSystemLine(`Prompt label: ${inlineValue(label)}`)) return false;
  if (!builder.appendSystemLine(`Prompt bytes: ${utf8ByteLength(promptText)}`)) return false;
  if (!builder.appendSystemLine(fence)) return false;
  if (!builder.append(promptText)) return false;
  if (!endsWithLf(promptText) && !builder.append('\n')) return false;
  return builder.appendSystemLine(fence);
}
