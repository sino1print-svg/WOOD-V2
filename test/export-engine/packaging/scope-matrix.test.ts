/**
 * Batch 10.4 Corrective - table-driven scope-to-entry allowlist (F2/C2) and
 * per-scope authoritative provenance (F5/C5).
 *
 * Second Corrective C7: each case asserts the *exact*, fully-ordered array of
 * `{path, kind}` pairs - not just the set of kinds present - so duplicate or
 * missing entries, wrong paths, and wrong per-path kinds are all caught, and
 * the multiplicity of repeated kinds (multiple `prompt_a`/`group_plan`/etc.
 * across scenes/sessions) is verified rather than collapsed away by a Set.
 */
import { describe, expect, it } from 'vitest';
import { packageExport } from '../../../src/export/packaging';
import { createExportPlan } from '../../../src/engines/export-engine';
import type {
  CoverId,
  GroupId,
  OutputAId,
  OutputBId,
  Project,
  SceneId,
  SessionId,
} from '../../../src/shared/domain-model';
import { ExportScope, GroupBy } from '../../../src/shared/domain-model';
import type { ExportArtifactKind } from '../../../src/shared/contracts/export-contracts';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from '../fixtures';
import { createGoldenZipCases } from './golden-fixtures';
import {
  createMultiScenePackageFixture,
  createPackageFixture,
  packageInputFromFormatter,
} from './fixtures';

const digest9 = '9'.repeat(64);
const digest6 = '6'.repeat(64);
const digest8 = '8'.repeat(64);

interface ExactEntry {
  readonly kind: ExportArtifactKind;
  readonly path: string;
}

function entriesOf(result: ReturnType<typeof packageExport>): readonly ExactEntry[] {
  if (!result.ok) return [];
  return result.entries.map((entry) => ({ kind: entry.kind, path: entry.path }));
}

interface ScopeCase {
  readonly name: string;
  readonly scopeIndex: number;
  readonly expectedEntries: readonly ExactEntry[];
  readonly expectSceneFingerprints: boolean;
  readonly expectCoverHash: boolean;
}

const CASES: readonly ScopeCase[] = [
  {
    name: 'output_a',
    scopeIndex: 0,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'output_b',
    scopeIndex: 1,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_output-b-canonical_B.txt' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'pair',
    scopeIndex: 2,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/001_pair_execution.md' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group',
    scopeIndex: 3,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'group_plan', path: 'project-001/session-01/groups/group-01.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/001_pair_execution.md' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group_a',
    scopeIndex: 4,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'group_b',
    scopeIndex: 5,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_output-b-canonical_B.txt' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: false,
  },
  {
    name: 'cover',
    scopeIndex: 6,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'cover_metadata', path: 'project-001/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'project-001/session-01/cover/cover-prompt.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'session',
    scopeIndex: 7,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'cover_metadata', path: 'project-001/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'project-001/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'project-001/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'project-001/session-01/groups/group-01.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/001_pair_execution.md' },
      { kind: 'session_summary', path: 'project-001/session-01/session-summary.md' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'execution_plan',
    scopeIndex: 8,
    expectedEntries: [
      { kind: 'readme', path: 'project-001/README.md' },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'execution_plan', path: 'project-001/session-01/execution-plan.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
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
    expectedEntries: [
      { kind: 'readme', path: 'item-09598bb4fca1/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'item-09598bb4fca1/checksums.sha256' },
      { kind: 'manifest', path: 'item-09598bb4fca1/manifest.json' },
      { kind: 'project', path: 'item-09598bb4fca1/project/project.json' },
      { kind: 'cover_metadata', path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'item-09598bb4fca1/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-01/groups/group-01.txt' },
      {
        kind: 'prompt_metadata',
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
      },
      { kind: 'validation', path: 'item-09598bb4fca1/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt' },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
      },
      { kind: 'session_summary', path: 'item-09598bb4fca1/session-01/session-summary.md' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
  {
    name: 'all',
    scopeIndex: 15,
    expectedEntries: [
      { kind: 'readme', path: 'item-09598bb4fca1/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'item-09598bb4fca1/checksums.sha256' },
      { kind: 'manifest', path: 'item-09598bb4fca1/manifest.json' },
      { kind: 'project', path: 'item-09598bb4fca1/project/project.json' },
      { kind: 'cover_metadata', path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'item-09598bb4fca1/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-01/groups/group-01.txt' },
      {
        kind: 'prompt_metadata',
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
      },
      { kind: 'validation', path: 'item-09598bb4fca1/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt' },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
      },
      { kind: 'session_summary', path: 'item-09598bb4fca1/session-01/session-summary.md' },
    ],
    expectSceneFingerprints: true,
    expectCoverHash: true,
  },
];

describe('Scope-to-entry-kind allowlist (F2/C2) and per-scope provenance (F5/C5)', () => {
  for (const testCase of CASES) {
    it(`'${testCase.name}' scope: emits exactly the expected {path, kind} entries, in order, no leakage`, () => {
      const scope = CANONICAL_SCOPES[testCase.scopeIndex]!;
      const result = packageExport(createPackageFixture({ scope }));
      expect(result.ok).toBe(true);
      expect(entriesOf(result)).toEqual(testCase.expectedEntries);
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

  it('version_snapshot scope packaging fails closed: VersionSnapshot.stateHash is a project-state digest, never a session fingerprint (Second Corrective C5)', () => {
    const scope = CANONICAL_SCOPES[12]!;
    const result = packageExport(createPackageFixture({ scope }));
    // ExportManifest.sourceFingerprints.sessionFingerprint is meant to be a
    // real SessionFingerprint.hash. version_snapshot resolves zero sessions,
    // so there is none to report; packaging must fail closed with the
    // existing scope-rejection code rather than substitute the snapshot's
    // whole-project stateHash (which is a different kind of hash entirely)
    // or fabricate any other value. No manifest/ZIP bytes are produced.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_SCOPE_001')).toBe(true);
    expect('zipBytes' in result).toBe(false);
    expect('manifestBytes' in result).toBe(false);
  });
});

describe('Second Corrective C7 - additional exact path/kind matrices (partial pair, multi-scene, multi-session, collisions)', () => {
  it('partial pair (Output A selected, Output B genuinely absent): no prompt_b/prompt_pair leakage, exact omission preserved (Third Corrective F5)', () => {
    const result = packageExport(
      createPackageFixture({ omitOutputB: true, scope: CANONICAL_SCOPES[2] }),
    );
    expect(result.ok).toBe(true);
    // Identical to the output_a-only entry list: with no real Output B for
    // this scene, 'pair' scope packaging degrades to an Output-A-only
    // delivery and must never emit prompt_b or prompt_pair.
    expect(entriesOf(result)).toEqual(CASES[0]!.expectedEntries);
    if (!result.ok) return;
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds).not.toContain('prompt_b');
    expect(kinds).not.toContain('prompt_pair');
    // The exact, non-empty Output B omission must survive into the package
    // result - not merely be absent from the entry list.
    expect(result.omissions).toEqual([
      {
        artifactKind: 'output_b',
        entityId: 'scene-001:output_b',
        field: 'source.project.sessions.جلسة-001.scenes.scene-001.outputB',
        code: 'EXPORT_SCOPE_002',
      },
    ]);
  });

  it('multi-scene session export: exact entries with correct multiplicity (2x prompt_a/prompt_b/prompt_pair/group_plan)', () => {
    const result = packageExport(createMultiScenePackageFixture());
    expect(result.ok).toBe(true);
    expect(entriesOf(result)).toEqual([
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'cover_metadata', path: 'project-001/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'project-001/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'project-001/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'project-001/session-01/groups/group-01.txt' },
      { kind: 'group_plan', path: 'project-001/session-01/groups/group-02.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/002_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/002_tee-front_B.txt' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/001_pair_execution.md' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/002_pair_execution.md' },
      { kind: 'session_summary', path: 'project-001/session-01/session-summary.md' },
    ]);
  });

  it('collision-heavy-names golden fixture: exact entries with deterministic _2 collision suffixing', () => {
    const golden = createGoldenZipCases().find((entry) => entry.name === 'collision-heavy-names')!;
    const result = packageExport(golden.input);
    expect(result.ok).toBe(true);
    expect(entriesOf(result)).toEqual([
      { kind: 'readme', path: 'item-09598bb4fca1/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
      },
      {
        kind: 'artwork_metadata',
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical_2.json',
      },
      { kind: 'checksums', path: 'item-09598bb4fca1/checksums.sha256' },
      { kind: 'manifest', path: 'item-09598bb4fca1/manifest.json' },
      { kind: 'project', path: 'item-09598bb4fca1/project/project.json' },
      { kind: 'cover_metadata', path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'item-09598bb4fca1/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-01/groups/group-01.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-01/groups/group-02.txt' },
      {
        kind: 'prompt_metadata',
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
      },
      { kind: 'validation', path: 'item-09598bb4fca1/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-01/prompts/A/002_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-01/prompts/B/002_tee-front_B.txt' },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
      },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-01/prompts/pairs/002_pair_execution.md',
      },
      { kind: 'session_summary', path: 'item-09598bb4fca1/session-01/session-summary.md' },
    ]);
  });

  it('multi-session complete_project export: exact entries across two sessions, one shared artwork deduplicated', () => {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const original = project.sessions[CANONICAL_SESSION_ID]!;
    const originalScene = original.scenes[CANONICAL_SCENE_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const secondSceneId = 'scene-second' as SceneId;
    const secondOutputAId = 'output-a-second' as OutputAId;
    const secondOutputBId = 'output-b-second' as OutputBId;
    const secondGroupId = 'group-second' as GroupId;
    const secondCoverId = 'cover-second' as CoverId;
    const secondScene = {
      ...originalScene,
      id: secondSceneId,
      sessionId: secondSessionId,
      outputA: { ...originalScene.outputA, id: secondOutputAId, sceneId: secondSceneId },
      outputB: {
        ...originalScene.outputB!,
        id: secondOutputBId,
        sceneId: secondSceneId,
        sourceOutputAId: secondOutputAId,
      },
    };
    const secondSession = {
      ...original,
      id: secondSessionId,
      scenes: { [secondSceneId]: secondScene },
      sceneOrder: [secondSceneId],
      groups: {
        [secondGroupId]: {
          ...Object.values(original.groups)[0]!,
          id: secondGroupId,
          sessionId: secondSessionId,
          sceneIds: [secondSceneId],
        },
      },
      cover: {
        ...original.cover!,
        id: secondCoverId,
        sessionId: secondSessionId,
        sourceSaleImageIds: [secondOutputAId],
      },
      // A real second session never shares a validation-result identity with
      // another session; session1's own results are cleared here rather than
      // copied verbatim, since this fixture's point is scene/output/artwork
      // identity, not validation-result content.
      validationResults: {},
    };
    project.sessions = { [CANONICAL_SESSION_ID]: original, [secondSessionId]: secondSession };
    project.sessionOrder = [CANONICAL_SESSION_ID, secondSessionId];

    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(planResult.ok).toBe(true);
    const result = packageExport(
      packageInputFromFormatter({ planResult, limits: CANONICAL_EXPORT_INPUT.limits }),
    );
    expect(result.ok).toBe(true);
    // secondScene reuses originalScene's outputB.artworkId verbatim (an
    // unrelated fixture-construction detail, not a defect), so there is only
    // one distinct artwork across both sessions and therefore exactly one
    // artwork_metadata entry - proving artwork dedup, not per-output emission.
    expect(entriesOf(result)).toEqual([
      { kind: 'readme', path: 'item-09598bb4fca1/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'item-09598bb4fca1/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'item-09598bb4fca1/checksums.sha256' },
      { kind: 'manifest', path: 'item-09598bb4fca1/manifest.json' },
      { kind: 'project', path: 'item-09598bb4fca1/project/project.json' },
      { kind: 'cover_metadata', path: 'item-09598bb4fca1/session-01/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'item-09598bb4fca1/session-01/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'item-09598bb4fca1/session-01/execution-plan.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-01/groups/group-01.txt' },
      {
        kind: 'prompt_metadata',
        path: 'item-09598bb4fca1/session-01/metadata/prompt-metadata.json',
      },
      { kind: 'validation', path: 'item-09598bb4fca1/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-01/prompts/B/001_tee-front_B.txt' },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-01/prompts/pairs/001_pair_execution.md',
      },
      { kind: 'session_summary', path: 'item-09598bb4fca1/session-01/session-summary.md' },
      { kind: 'cover_metadata', path: 'item-09598bb4fca1/session-02/cover/cover-metadata.json' },
      { kind: 'cover_prompt', path: 'item-09598bb4fca1/session-02/cover/cover-prompt.txt' },
      { kind: 'execution_plan', path: 'item-09598bb4fca1/session-02/execution-plan.txt' },
      { kind: 'group_plan', path: 'item-09598bb4fca1/session-02/groups/group-01.txt' },
      {
        kind: 'prompt_metadata',
        path: 'item-09598bb4fca1/session-02/metadata/prompt-metadata.json',
      },
      { kind: 'validation', path: 'item-09598bb4fca1/session-02/metadata/validation.json' },
      { kind: 'prompt_a', path: 'item-09598bb4fca1/session-02/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'item-09598bb4fca1/session-02/prompts/B/001_tee-front_B.txt' },
      {
        kind: 'prompt_pair',
        path: 'item-09598bb4fca1/session-02/prompts/pairs/001_pair_execution.md',
      },
      { kind: 'session_summary', path: 'item-09598bb4fca1/session-02/session-summary.md' },
    ]);
  });

  it('multi-scene GROUP scope (a single group spanning two scenes): exact entries with correct multiplicity, one merged group_plan (Third Corrective F5 - mandatory multi-scene group case)', () => {
    // A multi-scene SESSION export is not equivalent to a multi-scene GROUP
    // scope: 'group' scope's content policy never includes cover/execution
    // plan/session summary/project content, and its single group_plan
    // entry must cover both member scenes, not one entry per scene.
    const base = createCanonicalMultiSceneExportInput();
    const project = structuredClone(base.source.project) as Project;
    const session = project.sessions[CANONICAL_SESSION_ID]!;
    const [firstGroupId] = Object.keys(session.groups) as GroupId[];
    const [firstSceneId, secondSceneId] = session.sceneOrder;
    // Both multi-scene fixture scenes share `paletteColorId` (only
    // productId/outputA/outputB/hashes differ between them), so grouping by
    // color - unlike the fixture's own by-product groups - lets a single
    // group legitimately span both scenes.
    const mergedGroup = {
      ...session.groups[firstGroupId!]!,
      groupBy: GroupBy.Color,
      key: CANONICAL_SCENE.paletteColorId,
      sceneIds: [firstSceneId!, secondSceneId!],
    };
    project.sessions = {
      [CANONICAL_SESSION_ID]: { ...session, groups: { [firstGroupId!]: mergedGroup } },
    };

    const planResult = createExportPlan({
      ...base,
      source: { ...base.source, project },
      scope: {
        baseScope: ExportScope.Group,
        scopeDetail: 'group',
        sessionId: CANONICAL_SESSION_ID,
        groupId: firstGroupId!,
      },
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const result = packageExport(packageInputFromFormatter({ planResult, limits: base.limits }));
    expect(result.ok).toBe(true);
    expect(entriesOf(result)).toEqual([
      { kind: 'readme', path: 'project-001/README.md' },
      {
        kind: 'artwork_metadata',
        path: 'project-001/assets/artwork-metadata/artwork-canonical.json',
      },
      { kind: 'checksums', path: 'project-001/checksums.sha256' },
      { kind: 'manifest', path: 'project-001/manifest.json' },
      { kind: 'group_plan', path: 'project-001/session-01/groups/group-01.txt' },
      { kind: 'prompt_metadata', path: 'project-001/session-01/metadata/prompt-metadata.json' },
      { kind: 'validation', path: 'project-001/session-01/metadata/validation.json' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/001_tee-front_A.txt' },
      { kind: 'prompt_a', path: 'project-001/session-01/prompts/A/002_tee-front_A.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/001_tee-front_B.txt' },
      { kind: 'prompt_b', path: 'project-001/session-01/prompts/B/002_tee-front_B.txt' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/001_pair_execution.md' },
      { kind: 'prompt_pair', path: 'project-001/session-01/prompts/pairs/002_pair_execution.md' },
    ]);
  });
});
