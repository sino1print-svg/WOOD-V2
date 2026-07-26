/**
 * Per-file content builders for the ZIP tree - EX section 11.
 *
 * Prompt-bearing files (Output A/B, group plans, cover) hold the exact prompt
 * bytes verbatim - no framing, no wrapper - because they are meant to be used
 * directly (09_EXPORT_ENGINE §16). Everything else here is a small, explicit,
 * allowlisted projection built with the same bounded builder/canonical JSON
 * primitives Batch 10.3 introduced.
 */
import { ValidationSeverity, type SessionId } from '../../shared/domain-model';
import type {
  ExportNumberingEntry,
  ExportPlan,
  ExportSelectedArtworkMetadata,
  ExportSelectedCover,
  ExportSelectedExecutionPlan,
  ExportSelectedProject,
  ExportSelectedPromptMetadata,
  ExportSelectedSession,
  ExportSelectedValidationResult,
  ExportSelectedVersionMetadata,
} from '../../shared/contracts/export-planning';
import { ERROR_BY_CODE } from '../../shared/errors';
import { BoundedDocumentBuilder, type BuiltTextDocument } from '../document-builder';
import { encodeUtf8 } from '../utf8';
import { inlineValue } from '../text-rendering';
import {
  serializeExportJson,
  type ExportJsonObject,
  type ExportJsonValue,
} from '../json-serializer';

export interface ContentLimits {
  readonly maximumBytes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

function promptMetadataToJson(metadata: ExportSelectedPromptMetadata | null): ExportJsonValue {
  if (metadata === null) return null;
  return {
    templateVersion: metadata.templateVersion,
    moduleVersions: Object.fromEntries(Object.entries(metadata.moduleVersions)),
    generatedAt: metadata.generatedAt,
    generatorVersion: metadata.generatorVersion,
    promptChecksum: metadata.promptChecksum,
  };
}

function serializeJson(value: ExportJsonObject, limits: ContentLimits): BuiltTextDocument | null {
  return serializeExportJson(value, {
    indentation: 2,
    trailingLf: true,
    maximumBytes: limits.maximumBytes,
    maximumDepth: limits.maximumDepth,
    maximumArrayLength: limits.maximumArrayLength,
  });
}

/** Raw prompt bytes, byte-preserved: no normalization, trimming, or framing. */
export function promptFileBytes(promptText: string): Uint8Array {
  return encodeUtf8(promptText);
}

export function buildSessionSummary(
  session: ExportSelectedSession,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const builder = new BoundedDocumentBuilder(limits.maximumBytes);
  const ok =
    builder.appendSystemLine('SESSION SUMMARY') &&
    builder.appendSystemLine(`ID: ${inlineValue(session.id)}`) &&
    builder.appendSystemLine(`NAME: ${inlineValue(session.name)}`) &&
    builder.appendSystemLine(`SEASON: ${inlineValue(session.seasonId)}`) &&
    builder.appendSystemLine(`AUDIENCE: ${inlineValue(session.audience)}`) &&
    builder.appendSystemLine(`STATUS: ${inlineValue(session.status)}`) &&
    builder.appendSystemLine(`REQUESTED SCENE COUNT: ${session.requestedSceneCount}`) &&
    builder.appendSystemLine(
      `SCENES GENERATED (A): ${session.generationProgress.outputAGenerated}`,
    ) &&
    builder.appendSystemLine(
      `SCENES GENERATED (B): ${session.generationProgress.outputBGenerated}`,
    ) &&
    builder.appendSystemLine(
      `COVER GENERATED: ${inlineValue(session.generationProgress.coverGenerated)}`,
    ) &&
    builder.appendSystemLine(
      `ALL OUTPUT A READY: ${inlineValue(session.generationProgress.allOutputAReady)}`,
    );
  return ok ? builder.finish() : null;
}

export function buildExecutionPlanText(
  plan: ExportSelectedExecutionPlan,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const builder = new BoundedDocumentBuilder(limits.maximumBytes);
  let ok =
    builder.appendSystemLine('EXECUTION PLAN') &&
    builder.appendSystemLine(`SESSION: ${inlineValue(plan.sessionId)}`) &&
    builder.appendSystemLine('') &&
    builder.appendSystemLine('PHASE 1 - OUTPUT A');
  for (const item of plan.phase1) {
    ok =
      ok &&
      builder.appendSystemLine(
        `${item.label} | SCENE ${inlineValue(item.sceneId)} | OUTPUT ${inlineValue(item.outputAId)}`,
      );
  }
  ok =
    ok &&
    builder.appendSystemLine('') &&
    builder.appendSystemLine('PHASE 2 - OUTPUT B USING MATCHING A + PNG');
  for (const item of plan.phase2) {
    ok =
      ok &&
      builder.appendSystemLine(
        `${item.label} | SCENE ${inlineValue(item.sceneId)} | OUTPUT ${inlineValue(item.outputBId)} | SOURCE ${item.sourceOutputALabel} ${inlineValue(item.sourceOutputAId)}`,
      );
  }
  return ok ? builder.finish() : null;
}

export function buildPairExecutionMarkdown(
  entry: ExportNumberingEntry,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const builder = new BoundedDocumentBuilder(limits.maximumBytes);
  let ok =
    builder.appendSystemLine(`# Pair execution - scene ${entry.sceneNumber}`) &&
    builder.appendSystemLine('') &&
    builder.appendSystemLine(`- Session: ${inlineValue(entry.sessionId)}`) &&
    builder.appendSystemLine(`- Scene: ${inlineValue(entry.sceneId)}`) &&
    builder.appendSystemLine(`- ${entry.outputALabel}: ${inlineValue(entry.outputAId)}`);
  if (entry.outputBId !== undefined && entry.outputBLabel !== undefined) {
    ok =
      ok &&
      builder.appendSystemLine(`- ${entry.outputBLabel}: ${inlineValue(entry.outputBId)}`) &&
      builder.appendSystemLine(
        `- Execution order: generate ${entry.outputALabel} first, then ${entry.outputBLabel} using ${entry.outputALabel} and its uploaded PNG.`,
      );
  } else {
    ok = ok && builder.appendSystemLine('- Execution order: generate this Output A only.');
  }
  return ok ? builder.finish() : null;
}

export function buildProjectJson(
  project: ExportSelectedProject,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const retention: Record<string, ExportJsonValue> = { kind: project.retention.kind };
  if (project.retention.keepN !== undefined) retention.keepN = project.retention.keepN;
  if (project.retention.keepDays !== undefined) retention.keepDays = project.retention.keepDays;
  return serializeJson(
    {
      id: project.id,
      schemaVersion: project.schemaVersion,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sessionIds: [...project.sessionIds],
      currentVersionId: project.currentVersionId,
      versionIds: [...project.versionIds],
      isDigitalProduct: project.isDigitalProduct,
      persistenceMode: project.persistenceMode,
      retention,
    },
    limits,
  );
}

export function buildVersionJson(
  version: ExportSelectedVersionMetadata,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const output: Record<string, ExportJsonValue> = {
    versionId: version.versionId,
    projectId: version.projectId,
    timestamp: version.timestamp,
    parentVersionId: version.parentVersionId,
    reason: version.reason,
  };
  if (version.stateHash !== undefined) output.stateHash = version.stateHash;
  return serializeJson(output, limits);
}

export function buildArtworkMetadataJson(
  artwork: ExportSelectedArtworkMetadata,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const output: Record<string, ExportJsonValue> = {
    id: artwork.id,
    projectId: artwork.projectId,
    uploadedAt: artwork.uploadedAt,
    format: artwork.format,
    hasTransparency: artwork.hasTransparency,
    widthPx: artwork.widthPx,
    heightPx: artwork.heightPx,
    aspectRatio: artwork.aspectRatio,
    contentHash: artwork.contentHash,
  };
  if (artwork.dpi !== undefined) output.dpi = artwork.dpi;
  return serializeJson(output, limits);
}

export function buildCoverMetadataJson(
  cover: ExportSelectedCover,
  limits: ContentLimits,
): BuiltTextDocument | null {
  return serializeJson(
    {
      id: cover.id,
      sessionId: cover.sessionId,
      sourceOutputAIds: [...cover.sourceOutputAIds],
      sourceOutputALabels: [...cover.sourceOutputALabels],
      layout: cover.layout,
      metadata: {
        productIds: [...cover.metadata.productIds],
        colors: [...cover.metadata.colors],
        mockupCount: cover.metadata.mockupCount,
        views: [...cover.metadata.views],
        seasonId: cover.metadata.seasonId,
        digitalProductStatus: cover.metadata.digitalProductStatus,
        primaryProduct: cover.metadata.primaryProduct,
        primaryColor: cover.metadata.primaryColor,
        primaryView: cover.metadata.primaryView,
        primaryAudience: cover.metadata.primaryAudience,
      },
      status: cover.status,
      generatedAt: cover.generatedAt,
      promptHash: cover.promptHash,
      renderHash: cover.renderHash,
      coverHash: cover.coverHash,
      promptMeta: promptMetadataToJson(cover.promptMeta),
    },
    limits,
  );
}

export function buildPromptMetadataJson(
  sessionId: SessionId,
  plan: ExportPlan,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const outputsA = plan.selection.outputsA
    .filter((item) => item.sessionId === sessionId)
    .map((item) => ({
      id: item.id,
      label: item.label,
      promptMeta: promptMetadataToJson(item.promptMeta),
    }));
  const outputsB = plan.selection.outputsB
    .filter((item) => item.sessionId === sessionId)
    .map((item) => ({
      id: item.id,
      label: item.label,
      promptMeta: promptMetadataToJson(item.promptMeta),
    }));
  const groupPlans = plan.selection.groupPlans
    .filter((item) => item.sessionId === sessionId)
    .map((item) => ({
      groupId: item.groupId,
      groupNumber: item.groupNumber,
      promptMeta: promptMetadataToJson(item.promptMeta),
    }));
  const cover = plan.selection.covers.find((item) => item.sessionId === sessionId);
  return serializeJson(
    {
      schemaVersion: 1,
      sessionId,
      outputsA,
      outputsB,
      groupPlans,
      cover:
        cover === undefined
          ? null
          : { id: cover.id, promptMeta: promptMetadataToJson(cover.promptMeta) },
    },
    limits,
  );
}

function validationFailureToJson(
  failure: ExportSelectedValidationResult['failures'][number],
): ExportJsonObject {
  const registered = ERROR_BY_CODE[failure.code];
  return {
    check: failure.check,
    code: failure.code,
    severity: failure.severity,
    priorityClass: failure.priorityClass,
    domain: failure.domain,
    originEngine: failure.originEngine,
    messageAr: registered?.messageAr ?? failure.code,
    messageEn: registered?.messageEn ?? failure.code,
  };
}

export function buildValidationJson(
  sessionId: SessionId,
  plan: ExportPlan,
  limits: ContentLimits,
): BuiltTextDocument | null {
  const validationResults = plan.selection.validationResults
    .filter((result) => result.sessionId === sessionId)
    .map((result) => ({
      id: result.id,
      sessionId: result.sessionId,
      passed: result.passed,
      checks: result.checks.map((check) => ({ check: check.check, passed: check.passed })),
      failures: result.failures.map(validationFailureToJson),
    }));
  const issues = plan.issues
    .filter((issue) => issue.severity === ValidationSeverity.Warning)
    .map((issue) => {
      const registered = ERROR_BY_CODE[issue.code];
      return {
        code: issue.code,
        field: issue.field,
        severity: issue.severity,
        messageAr: registered?.messageAr ?? issue.message,
        messageEn: registered?.messageEn ?? issue.code,
      };
    });
  const omissions = plan.omissions.map((omission) => {
    const registered = ERROR_BY_CODE[omission.code];
    return {
      artifactKind: omission.artifactKind,
      entityId: omission.entityId,
      field: omission.field,
      code: omission.code,
      messageAr: registered?.messageAr ?? omission.code,
      messageEn: registered?.messageEn ?? omission.code,
    };
  });
  return serializeJson(
    {
      schemaVersion: 1,
      sessionId,
      partial: plan.partial,
      validationResults,
      issues,
      omissions,
    },
    limits,
  );
}
