/**
 * Batch 10.4 First Corrective - table-driven scope-to-entry-kind allowlist
 * (F2) and per-scope authoritative provenance (F5).
 */
import { describe, expect, it } from 'vitest';
import { packageExport } from '../../../src/export/packaging';
import type { ExportArtifactKind } from '../../../src/shared/contracts/export-contracts';
import { CANONICAL_SCOPES } from '../fixtures';
import { createPackageFixture } from './fixtures';

const digest9 = '9'.repeat(64);
const digest6 = '6'.repeat(64);
const digest8 = '8'.repeat(64);

interface ScopeCase {
  readonly name: string;
  readonly scopeIndex: number;
  readonly expectedKinds: readonly ExportArtifactKind[];
  readonly expectSceneFingerprints: boolean;
  readonly expectCoverHash: boolean;
}

const CASES: readonly ScopeCase[] = [
  {
    name: 'output_a',
    scopeIndex: 0,
    expectedKinds: ['readme', 'checksums', 'manifest', 'prompt_metadata', 'validation', 'prompt_a'],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'output_b',
    scopeIndex: 1,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'artwork_metadata',
      'prompt_metadata',
      'validation',
      'prompt_b',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'pair',
    scopeIndex: 2,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'artwork_metadata',
      'prompt_metadata',
      'validation',
      'prompt_a',
      'prompt_b',
      'prompt_pair',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group',
    scopeIndex: 3,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'artwork_metadata',
      'group_plan',
      'prompt_metadata',
      'validation',
      'prompt_a',
      'prompt_b',
      'prompt_pair',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group_a',
    scopeIndex: 4,
    expectedKinds: ['readme', 'checksums', 'manifest', 'prompt_metadata', 'validation', 'prompt_a'],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group_b',
    scopeIndex: 5,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'artwork_metadata',
      'prompt_metadata',
      'validation',
      'prompt_b',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'cover',
    scopeIndex: 6,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'cover_metadata',
      'cover_prompt',
      'prompt_metadata',
      'validation',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'session',
    scopeIndex: 7,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'artwork_metadata',
      'cover_metadata',
      'cover_prompt',
      'execution_plan',
      'group_plan',
      'prompt_metadata',
      'validation',
      'prompt_a',
      'prompt_b',
      'prompt_pair',
      'session_summary',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'execution_plan',
    scopeIndex: 8,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'execution_plan',
      'prompt_metadata',
      'validation',
    ],
    expectSceneFingerprints: true,
    // execution_plan resolves the same session (and its cover id) as the
    // 'session' scope; only the content policy differs. coverHash reflects
    // resolved-scope eligibility, not which entry kinds get emitted, so it is
    // still populated here even though no cover_prompt/cover_metadata entry
    // is produced for this scope.
    expectCoverHash: true,
  },
  {
    name: 'complete_project',
    scopeIndex: 9,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'project',
      'artwork_metadata',
      'cover_metadata',
      'cover_prompt',
      'execution_plan',
      'group_plan',
      'prompt_metadata',
      'validation',
      'prompt_a',
      'prompt_b',
      'prompt_pair',
      'session_summary',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'all',
    scopeIndex: 15,
    expectedKinds: [
      'readme',
      'checksums',
      'manifest',
      'project',
      'artwork_metadata',
      'cover_metadata',
      'cover_prompt',
      'execution_plan',
      'group_plan',
      'prompt_metadata',
      'validation',
      'prompt_a',
      'prompt_b',
      'prompt_pair',
      'session_summary',
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
];

describe('Scope-to-entry-kind allowlist (F2) and per-scope provenance (F5)', () => {
  for (const testCase of CASES) {
    it(`'${testCase.name}' scope: emits exactly the allowlisted entry kinds, no leakage`, () => {
      const scope = CANONICAL_SCOPES[testCase.scopeIndex]!;
      const result = packageExport(createPackageFixture({ scope }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const actualKinds = new Set(result.entries.map((entry) => entry.kind));
      const expectedKinds = new Set(testCase.expectedKinds);
      const unexpected = [...actualKinds].filter((kind) => !expectedKinds.has(kind));
      const missing = [...expectedKinds].filter((kind) => !actualKinds.has(kind));
      expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] });
    });

    it(`'${testCase.name}' scope: manifest sourceFingerprints are authoritative source data`, () => {
      const scope = CANONICAL_SCOPES[testCase.scopeIndex]!;
      const result = packageExport(createPackageFixture({ scope }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as {
        sourceFingerprints: {
          sessionFingerprint: string;
          sceneFingerprints?: readonly string[];
          coverHash?: string;
        };
      };
      // Never the old projectId-hash fallback; always the real session fingerprint.
      expect(manifest.sourceFingerprints.sessionFingerprint).toBe(digest9);
      if (testCase.expectSceneFingerprints) {
        expect(manifest.sourceFingerprints.sceneFingerprints).toEqual([digest6]);
      }
      if (testCase.expectCoverHash) {
        expect(manifest.sourceFingerprints.coverHash).toBe(digest8);
      } else {
        expect(manifest.sourceFingerprints.coverHash).toBeUndefined();
      }
    });
  }

  it('rejects pair-file leakage into output_a, cover, group_a, and execution_plan scopes specifically', () => {
    for (const scopeIndex of [0, 6, 4, 8]) {
      const scope = CANONICAL_SCOPES[scopeIndex]!;
      const result = packageExport(createPackageFixture({ scope }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.entries.some((entry) => entry.kind === 'prompt_pair')).toBe(false);
    }
  });

  it('version_snapshot scope carries a real stateHash-derived provenance, no fabricated fallback', () => {
    const scope = CANONICAL_SCOPES[12]!;
    const result = packageExport(createPackageFixture({ scope }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as {
      sourceFingerprints: { sessionFingerprint: string };
    };
    // digest('b') is the canonical fixture's version stateHash.
    expect(manifest.sourceFingerprints.sessionFingerprint).toBe('b'.repeat(64));
    const kinds = new Set(result.entries.map((entry) => entry.kind));
    expect(kinds.has('version_snapshot')).toBe(true);
    expect(kinds.has('prompt_pair')).toBe(false);
    expect(kinds.has('prompt_a')).toBe(false);
  });
});
