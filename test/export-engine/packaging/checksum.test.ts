import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Bytes, verifySha256 } from '../../../src/export/packaging/checksum';
import type { Sha256 } from '../../../src/shared/domain-model';

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('SHA-256 checksum implementation (EX section 3.5/14)', () => {
  it('matches known SHA-256 test vectors', () => {
    const empty = new TextEncoder().encode('');
    expect(sha256Bytes(empty)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const abc = new TextEncoder().encode('abc');
    expect(sha256Bytes(abc)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches Node crypto for empty bytes', () => {
    const bytes = new Uint8Array(0);
    expect(sha256Bytes(bytes)).toBe(nodeSha256(bytes));
  });

  it('matches Node crypto for UTF-8 Arabic text', () => {
    const bytes = new TextEncoder().encode('مرحبا بالعالم - نص عربي للاختبار');
    expect(sha256Bytes(bytes)).toBe(nodeSha256(bytes));
  });

  it('matches Node crypto for emoji content', () => {
    const bytes = new TextEncoder().encode('🎨🧵✨ prompt with emoji');
    expect(sha256Bytes(bytes)).toBe(nodeSha256(bytes));
  });

  it('produces different digests for CR, LF, and CRLF variants', () => {
    const cr = sha256Bytes(new TextEncoder().encode('line1\rline2'));
    const lf = sha256Bytes(new TextEncoder().encode('line1\nline2'));
    const crlf = sha256Bytes(new TextEncoder().encode('line1\r\nline2'));
    expect(new Set([cr, lf, crlf]).size).toBe(3);
  });

  it('is sensitive to trailing whitespace', () => {
    const withoutTrailing = sha256Bytes(new TextEncoder().encode('prompt text'));
    const withTrailing = sha256Bytes(new TextEncoder().encode('prompt text   '));
    expect(withoutTrailing).not.toBe(withTrailing);
  });

  it('is sensitive to an embedded NUL byte', () => {
    const withoutNul = sha256Bytes(new Uint8Array([97, 98, 99]));
    const withNul = sha256Bytes(new Uint8Array([97, 0, 98, 99]));
    expect(withoutNul).not.toBe(withNul);
    expect(sha256Bytes(new Uint8Array([97, 0, 98, 99]))).toBe(
      nodeSha256(new Uint8Array([97, 0, 98, 99])),
    );
  });

  it('changes digest for any single-byte mutation', () => {
    const base = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    const baseDigest = sha256Bytes(base);
    for (const index of [0, 10, base.length - 1]) {
      const mutated = base.slice();
      mutated[index] = (mutated[index]! + 1) % 256;
      expect(sha256Bytes(mutated)).not.toBe(baseDigest);
    }
  });

  it('is a pure function: repeated runs on identical bytes produce identical digests', () => {
    const bytes = new TextEncoder().encode('repeatable content for identity check');
    const first = sha256Bytes(bytes);
    const second = sha256Bytes(bytes);
    const third = sha256Bytes(bytes.slice());
    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  it('verifySha256 reports ok:true only when the digest actually matches', () => {
    const bytes = new TextEncoder().encode('verify me');
    const expected = sha256Bytes(bytes) as Sha256;
    expect(verifySha256(expected, bytes).ok).toBe(true);

    const wrongExpected = sha256Bytes(new TextEncoder().encode('something else')) as Sha256;
    const result = verifySha256(wrongExpected, bytes);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe(expected);
  });

  it('verifySha256 detects corrupted-entry mismatches without throwing', () => {
    const original = new TextEncoder().encode('original content');
    const corrupted = new TextEncoder().encode('corrupted content');
    const expected = sha256Bytes(original) as Sha256;
    expect(() => verifySha256(expected, corrupted)).not.toThrow();
    expect(verifySha256(expected, corrupted).ok).toBe(false);
  });

  it('matches Node crypto across 200 random byte payloads', () => {
    for (let index = 0; index < 200; index += 1) {
      const length = (index * 7) % 300;
      const bytes = new Uint8Array(length);
      for (let position = 0; position < length; position += 1) {
        bytes[position] = (index * 31 + position * 17) % 256;
      }
      expect(sha256Bytes(bytes)).toBe(nodeSha256(bytes));
    }
  });
});
