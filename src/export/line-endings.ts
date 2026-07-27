/** Formatter-owned line endings are always LF. Opaque prompt text is untouched. */
export const LF = '\n';

/** System framing must never contain CR or embedded line endings. */
export function isSystemLine(value: string): boolean {
  return !value.includes('\r') && !value.includes('\n');
}

export function endsWithLf(value: string): boolean {
  return value.endsWith(LF);
}
