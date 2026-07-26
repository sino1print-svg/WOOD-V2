import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { packageExport } from '../../../src/export/packaging';
import { GOLDEN_ZIP_CASE_NAMES, createGoldenZipCases } from './golden-fixtures';
import { GOLDEN_ZIP_DIGESTS } from './golden-digests';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Golden ZIP fixtures (EX section 9.5)', () => {
  it('locks exactly the ten reviewed fixture identities', () => {
    expect(createGoldenZipCases().map((fixture) => fixture.name)).toEqual(GOLDEN_ZIP_CASE_NAMES);
    expect(Object.keys(GOLDEN_ZIP_DIGESTS)).toEqual([...GOLDEN_ZIP_CASE_NAMES]);
  });

  for (const golden of createGoldenZipCases()) {
    it(`matches the reviewed byte oracle for ${golden.name}`, () => {
      const expected = GOLDEN_ZIP_DIGESTS[golden.name];
      const first = packageExport(golden.input);
      const second = packageExport(golden.input);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      // repeated runs are byte-identical
      expect(second.zipBytes).toEqual(first.zipBytes);

      expect(first.zipBytes.byteLength).toBe(expected.zipByteLength);
      expect(first.zipSha256).toBe(expected.zipSha256);
      expect(sha256(first.zipBytes)).toBe(expected.zipSha256);

      expect(first.manifestBytes.byteLength).toBe(expected.manifestByteLength);
      expect(sha256(first.manifestBytes)).toBe(expected.manifestSha256);

      expect(first.checksumsBytes.byteLength).toBe(expected.checksumsByteLength);
      expect(sha256(first.checksumsBytes)).toBe(expected.checksumsSha256);

      expect(first.entries).toHaveLength(expected.entries.length);
      for (let index = 0; index < expected.entries.length; index += 1) {
        const actual = first.entries[index]!;
        const expectedEntry = expected.entries[index]!;
        expect(actual.path).toBe(expectedEntry.path);
        expect(actual.kind).toBe(expectedEntry.kind);
        expect(actual.byteLength).toBe(expectedEntry.byteLength);
        expect(actual.checksum).toBe(expectedEntry.sha256);
      }
    });
  }
});
