/**
 * Compile-time assignability checks (validated by `tsc --noEmit`, IMPL §6).
 *
 * Each `@ts-expect-error` proves an intended INCOMPATIBILITY exists; removing the
 * incompatibility makes tsc fail with "unused @ts-expect-error". The type checks
 * live in an UNCALLED exported function so nothing executes at runtime (esbuild
 * strips types and does not type-check); the enforcement is the typecheck gate.
 */
import { describe, it, expect } from 'vitest';
import type {
  EvaluationContext,
  ExportFormat,
  MainCover,
  ProjectId,
  ArtworkId,
  OutputA,
  OutputAId,
  OutputB,
  OutputBId,
  Artwork,
  SerializedProjectState,
} from '../../src/shared/domain-model';
import type { ExportDeliveryFormat } from '../../src/shared/contracts';
import type { ProjectStore } from '../../src/persistence';

export function __assignabilityChecks(ctx: EvaluationContext, opFmt: ExportDeliveryFormat): void {
  const outAId = 'sale-image-001' as unknown as OutputAId;
  const outBId = 'preview-image-001' as unknown as OutputBId;

  // MainCover.sourceSaleImageIds accepts OutputAId only
  const coverSources: MainCover['sourceSaleImageIds'] = [outAId];
  void coverSources;
  // @ts-expect-error OutputBId is not assignable to a readonly OutputAId[]
  const coverSourcesBad: MainCover['sourceSaleImageIds'] = [outBId];
  void coverSourcesBad;
  // @ts-expect-error readonly array cannot be mutated
  coverSources.push(outAId);

  // Branded IDs are mutually non-assignable
  // @ts-expect-error OutputBId is not an OutputAId
  const idBad: OutputAId = outBId;
  void idBad;
  const projectId = 'مشروع' as unknown as ProjectId;
  const artworkId = 'عمل-فني' as unknown as ArtworkId;
  // @ts-expect-error ProjectId and ArtworkId remain distinct brands even with Unicode values
  const brandBad: ProjectId = artworkId;
  void brandBad;
  void projectId;

  // OutputB requires sourceOutputAId + artworkId (required, non-optional)
  const sourceRequired: undefined extends OutputB['sourceOutputAId'] ? true : false = false;
  void sourceRequired;
  const artworkRequired: undefined extends OutputB['artworkId'] ? true : false = false;
  void artworkRequired;

  // optional vs nullable distinction
  const renderNull: OutputA['renderHash'] = null;
  void renderNull;
  // @ts-expect-error renderHash is nullable but NOT optional (undefined disallowed)
  const renderUndef: OutputA['renderHash'] = undefined;
  void renderUndef;
  const dpiVal: Artwork['dpi'] = undefined; // dpi is OPTIONAL
  void dpiVal;

  // EvaluationContext (runtime-only) is not assignable to a persisted field
  // @ts-expect-error EvaluationContext is not a persisted SerializedProjectState
  const persistedBad: SerializedProjectState = ctx;
  void persistedBad;

  // Operational ExportDeliveryFormat is NOT a persisted ExportFormat without mapping
  // @ts-expect-error 'clipboard'/'markdown' are not persisted ExportFormat values
  const persistedFmt: ExportFormat = opFmt;
  void persistedFmt;

  // Public/manual save never exposes a switch that can disable VersionSnapshot creation.
  type SaveOptions = Parameters<ProjectStore['save']>[1];
  const manualSaveOptions: SaveOptions = {
    overwrite: false,
    timestamp: '2026-07-16T10:00:00.000Z' as never,
  };
  void manualSaveOptions;
  // @ts-expect-error createSnapshot is intentionally absent from the public save API
  const snapshotBypass: SaveOptions = { ...manualSaveOptions, createSnapshot: false };
  void snapshotBypass;
}

describe('domain-model compile-time assignability', () => {
  it('is enforced by tsc (see @ts-expect-error assertions)', () => {
    expect(typeof __assignabilityChecks).toBe('function');
  });
});
