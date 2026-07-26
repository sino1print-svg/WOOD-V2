/**
 * Batch 10.4 First Corrective - required adversarial tests (spec section 2).
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { packageExport } from '../../../src/export/packaging';
import type { ExportPackageInput } from '../../../src/export/packaging';
import { packageExportWithHooksForTesting } from '../../../src/export/packaging/package';
import { sha256Bytes } from '../../../src/export/packaging/checksum';
import { writeDeterministicZip } from '../../../src/export/packaging/zip-writer';
import {
  verifyPackageZip,
  type ExpectedZipEntry,
} from '../../../src/export/packaging/zip-verifier';
import { makeEntry, type PackageEntry } from '../../../src/export/packaging/package-entry';
import {
  ExportFormat,
  ExportScope,
  ValidationSeverity,
  type CoverId,
  type GroupId,
  type OutputAId,
  type OutputBId,
  type Project,
  type SceneId,
  type SessionId,
} from '../../../src/shared/domain-model';
import { APP_CONFIG } from '../../../src/config/app-config';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
} from '../fixtures';
import { createPackageFixture, packageInputFromFormatter } from './fixtures';
import {
  assembleRawZip,
  buildLocalBlock,
  crc32Of,
  findCentralHeaderOffset,
  findEocdOffset,
  insertBytesIntoLocalRegion,
  localHeaderOffsetFor,
  readU16,
  readU32,
  reorderLocalBlocks,
  writeU16,
  writeU32,
} from './zip-byte-helpers';
import { parseZip } from '../../../src/export/packaging/zip-verifier';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Wraps a raw `ExportPlanResult` into a full `ExportPackageInput` for direct `packageExport` calls. */
function packageInputFor(planResult: ExportPackageInput['planResult']): ExportPackageInput {
  const { versions, limits, createdAt, exportId } = createPackageFixture();
  return { planResult, versions, limits, createdAt, exportId };
}

interface EntryMutationResult {
  readonly zipBytes: Uint8Array;
  /** The mutated entry's own content bytes, post-mutation. */
  readonly mutatedBytes: Uint8Array;
}

function mutateEntryData(
  zipBytes: Uint8Array,
  filenameSuffix: string,
  mutate: (data: Uint8Array) => void,
): EntryMutationResult {
  const bytes = zipBytes.slice();
  const centralOffset = findCentralHeaderOffset(bytes, filenameSuffix);
  const localOffset = localHeaderOffsetFor(bytes, centralOffset);
  const localNameLength = readU16(bytes, localOffset + 26);
  const localExtraLength = readU16(bytes, localOffset + 28);
  const uncompressedSize = readU32(bytes, centralOffset + 24);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const data = bytes.subarray(dataStart, dataStart + uncompressedSize);
  mutate(data);
  const crc = crc32Of(bytes.slice(dataStart, dataStart + uncompressedSize));
  writeU32(bytes, localOffset + 14, crc);
  writeU32(bytes, centralOffset + 16, crc);
  return { zipBytes: bytes, mutatedBytes: data.slice() };
}

function ledgerFor(
  result: Extract<ReturnType<typeof packageExport>, { ok: true }>,
): ExpectedZipEntry[] {
  return result.entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    checksum: entry.checksum,
  }));
}

/**
 * Second Corrective C3: every internal-document mutation test must prove the
 * *semantic* verifier layer rejects the tamper independently of the outer
 * per-entry checksum ledger. Updating exactly the mutated entry's ledger
 * checksum to match its new bytes makes the outer ledger check pass, so any
 * remaining rejection can only come from `verifyChecksumsFile`/
 * `verifyManifestFile` reconciling the mutated document's own internal
 * claims against the real extracted content.
 */
function ledgerWithUpdatedChecksum(
  ledger: readonly ExpectedZipEntry[],
  pathSuffix: string,
  mutatedBytes: Uint8Array,
): ExpectedZipEntry[] {
  const newChecksum = sha256Bytes(mutatedBytes);
  const updated = ledger.map((entry) =>
    entry.path.endsWith(pathSuffix) ? { ...entry, checksum: newChecksum } : entry,
  );
  expect(updated.some((entry) => entry.path.endsWith(pathSuffix))).toBe(true);
  return updated;
}

/**
 * `checksums.sha256` checksums every real content entry, including
 * manifest.json itself. A manifest.json mutation test that only fixes the
 * outer ledger would still be rejected first by `verifyChecksumsFile`
 * (manifest.json's own checksums.sha256 line would stop matching), which
 * proves nothing about `verifyManifestFile`. This helper additionally
 * re-syncs the checksums.sha256 entry's manifest.json line and its own
 * ledger checksum, isolating the rejection to the manifest semantic layer.
 */
function mutateManifestAndRetargetLedger(
  result: Extract<ReturnType<typeof packageExport>, { ok: true }>,
  mutateManifest: (data: Uint8Array) => void,
): { zipBytes: Uint8Array; ledger: ExpectedZipEntry[] } {
  const manifestMutation = mutateEntryData(result.zipBytes, 'manifest.json', mutateManifest);
  const newManifestChecksum = sha256Bytes(manifestMutation.mutatedBytes);
  const manifestLinePattern = /^[a-f0-9]{64}( {2}manifest\.json)$/mu;
  const checksumsMutation = mutateEntryData(
    manifestMutation.zipBytes,
    'checksums.sha256',
    (data) => {
      const text = new TextDecoder().decode(data);
      expect(manifestLinePattern.test(text)).toBe(true);
      const patched = text.replace(manifestLinePattern, `${newManifestChecksum}$1`);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    },
  );
  let ledger = ledgerFor(result);
  ledger = ledgerWithUpdatedChecksum(ledger, 'manifest.json', manifestMutation.mutatedBytes);
  ledger = ledgerWithUpdatedChecksum(ledger, 'checksums.sha256', checksumsMutation.mutatedBytes);
  return { zipBytes: checksumsMutation.zipBytes, ledger };
}

/** Minimal hand-built two-content-file package, for direct checksums/manifest surgery. */
function buildMinimalPackage(checksumsText: string, manifestBytes: Uint8Array) {
  const promptA = makeEntry(
    'proj/session-01/prompts/A/001_x_A.txt',
    'prompt_a',
    ExportFormat.Txt,
    'text/plain;charset=utf-8',
    encode('Prompt A content.'),
  );
  const readme = makeEntry(
    'proj/README.md',
    'readme',
    'markdown',
    'text/markdown;charset=utf-8',
    encode('# Readme'),
  );
  const manifestEntry = makeEntry(
    'proj/manifest.json',
    'manifest',
    ExportFormat.Json,
    'application/json',
    manifestBytes,
  );
  const checksumsEntry = makeEntry(
    'proj/checksums.sha256',
    'checksums',
    ExportFormat.Txt,
    'text/plain;charset=utf-8',
    encode(checksumsText),
  );
  const entries: PackageEntry[] = [promptA, readme, manifestEntry, checksumsEntry].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const written = writeDeterministicZip(entries, 1000, 50_000_000);
  return { entries, written };
}

describe('First Corrective F1 - reject backup and Prompt Pack scopes', () => {
  const versions = createPackageFixture().versions;

  function packageForScope(scope: ExportPackageInput['planResult']) {
    return packageExport({
      planResult: scope,
      limits: APP_CONFIG.limits.export,
      versions,
      createdAt: '2026-07-26T10:00:00.000Z',
      exportId: 'export-corrective',
    });
  }

  it('rejects a full-project backup plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: { baseScope: ExportScope.All, scopeDetail: 'backup', backupType: 'full_project' },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects a session backup plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: {
        baseScope: ExportScope.All,
        scopeDetail: 'backup',
        backupType: 'session',
        sessionId: CANONICAL_SESSION_ID,
      },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects an all-project Prompt Pack plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: { baseScope: ExportScope.All, scopeDetail: 'prompt_pack' },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });

  it('rejects a session Prompt Pack plan: ok:false, no bytes', () => {
    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      scope: {
        baseScope: ExportScope.Session,
        scopeDetail: 'prompt_pack',
        sessionId: CANONICAL_SESSION_ID,
      },
    });
    expect(planResult.ok).toBe(true);
    const result = packageForScope(planResult);
    expect(result.ok).toBe(false);
    expect('zipBytes' in result).toBe(false);
  });
});

describe('Second Corrective C1 - pair-file emission requires a genuine, cross-verified A/B link', () => {
  function pairPlanResult() {
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[2]! });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    return planResult;
  }

  it('canonical complete pair emits Output A, Output B, and exactly one pair file', () => {
    const result = packageExport(packageInputFor(pairPlanResult()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === 'prompt_a')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'prompt_b')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'prompt_pair')).toHaveLength(1);
  });

  it('hostile plan with Output B linked to a different Output A: fails closed, no bytes (Third Corrective F1)', () => {
    const planResult = pairPlanResult();
    const clonedPlan = structuredClone(planResult.value);
    expect(clonedPlan.selection.outputsB).toHaveLength(1);
    const mutatedPlan = {
      ...clonedPlan,
      selection: {
        ...clonedPlan.selection,
        outputsB: clonedPlan.selection.outputsB.map((outputB) => ({
          ...outputB,
          // A syntactically valid but unrelated Output A id - the resolved
          // plan no longer actually links this B back to the selected A,
          // even though both individually still look well-formed.
          sourceOutputAId: 'output-a-unrelated-hostile-id' as OutputAId,
        })),
      },
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutatedPlan }));
    // A relationally-corrupt B->A link must fail the whole packaging
    // operation, not merely suppress prompt_pair while still emitting an
    // Output B prompt under a false source relationship.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_LINK_001')).toBe(true);
    expect('zipBytes' in result).toBe(false);
    expect('manifestBytes' in result).toBe(false);
  });

  it('hostile plan whose numbering disagrees with an otherwise-consistent A/B selection: fails closed, no bytes', () => {
    const planResult = pairPlanResult();
    const clonedPlan = structuredClone(planResult.value);
    expect(clonedPlan.numbering.length).toBeGreaterThan(0);
    // selection.outputsA/outputsB remain mutually consistent with each other,
    // but plan.numbering - the independent second signal - is mutated to
    // reference a different Output B id, so it no longer corroborates.
    const mutatedPlan = {
      ...clonedPlan,
      numbering: clonedPlan.numbering.map((entry) =>
        entry.outputBId !== undefined
          ? { ...entry, outputBId: 'output-b-unrelated-hostile-id' as (typeof entry)['outputBId'] }
          : entry,
      ),
    };
    const result = packageExport(packageInputFor({ ok: true, value: mutatedPlan }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_LINK_001')).toBe(true);
    expect('zipBytes' in result).toBe(false);
  });

  it('canonical (non-hostile) plans with Output B selected but no Output A selected for that scene are unaffected (e.g. output_b/group_b policy)', () => {
    // Output A is legitimately absent from `selection.outputsA` for scopes
    // whose content policy never selects it (output_b/group_b); this must
    // never be mistaken for a broken linkage.
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[1]! });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.value.selection.outputsA).toHaveLength(0);
    expect(planResult.value.selection.outputsB).toHaveLength(1);
    const result = packageExport(packageInputFor(planResult));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.some((entry) => entry.kind === 'prompt_b')).toBe(true);
  });
});

describe('Third Corrective F2 - pair eligibility keyed by complete session+scene identity (no cross-session leakage)', () => {
  /**
   * Builds a real, planner-produced two-session `complete_project` plan where
   * BOTH sessions' single scene deliberately reuses the exact same
   * `SceneId` value - shape-valid (scene IDs are only guaranteed unique
   * within a session, per the domain model), but adversarial. Session 2's
   * own selected Output A/B are then stripped from the resulting plan (its
   * `plan.numbering` row - built independently of selection - still exists
   * and still carries the reused scene id), reproducing the exact "no
   * selected Output A or B for session 2" hostile scenario from the audit.
   */
  function crossSessionHostilePlan() {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const original = project.sessions[CANONICAL_SESSION_ID]!;
    const originalScene = original.scenes[CANONICAL_SCENE_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const secondOutputAId = 'output-a-second' as OutputAId;
    const secondOutputBId = 'output-b-second' as OutputBId;
    // Deliberately reuse CANONICAL_SCENE_ID (not a fresh id) for the second
    // session's only scene - shape-valid, since scene ids are only unique
    // within a session - while every other identity (session, group, cover,
    // Output A/B ids) is fresh and distinct, so this is otherwise a normal,
    // internally-consistent second session.
    const secondScene = {
      ...originalScene,
      sessionId: secondSessionId,
      outputA: { ...originalScene.outputA, id: secondOutputAId, sceneId: CANONICAL_SCENE_ID },
      outputB: {
        ...originalScene.outputB!,
        id: secondOutputBId,
        sceneId: CANONICAL_SCENE_ID,
        sourceOutputAId: secondOutputAId,
      },
    };
    const secondGroupId = 'group-second' as GroupId;
    const secondSession = {
      ...original,
      id: secondSessionId,
      scenes: { [CANONICAL_SCENE_ID]: secondScene },
      groups: {
        [secondGroupId]: {
          ...Object.values(original.groups)[0]!,
          id: secondGroupId,
          sessionId: secondSessionId,
          sceneIds: [CANONICAL_SCENE_ID],
        },
      },
      cover: {
        ...original.cover!,
        id: 'cover-second' as CoverId,
        sessionId: secondSessionId,
        sourceSaleImageIds: [secondOutputAId],
      },
    };
    project.sessions = { [CANONICAL_SESSION_ID]: original, [secondSessionId]: secondSession };
    project.sessionOrder = [CANONICAL_SESSION_ID, secondSessionId];

    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');

    // Both sessions currently have their OWN genuinely-selected, genuinely-
    // linked Output A/B for the reused scene id (planner-produced, fully
    // consistent) - confirm that before stripping session 2's selection.
    const session2A = planResult.value.selection.outputsA.filter(
      (item) => item.sessionId === secondSessionId,
    );
    const session2B = planResult.value.selection.outputsB.filter(
      (item) => item.sessionId === secondSessionId,
    );
    expect(session2A).toHaveLength(1);
    expect(session2B).toHaveLength(1);
    expect(
      planResult.value.numbering.filter((item) => item.sceneId === CANONICAL_SCENE_ID),
    ).toHaveLength(2);

    // Now strip session 2's own selected A/B, leaving its numbering row
    // (which still carries the reused scene id) as the only remaining trace.
    const hostilePlan = {
      ...planResult.value,
      selection: {
        ...planResult.value.selection,
        outputsA: planResult.value.selection.outputsA.filter(
          (item) => item.sessionId !== secondSessionId,
        ),
        outputsB: planResult.value.selection.outputsB.filter(
          (item) => item.sessionId !== secondSessionId,
        ),
      },
    };
    return { hostilePlan, secondSessionId };
  }

  it('a shape-valid hostile plan reusing a sceneId across two sessions never lets session 1 authorize a pair file in session 2', () => {
    const { hostilePlan } = crossSessionHostilePlan();
    const result = packageExport(
      packageInputFromFormatter({
        planResult: { ok: true, value: hostilePlan },
        limits: APP_CONFIG.limits.export,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // session-02 must carry no prompt_pair, prompt_a, or prompt_b - its own
    // selection was stripped, and session 1's real A/B/pair must never be
    // borrowed for it merely because the scene id happens to match.
    const session02Kinds = result.entries
      .filter((entry) => entry.path.includes('/session-02/'))
      .map((entry) => entry.kind);
    expect(session02Kinds).not.toContain('prompt_pair');
    expect(session02Kinds).not.toContain('prompt_a');
    expect(session02Kinds).not.toContain('prompt_b');
    // Session 1's own legitimate pair is unaffected.
    const session01Kinds = result.entries
      .filter((entry) => entry.path.includes('/session-01/'))
      .map((entry) => entry.kind);
    expect(session01Kinds).toContain('prompt_pair');
    expect(session01Kinds).toContain('prompt_a');
    expect(session01Kinds).toContain('prompt_b');
  });

  it('session 2 numbering forged to reference session 1 real output ids, with no Output A or B selected for session 2, does not cross-contaminate either session', () => {
    // Fourth Corrective audit F4: despite the title this test carried before,
    // its two numbering rows belong to two DIFFERENT session identities, not
    // one reused identity - this is cross-session forgery of a numbering row
    // that has no corresponding selected Output A/B at all for session 2 (so
    // it can never drive pair-file emission on its own), not a true
    // same-identity duplicate. See the "Fourth Corrective C1/C2" describe
    // block below for the actual same-identity duplicate-numbering-row tests.
    const { hostilePlan } = crossSessionHostilePlan();
    // Additionally corrupt session 2's numbering row to point at session 1's
    // real output ids directly (an even more direct forgery attempt).
    const session1Numbering = hostilePlan.numbering.find(
      (item) => item.sessionId === CANONICAL_SESSION_ID,
    )!;
    const forgedPlan = {
      ...hostilePlan,
      numbering: hostilePlan.numbering.map((entry) =>
        entry.sessionId !== CANONICAL_SESSION_ID
          ? {
              ...entry,
              outputAId: session1Numbering.outputAId,
              outputBId: session1Numbering.outputBId,
            }
          : entry,
      ),
    };
    const result = packageExport(
      packageInputFromFormatter({
        planResult: { ok: true, value: forgedPlan },
        limits: APP_CONFIG.limits.export,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session02Kinds = result.entries
      .filter((entry) => entry.path.includes('/session-02/'))
      .map((entry) => entry.kind);
    expect(session02Kinds).not.toContain('prompt_pair');
  });
});

describe('Fourth Corrective C1/C2 - exact relational cardinality and B-only linkage validation', () => {
  function singleSessionPairPlan() {
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[2]! });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    return structuredClone(planResult.value);
  }

  function singleSessionOutputBOnlyPlan() {
    const planResult = createExportPlan({ ...CANONICAL_EXPORT_INPUT, scope: CANONICAL_SCOPES[1]! });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    expect(planResult.value.selection.outputsA).toHaveLength(0);
    expect(planResult.value.selection.outputsB).toHaveLength(1);
    return structuredClone(planResult.value);
  }

  /** Two real sessions, each with its own distinct scene, fully valid and mutually independent A/B pair. */
  function twoSessionPairPlan() {
    const project = structuredClone(CANONICAL_PROJECT) as Project;
    const original = project.sessions[CANONICAL_SESSION_ID]!;
    const originalScene = original.scenes[CANONICAL_SCENE_ID]!;
    const secondSessionId = 'session-second' as SessionId;
    const secondSceneId = 'scene-second' as SceneId;
    const secondOutputAId = 'output-a-second' as OutputAId;
    const secondOutputBId = 'output-b-second' as OutputBId;
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
    const secondGroupId = 'group-second' as GroupId;
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
        id: 'cover-second' as CoverId,
        sessionId: secondSessionId,
        sourceSaleImageIds: [secondOutputAId],
      },
    };
    project.sessions = { [CANONICAL_SESSION_ID]: original, [secondSessionId]: secondSession };
    project.sessionOrder = [CANONICAL_SESSION_ID, secondSessionId];

    const planResult = createExportPlan({
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: { baseScope: ExportScope.All, scopeDetail: 'complete_project' },
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('unreachable');
    return { plan: structuredClone(planResult.value), secondSessionId, secondSceneId };
  }

  function expectRelationalFailure(plan: ReturnType<typeof singleSessionPairPlan>): void {
    const result = packageExport(packageInputFor({ ok: true, value: plan }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_LINK_001')).toBe(true);
    expect('zipBytes' in result).toBe(false);
  }

  describe('pair-bearing scopes', () => {
    it('Output B moved to a different (but real, in-scope) session: typed failure', () => {
      const { plan, secondSessionId } = twoSessionPairPlan();
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsB: plan.selection.outputsB.map((outputB) =>
            outputB.sessionId === secondSessionId
              ? { ...outputB, sessionId: CANONICAL_SESSION_ID }
              : outputB,
          ),
        },
      };
      expectRelationalFailure(mutated);
    });

    it('Output B moved to a different (but real, in-scope) scene: typed failure', () => {
      const { plan, secondSessionId } = twoSessionPairPlan();
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsB: plan.selection.outputsB.map((outputB) =>
            outputB.sessionId === secondSessionId
              ? { ...outputB, sceneId: CANONICAL_SCENE_ID }
              : outputB,
          ),
        },
      };
      expectRelationalFailure(mutated);
    });

    it('Output B present in pair scope with the selected Output A removed entirely: typed failure', () => {
      const plan = singleSessionPairPlan();
      expectRelationalFailure({ ...plan, selection: { ...plan.selection, outputsA: [] } });
    });

    it('duplicate selected Output A for the same identity: typed failure', () => {
      const plan = singleSessionPairPlan();
      const originalA = plan.selection.outputsA[0]!;
      const duplicateA = { ...originalA, id: 'output-a-duplicate-hostile-id' as OutputAId };
      expectRelationalFailure({
        ...plan,
        selection: { ...plan.selection, outputsA: [originalA, duplicateA] },
      });
    });

    it('duplicate selected Output B for the same identity: typed failure', () => {
      const plan = singleSessionPairPlan();
      const originalB = plan.selection.outputsB[0]!;
      const duplicateB = { ...originalB, id: 'output-b-duplicate-hostile-id' as OutputBId };
      expectRelationalFailure({
        ...plan,
        selection: { ...plan.selection, outputsB: [originalB, duplicateB] },
      });
    });

    it('missing numbering row for a selected pair: typed failure', () => {
      const plan = singleSessionPairPlan();
      expectRelationalFailure({ ...plan, numbering: [] });
    });

    it('duplicate identical numbering row for the same identity: typed failure', () => {
      const plan = singleSessionPairPlan();
      const originalEntry = plan.numbering[0]!;
      expectRelationalFailure({ ...plan, numbering: [originalEntry, { ...originalEntry }] });
    });

    it('valid numbering row followed by a conflicting duplicate: typed failure', () => {
      const plan = singleSessionPairPlan();
      const originalEntry = plan.numbering[0]!;
      const conflictingEntry = {
        ...originalEntry,
        outputAId: 'output-a-conflicting-hostile-id' as OutputAId,
        outputBId: 'output-b-conflicting-hostile-id' as OutputBId,
      };
      expectRelationalFailure({ ...plan, numbering: [originalEntry, conflictingEntry] });
    });

    it('the same valid+conflicting numbering rows in reverse order: identical typed failure (order-independent)', () => {
      const plan = singleSessionPairPlan();
      const originalEntry = plan.numbering[0]!;
      const conflictingEntry = {
        ...originalEntry,
        outputAId: 'output-a-conflicting-hostile-id' as OutputAId,
        outputBId: 'output-b-conflicting-hostile-id' as OutputBId,
      };
      const forward = packageExport(
        packageInputFor({
          ok: true,
          value: { ...plan, numbering: [originalEntry, conflictingEntry] },
        }),
      );
      const reversed = packageExport(
        packageInputFor({
          ok: true,
          value: { ...plan, numbering: [conflictingEntry, originalEntry] },
        }),
      );
      expect(forward.ok).toBe(false);
      expect(reversed.ok).toBe(false);
      if (forward.ok || reversed.ok) return;
      expect(forward.failures.map((failure) => failure.code)).toEqual(
        reversed.failures.map((failure) => failure.code),
      );
      expect(forward.failures[0]!.code).toBe('EXPORT_LINK_001');
    });

    it('numbering.outputAId mismatch (distinct from an outputBId mismatch): typed failure', () => {
      const plan = singleSessionPairPlan();
      expectRelationalFailure({
        ...plan,
        numbering: plan.numbering.map((entry) => ({
          ...entry,
          outputAId: 'output-a-unrelated-hostile-id' as OutputAId,
        })),
      });
    });

    it('a selected output whose session is outside plan.scope.sessionIds entirely: typed failure', () => {
      const plan = singleSessionPairPlan();
      expectRelationalFailure({
        ...plan,
        selection: {
          ...plan.selection,
          outputsA: plan.selection.outputsA.map((outputA) => ({
            ...outputA,
            sessionId: 'session-totally-unrelated' as SessionId,
          })),
        },
      });
    });

    it('a selected output whose scene is outside a non-empty plan.scope.sceneIds: typed failure', () => {
      const plan = singleSessionPairPlan();
      expect(plan.scope.sceneIds.length).toBeGreaterThan(0);
      expectRelationalFailure({
        ...plan,
        selection: {
          ...plan.selection,
          outputsA: plan.selection.outputsA.map((outputA) => ({
            ...outputA,
            sceneId: 'scene-totally-unrelated' as SceneId,
          })),
        },
      });
    });
  });

  describe('B-only scopes (output_b/group_b)', () => {
    it('false sourceOutputAId: typed failure', () => {
      const plan = singleSessionOutputBOnlyPlan();
      expectRelationalFailure({
        ...plan,
        selection: {
          ...plan.selection,
          outputsB: plan.selection.outputsB.map((outputB) => ({
            ...outputB,
            sourceOutputAId: 'output-a-unrelated-hostile-id' as OutputAId,
          })),
        },
      });
    });

    it('wrong numbering.outputAId (disagrees with the real sourceOutputAId): typed failure', () => {
      const plan = singleSessionOutputBOnlyPlan();
      expectRelationalFailure({
        ...plan,
        numbering: plan.numbering.map((entry) => ({
          ...entry,
          outputAId: 'output-a-unrelated-hostile-id' as OutputAId,
        })),
      });
    });

    it('wrong numbering.outputBId: typed failure', () => {
      const plan = singleSessionOutputBOnlyPlan();
      expectRelationalFailure({
        ...plan,
        numbering: plan.numbering.map((entry) => ({
          ...entry,
          outputBId: 'output-b-unrelated-hostile-id' as OutputBId,
        })),
      });
    });

    it('missing numbering row: typed failure', () => {
      const plan = singleSessionOutputBOnlyPlan();
      expectRelationalFailure({ ...plan, numbering: [] });
    });

    it('duplicate/conflicting numbering row for the same identity: typed failure', () => {
      const plan = singleSessionOutputBOnlyPlan();
      const originalEntry = plan.numbering[0]!;
      expectRelationalFailure({ ...plan, numbering: [originalEntry, { ...originalEntry }] });
    });
  });

  describe('cross-session reused-identity scopes', () => {
    it('two real sessions each with their own valid, independent pair: both succeed, no cross-contamination', () => {
      const { plan } = twoSessionPairPlan();
      const result = packageExport(packageInputFor({ ok: true, value: plan }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const kinds = (folder: string) =>
        result.entries.filter((entry) => entry.path.includes(`/${folder}/`)).map((e) => e.kind);
      for (const folder of ['session-01', 'session-02']) {
        expect(kinds(folder)).toContain('prompt_a');
        expect(kinds(folder)).toContain('prompt_b');
        expect(kinds(folder)).toContain('prompt_pair');
      }
    });

    it('session order reversed: identical (successful) result regardless of array insertion order', () => {
      const { plan } = twoSessionPairPlan();
      const forward = packageExport(packageInputFor({ ok: true, value: plan }));
      const reversedPlan = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsA: [...plan.selection.outputsA].reverse(),
          outputsB: [...plan.selection.outputsB].reverse(),
        },
        numbering: [...plan.numbering].reverse(),
      };
      const reversed = packageExport(packageInputFor({ ok: true, value: reversedPlan }));
      expect(forward.ok).toBe(true);
      expect(reversed.ok).toBe(true);
      if (!forward.ok || !reversed.ok) return;
      // Aggregate, whole-project files (README/manifest/checksums) legitimately
      // document sessions in the order they appear in the plan's arrays, so
      // reversing that order changes their listing text (and therefore their
      // checksum) without indicating any relational-integrity problem. Every
      // other file is scoped to a single session+scene by a `.filter`/`.find`
      // keyed on identity, not by array position, so its content - and
      // checksum - must stay byte-identical regardless of insertion order.
      const AGGREGATE_KINDS = new Set(['readme', 'manifest', 'checksums']);
      const normalize = (entry: (typeof forward.entries)[number]) =>
        AGGREGATE_KINDS.has(entry.kind)
          ? { path: entry.path, kind: entry.kind, byteLength: entry.byteLength }
          : entry;
      const sortByPath = (entries: typeof forward.entries) =>
        [...entries].map(normalize).sort((a, b) => (a.path < b.path ? -1 : 1));
      expect(sortByPath(reversed.entries)).toEqual(sortByPath(forward.entries));
    });

    it('session 2 Output B points at session 1 Output A (both sessions otherwise real and independent): typed failure', () => {
      const { plan, secondSessionId } = twoSessionPairPlan();
      const session1OutputA = plan.selection.outputsA.find(
        (item) => item.sessionId === CANONICAL_SESSION_ID,
      )!;
      const mutated = {
        ...plan,
        selection: {
          ...plan.selection,
          outputsB: plan.selection.outputsB.map((outputB) =>
            outputB.sessionId === secondSessionId
              ? { ...outputB, sourceOutputAId: session1OutputA.id }
              : outputB,
          ),
        },
      };
      expectRelationalFailure(mutated);
    });

    it('session 2 numbering forged to reference session 1 ids while session 2 Output B is still genuinely selected: typed failure', () => {
      const { plan, secondSessionId } = twoSessionPairPlan();
      const session1Numbering = plan.numbering.find(
        (item) => item.sessionId === CANONICAL_SESSION_ID,
      )!;
      const mutated = {
        ...plan,
        numbering: plan.numbering.map((entry) =>
          entry.sessionId === secondSessionId
            ? {
                ...entry,
                outputAId: session1Numbering.outputAId,
                outputBId: session1Numbering.outputBId,
              }
            : entry,
        ),
      };
      expectRelationalFailure(mutated);
    });
  });
});

describe('First Corrective F3 - checksums.sha256 semantic verification', () => {
  it('detects a checksums.sha256 line changed while the CRC is recomputed for it', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Flip one hex character within the checksums.sha256 body text itself; the
    // CRC of the (mutated) checksums.sha256 entry is recomputed so the ZIP
    // structure alone looks valid - only semantic reconciliation catches this.
    const { zipBytes, mutatedBytes } = mutateEntryData(
      result.zipBytes,
      'checksums.sha256',
      (data) => {
        const text = new TextDecoder().decode(data);
        const index = text.search(/[a-f0-9]{64}/u);
        expect(index).toBeGreaterThanOrEqual(0);
        const flipped = data[index] === 0x61 ? 0x62 : 0x61; // 'a' <-> 'b'
        data[index] = flipped;
      },
    );
    // C3: update the ledger's own checksums.sha256 checksum to match the
    // mutated bytes, so the outer per-entry ledger check passes and the
    // rejection can only come from the semantic checksums.sha256 layer.
    const ledger = ledgerWithUpdatedChecksum(ledgerFor(result), 'checksums.sha256', mutatedBytes);
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('checksums_hash_mismatch');
  });

  it('detects a missing checksum line', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    // Deliberately omit the README.md line.
    const text = `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    void readmeChecksum;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects an extra (unexpected) checksum line', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    const bogusChecksum = sha256Bytes(encode('bogus'));
    const text =
      `${readmeChecksum}  README.md\n` +
      `${bogusChecksum}  nonexistent-file.txt\n` +
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects a duplicate checksum path', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    const text =
      `${readmeChecksum}  README.md\n` +
      `${readmeChecksum}  README.md\n` +
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });

  it('detects unsorted checksum paths', () => {
    const contentChecksum = sha256Bytes(encode('Prompt A content.'));
    const readmeChecksum = sha256Bytes(encode('# Readme'));
    // 'session-01/...' sorts after 'README.md' byte-lexicographically; reverse it.
    const text =
      `${contentChecksum}  session-01/prompts/A/001_x_A.txt\n` + `${readmeChecksum}  README.md\n`;
    const manifestBytes = encode('{}');
    const { written } = buildMinimalPackage(text, manifestBytes);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const expected: ExpectedZipEntry[] = [
      {
        path: 'proj/session-01/prompts/A/001_x_A.txt',
        kind: 'prompt_a',
        checksum: contentChecksum,
      },
      { path: 'proj/README.md', kind: 'readme', checksum: readmeChecksum },
      { path: 'proj/manifest.json', kind: 'manifest', checksum: sha256Bytes(manifestBytes) },
      { path: 'proj/checksums.sha256', kind: 'checksums', checksum: sha256Bytes(encode(text)) },
    ];
    expect(verifyPackageZip(written.bytes, expected).ok).toBe(false);
  });
});

describe('First Corrective F3 - manifest.json semantic verification', () => {
  it('detects a manifest included-file path mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      // Target the `includedFiles[].path` field specifically (the `"path": `
      // prefix disambiguates it from the same string used as a bare object
      // key in the alphabetically-earlier `checksums`/`fileSizes` sections).
      const target = '"path": "session-01/prompts/A/001_tee-front_A.txt"';
      const replacement = '"path": "session-01/prompts/A/zzzzzzzzzzzzzzzzzzz"';
      expect(replacement.length).toBe(target.length);
      const patched = text.replace(target, replacement);
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    // Renaming an includedFiles[].path leaves the OLD path as a now-orphaned
    // key in fileSizes/checksums (C2: an extra bookkeeping key is rejected on
    // its own, even before the renamed/bogus path is checked against real
    // content), and fileSizes is reconciled ahead of checksums.
    expect(verification.reason).toBe('manifest_filesizes_extra_path');
  });

  it('detects a manifest fileSizes mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      const match = /"README\.md":\s*(\d+)/u.exec(text);
      expect(match).not.toBeNull();
      const original = match![1]!;
      const replacement = String(Number(original) + 1).padStart(original.length, '0');
      expect(replacement.length).toBe(original.length);
      const patched = text.replace(`"README.md": ${original}`, `"README.md": ${replacement}`);
      expect(patched).not.toBe(text);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('detects a manifest checksums mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      const index = text.indexOf('"checksums"');
      const hashIndex = text.slice(index).search(/[a-f0-9]{64}/u) + index;
      expect(hashIndex).toBeGreaterThan(index);
      const flipped = data[hashIndex] === 0x61 ? 0x62 : 0x61;
      data[hashIndex] = flipped;
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksum_mismatch');
  });

  it('detects a manifest kind mismatch', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { zipBytes, ledger } = mutateManifestAndRetargetLedger(result, (data) => {
      const text = new TextDecoder().decode(data);
      // Same character count as "readme" so the JSON payload length is unchanged.
      const patched = text.replace('"kind": "readme"', '"kind": "readmf"');
      expect(patched).not.toBe(text);
      expect(patched.length).toBe(text.length);
      data.set(new TextEncoder().encode(patched));
    });
    const verification = verifyPackageZip(zipBytes, ledger);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_kind_mismatch');
  });
});

const README_BYTES = encode('# Readme');
const PROMPT_A_BYTES = encode('Prompt A content.');
const README_PATH = 'README.md';
const PROMPT_A_PATH = 'session-01/prompts/A/001_x_A.txt';

interface MinimalManifestFields {
  readonly includedFiles: readonly { readonly path: string; readonly kind: string }[];
  readonly fileSizes: Readonly<Record<string, number>>;
  readonly checksums: Readonly<Record<string, string>>;
}

function omitPath<T>(record: Readonly<Record<string, T>>, path: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== path));
}

/** A schema-valid manifest DTO covering exactly `README.md` + the one prompt-A file. */
function baseManifestFields(): MinimalManifestFields {
  return {
    includedFiles: [
      { path: README_PATH, kind: 'readme' },
      { path: PROMPT_A_PATH, kind: 'prompt_a' },
    ],
    fileSizes: {
      [README_PATH]: README_BYTES.byteLength,
      [PROMPT_A_PATH]: PROMPT_A_BYTES.byteLength,
    },
    checksums: {
      [README_PATH]: sha256Bytes(README_BYTES),
      [PROMPT_A_PATH]: sha256Bytes(PROMPT_A_BYTES),
    },
  };
}

function fullManifestObject(fields: MinimalManifestFields): Record<string, unknown> {
  return {
    exportId: 'export-corrective',
    schemaVersion: 1,
    projectId: 'project-corrective',
    sessionIds: ['session-01'],
    exportScope: 'session',
    scopeDetail: 'session',
    exportFormats: ['zip'],
    createdAt: '2026-07-26T10:00:00.000Z',
    applicationVersion: '0.1.0',
    generatorVersion: '0.1.0',
    ruleSetVersions: {},
    promptModuleVersions: {},
    includedFiles: fields.includedFiles,
    fileSizes: fields.fileSizes,
    checksums: fields.checksums,
    warnings: [],
    sourceFingerprints: { sessionFingerprint: 'a'.repeat(64) },
  };
}

/**
 * Builds a minimal package whose `checksums.sha256` fully and correctly
 * reconciles (README.md, the prompt-A file, and manifest.json itself), so
 * that any rejection can only come from `verifyManifestFile` reconciling the
 * given (possibly defective) manifest fields - never the checksums layer.
 */
function buildManifestReconciliationCase(fields: MinimalManifestFields): {
  readonly zipBytes: Uint8Array;
  readonly expected: ExpectedZipEntry[];
} {
  const manifestBytes = encode(JSON.stringify(fullManifestObject(fields)));
  const manifestChecksum = sha256Bytes(manifestBytes);
  const lines = [
    { path: README_PATH, checksum: sha256Bytes(README_BYTES) },
    { path: 'manifest.json', checksum: manifestChecksum },
    { path: PROMPT_A_PATH, checksum: sha256Bytes(PROMPT_A_BYTES) },
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const checksumsText = lines.map((line) => `${line.checksum}  ${line.path}\n`).join('');
  const { entries, written } = buildMinimalPackage(checksumsText, manifestBytes);
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error('unreachable');
  const expected: ExpectedZipEntry[] = entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    checksum: entry.checksum,
  }));
  return { zipBytes: written.bytes, expected };
}

describe('Second Corrective C2 - manifest map exactness (extra/missing bookkeeping keys, unsafe paths)', () => {
  it('rejects an extra fileSizes key not present in includedFiles', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      fileSizes: { ...fields.fileSizes, 'bogus-extra.txt': 5 },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_filesizes_extra_path');
  });

  it('rejects an extra checksums key not present in includedFiles', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      checksums: { ...fields.checksums, 'bogus-extra.txt': 'a'.repeat(64) },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksums_extra_path');
  });

  it('rejects a missing fileSizes key for an included path', () => {
    const fields = baseManifestFields();
    const fileSizes = omitPath(fields.fileSizes, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({ ...fields, fileSizes });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('rejects a missing checksums key for an included path', () => {
    const fields = baseManifestFields();
    const checksums = omitPath(fields.checksums, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({ ...fields, checksums });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_checksum_mismatch');
  });

  it('rejects an included path absent from both fileSizes and checksums', () => {
    const fields = baseManifestFields();
    const fileSizes = omitPath(fields.fileSizes, README_PATH);
    const checksums = omitPath(fields.checksums, README_PATH);
    const { zipBytes, expected } = buildManifestReconciliationCase({
      ...fields,
      fileSizes,
      checksums,
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_size_mismatch');
  });

  it('rejects a real content path (README.md) absent from includedFiles/fileSizes/checksums entirely', () => {
    const fields = baseManifestFields();
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: fields.includedFiles.filter((file) => file.path !== README_PATH),
      fileSizes: Object.fromEntries(
        Object.entries(fields.fileSizes).filter(([path]) => path !== README_PATH),
      ),
      checksums: Object.fromEntries(
        Object.entries(fields.checksums).filter(([path]) => path !== README_PATH),
      ),
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_missing_path');
  });

  it('rejects an unsafe (backslash) bookkeeping path in includedFiles', () => {
    // `..`/leading-`/` are already rejected by the manifest JSON schema's own
    // `path` pattern (-> manifest_schema_invalid); a backslash passes that
    // pattern but is still unsafe as a ZIP-relative path, so it specifically
    // exercises the defense-in-depth `isSafeZipPath` check in the semantic
    // verifier itself.
    const fields = baseManifestFields();
    const unsafePath = 'evil\\backslash.txt';
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: [
        { path: unsafePath, kind: 'readme' },
        { path: PROMPT_A_PATH, kind: 'prompt_a' },
      ],
      fileSizes: {
        [unsafePath]: fields.fileSizes[README_PATH]!,
        [PROMPT_A_PATH]: fields.fileSizes[PROMPT_A_PATH]!,
      },
      checksums: {
        [unsafePath]: fields.checksums[README_PATH]!,
        [PROMPT_A_PATH]: fields.checksums[PROMPT_A_PATH]!,
      },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_unsafe_path');
  });

  it('rejects a manifest schema-invalid path-traversal bookkeeping path (schema layer)', () => {
    const fields = baseManifestFields();
    const traversalPath = '../../etc/evil.txt';
    const { zipBytes, expected } = buildManifestReconciliationCase({
      includedFiles: [
        { path: traversalPath, kind: 'readme' },
        { path: PROMPT_A_PATH, kind: 'prompt_a' },
      ],
      fileSizes: {
        [traversalPath]: fields.fileSizes[README_PATH]!,
        [PROMPT_A_PATH]: fields.fileSizes[PROMPT_A_PATH]!,
      },
      checksums: {
        [traversalPath]: fields.checksums[README_PATH]!,
        [PROMPT_A_PATH]: fields.checksums[PROMPT_A_PATH]!,
      },
    });
    const verification = verifyPackageZip(zipBytes, expected);
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('manifest_schema_invalid');
  });
});

describe('First Corrective F4 - local/central header reconciliation and fixed metadata', () => {
  it('detects local filename differing from central filename', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'checksums.sha256');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    const nameLength = readU16(bytes, localOffset + 26);
    const nameStart = localOffset + 30;
    // Flip the last character of the local filename only (same length).
    bytes[nameStart + nameLength - 1] = bytes[nameStart + nameLength - 1]! ^ 0x20;
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('local_central_filename_mismatch');
  });

  it('detects local general-purpose flag differing from central flag', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 6, 0x0000);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('local_central_flag_mismatch');
  });

  it('detects a non-fixed general-purpose flag shared by both headers', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 6, 0x0000);
    writeU16(bytes, centralOffset + 8, 0x0000);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_general_purpose_flag');
  });

  it('detects a non-zero central extra field length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 30, 4);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('central_extra_field_present');
  });

  it('detects a non-zero local extra field length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    const localOffset = localHeaderOffsetFor(bytes, centralOffset);
    writeU16(bytes, localOffset + 28, 4);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('local_extra_field_present');
  });

  it('detects a non-zero file comment length', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 32, 4);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('central_file_comment_present');
  });

  it('detects central-directory trailing bytes', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const original = result.zipBytes;
    const eocd = findEocdOffset(original);
    const junkSize = 4;
    const bytes = new Uint8Array(original.length + junkSize);
    bytes.set(original.slice(0, eocd), 0);
    bytes.set(new Uint8Array(junkSize).fill(0xaa), eocd);
    bytes.set(original.slice(eocd), eocd + junkSize);
    const newEocd = eocd + junkSize;
    const originalSize = readU32(original, eocd + 12);
    writeU32(bytes, newEocd + 12, originalSize + junkSize);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('trailing_central_directory_bytes');
  });

  it('detects a symlink-shaped external attributes value with the precise symlink_entry_rejected reason (Third Corrective F5)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    // Unix mode 0o120777 (symlink, S_IFLNK) in the upper 16 bits.
    writeU32(bytes, centralOffset + 38, (0o120777 << 16) >>> 0);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    // The symlink-specific check now runs before the generic non-zero
    // external-attributes check, so this exact reason is actually reachable
    // rather than permanently shadowed by a more generic one.
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('symlink_entry_rejected');
  });

  it('detects a non-zero, non-symlink external attributes value with the generic unexpected_external_attributes reason', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    // A non-zero external attributes value whose Unix file-type bits (upper
    // 16 bits, masked with 0xf000) are NOT S_IFLNK - a regular-file mode
    // with an unexpected read-only/DOS-archive bit set, not a symlink.
    writeU32(bytes, centralOffset + 38, (0o100644 << 16) >>> 0);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_external_attributes');
  });
});

describe('Second Corrective C4 - full 16-bit "version made by" platform lock', () => {
  it('rejects a 0x0314 Unix platform sharing the same low version byte', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0314);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('rejects another non-zero platform high byte (0x0114) with the same low version byte', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0114);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('rejects an altered low version byte (0x0013) on the canonical MS-DOS platform', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0013);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_version_made_by');
  });

  it('accepts the unchanged canonical 0x0014 value', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const centralOffset = findCentralHeaderOffset(bytes, 'README.md');
    writeU16(bytes, centralOffset + 4, 0x0014);
    expect(verifyPackageZip(bytes, ledgerFor(result)).ok).toBe(true);
  });
});

describe('Third Corrective F3 - complete canonical local-byte-range coverage (no hidden/unaccounted bytes)', () => {
  it('accepts the unmodified canonical archive (baseline - full coverage holds)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyPackageZip(result.zipBytes, ledgerFor(result)).ok).toBe(true);
  });

  it('rejects hidden ASCII secret bytes inserted just before the central directory', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const eocd = findEocdOffset(result.zipBytes);
    const centralDirectoryOffset = readU32(result.zipBytes, eocd + 16);
    const hidden = new TextEncoder().encode('SECRET-HIDDEN-BYTES');
    const mutated = insertBytesIntoLocalRegion(result.zipBytes, centralDirectoryOffset, hidden);
    const verification = verifyPackageZip(mutated, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('bytes_before_central_directory');
  });

  it('rejects a hidden PNG signature inserted just before the central directory', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const eocd = findEocdOffset(result.zipBytes);
    const centralDirectoryOffset = readU32(result.zipBytes, eocd + 16);
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mutated = insertBytesIntoLocalRegion(
      result.zipBytes,
      centralDirectoryOffset,
      pngSignature,
    );
    const verification = verifyPackageZip(mutated, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('bytes_before_central_directory');
  });

  it("rejects bytes inserted between two local entries, even though every entry's own recorded range stays internally consistent", () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // README.md is the first entry (byte-lexicographically smallest path);
    // insert right at its data end, immediately before the next entry's
    // local header - the entries before/at the insertion point are
    // untouched, everything after (including the pushed-forward next entry
    // and the central directory) is offset-repaired by the helper.
    const centralOffset = findCentralHeaderOffset(result.zipBytes, 'README.md');
    const localOffset = localHeaderOffsetFor(result.zipBytes, centralOffset);
    const nameLength = readU16(result.zipBytes, localOffset + 26);
    const uncompressedSize = readU32(result.zipBytes, centralOffset + 24);
    const dataEnd = localOffset + 30 + nameLength + uncompressedSize;
    const gapBytes = new TextEncoder().encode('GAP-BYTES-HERE');
    const mutated = insertBytesIntoLocalRegion(result.zipBytes, dataEnd, gapBytes);
    const verification = verifyPackageZip(mutated, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('local_entry_gap');
  });

  it('rejects a prefix inserted before the first local header, even with every offset otherwise repaired', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prefixBytes = new TextEncoder().encode('UNEXPECTED-PREFIX');
    const mutated = insertBytesIntoLocalRegion(result.zipBytes, 0, prefixBytes);
    const verification = verifyPackageZip(mutated, ledgerFor(result));
    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.reason).toBe('structural');
    expect(verification.detail).toBe('unexpected_archive_prefix');
  });

  it('rejects a reused local header offset (two central records pointing at the same local entry)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const readmeCentral = findCentralHeaderOffset(bytes, 'README.md');
    const checksumsCentral = findCentralHeaderOffset(bytes, 'checksums.sha256');
    const readmeLocalOffset = localHeaderOffsetFor(bytes, readmeCentral);
    // Repoint checksums.sha256's central record at README.md's local entry -
    // a full local-header/name/CRC/size mismatch would already be caught by
    // the earlier per-entry reconciliation checks, so this specifically
    // proves the canonical-coverage pass is reached as an additional,
    // independent layer (both checks correctly reject this archive).
    writeU32(bytes, checksumsCentral + 42, readmeLocalOffset);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
  });

  it("rejects overlapping local ranges (a later local header starting inside an earlier entry's data)", () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.zipBytes.slice();
    const readmeCentral = findCentralHeaderOffset(bytes, 'README.md');
    const checksumsCentral = findCentralHeaderOffset(bytes, 'checksums.sha256');
    const readmeLocalOffset = localHeaderOffsetFor(bytes, readmeCentral);
    const readmeNameLength = readU16(bytes, readmeLocalOffset + 26);
    // Point checksums.sha256's local header one byte into README.md's data
    // region - overlapping, not reused, and not a simple gap.
    writeU32(bytes, checksumsCentral + 42, readmeLocalOffset + 30 + readmeNameLength + 1);
    const verification = verifyPackageZip(bytes, ledgerFor(result));
    expect(verification.ok).toBe(false);
  });
});

describe('Third Corrective F4 - writeDeterministicZip rejects unsafe paths directly (public writer, independent of any caller)', () => {
  function entryAt(path: string): PackageEntry {
    return makeEntry(path, 'readme', 'markdown', 'text/markdown;charset=utf-8', encode('# x'));
  }

  const UNSAFE_PATHS = [
    '../evil.txt',
    'a/../../evil.txt',
    '/absolute.txt',
    'C:/drive.txt',
    '\\\\server\\share\\file.txt',
    'a\\b.txt',
    'a/./b.txt',
    'a//b.txt',
    'a\u0000b.txt',
  ];

  for (const unsafePath of UNSAFE_PATHS) {
    it(`rejects ${JSON.stringify(unsafePath)} with no ZIP bytes produced`, () => {
      const result = writeDeterministicZip([entryAt(unsafePath)], 1000, 50_000_000);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('unsafe_path');
      expect('bytes' in result).toBe(false);
    });
  }

  it('rejects a duplicate path with a distinct reason from unsafe_path', () => {
    const result = writeDeterministicZip(
      [entryAt('proj/a.txt'), entryAt('proj/a.txt')],
      1000,
      50_000_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate_path');
  });

  it('rejects an unsorted path list with a distinct reason from unsafe_path', () => {
    const result = writeDeterministicZip(
      [entryAt('proj/b.txt'), entryAt('proj/a.txt')],
      1000,
      50_000_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unordered_entries');
  });

  it('accepts a valid, safe Unicode path deterministically', () => {
    const path = 'proj/session-01/prompts/A/\u{1F4C1}_\u0645\u0644\u0641_A.txt';
    const first = writeDeterministicZip([entryAt(path)], 1000, 50_000_000);
    const second = writeDeterministicZip([entryAt(path)], 1000, 50_000_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.bytes).toEqual(first.bytes);
  });
});

describe('First Corrective F6 - omissions/warnings preserved on post-plan failure', () => {
  it('preserves plan.omissions when a packaging failure occurs after a partial plan', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    expect(fixture.planResult.value.partial).toBe(true);
    expect(fixture.planResult.value.omissions.length).toBeGreaterThan(0);

    // Force a post-plan failure (manifest/checksums overflow) via a tiny byte budget.
    const tinyLimits = { ...fixture.limits, maxJsonBytes: 1 };
    const result = packageExport({ ...fixture, limits: tinyLimits });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });

  it('preserves plan.omissions when ZIP writing itself fails after a partial plan', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    // A tiny archive-size cap does not affect the earlier hostile-input bound
    // checks (those key off maxJsonDepth/maxZipEntries), so this fails inside
    // writeDeterministicZip itself, after a valid partial plan was prepared.
    const tinyLimits = { ...fixture.limits, maxArchiveBytes: 100 };
    const result = packageExport({ ...fixture, limits: tinyLimits });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });
});

describe('Second Corrective C6 - the outer catch path preserves known warnings/omissions', () => {
  it('preserves warnings/omissions when an unexpected exception occurs after a valid plan is prepared', () => {
    const fixture = createPackageFixture({ omitOutputB: true });
    expect(fixture.planResult.ok).toBe(true);
    if (!fixture.planResult.ok) return;
    expect(fixture.planResult.value.omissions.length).toBeGreaterThan(0);

    const injected = new Error('injected-post-plan-fault');
    const result = packageExportWithHooksForTesting(fixture, {
      afterPlanPrepared: () => {
        throw injected;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.some((failure) => failure.code === 'EXPORT_CORRUPT_001')).toBe(true);
    // The whole point of C6: these must be the REAL values from the plan
    // that was already known-good before the injected exception, not empty
    // arrays reset by a naive catch-all.
    expect(result.warnings).toEqual(
      fixture.planResult.value.issues.filter(
        (issue) => issue.severity === ValidationSeverity.Warning,
      ),
    );
    expect(result.omissions).toEqual(fixture.planResult.value.omissions);
    expect(result.omissions.length).toBeGreaterThan(0);
  });
});

describe('First Corrective F10 - semantic calendar validation', () => {
  it('rejects impossible calendar timestamps even when they match the text pattern', () => {
    const base = createPackageFixture();
    for (const invalid of [
      '2026-13-01T00:00:00.000Z',
      '2026-02-30T00:00:00.000Z',
      '2026-01-01T24:00:00.000Z',
      '2026-01-01T00:60:00.000Z',
      '2026-01-01T00:00:60.000Z',
      '2026-00-01T00:00:00.000Z',
      '2026-01-00T00:00:00.000Z',
    ]) {
      const result = packageExport({ ...base, createdAt: invalid });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts valid edge-case calendar timestamps (leap day, year boundary)', () => {
    const base = createPackageFixture();
    for (const valid of ['2024-02-29T23:59:59.999Z', '2026-01-01T00:00:00.000Z']) {
      const result = packageExport({ ...base, createdAt: valid });
      expect(result.ok).toBe(true);
    }
  });
});

describe('Fourth Corrective C4 - canonical local/central physical order enforcement', () => {
  it('accepts a real multi-entry canonical archive unchanged (baseline)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.length).toBeGreaterThanOrEqual(4);
    expect(verifyPackageZip(result.zipBytes, ledgerFor(result)).ok).toBe(true);
  });

  it('rejects two interior local entries physically swapped, even though every entry stays individually well-formed and full byte coverage holds', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entryCount = result.entries.length;
    expect(entryCount).toBeGreaterThanOrEqual(4);
    // Swap the physical position of the two interior entries (indices 1 and
    // 2 in central/path order) - the very first entry stays at offset 0 (so
    // the archive-prefix check alone can't explain the rejection) and total
    // byte coverage is unchanged (so the gap/hidden-bytes checks alone can't
    // explain it either).
    const newOrder = [0, 2, 1, ...Array.from({ length: entryCount - 3 }, (_, i) => i + 3)];
    const swapped = reorderLocalBlocks(result.zipBytes, newOrder);
    const verification = verifyPackageZip(swapped, ledgerFor(result));
    expect(verification.ok).toBe(false);
  });

  it('rejects every local entry physically reversed, even though central-directory record order and total byte coverage are both untouched', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entryCount = result.entries.length;
    expect(entryCount).toBeGreaterThanOrEqual(4);
    const reversedOrder = Array.from({ length: entryCount }, (_, i) => entryCount - 1 - i);
    const reversed = reorderLocalBlocks(result.zipBytes, reversedOrder);
    const verification = verifyPackageZip(reversed, ledgerFor(result));
    expect(verification.ok).toBe(false);
  });

  it('a real unzip-compatible tool may tolerate a physically-reordered archive, but the internal verifier must still reject it', () => {
    // Central-directory bookkeeping alone (name/offset/size/crc) is enough
    // for many real ZIP readers to locate and extract every entry correctly
    // regardless of physical local-entry byte order - which is exactly why
    // canonical *physical* order must be enforced independently in-process,
    // never assumed from "a permissive external tool accepted it".
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entryCount = result.entries.length;
    const reversedOrder = Array.from({ length: entryCount }, (_, i) => entryCount - 1 - i);
    const reversed = reorderLocalBlocks(result.zipBytes, reversedOrder);
    // Every entry's own central-directory bookkeeping (name, crc, size) is
    // still fully self-consistent with the (relocated) local header it
    // points at - a reader that trusts the central directory can still
    // extract every file's correct bytes. Confirmed here by reusing the
    // same CRC recomputation `parseZip`'s own per-entry checks perform,
    // walking strictly by central-directory offset rather than assuming
    // physical order.
    for (const entry of result.entries) {
      const centralOffset = findCentralHeaderOffset(reversed, entry.path.split('/').pop()!);
      const localOffset = localHeaderOffsetFor(reversed, centralOffset);
      const nameLength = readU16(reversed, localOffset + 26);
      const size = readU32(reversed, centralOffset + 24);
      const dataStart = localOffset + 30 + nameLength;
      const data = reversed.slice(dataStart, dataStart + size);
      expect(crc32Of(data)).toBe(readU32(reversed, centralOffset + 16));
    }
    // Yet the internal verifier rejects it outright.
    const verification = verifyPackageZip(reversed, ledgerFor(result));
    expect(verification.ok).toBe(false);
  });

  it('reaches exactly local_offset_reused for two central records that both reference the same physical local entry', () => {
    const sharedContent = encode('shared content');
    const shared = buildLocalBlock('shared.txt', sharedContent);
    const sharedCrc = crc32Of(sharedContent);
    const bytes = assembleRawZip(
      [shared],
      [
        {
          name: 'shared.txt',
          crc: sharedCrc,
          size: sharedContent.length,
          localHeaderOffset: 0,
        },
        {
          name: 'shared.txt',
          crc: sharedCrc,
          size: sharedContent.length,
          localHeaderOffset: 0,
        },
      ],
    );
    const parsed = parseZip(bytes);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('local_offset_reused');
  });

  it("reaches exactly local_entry_overlap for a second entry whose local header is embedded inside the first entry's own data payload", () => {
    const bContent = encode('B content');
    const bBlock = buildLocalBlock('b.txt', bContent);
    // "a.txt"'s own declared content literally contains a second, fully
    // valid local-file structure ("b.txt"'s) as a byte substring - a
    // genuine physical overlap that neither entry's own per-entry header
    // checks can see on their own, since both entries independently
    // self-reconcile (name/crc/size all match their own central record).
    const aContent = new Uint8Array(4 + bBlock.length);
    aContent.set(encode('AAAA'), 0);
    aContent.set(bBlock, 4);
    const aBlock = buildLocalBlock('a.txt', aContent);
    const bOffsetInArchive = 30 + encode('a.txt').length + 4;
    const bytes = assembleRawZip(
      [aBlock],
      [
        { name: 'a.txt', crc: crc32Of(aContent), size: aContent.length, localHeaderOffset: 0 },
        {
          name: 'b.txt',
          crc: crc32Of(bContent),
          size: bContent.length,
          localHeaderOffset: bOffsetInArchive,
        },
      ],
    );
    const parsed = parseZip(bytes);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('local_entry_overlap');
  });

  it('reaches exactly local_order_mismatch when a later central entry physically precedes an earlier one, with no reuse or overlap between them', () => {
    const cContent = encode('C content');
    const cBlock = buildLocalBlock('c.txt', cContent);
    // "a.txt" embeds "c.txt"'s complete local structure inside its own data
    // (same technique as the overlap case above); "b.txt" is placed
    // immediately - contiguously, canonically - after "a.txt" ends. Central
    // order is a, b, c: the (a,b) pair is perfectly canonical (no gap, no
    // overlap), so the very first anomaly the pairwise walk can encounter
    // is (b,c) - and there, "c.txt"'s physical offset falls *before*
    // "b.txt"'s, with no shared offset and no dataEnd overlap between them.
    const aContent = new Uint8Array(4 + cBlock.length);
    aContent.set(encode('AAAA'), 0);
    aContent.set(cBlock, 4);
    const aBlock = buildLocalBlock('a.txt', aContent);
    const bContent = encode('B content');
    const bBlock = buildLocalBlock('b.txt', bContent);
    const cOffsetInArchive = 30 + encode('a.txt').length + 4;
    const bytes = assembleRawZip(
      [aBlock, bBlock],
      [
        { name: 'a.txt', crc: crc32Of(aContent), size: aContent.length, localHeaderOffset: 0 },
        {
          name: 'b.txt',
          crc: crc32Of(bContent),
          size: bContent.length,
          localHeaderOffset: aBlock.length,
        },
        {
          name: 'c.txt',
          crc: crc32Of(cContent),
          size: cContent.length,
          localHeaderOffset: cOffsetInArchive,
        },
      ],
    );
    const parsed = parseZip(bytes);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('local_order_mismatch');
  });
});
