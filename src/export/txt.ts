import { ValidationSeverity } from '../shared/domain-model';
import { ERROR_BY_CODE } from '../shared/errors';
import { BoundedDocumentBuilder } from './document-builder';
import type { ExportFormatResult, ExportFormatterInput } from './format-result';
import { prepareFormatterInput } from './projection';
import { formattingLimitFailure, successfulFormat } from './result-builder';
import { appendTxtOpaquePrompt, appendTxtSection, inlineValue } from './text-rendering';

function appendHeader(
  builder: BoundedDocumentBuilder,
  prepared: ReturnType<typeof prepareFormatterInput> & { readonly ok: true },
): boolean {
  const plan = prepared.value.plan;
  return (
    builder.appendSystemLine('MOCKUP PHOTOSHOOT DIRECTOR EXPORT') &&
    builder.appendSystemLine('FORMAT: TXT') &&
    builder.appendSystemLine('SCHEMA VERSION: 1') &&
    builder.appendSystemLine(`BASE SCOPE: ${inlineValue(plan.scope.baseScope)}`) &&
    builder.appendSystemLine(`SCOPE DETAIL: ${inlineValue(plan.scope.scopeDetail)}`) &&
    builder.appendSystemLine(`PROJECT ID: ${inlineValue(plan.scope.projectId)}`) &&
    builder.appendSystemLine(`PARTIAL: ${inlineValue(plan.partial)}`)
  );
}

function appendNumbering(
  builder: BoundedDocumentBuilder,
  prepared: ReturnType<typeof prepareFormatterInput> & { readonly ok: true },
): boolean {
  const plan = prepared.value.plan;
  if (plan.numbering.length === 0 && plan.groupNumbering.length === 0) return true;
  if (!appendTxtSection(builder, 'NUMBERING MAP', true)) return false;
  for (const entry of plan.numbering) {
    const outputB =
      entry.outputBId === undefined || entry.outputBLabel === undefined
        ? ''
        : ` | ${entry.outputBLabel}=${inlineValue(entry.outputBId)}`;
    if (
      !builder.appendSystemLine(
        `SESSION ${inlineValue(entry.sessionId)} | SCENE ${inlineValue(entry.sceneId)} | ${entry.outputALabel}=${inlineValue(entry.outputAId)}${outputB}`,
      )
    ) {
      return false;
    }
  }
  for (const entry of plan.groupNumbering) {
    const outputB =
      entry.outputBId === undefined || entry.outputBLabel === undefined
        ? ''
        : ` | ${entry.outputBLabel}=${inlineValue(entry.outputBId)}`;
    if (
      !builder.appendSystemLine(
        `GROUP ${entry.groupNumber}.${entry.groupSceneNumber} | SCENE ${inlineValue(entry.sceneId)} | ${entry.outputALabel}=${inlineValue(entry.outputAId)}${outputB}`,
      )
    ) {
      return false;
    }
  }
  return true;
}

function appendMetadata(
  builder: BoundedDocumentBuilder,
  prepared: ReturnType<typeof prepareFormatterInput> & { readonly ok: true },
): boolean {
  const { selection } = prepared.value.plan;
  if (selection.project !== null) {
    if (!appendTxtSection(builder, 'PROJECT', true)) return false;
    if (!builder.appendSystemLine(`ID: ${inlineValue(selection.project.id)}`)) return false;
    if (!builder.appendSystemLine(`NAME: ${inlineValue(selection.project.name)}`)) return false;
    if (
      !builder.appendSystemLine(`SCHEMA VERSION: ${inlineValue(selection.project.schemaVersion)}`)
    ) {
      return false;
    }
  }
  if (selection.sessions.length > 0) {
    if (!appendTxtSection(builder, 'SESSIONS', true)) return false;
    for (const session of selection.sessions) {
      if (
        !builder.appendSystemLine(
          `SESSION ${inlineValue(session.id)} | NAME ${inlineValue(session.name)} | SEASON ${inlineValue(session.seasonId)} | AUDIENCE ${inlineValue(session.audience)} | SCENES ${session.requestedSceneCount}`,
        )
      ) {
        return false;
      }
    }
  }
  if (selection.groups.length > 0) {
    if (!appendTxtSection(builder, 'GROUPS', true)) return false;
    for (const group of selection.groups) {
      if (
        !builder.appendSystemLine(
          `GROUP ${group.groupNumber} | ID ${inlineValue(group.id)} | BY ${inlineValue(group.groupBy)} | KEY ${inlineValue(group.key)} | SCENES ${group.sceneIds.map(inlineValue).join(', ')}`,
        )
      ) {
        return false;
      }
    }
  }
  if (selection.scenes.length > 0) {
    if (!appendTxtSection(builder, 'SCENES', true)) return false;
    for (const scene of selection.scenes) {
      if (
        !builder.appendSystemLine(
          `SCENE ${inlineValue(scene.id)} | SESSION ${inlineValue(scene.sessionId)} | PRODUCT ${inlineValue(scene.productId)} | VIEW ${inlineValue(scene.view)} | DISPLAY ${inlineValue(scene.displayMethod)}`,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function appendPrompts(
  builder: BoundedDocumentBuilder,
  prepared: ReturnType<typeof prepareFormatterInput> & { readonly ok: true },
): boolean {
  const { selection } = prepared.value.plan;
  if (selection.outputsA.length > 0) {
    if (!appendTxtSection(builder, 'OUTPUT A PROMPTS', true)) return false;
    for (const outputA of selection.outputsA) {
      if (!appendTxtOpaquePrompt(builder, outputA.label, outputA.promptText)) return false;
    }
  }
  if (selection.outputsB.length > 0) {
    if (!appendTxtSection(builder, 'OUTPUT B PROMPTS', true)) return false;
    for (const outputB of selection.outputsB) {
      if (
        !builder.appendSystemLine(
          `SOURCE: ${outputB.label} USES ${outputB.sourceOutputALabel} (${inlineValue(outputB.sourceOutputAId)})`,
        ) ||
        !appendTxtOpaquePrompt(builder, outputB.label, outputB.promptText)
      ) {
        return false;
      }
    }
  }
  if (selection.groupPlans.length > 0) {
    if (!appendTxtSection(builder, 'GROUP PLANS', true)) return false;
    for (const group of selection.groupPlans) {
      if (
        !appendTxtOpaquePrompt(
          builder,
          `GROUP ${group.groupNumber} (${group.groupId})`,
          group.promptText,
        )
      ) {
        return false;
      }
    }
  }
  if (selection.executionPlans.length > 0) {
    if (!appendTxtSection(builder, 'EXECUTION PLANS', true)) return false;
    for (const executionPlan of selection.executionPlans) {
      if (!builder.appendSystemLine(`SESSION: ${inlineValue(executionPlan.sessionId)}`)) {
        return false;
      }
      if (!builder.appendSystemLine('PHASE 1 — OUTPUT A')) return false;
      for (const item of executionPlan.phase1) {
        if (
          !builder.appendSystemLine(
            `${item.label} | SCENE ${inlineValue(item.sceneId)} | OUTPUT ${inlineValue(item.outputAId)}`,
          )
        ) {
          return false;
        }
      }
      if (!builder.appendSystemLine('PHASE 2 — OUTPUT B USING MATCHING A + PNG')) return false;
      for (const item of executionPlan.phase2) {
        if (
          !builder.appendSystemLine(
            `${item.label} | SCENE ${inlineValue(item.sceneId)} | OUTPUT ${inlineValue(item.outputBId)} | SOURCE ${item.sourceOutputALabel} ${inlineValue(item.sourceOutputAId)}`,
          )
        ) {
          return false;
        }
      }
    }
  }
  if (selection.covers.length > 0) {
    if (!appendTxtSection(builder, 'COVER', true)) return false;
    for (const cover of selection.covers) {
      if (
        !builder.appendSystemLine(`OUTPUT A SOURCES: ${cover.sourceOutputALabels.join(', ')}`) ||
        !appendTxtOpaquePrompt(builder, `COVER (${cover.id})`, cover.promptText)
      ) {
        return false;
      }
    }
  }
  return true;
}

function appendDiagnostics(
  builder: BoundedDocumentBuilder,
  prepared: ReturnType<typeof prepareFormatterInput> & { readonly ok: true },
): boolean {
  const plan = prepared.value.plan;
  if (plan.omissions.length > 0) {
    if (!appendTxtSection(builder, 'OMISSIONS', true)) return false;
    for (const omission of plan.omissions) {
      const error = ERROR_BY_CODE[omission.code];
      if (
        !builder.appendSystemLine(
          `CODE ${omission.code} | SEVERITY ${error?.severity ?? ValidationSeverity.Blocking} | KIND ${omission.artifactKind} | ID ${inlineValue(omission.entityId)} | LOCATION ${inlineValue(omission.field)} | REASON ${inlineValue(error?.messageEn ?? omission.code)}`,
        )
      ) {
        return false;
      }
    }
  }
  const warnings = plan.issues.filter((issue) => issue.severity === ValidationSeverity.Warning);
  if (warnings.length > 0) {
    if (!appendTxtSection(builder, 'WARNINGS', true)) return false;
    for (const warning of warnings) {
      const error = ERROR_BY_CODE[warning.code];
      if (
        !builder.appendSystemLine(
          `CODE ${warning.code} | LOCATION ${inlineValue(warning.field)} | REASON ${inlineValue(error?.messageEn ?? warning.code)}`,
        )
      ) {
        return false;
      }
    }
  }
  if (plan.issues.length > 0 || plan.selection.validationResults.length > 0) {
    if (!appendTxtSection(builder, 'VALIDATION SUMMARY', true)) return false;
    if (!builder.appendSystemLine(`PARTIAL: ${plan.partial}`)) return false;
    if (!builder.appendSystemLine(`ISSUES: ${plan.issues.length}`)) return false;
    if (!builder.appendSystemLine(`OMISSIONS: ${plan.omissions.length}`)) return false;
    if (
      !builder.appendSystemLine(
        `SOURCE VALIDATION RESULTS: ${plan.selection.validationResults.length}`,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function formatTxt(input: ExportFormatterInput): ExportFormatResult {
  const prepared = prepareFormatterInput(input);
  if (!prepared.ok) return prepared;
  const builder = new BoundedDocumentBuilder(prepared.value.limits.maxArtifactBytes);
  if (
    !appendHeader(builder, prepared) ||
    !appendNumbering(builder, prepared) ||
    !appendMetadata(builder, prepared) ||
    !appendPrompts(builder, prepared) ||
    !appendDiagnostics(builder, prepared)
  ) {
    return formattingLimitFailure('formatter.txt');
  }
  const built = builder.finish();
  return built
    ? successfulFormat(prepared.value, built, 'txt', 'text/plain;charset=utf-8', 'txt')
    : formattingLimitFailure('formatter.txt');
}
