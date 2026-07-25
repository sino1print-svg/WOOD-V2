import {
  DisplayMethod,
  GarmentView,
  OutputStatus,
  PromptModuleType,
  type ColorId,
  type CoverMetadata,
  type MainCover,
  type OutputAId,
  type PromptMetadata,
  type Sha256,
} from '../../shared/domain-model';
import { coverFailureResult } from './failures';
import { sha256Hex } from './hash';
import { deriveCoverLayout } from './layout';
import { coverBadges, renderCoverPromptModule } from './prompt-module';
import { inspectRuntimeInput, ownedFrozenClone } from './runtime';
import type {
  CoverCompositionPlan,
  CoverEngineInput,
  CoverEngineResult,
  CoverLayoutPlan,
  CoverSourceImage,
} from './types';
import { validateCoverInput } from './validation';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deterministicMode<T extends string>(values: readonly T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    ([left, leftCount], [right, rightCount]) => rightCount - leftCount || compareText(left, right),
  )[0]![0];
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort(compareText);
}

function deriveMetadata(input: CoverEngineInput): CoverMetadata {
  const productIds = uniqueSorted(input.saleImages.map((source) => source.productId));
  const colors = uniqueSorted(input.lockedColors.map((color) => color.id));
  const views = uniqueSorted(input.saleImages.map((source) => source.output.view));
  return {
    productIds,
    colors,
    mockupCount: input.saleImages.length,
    views,
    seasonId: input.season.id,
    digitalProductStatus: input.project.isDigitalProduct,
    primaryProduct: deterministicMode(input.saleImages.map((source) => source.productId)),
    primaryColor: deterministicMode(input.saleImages.map((source) => source.output.color)),
    primaryView: deterministicMode(input.saleImages.map((source) => source.output.view)),
    primaryAudience: input.metadata.primaryAudience,
  };
}

function sourcePriority(source: CoverSourceImage, metadata: CoverMetadata): number {
  const exactPrimary =
    source.productId === metadata.primaryProduct &&
    source.output.color === metadata.primaryColor &&
    source.output.view === metadata.primaryView;
  if (exactPrimary) return 0;
  if (source.output.view === GarmentView.Back) return 7;
  if (
    source.displayMethod === DisplayMethod.OnModel ||
    source.displayMethod === DisplayMethod.GhostMannequin
  ) {
    return 1;
  }
  if (source.output.view === GarmentView.FlatDetail) return 2;
  if (source.displayMethod === DisplayMethod.FlatLay) return 3;
  if (source.displayMethod === DisplayMethod.Folded) return 4;
  if (
    source.displayMethod === DisplayMethod.Hanger ||
    source.displayMethod === DisplayMethod.Hanging
  ) {
    return 6;
  }
  return 5;
}

function orderSources(
  sources: readonly CoverSourceImage[],
  metadata: CoverMetadata,
): readonly CoverSourceImage[] {
  return [...sources].sort(
    (left, right) =>
      sourcePriority(left, metadata) - sourcePriority(right, metadata) ||
      left.sceneOrder - right.sceneOrder ||
      compareText(left.output.id, right.output.id),
  );
}

function orderedColors(metadata: CoverMetadata): readonly ColorId[] {
  return [
    metadata.primaryColor,
    ...metadata.colors.filter((color) => color !== metadata.primaryColor).sort(compareText),
  ];
}

function moduleVersions(version: string): PromptMetadata['moduleVersions'] {
  return {
    [PromptModuleType.Global]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.Product]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.Season]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.Scene]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.OutputA]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.OutputB]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.Cover]: version as PromptMetadata['templateVersion'],
    [PromptModuleType.Group]: version as PromptMetadata['templateVersion'],
  };
}

function coverHashMaterial(
  sourceIds: readonly OutputAId[],
  plan: CoverLayoutPlan,
  metadata: CoverMetadata,
): string {
  return JSON.stringify({
    sourceSaleImageIds: sourceIds,
    layout: plan.layout,
    grid: [plan.columns, plan.rows, plan.capacity, plan.heroSpan],
    metadata: {
      productIds: metadata.productIds,
      colors: metadata.colors,
      mockupCount: metadata.mockupCount,
      views: metadata.views,
      seasonId: metadata.seasonId,
      digitalProductStatus: metadata.digitalProductStatus,
      primaryProduct: metadata.primaryProduct,
      primaryColor: metadata.primaryColor,
      primaryView: metadata.primaryView,
      primaryAudience: metadata.primaryAudience,
    },
  });
}

function sameCoverComposition(left: MainCover, right: MainCover): boolean {
  return (
    left.status !== OutputStatus.Stale &&
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.layout === right.layout &&
    left.coverHash === right.coverHash &&
    left.promptHash === right.promptHash &&
    left.promptText === right.promptText &&
    left.promptMeta?.templateVersion === right.promptMeta?.templateVersion &&
    left.promptMeta?.generatorVersion === right.promptMeta?.generatorVersion &&
    left.promptMeta?.promptChecksum === right.promptMeta?.promptChecksum &&
    JSON.stringify(left.sourceSaleImageIds) === JSON.stringify(right.sourceSaleImageIds) &&
    JSON.stringify(left.readMetadata) === JSON.stringify(right.readMetadata)
  );
}

/**
 * Pure Phase 7 Cover Engine. It composes a deterministic prompt and composition
 * plan only; it never loads, edits, renders, uploads, or persists an image.
 */
export function composeCover(input: CoverEngineInput): CoverEngineResult {
  try {
    const inspection = inspectRuntimeInput(input);
    if (inspection) {
      return coverFailureResult('COVER_META_001', inspection === 'limit' ? 'input.limit' : 'input');
    }
    const ownedInput = ownedFrozenClone(input);
    if (!ownedInput) return coverFailureResult('COVER_META_001', 'input');
    const invalid = validateCoverInput(ownedInput);
    if (invalid) return invalid;

    const metadata = deriveMetadata(ownedInput);
    const layout = deriveCoverLayout(metadata.mockupCount);
    const sources = orderSources(ownedInput.saleImages, metadata);
    const sourceIds = sources.map((source) => source.output.id);
    const colorOrder = orderedColors(metadata);
    const badgeOrder = coverBadges(metadata.digitalProductStatus);
    const text = renderCoverPromptModule(ownedInput.promptModule, {
      input: ownedInput,
      metadata,
      plan: layout,
      orderedSources: sources,
      colorOrder,
    });
    if (text === null) {
      return coverFailureResult('COVER_VAR_001', 'promptText');
    }

    const coverHash = sha256Hex(coverHashMaterial(sourceIds, layout, metadata)) as Sha256;
    const promptHash = sha256Hex(text) as Sha256;
    const versions = moduleVersions(ownedInput.versions.moduleVersion);
    const promptChecksum = sha256Hex(
      [
        text,
        coverHash,
        ownedInput.versions.templateVersion,
        ownedInput.versions.generatorVersion,
        ownedInput.versions.moduleVersion,
        ownedInput.promptModule.id,
        String(ownedInput.promptModule.schemaVersion),
      ].join('\n--COVER-CHECKSUM--\n'),
    ) as Sha256;
    const candidate: MainCover = {
      id: ownedInput.coverId,
      sessionId: ownedInput.sessionId,
      sourceSaleImageIds: sourceIds,
      layout: layout.layout,
      readMetadata: metadata,
      status: OutputStatus.Pending,
      promptText: text,
      generatedAt: null,
      promptHash,
      renderHash: null,
      coverHash,
      promptMeta: {
        templateVersion: ownedInput.versions.templateVersion as PromptMetadata['templateVersion'],
        moduleVersions: versions,
        generatedAt: ownedInput.generatedAt as PromptMetadata['generatedAt'],
        generatorVersion: ownedInput.versions
          .generatorVersion as PromptMetadata['generatorVersion'],
        promptChecksum,
      },
    };

    const cacheHit = ownedInput.cachedCover
      ? sameCoverComposition(ownedInput.cachedCover, candidate)
      : false;
    const selected = cacheHit ? ownedInput.cachedCover! : candidate;
    const ownedCover = ownedFrozenClone(selected);
    const composition: CoverCompositionPlan = {
      layout,
      heroImageId: sourceIds[0]!,
      supportImageIds: sourceIds.slice(1),
      orderedColorIds: colorOrder,
      badges: badgeOrder,
      cacheHit,
    };
    const ownedComposition = ownedFrozenClone(composition);
    if (!ownedCover || !ownedComposition) {
      return coverFailureResult('COVER_META_001', 'output');
    }
    return Object.freeze({ ok: true, value: ownedCover, composition: ownedComposition });
  } catch {
    return coverFailureResult('COVER_META_001', 'input');
  }
}
