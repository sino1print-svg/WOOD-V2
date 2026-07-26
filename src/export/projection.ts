/**
 * Positive allowlist projection from the approved Batch 10.2 plan.
 *
 * No Project, Session, Scene, runtime object, or persistence record is accepted
 * here. Every serialized field is copied explicitly from the already-selected
 * plan, and volatile timestamps are omitted from the canonical variant.
 */
import { ValidationSeverity, type ValidationFailure } from '../shared/domain-model';
import type { ExportPlan, ExportSelectedPromptMetadata } from '../shared/contracts/export-planning';
import { ERROR_BY_CODE } from '../shared/errors';
import { formatterFailure, registeredExportFailure } from './failures';
import type { ExportFormatterInput, ExportFormatterLimits } from './format-result';
import type { ExportJsonObject, ExportJsonValue } from './json-serializer';
import { validFormatterPlan, validPlannerFailures } from './plan-validation';
import {
  freezeOwned,
  hasExactKeys,
  inspectFormatterRuntimeValue,
  isPlainRecord,
  validFormatterLimits,
} from './runtime';

export interface PreparedFormatterSource {
  readonly plan: ExportPlan;
  readonly limits: ExportFormatterLimits;
  readonly readableJson: ExportJsonObject;
  readonly canonicalJson: ExportJsonObject;
}

export type PrepareFormatterResult =
  | { readonly ok: true; readonly value: PreparedFormatterSource }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

function failed(failure: ValidationFailure): PrepareFormatterResult {
  return freezeOwned({ ok: false, failures: [failure] });
}

function failures(items: readonly ValidationFailure[]): PrepareFormatterResult {
  return freezeOwned({ ok: false, failures: items });
}

function stringRecord(source: Readonly<Record<string, string>>): ExportJsonObject {
  const output: Record<string, ExportJsonValue> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function numberRecord(source: Readonly<Record<string, number>>): ExportJsonObject {
  const output: Record<string, ExportJsonValue> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function promptMetadataToJson(
  metadata: ExportSelectedPromptMetadata | null,
  readable: boolean,
): ExportJsonValue {
  if (metadata === null) return null;
  const output: Record<string, ExportJsonValue> = {
    generatorVersion: metadata.generatorVersion,
    moduleVersions: stringRecord(metadata.moduleVersions),
    promptChecksum: metadata.promptChecksum,
    templateVersion: metadata.templateVersion,
  };
  if (readable) output.generatedAt = metadata.generatedAt;
  return output;
}

function scopeToJson(plan: ExportPlan): ExportJsonObject {
  return {
    baseScope: plan.scope.baseScope,
    coverIds: [...plan.scope.coverIds],
    groupIds: [...plan.scope.groupIds],
    outputAIds: [...plan.scope.outputAIds],
    outputBIds: [...plan.scope.outputBIds],
    policy: {
      artworkMetadata: plan.scope.policy.artworkMetadata,
      backupResolutionOnly: plan.scope.policy.backupResolutionOnly,
      cover: plan.scope.policy.cover,
      executionPlans: plan.scope.policy.executionPlans,
      groupMetadata: plan.scope.policy.groupMetadata,
      groupPlans: plan.scope.policy.groupPlans,
      outputA: plan.scope.policy.outputA,
      outputB: plan.scope.policy.outputB,
      projectMetadata: plan.scope.policy.projectMetadata,
      sceneMetadata: plan.scope.policy.sceneMetadata,
      sessionMetadata: plan.scope.policy.sessionMetadata,
      validationResults: plan.scope.policy.validationResults,
      versionMetadata: plan.scope.policy.versionMetadata,
    },
    projectId: plan.scope.projectId,
    sceneIds: [...plan.scope.sceneIds],
    scopeDetail: plan.scope.scopeDetail,
    sessionIds: [...plan.scope.sessionIds],
    versionIds: [...plan.scope.versionIds],
  };
}

function projectToJson(plan: ExportPlan, readable: boolean): ExportJsonValue {
  const project = plan.selection.project;
  if (project === null) return null;
  const retention: Record<string, ExportJsonValue> = { kind: project.retention.kind };
  if (project.retention.keepN !== undefined) retention.keepN = project.retention.keepN;
  else if (readable) retention.keepN = null;
  if (project.retention.keepDays !== undefined) retention.keepDays = project.retention.keepDays;
  else if (readable) retention.keepDays = null;

  const output: Record<string, ExportJsonValue> = {
    currentVersionId: project.currentVersionId,
    id: project.id,
    isDigitalProduct: project.isDigitalProduct,
    name: project.name,
    persistenceMode: project.persistenceMode,
    retention,
    schemaVersion: project.schemaVersion,
    sessionIds: [...project.sessionIds],
    versionIds: [...project.versionIds],
  };
  if (readable) {
    output.createdAt = project.createdAt;
    output.updatedAt = project.updatedAt;
  }
  return output;
}

function sessionsToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.sessions.map((session) => {
    const colorSelection: Record<string, ExportJsonValue> = {
      colorIds: [...session.colorSelection.colorIds],
      locked: session.colorSelection.locked,
    };
    if (session.colorSelection.paletteId !== undefined) {
      colorSelection.paletteId = session.colorSelection.paletteId;
    } else if (readable) {
      colorSelection.paletteId = null;
    }
    const output: Record<string, ExportJsonValue> = {
      audience: session.audience,
      colorSelection,
      fingerprint: {
        artworkContentHashes: [...session.fingerprint.artworkContentHashes],
        hash: session.fingerprint.hash,
        ruleSetVersions: numberRecord(session.fingerprint.ruleSetVersions),
        sceneFingerprints: [...session.fingerprint.sceneFingerprints],
      },
      generationProgress: {
        allOutputAReady: session.generationProgress.allOutputAReady,
        coverGenerated: session.generationProgress.coverGenerated,
        outputAGenerated: session.generationProgress.outputAGenerated,
        outputBGenerated: session.generationProgress.outputBGenerated,
        totalScenes: session.generationProgress.totalScenes,
      },
      id: session.id,
      name: session.name,
      productIds: [...session.productIds],
      projectId: session.projectId,
      requestedSceneCount: session.requestedSceneCount,
      sceneIds: [...session.sceneIds],
      seasonId: session.seasonId,
      status: session.status,
      validationResultIds: [...session.validationResultIds],
    };
    if (readable) {
      output.createdAt = session.createdAt;
      output.updatedAt = session.updatedAt;
    }
    return output;
  });
}

function groupsToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.groups.map((group) => ({
    groupBy: group.groupBy,
    groupNumber: group.groupNumber,
    id: group.id,
    key: group.key,
    sceneIds: [...group.sceneIds],
    sessionId: group.sessionId,
  }));
}

function groupPlansToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.groupPlans.map((group) => ({
    groupId: group.groupId,
    groupNumber: group.groupNumber,
    promptMeta: promptMetadataToJson(group.promptMeta, readable),
    promptText: group.promptText,
    sessionId: group.sessionId,
  }));
}

function scenesToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.scenes.map((scene) => ({
    cameraId: scene.cameraId,
    compositionId: scene.compositionId,
    decorIds: [...scene.decorIds],
    dedupSignature: {
      cameraAngle: scene.dedupSignature.cameraAngle,
      compositionId: scene.dedupSignature.compositionId,
      hash: scene.dedupSignature.hash,
      poseId: scene.dedupSignature.poseId,
      sceneTemplateId: scene.dedupSignature.sceneTemplateId,
    },
    displayMethod: scene.displayMethod,
    id: scene.id,
    lightingId: scene.lightingId,
    locationId: scene.locationId,
    paletteColorId: scene.paletteColorId,
    poseId: scene.poseId,
    printAreaRulesRef: scene.printAreaRulesRef,
    productId: scene.productId,
    propIds: [...scene.propIds],
    sceneFingerprint: scene.sceneFingerprint,
    sceneHash: scene.sceneHash,
    sceneVersion: scene.sceneVersion,
    seasonId: scene.seasonId,
    sessionId: scene.sessionId,
    templateId: scene.templateId,
    view: scene.view,
  }));
}

function outputsAToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.outputsA.map((outputA) => {
    const output: Record<string, ExportJsonValue> = {
      color: outputA.color,
      contentHash: outputA.contentHash,
      forbidden: [...outputA.forbidden],
      garment: outputA.garment,
      id: outputA.id,
      label: outputA.label,
      promptHash: outputA.promptHash,
      promptMeta: promptMetadataToJson(outputA.promptMeta, readable),
      promptText: outputA.promptText,
      renderHash: outputA.renderHash,
      sceneId: outputA.sceneId,
      sceneNumber: outputA.sceneNumber,
      sessionId: outputA.sessionId,
      status: outputA.status,
      view: outputA.view,
    };
    if (readable) output.generatedAt = outputA.generatedAt;
    return output;
  });
}

function outputsBToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.outputsB.map((outputB) => {
    const output: Record<string, ExportJsonValue> = {
      artworkId: outputB.artworkId,
      contentHash: outputB.contentHash,
      id: outputB.id,
      label: outputB.label,
      onlyArtworkChanges: outputB.onlyArtworkChanges,
      promptHash: outputB.promptHash,
      promptMeta: promptMetadataToJson(outputB.promptMeta, readable),
      promptText: outputB.promptText,
      renderHash: outputB.renderHash,
      sceneId: outputB.sceneId,
      sceneNumber: outputB.sceneNumber,
      sessionId: outputB.sessionId,
      sourceContentHash: outputB.sourceContentHash,
      sourceHash: outputB.sourceHash,
      sourceOutputAId: outputB.sourceOutputAId,
      sourceOutputALabel: outputB.sourceOutputALabel,
      status: outputB.status,
    };
    if (readable) output.generatedAt = outputB.generatedAt;
    return output;
  });
}

function coversToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.covers.map((cover) => {
    const output: Record<string, ExportJsonValue> = {
      coverHash: cover.coverHash,
      id: cover.id,
      layout: cover.layout,
      metadata: {
        colors: [...cover.metadata.colors],
        digitalProductStatus: cover.metadata.digitalProductStatus,
        mockupCount: cover.metadata.mockupCount,
        primaryAudience: cover.metadata.primaryAudience,
        primaryColor: cover.metadata.primaryColor,
        primaryProduct: cover.metadata.primaryProduct,
        primaryView: cover.metadata.primaryView,
        productIds: [...cover.metadata.productIds],
        seasonId: cover.metadata.seasonId,
        views: [...cover.metadata.views],
      },
      promptHash: cover.promptHash,
      promptMeta: promptMetadataToJson(cover.promptMeta, readable),
      promptText: cover.promptText,
      renderHash: cover.renderHash,
      sessionId: cover.sessionId,
      sourceOutputAIds: [...cover.sourceOutputAIds],
      sourceOutputALabels: [...cover.sourceOutputALabels],
      status: cover.status,
    };
    if (readable) output.generatedAt = cover.generatedAt;
    return output;
  });
}

function artworksToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.artworks.map((artwork) => {
    const output: Record<string, ExportJsonValue> = {
      aspectRatio: artwork.aspectRatio,
      contentHash: artwork.contentHash,
      format: artwork.format,
      hasTransparency: artwork.hasTransparency,
      heightPx: artwork.heightPx,
      id: artwork.id,
      projectId: artwork.projectId,
      widthPx: artwork.widthPx,
    };
    if (artwork.dpi !== undefined) output.dpi = artwork.dpi;
    else if (readable) output.dpi = null;
    if (readable) output.uploadedAt = artwork.uploadedAt;
    return output;
  });
}

function productsToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.products.map((product) => {
    const output: Record<string, ExportJsonValue> = {
      allowedViews: [...product.allowedViews],
      defaultColors: [...product.defaultColors],
      id: product.id,
      kind: product.kind,
      name: product.name,
      schemaVersion: product.schemaVersion,
      type: product.type,
    };
    if (product.productHash !== undefined) output.productHash = product.productHash;
    else if (readable) output.productHash = null;
    return output;
  });
}

function seasonsToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.seasons.map((season) => ({
    id: season.id,
    kind: season.kind,
    name: season.name,
    schemaVersion: season.schemaVersion,
  }));
}

function colorsToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.colors.map((color) => ({
    hex: color.hex,
    id: color.id,
    name: color.name,
  }));
}

function issueToJson(issue: ValidationFailure): ExportJsonObject {
  const registered = ERROR_BY_CODE[issue.code];
  return {
    code: issue.code,
    field: issue.field,
    messageAr: registered?.messageAr ?? issue.message,
    messageEn: registered?.messageEn ?? issue.code,
    originEngine: issue.originEngine,
    severity: issue.severity,
  };
}

function validationResultsToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.validationResults.map((result) => {
    const output: Record<string, ExportJsonValue> = {
      checks: result.checks.map((check) => ({
        check: check.check,
        passed: check.passed,
      })),
      failures: result.failures.map((failure) => ({
        check: failure.check,
        code: failure.code,
        domain: failure.domain,
        originEngine: failure.originEngine,
        priorityClass: failure.priorityClass,
        severity: failure.severity,
      })),
      id: result.id,
      passed: result.passed,
      sessionId: result.sessionId,
    };
    if (readable) output.evaluatedAt = result.evaluatedAt;
    return output;
  });
}

function versionsToJson(plan: ExportPlan, readable: boolean): readonly ExportJsonValue[] {
  return plan.selection.versions.map((version) => {
    const output: Record<string, ExportJsonValue> = {
      parentVersionId: version.parentVersionId,
      projectId: version.projectId,
      reason: version.reason,
      versionId: version.versionId,
    };
    if (version.stateHash !== undefined) output.stateHash = version.stateHash;
    else if (readable) output.stateHash = null;
    if (readable) output.timestamp = version.timestamp;
    return output;
  });
}

function executionPlansToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.executionPlans.map((executionPlan) => ({
    phase1: executionPlan.phase1.map((item) => ({
      label: item.label,
      outputAId: item.outputAId,
      sceneId: item.sceneId,
    })),
    phase2: executionPlan.phase2.map((item) => ({
      label: item.label,
      outputBId: item.outputBId,
      sceneId: item.sceneId,
      sourceOutputAId: item.sourceOutputAId,
      sourceOutputALabel: item.sourceOutputALabel,
    })),
    sessionId: executionPlan.sessionId,
  }));
}

function numberingToJson(plan: ExportPlan): ExportJsonObject {
  return {
    groups: plan.groupNumbering.map((entry) => {
      const output: Record<string, ExportJsonValue> = {
        groupId: entry.groupId,
        groupNumber: entry.groupNumber,
        groupSceneNumber: entry.groupSceneNumber,
        outputAId: entry.outputAId,
        outputALabel: entry.outputALabel,
        sceneId: entry.sceneId,
        sceneNumber: entry.sceneNumber,
        sessionId: entry.sessionId,
      };
      if (entry.outputBId !== undefined) output.outputBId = entry.outputBId;
      if (entry.outputBLabel !== undefined) output.outputBLabel = entry.outputBLabel;
      return output;
    }),
    outputs: plan.numbering.map((entry) => {
      const output: Record<string, ExportJsonValue> = {
        outputAId: entry.outputAId,
        outputALabel: entry.outputALabel,
        sceneId: entry.sceneId,
        sceneNumber: entry.sceneNumber,
        sessionId: entry.sessionId,
      };
      if (entry.outputBId !== undefined) output.outputBId = entry.outputBId;
      if (entry.outputBLabel !== undefined) output.outputBLabel = entry.outputBLabel;
      return output;
    }),
  };
}

function omissionsToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.omissions.map((omission) => {
    const registered = ERROR_BY_CODE[omission.code];
    return {
      artifactKind: omission.artifactKind,
      code: omission.code,
      entityId: omission.entityId,
      location: omission.field,
      messageAr: registered?.messageAr ?? omission.code,
      messageEn: registered?.messageEn ?? omission.code,
      scopeDetail: plan.scope.scopeDetail,
      severity: registered?.severity ?? ValidationSeverity.Blocking,
    };
  });
}

function orderedToJson(plan: ExportPlan): readonly ExportJsonValue[] {
  return plan.selection.ordered.map((item) => {
    const output: Record<string, ExportJsonValue> = {
      entityId: item.entityId,
      kind: item.kind,
    };
    if (item.sessionId !== undefined) output.sessionId = item.sessionId;
    if (item.sceneId !== undefined) output.sceneId = item.sceneId;
    if (item.label !== undefined) output.label = item.label;
    return output;
  });
}

function buildDocumentJson(plan: ExportPlan, readable: boolean): ExportJsonObject {
  const issues = plan.issues.map(issueToJson);
  const warnings = plan.issues
    .filter((issue) => issue.severity === ValidationSeverity.Warning)
    .map(issueToJson);
  const blockingCount = plan.issues.filter(
    (issue) => issue.severity === ValidationSeverity.Blocking,
  ).length;
  return {
    artworkMetadata: artworksToJson(plan, readable),
    canonicalOrder: orderedToJson(plan),
    colors: colorsToJson(plan),
    covers: coversToJson(plan, readable),
    executionPlans: executionPlansToJson(plan),
    groupPlans: groupPlansToJson(plan, readable),
    groups: groupsToJson(plan),
    numbering: numberingToJson(plan),
    omissions: omissionsToJson(plan),
    outputsA: outputsAToJson(plan, readable),
    outputsB: outputsBToJson(plan, readable),
    partial: plan.partial,
    products: productsToJson(plan, readable),
    project: projectToJson(plan, readable),
    scenes: scenesToJson(plan),
    schemaVersion: 1,
    scope: scopeToJson(plan),
    seasons: seasonsToJson(plan),
    sessions: sessionsToJson(plan, readable),
    validationResults: validationResultsToJson(plan, readable),
    validationSummary: {
      blockingIssueCount: blockingCount,
      complete: !plan.partial,
      issueCount: plan.issues.length,
      issues,
      omissionCount: plan.omissions.length,
      sourceValidationResultCount: plan.selection.validationResults.length,
      warningCount: warnings.length,
    },
    versions: versionsToJson(plan, readable),
    warnings,
  };
}

function sanitizePlannerFailures(input: ExportFormatterInput): readonly ValidationFailure[] | null {
  if (input.planResult.ok) return null;
  const output: ValidationFailure[] = [];
  for (const item of input.planResult.failures) {
    const registered = registeredExportFailure(item.code, item.field);
    if (!registered) return null;
    output.push(registered);
  }
  return output.length > 0 ? output : null;
}

/**
 * Validate the formatter boundary without invoking getters, then build owned
 * readable and canonical DTOs from explicit allowlists.
 */
export function prepareFormatterInput(input: ExportFormatterInput): PrepareFormatterResult {
  try {
    const firstInspection = inspectFormatterRuntimeValue(input);
    if (firstInspection) return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.input'));
    if (
      !isPlainRecord(input) ||
      !hasExactKeys(input, ['planResult', 'limits']) ||
      !validFormatterLimits(input.limits)
    ) {
      return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.input'));
    }
    const boundedInspection = inspectFormatterRuntimeValue(
      input,
      input.limits.maxJsonDepth,
      input.limits.maxZipEntries,
    );
    if (boundedInspection) {
      return failed(
        formatterFailure(
          boundedInspection === 'limit' ? 'EXPORT_STORAGE_001' : 'EXPORT_CORRUPT_001',
          'formatter.input',
        ),
      );
    }
    if (!isPlainRecord(input.planResult)) {
      return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.planResult'));
    }
    if (!input.planResult.ok) {
      if (
        !hasExactKeys(input.planResult, ['ok', 'failures']) ||
        !validPlannerFailures(input.planResult.failures, input.limits.maxZipEntries)
      ) {
        return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.planResult'));
      }
      const sanitized = sanitizePlannerFailures(input);
      return sanitized
        ? failures(sanitized)
        : failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.planResult.failures'));
    }
    if (
      !hasExactKeys(input.planResult, ['ok', 'value']) ||
      !validFormatterPlan(input.planResult.value, input.limits.maxZipEntries)
    ) {
      return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.planResult.value'));
    }

    const plan = input.planResult.value;
    const prepared: PreparedFormatterSource = {
      plan,
      limits: input.limits,
      readableJson: buildDocumentJson(plan, true),
      canonicalJson: buildDocumentJson(plan, false),
    };
    return freezeOwned({ ok: true, value: prepared });
  } catch {
    return failed(formatterFailure('EXPORT_CORRUPT_001', 'formatter.input'));
  }
}
