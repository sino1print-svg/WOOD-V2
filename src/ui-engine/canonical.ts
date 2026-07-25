function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) output[key] = normalize(record[key]);
    return output;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function deterministicFingerprint(value: unknown): string {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ui-${hash.toString(16).padStart(8, '0')}`;
}
