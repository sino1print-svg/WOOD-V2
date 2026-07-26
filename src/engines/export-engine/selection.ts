import type {
  MainCover,
  OutputA,
  OutputB,
  PhotoshootSession,
  Project,
  PromptMetadata,
  Scene,
  Sha256,
  ValidationResult,
  ValidationResultId,
  VersionSnapshot,
} from '../../shared/domain-model';
import type { ExportSourceSnapshot } from '../../shared/contracts/export-contracts';
import { canonicalGroups, canonicalScenes, canonicalSessions } from './ordering';
import { compareUtf8, isPlainRecord } from './runtime';
import type { ExportEligibility } from './validation';
import type {
  ExportAllowlistedSelection,
  ExportNumberingEntry,
  ExportOrderedSelectionReference,
  ExportPlanProvenance,
  ExportResolvedScope,
  ExportSelectedArtworkMetadata,
  ExportSelectedColor,
  ExportSelectedCover,
  ExportSelectedExecutionPlan,
  ExportSelectedGroup,
  ExportSelectedGroupPlan,
  ExportSelectedOutputA,
  ExportSelectedOutputB,
  ExportSelectedProduct,
  ExportSelectedProject,
  ExportSelectedPromptMetadata,
  ExportSelectedScene,
  ExportSelectedSeason,
  ExportSelectedSession,
  ExportSelectedValidationResult,
  ExportSelectedVersionMetadata,
} from './types';

function orderedRecord<Value>(
  source: Readonly<Record<string, Value>>,
): Readonly<Record<string, Value>> {
  const result: Record<string, Value> = {};
  for (const key of Object.keys(source).sort(compareUtf8)) result[key] = source[key]!;
  return result;
}

function selectPromptMetadata(
  metadata: PromptMetadata | null | undefined,
): ExportSelectedPromptMetadata | null {
  if (!metadata) return null;
  return {
    templateVersion: metadata.templateVersion,
    moduleVersions: orderedRecord(metadata.moduleVersions),
    generatedAt: metadata.generatedAt,
    generatorVersion: metadata.generatorVersion,
    promptChecksum: metadata.promptChecksum,
  };
}

function selectProject(project: Project): ExportSelectedProject {
  return {
    id: project.id,
    schemaVersion: project.schemaVersion,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sessionIds: [...project.sessionOrder],
    currentVersionId: project.currentVersionId,
    versionIds: [...project.versionOrder],
    isDigitalProduct: project.isDigitalProduct,
    persistenceMode: project.persistenceMode,
    retention: {
      kind: project.retention.kind,
      ...(project.retention.keepN === undefined ? {} : { keepN: project.retention.keepN }),
      ...(project.retention.keepDays === undefined ? {} : { keepDays: project.retention.keepDays }),
    },
  };
}

function selectSession(session: PhotoshootSession): ExportSelectedSession {
  return {
    id: session.id,
    projectId: session.projectId,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    seasonId: session.season,
    audience: session.audience,
    productIds: [...session.productIds],
    colorSelection: {
      colorIds: [...session.colorSelection.colorIds],
      locked: session.colorSelection.locked,
      ...(session.colorSelection.paletteId === undefined
        ? {}
        : { paletteId: session.colorSelection.paletteId }),
    },
    requestedSceneCount: session.requestedSceneCount,
    sceneIds: [...session.sceneOrder],
    status: session.status,
    validationResultIds: Object.keys(session.validationResults).sort(compareUtf8),
    generationProgress: {
      totalScenes: session.generationProgress.totalScenes,
      outputAGenerated: session.generationProgress.outputAGenerated,
      outputBGenerated: session.generationProgress.outputBGenerated,
      coverGenerated: session.generationProgress.coverGenerated,
      allOutputAReady: session.generationProgress.allOutputAReady,
    },
    fingerprint: {
      hash: session.fingerprint.hash,
      sceneFingerprints: [...session.fingerprint.components.sceneFingerprints],
      artworkContentHashes: [...session.fingerprint.components.artworkContentHashes],
      ruleSetVersions: orderedRecord(session.fingerprint.components.ruleSetVersions),
    },
  };
}

function selectScene(scene: Scene): ExportSelectedScene {
  return {
    id: scene.id,
    sessionId: scene.sessionId,
    templateId: scene.templateId,
    productId: scene.productId,
    locationId: scene.locationId,
    lightingId: scene.lightingId,
    decorIds: [...scene.decorIds],
    propIds: [...scene.propIds],
    cameraId: scene.cameraId,
    compositionId: scene.compositionId,
    poseId: scene.poseId,
    displayMethod: scene.displayMethod,
    paletteColorId: scene.paletteColorId,
    seasonId: scene.seasonId,
    printAreaRulesRef: scene.printAreaRulesRef,
    view: scene.view,
    dedupSignature: {
      sceneTemplateId: scene.dedupSignature.sceneTemplateId,
      poseId: scene.dedupSignature.poseId,
      cameraAngle: scene.dedupSignature.cameraAngle,
      compositionId: scene.dedupSignature.compositionId,
      hash: scene.dedupSignature.hash,
    },
    sceneVersion: scene.sceneVersion,
    sceneHash: scene.sceneHash,
    sceneFingerprint: scene.sceneFingerprint,
  };
}

function selectOutputA(
  sessionId: ExportSelectedOutputA['sessionId'],
  output: OutputA,
  numbering: ExportNumberingEntry,
): ExportSelectedOutputA {
  return {
    id: output.id,
    sessionId,
    sceneId: output.sceneId,
    sceneNumber: numbering.sceneNumber,
    label: numbering.outputALabel,
    garment: output.garment,
    color: output.color,
    view: output.view,
    status: output.status,
    forbidden: [...output.forbidden],
    promptText: output.promptText,
    contentHash: output.contentHash,
    generatedAt: output.generatedAt,
    promptHash: output.promptHash,
    renderHash: output.renderHash,
    promptMeta: selectPromptMetadata(output.promptMeta),
  };
}

function selectOutputB(
  sessionId: ExportSelectedOutputB['sessionId'],
  output: OutputB,
  numbering: ExportNumberingEntry,
): ExportSelectedOutputB {
  return {
    id: output.id,
    sessionId,
    sceneId: output.sceneId,
    sceneNumber: numbering.sceneNumber,
    label: numbering.outputBLabel!,
    sourceOutputAId: output.sourceOutputAId,
    sourceOutputALabel: numbering.outputALabel,
    artworkId: output.artworkId,
    onlyArtworkChanges: output.onlyArtworkChanges,
    sourceContentHash: output.sourceContentHash,
    status: output.status,
    promptText: output.promptText,
    generatedAt: output.generatedAt,
    promptHash: output.promptHash,
    renderHash: output.renderHash,
    sourceHash: output.sourceHash,
    contentHash: output.contentHash,
    promptMeta: selectPromptMetadata(output.promptMeta),
  };
}

function selectCover(
  cover: MainCover,
  labels: ReadonlyMap<string, ExportNumberingEntry>,
): ExportSelectedCover {
  return {
    id: cover.id,
    sessionId: cover.sessionId,
    sourceOutputAIds: [...cover.sourceSaleImageIds],
    sourceOutputALabels: cover.sourceSaleImageIds.map(
      (outputAId) => labels.get(outputAId)!.outputALabel,
    ),
    layout: cover.layout,
    metadata: {
      productIds: [...cover.readMetadata.productIds],
      colors: [...cover.readMetadata.colors],
      mockupCount: cover.readMetadata.mockupCount,
      views: [...cover.readMetadata.views],
      seasonId: cover.readMetadata.seasonId,
      digitalProductStatus: cover.readMetadata.digitalProductStatus,
      primaryProduct: cover.readMetadata.primaryProduct,
      primaryColor: cover.readMetadata.primaryColor,
      primaryView: cover.readMetadata.primaryView,
      primaryAudience: cover.readMetadata.primaryAudience,
    },
    status: cover.status,
    promptText: cover.promptText,
    generatedAt: cover.generatedAt,
    promptHash: cover.promptHash,
    renderHash: cover.renderHash,
    coverHash: cover.coverHash,
    promptMeta: selectPromptMetadata(cover.promptMeta),
  };
}

function selectValidationResult(validation: ValidationResult): ExportSelectedValidationResult {
  return {
    id: validation.id,
    sessionId: validation.sessionId,
    evaluatedAt: validation.evaluatedAt,
    passed: validation.passed,
    checks: validation.checks.map((check) => ({
      check: check.check,
      passed: check.passed,
    })),
    failures: validation.failures.map((failure) => ({
      check: failure.check,
      code: failure.code,
      severity: failure.severity,
      priorityClass: failure.priorityClass,
      domain: failure.domain,
      originEngine: failure.originEngine,
    })),
  };
}

function selectVersion(version: VersionSnapshot): ExportSelectedVersionMetadata {
  return {
    versionId: version.versionId,
    projectId: version.projectId,
    timestamp: version.timestamp,
    parentVersionId: version.parentVersionId,
    reason: version.reason,
    ...(version.stateHash === undefined ? {} : { stateHash: version.stateHash }),
  };
}

function selectedLibraryIds(
  project: Project,
  resolved: ExportResolvedScope,
): {
  readonly products: readonly string[];
  readonly seasons: readonly string[];
  readonly colors: readonly string[];
} {
  const products = new Set<string>();
  const seasons = new Set<string>();
  const colors = new Set<string>();
  for (const session of canonicalSessions(project, resolved.sessionIds)) {
    for (const productId of session.productIds) products.add(productId);
    seasons.add(session.season);
    for (const colorId of session.colorSelection.colorIds) colors.add(colorId);
    for (const scene of canonicalScenes(session, resolved.sceneIds)) {
      products.add(scene.productId);
      seasons.add(scene.seasonId);
      colors.add(scene.paletteColorId);
    }
  }
  return {
    products: [...products].sort(compareUtf8),
    seasons: [...seasons].sort(compareUtf8),
    colors: [...colors].sort(compareUtf8),
  };
}

function selectProducts(
  source: ExportSourceSnapshot,
  ids: readonly string[],
): readonly ExportSelectedProduct[] {
  const requested = new Set(ids);
  return source.products
    .filter((product) => requested.has(product.id))
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((product) => ({
      id: product.id,
      schemaVersion: product.schemaVersion,
      kind: product.kind,
      name: product.name,
      type: product.type,
      allowedViews: [...product.allowedViews],
      defaultColors: [...product.defaultColors],
      ...(product.productHash === undefined ? {} : { productHash: product.productHash }),
    }));
}

function selectSeasons(
  source: ExportSourceSnapshot,
  ids: readonly string[],
): readonly ExportSelectedSeason[] {
  const requested = new Set(ids);
  return source.seasons
    .filter((season) => requested.has(season.id))
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((season) => ({
      id: season.id,
      schemaVersion: season.schemaVersion,
      kind: season.kind,
      name: season.name,
    }));
}

function selectColors(
  source: ExportSourceSnapshot,
  ids: readonly string[],
): readonly ExportSelectedColor[] {
  const requested = new Set(ids);
  return source.colors
    .filter((color) => requested.has(color.id))
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((color) => ({ id: color.id, name: color.name, hex: color.hex }));
}

/** Copy only explicitly approved fields and canonical arrays from eligible entities. */
export function selectExportArtifacts(
  source: ExportSourceSnapshot,
  resolved: ExportResolvedScope,
  numbering: readonly ExportNumberingEntry[],
  eligibility: ExportEligibility,
): ExportAllowlistedSelection {
  const project = source.project as Project;
  const sessions = canonicalSessions(project, resolved.sessionIds);
  const numberingByScene = new Map(numbering.map((entry) => [entry.sceneId, entry]));
  const numberingByOutputA = new Map(numbering.map((entry) => [entry.outputAId, entry]));
  const selectedSessions: ExportSelectedSession[] = [];
  const selectedGroups: ExportSelectedGroup[] = [];
  const selectedGroupPlans: ExportSelectedGroupPlan[] = [];
  const selectedScenes: ExportSelectedScene[] = [];
  const selectedOutputsA: ExportSelectedOutputA[] = [];
  const selectedOutputsB: ExportSelectedOutputB[] = [];
  const selectedCovers: ExportSelectedCover[] = [];
  const selectedArtworks: ExportSelectedArtworkMetadata[] = [];
  const selectedValidations: ExportSelectedValidationResult[] = [];
  const selectedVersions: ExportSelectedVersionMetadata[] = [];
  const selectedExecutionPlans: ExportSelectedExecutionPlan[] = [];
  const ordered: ExportOrderedSelectionReference[] = [];
  const artworkOrder: string[] = [];
  const seenArtworks = new Set<string>();
  const restrictGroupContent = resolved.baseScope === 'group' && eligibility.restrictedGroupBlocked;

  const selectedProject = resolved.policy.projectMetadata ? selectProject(project) : null;
  if (selectedProject) ordered.push({ kind: 'project', entityId: selectedProject.id });

  for (const session of sessions) {
    if (resolved.policy.sessionMetadata) {
      selectedSessions.push(selectSession(session));
      ordered.push({ kind: 'session', entityId: session.id, sessionId: session.id });
    }

    const allGroups = canonicalGroups(
      session,
      Object.values(session.groups).map((group) => group.id),
    );
    const requestedGroups = new Set<string>(resolved.groupIds);
    for (let index = 0; index < allGroups.length; index += 1) {
      const group = allGroups[index]!;
      if (
        !requestedGroups.has(group.id) ||
        !eligibility.validGroupIds.has(group.id) ||
        !resolved.policy.groupMetadata
      ) {
        continue;
      }
      const groupNumber = index + 1;
      const selected: ExportSelectedGroup = {
        id: group.id,
        sessionId: group.sessionId,
        groupNumber,
        groupBy: group.groupBy,
        key: group.key,
        sceneIds: [...group.sceneIds],
      };
      selectedGroups.push(selected);
      ordered.push({ kind: 'group', entityId: group.id, sessionId: session.id });
      if (resolved.policy.groupPlans && eligibility.validGroupPlanIds.has(group.id)) {
        selectedGroupPlans.push({
          groupId: group.id,
          sessionId: group.sessionId,
          groupNumber,
          promptText: group.groupPromptText!,
          promptMeta: selectPromptMetadata(group.groupPromptMeta),
        });
      }
    }

    const scenes = canonicalScenes(session, resolved.sceneIds);
    if (resolved.policy.sceneMetadata) {
      for (const scene of scenes) {
        selectedScenes.push(selectScene(scene));
        ordered.push({
          kind: 'scene',
          entityId: scene.id,
          sessionId: session.id,
          sceneId: scene.id,
        });
      }
    }

    if (!restrictGroupContent && resolved.policy.outputA) {
      for (const scene of scenes) {
        const entry = numberingByScene.get(scene.id);
        if (
          !entry ||
          !isPlainRecord(scene.outputA) ||
          !eligibility.validOutputAIds.has(scene.outputA.id)
        ) {
          continue;
        }
        const selected = selectOutputA(session.id, scene.outputA, entry);
        selectedOutputsA.push(selected);
        ordered.push({
          kind: 'output_a',
          entityId: selected.id,
          sessionId: session.id,
          sceneId: scene.id,
          label: selected.label,
        });
      }
    }

    if (!restrictGroupContent && resolved.policy.outputB) {
      for (const scene of scenes) {
        const entry = numberingByScene.get(scene.id);
        const output = scene.outputB;
        if (
          !entry ||
          !entry.outputBLabel ||
          !output ||
          !eligibility.validOutputBIds.has(output.id)
        ) {
          continue;
        }
        const selected = selectOutputB(session.id, output, entry);
        selectedOutputsB.push(selected);
        ordered.push({
          kind: 'output_b',
          entityId: selected.id,
          sessionId: session.id,
          sceneId: scene.id,
          label: selected.label,
        });
        if (!seenArtworks.has(output.artworkId)) {
          seenArtworks.add(output.artworkId);
          artworkOrder.push(output.artworkId);
        }
      }
    }

    if (!restrictGroupContent && resolved.policy.executionPlans) {
      const phase1 = scenes.flatMap((scene) => {
        const entry = numberingByScene.get(scene.id);
        if (
          !entry ||
          !isPlainRecord(scene.outputA) ||
          !eligibility.validOutputAIds.has(scene.outputA.id)
        ) {
          return [];
        }
        return [{ sceneId: scene.id, outputAId: scene.outputA.id, label: entry.outputALabel }];
      });
      const phase2 = scenes.flatMap((scene) => {
        const entry = numberingByScene.get(scene.id);
        const output = scene.outputB;
        if (
          !entry ||
          !entry.outputBLabel ||
          !output ||
          !eligibility.validOutputBIds.has(output.id)
        ) {
          return [];
        }
        return [
          {
            sceneId: scene.id,
            outputBId: output.id,
            label: entry.outputBLabel,
            sourceOutputAId: output.sourceOutputAId,
            sourceOutputALabel: entry.outputALabel,
          },
        ];
      });
      if (phase1.length > 0) {
        selectedExecutionPlans.push({ sessionId: session.id, phase1, phase2 });
        ordered.push({ kind: 'execution_plan', entityId: session.id, sessionId: session.id });
      }
    }

    if (resolved.policy.cover && session.cover && eligibility.validCoverIds.has(session.cover.id)) {
      const selected = selectCover(session.cover, numberingByOutputA);
      selectedCovers.push(selected);
      ordered.push({ kind: 'cover', entityId: selected.id, sessionId: session.id });
    }

    if (resolved.policy.validationResults) {
      for (const validationId of Object.keys(session.validationResults).sort(compareUtf8)) {
        selectedValidations.push(
          selectValidationResult(session.validationResults[validationId as ValidationResultId]!),
        );
      }
    }
  }

  if (resolved.policy.artworkMetadata) {
    for (const artworkId of artworkOrder) {
      if (!eligibility.validArtworkIds.has(artworkId)) continue;
      const artwork = project.artworks[artworkId as keyof typeof project.artworks]!;
      selectedArtworks.push({
        id: artwork.id,
        projectId: artwork.projectId,
        uploadedAt: artwork.uploadedAt,
        format: artwork.format,
        hasTransparency: artwork.hasTransparency,
        widthPx: artwork.widthPx,
        heightPx: artwork.heightPx,
        ...(artwork.dpi === undefined ? {} : { dpi: artwork.dpi }),
        aspectRatio: artwork.aspectRatio,
        contentHash: artwork.contentHash,
      });
    }
  }

  if (resolved.policy.versionMetadata) {
    for (const versionId of resolved.versionIds) {
      const version = project.versionHistory[versionId];
      if (!version) continue;
      selectedVersions.push(selectVersion(version));
      ordered.push({ kind: 'version_snapshot', entityId: version.versionId });
    }
  }

  const libraryIds = selectedLibraryIds(project, resolved);
  return {
    project: selectedProject,
    sessions: selectedSessions,
    groups: selectedGroups,
    groupPlans: selectedGroupPlans,
    scenes: selectedScenes,
    outputsA: selectedOutputsA,
    outputsB: selectedOutputsB,
    covers: selectedCovers,
    artworks: selectedArtworks,
    products: selectProducts(source, libraryIds.products),
    seasons: selectSeasons(source, libraryIds.seasons),
    colors: selectColors(source, libraryIds.colors),
    validationResults: selectedValidations,
    versions: selectedVersions,
    executionPlans: selectedExecutionPlans,
    ordered,
  };
}

/**
 * Authoritative source provenance (EX §13; Batch 10.4 First Corrective F5) -
 * computed from the real source project/session/scene/cover in the resolved
 * scope, independent of `resolved.policy` content filtering.
 *
 * `version_snapshot` is the one supported scope with zero resolved sessions
 * (scope.ts); there the manifest's session-shaped fingerprint field has no
 * session to describe, so the resolved `VersionSnapshot`'s own authoritative
 * `stateHash` is used instead - real source data, never a fabricated value.
 * `persistence/version-history` already treats a snapshot with no `stateHash`
 * as corrupted and refuses to apply it, so every snapshot reachable here
 * through a successful plan has one; the absence path below is therefore
 * unreachable for valid data and surfaces as `EXPORT_CORRUPT_001` (via the
 * caller's try/catch) rather than a fabricated digest.
 */
export function computeExportProvenance(
  source: ExportSourceSnapshot,
  resolved: ExportResolvedScope,
): ExportPlanProvenance {
  const project = source.project as Project;
  const sessions = canonicalSessions(project, resolved.sessionIds);

  const sceneFingerprints: Sha256[] = [];
  for (const session of sessions) {
    for (const scene of canonicalScenes(session, resolved.sceneIds)) {
      sceneFingerprints.push(scene.sceneFingerprint);
    }
  }

  const requestedCoverIds = new Set<string>(resolved.coverIds);
  let coverHash: Sha256 | null = null;
  for (const session of sessions) {
    if (session.cover !== null && requestedCoverIds.has(session.cover.id)) {
      coverHash = session.cover.coverHash;
      break;
    }
  }

  const primarySession = sessions[0];
  if (primarySession !== undefined) {
    return { sessionFingerprint: primarySession.fingerprint.hash, sceneFingerprints, coverHash };
  }

  const versionId = resolved.versionIds[0];
  const snapshot = versionId !== undefined ? project.versionHistory[versionId] : undefined;
  if (snapshot?.stateHash !== undefined) {
    return { sessionFingerprint: snapshot.stateHash, sceneFingerprints, coverHash };
  }

  throw new Error('export-provenance-unavailable');
}
