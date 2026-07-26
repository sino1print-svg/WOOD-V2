/**
 * Deterministic, cross-platform-safe ZIP path segment rules - EX section 12.2/21.
 *
 * All checks operate on already-produced ASCII-safe segments (from `slug.ts` or
 * fixed literal fragments); nothing here reads the filesystem, the OS locale, or
 * wall-clock state.
 */
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const INVALID_PUNCTUATION = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const CONTROL_MAX = 0x1f;
const DEL_CODE = 0x7f;

function isDisallowedCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= CONTROL_MAX || code === DEL_CODE || INVALID_PUNCTUATION.has(character);
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= CONTROL_MAX || code === DEL_CODE) return true;
  }
  return false;
}

function stripInvalidCharacters(segment: string): string {
  let out = '';
  for (const character of segment) {
    out += isDisallowedCharacter(character) || isWhitespace(character) ? '-' : character;
  }
  return out;
}

function collapseHyphens(segment: string): string {
  let collapsed = '';
  let previousWasHyphen = false;
  for (const character of segment) {
    if (character === '-') {
      if (!previousWasHyphen) collapsed += '-';
      previousWasHyphen = true;
    } else {
      collapsed += character;
      previousWasHyphen = false;
    }
  }
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === '-') start += 1;
  while (end > start && collapsed[end - 1] === '-') end -= 1;
  return collapsed.slice(start, end);
}

function guardReservedAndDotOnly(segment: string): string {
  if (segment === '.' || segment === '..' || segment.length === 0) return 'segment';
  const withoutExtension = segment.split('.')[0] ?? segment;
  if (RESERVED_WINDOWS_NAMES.has(withoutExtension.toLowerCase())) return `file-${segment}`;
  return segment;
}

/**
 * Sanitize one path segment (a single folder/file name, no separators) and bound
 * it to `maxLength` bytes. The result never contains `/`, `\`, control
 * characters, or a bare `.`/`..`, and never matches a reserved Windows device name.
 */
export function sanitizeSegment(rawSegment: string, maxLength: number): string {
  const stripped = stripInvalidCharacters(rawSegment);
  const collapsed = collapseHyphens(stripped);
  const guarded = guardReservedAndDotOnly(collapsed.length > 0 ? collapsed : 'segment');
  return truncateSegment(guarded, maxLength);
}

/** Deterministic truncation that never leaves a trailing hyphen or empty result. */
export function truncateSegment(segment: string, maxLength: number): string {
  if (segment.length <= maxLength) return segment;
  let cut = segment.slice(0, maxLength);
  let end = cut.length;
  while (end > 0 && cut[end - 1] === '-') end -= 1;
  cut = cut.slice(0, end);
  return cut.length > 0 ? cut : segment.slice(0, maxLength);
}

export interface JoinedZipPath {
  readonly path: string;
  readonly withinLimits: boolean;
}

/** Join already-sanitized segments with `/`, the only separator ZIP paths use. */
export function joinZipPath(segments: readonly string[], maxPathLength: number): JoinedZipPath {
  const path = segments.join('/');
  return { path, withinLimits: path.length > 0 && path.length <= maxPathLength };
}

/**
 * Reject absolute paths, drive letters, UNC paths, backslashes, `..` segments,
 * empty segments, and control/NUL bytes in a fully-joined ZIP entry path.
 */
export function isSafeZipPath(path: string): boolean {
  if (path.length === 0 || containsControlCharacter(path)) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.length >= 2 && path[1] === ':') return false;
  if (path.startsWith('\\\\') || path.startsWith('//')) return false;
  if (path.includes('\\')) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
