import { describe, expect, it } from 'vitest';
import { encodeUtf8, hasUtf8Bom, utf8ByteLength } from '../../src/export';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

describe('Export UTF-8 primitive', () => {
  it('encodes ASCII with exact UTF-8 bytes', () => {
    expect(hex(encodeUtf8('Prompt\n'))).toBe('50726f6d70740a');
  });

  it('encodes Arabic without escaping or a BOM', () => {
    const bytes = encodeUtf8('برومبت');
    expect(hex(bytes)).toBe('d8a8d8b1d988d985d8a8d8aa');
    expect(hasUtf8Bom(bytes)).toBe(false);
  });

  it('encodes emoji as its four-byte UTF-8 sequence', () => {
    expect(hex(encodeUtf8('🎨'))).toBe('f09f8ea8');
  });

  it('never prepends a UTF-8 BOM while preserving a caller-supplied U+FEFF', () => {
    expect(hex(encodeUtf8('\uFEFFliteral-content'))).toBe('efbbbf6c69746572616c2d636f6e74656e74');
    expect(hex(encodeUtf8('A')).startsWith('efbbbf')).toBe(false);
  });

  it('preserves NFC and NFD as distinct source sequences', () => {
    const nfc = 'é';
    const nfd = 'e\u0301';
    expect(hex(encodeUtf8(nfc))).toBe('c3a9');
    expect(hex(encodeUtf8(nfd))).toBe('65cc81');
    expect(encodeUtf8(nfc)).not.toEqual(encodeUtf8(nfd));
  });

  it('does not normalize CRLF or standalone CR in opaque text', () => {
    expect(hex(encodeUtf8('A\r\nB\rC\n'))).toBe('410d0a420d430a');
  });

  it('preserves leading, trailing, and blank-line whitespace', () => {
    const source = '  first \n\nlast  ';
    expect(new TextDecoder().decode(encodeUtf8(source))).toBe(source);
  });

  it('matches the allocation-free byte counter for multilingual values', () => {
    for (const value of ['ASCII', 'العربية', '🎨✨', 'e\u0301', '\uD800', 'A\r\nB']) {
      expect(utf8ByteLength(value)).toBe(encodeUtf8(value).byteLength);
    }
  });

  it('returns identical bytes across repeated calls', () => {
    const source = 'ثابت 🎨\r\n  ';
    expect(encodeUtf8(source)).toEqual(encodeUtf8(source));
  });

  it('returns owned byte arrays', () => {
    const first = encodeUtf8('same');
    const second = encodeUtf8('same');
    first[0] = 0;
    expect(second[0]).toBe(115);
  });
});
