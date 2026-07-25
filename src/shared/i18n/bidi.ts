/**
 * Bidi isolation utilities — 07_UI_ENGINE §18 / 12_IMPLEMENTATION_GUIDE §48.
 * The UI is Arabic RTL; generated English prompt content must remain LTR-isolated
 * so it never reorders inside the RTL layout. Pure, deterministic string helpers.
 */

/** Unicode Left-to-Right Isolate (U+2066). */
export const LRI = '⁦';
/** Unicode Right-to-Left Isolate (U+2067). */
export const RLI = '⁧';
/** Unicode Pop Directional Isolate (U+2069). */
export const PDI = '⁩';

export type Direction = 'rtl' | 'ltr';

/** Document/UI base direction (Arabic-only UI). */
export const UI_DIRECTION: Direction = 'rtl';

/** Prompt/content direction (English-only prompt payloads). */
export const PROMPT_DIRECTION: Direction = 'ltr';

/**
 * Wrap English text in an LTR isolate so it renders left-to-right within the
 * RTL Arabic layout without affecting surrounding text order.
 * Deterministic: same input -> same output.
 */
export function isolateLtr(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/** True when the string is already LTR-isolated by this utility. */
export function isLtrIsolated(text: string): boolean {
  return text.startsWith(LRI) && text.endsWith(PDI);
}
