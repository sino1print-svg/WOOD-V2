/**
 * Deterministic ASCII slugger for ZIP path segments — EX §12.1/§12.2.
 *
 * No Intl.Collator, no locale-aware transliteration library, no timestamps, no
 * random state. Unmappable characters become '-'; the original name is never
 * used for slugging decisions beyond this fixed, project-owned mapping, and the
 * exact original string is preserved separately in manifest metadata.
 */
import { sha256Bytes } from './checksum';
import { encodeUtf8 } from '../utf8';

/** Fixed transliteration table for common accented Latin letters. Project-owned. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  á: 'a',
  à: 'a',
  â: 'a',
  ä: 'a',
  ã: 'a',
  å: 'a',
  ā: 'a',
  æ: 'ae',
  ç: 'c',
  ć: 'c',
  č: 'c',
  ď: 'd',
  đ: 'd',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  ē: 'e',
  ě: 'e',
  ğ: 'g',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ī: 'i',
  ł: 'l',
  ñ: 'n',
  ń: 'n',
  ň: 'n',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  ö: 'o',
  õ: 'o',
  ō: 'o',
  ø: 'o',
  œ: 'oe',
  ř: 'r',
  ś: 's',
  š: 's',
  ş: 's',
  ß: 'ss',
  ť: 't',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ū: 'u',
  ů: 'u',
  ý: 'y',
  ÿ: 'y',
  ž: 'z',
  ź: 'z',
  ż: 'z',
};

function transliterateCodePoint(character: string): string {
  const lower = character.toLowerCase();
  const mapped = TRANSLITERATION[lower];
  if (mapped !== undefined) return mapped;
  return /[a-z0-9]/u.test(lower) ? lower : '-';
}

/** Deterministic short digest suffix; never a timestamp or random UUID. */
function stableFallback(seed: string): string {
  const digest = sha256Bytes(encodeUtf8(seed));
  return `item-${digest.slice(0, 12)}`;
}

/**
 * Build a deterministic ASCII-safe, lowercase, hyphenated slug from an untrusted
 * name. NFC-normalizes the input for slugging purposes only; prompt/content bytes
 * are never touched by this function.
 */
export function slugify(rawName: unknown, fallbackSeed: string): string {
  const name = typeof rawName === 'string' ? rawName : '';
  const normalized = name.normalize('NFC');
  let out = '';
  for (const character of normalized) {
    out += transliterateCodePoint(character);
  }
  const hyphenated = out
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return hyphenated.length > 0 ? hyphenated : stableFallback(fallbackSeed);
}
