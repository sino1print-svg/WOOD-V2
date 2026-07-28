import { ValidationSeverity } from '../shared/domain-model';
import { ERROR_BY_CODE } from '../shared/errors';
import { BoundedDocumentBuilder } from './document-builder';
import type { ExportFormatResult, ExportFormatterInput } from './format-result';
import { prepareFormatterInput, type PreparedFormatterSource } from './projection';
import { formattingLimitFailure, successfulFormat } from './result-builder';
import { appendMarkdownOpaquePrompt, inlineValue } from './text-rendering';

function heading(builder: BoundedDocumentBuilder, level: 2 | 3, title: string): boolean {
  return builder.appendSystemLine() && builder.appendSystemLine(`${'#'.repeat(level)} ${title}`);
}

function appendMetadata(
  builder: BoundedDocumentBuilder,
  prepared: PreparedFormatterSource,
): boolean {
  const plan = prepared.plan;
  if (!heading(builder, 2, 'Metadata')) return false;
  return (
    builder.appendSystemLine(`- Schema version: 1`) &&
    builder.appendSystemLine(`- Base scope: ${inlineValue(plan.scope.baseScope)}`) &&
    builder.appendSystemLine(`- Scope detail: ${inlineValue(plan.scope.scopeDetail)}`) &&
    builder.appendSystemLine(`- Project ID: ${inlineValue(plan.scope.projectId)}`) &&
    builder.appendSystemLine(`- Partial: ${inlineValue(plan.partial)}`)
  );
}

function appendNumbering(
  builder: BoundedDocumentBuilder,
  prepared: PreparedFormatterSource,
): boolean {
  const plan = prepared.plan;
  if (plan.numbering.length === 0 && plan.groupNumbering.length === 0) return true;
  if (!heading(builder, 2, 'Numbering Map')) return false;
  for (const entry of plan.numbering) {
    const outputB =
      entry.outputBId === undefined || entry.outputBLabel === undefined
        ? ''
        : `; ${entry.outputBLabel} = ${inlineValue(entry.outputBId)}`;
    if (
      !builder.appendSystemLine(
        `- Session ${inlineValue(entry.sessionId)}, scene ${inlineValue(entry.sceneId)}: ${entry.outputALabel} = ${inlineValue(entry.outputAId)}${outputB}`,
      )
    ) {
      return false;
    }
  }
  for (const entry of plan.groupNumbering) {
    const outputB =
      entry.outputBId === undefined || entry.outputBLabel === undefined
        ? ''
        : `; ${entry.outputBLabel} = ${inlineValue(entry.outputBId)}`;
    if (
      !builder.appendSystemLine(
        `- Group ${entry.groupNumber}.${entry.groupSceneNumber}, scene ${inlineValue(entry.sceneId)}: ${entry.outputALabel} = ${inlineValue(entry.outputAId)}${outputB}`,
      )
    ) {
      return false;
    }
  }
  return true;
}

function appendEntities(
  builder: BoundedDocumentBuilder,
  prepared: PreparedFormatterSource,
): boolean {
  const { selection } = prepared.plan;
  if (selection.project !== null) {
    if (!heading(builder, 2, 'Project')) return false;
    if (!builder.appendSystemLine(`- ID: ${inlineValue(selection.project.id)}`)) return false;
    if (!builder.appendSystemLine(`- Name: ${inlineValue(selection.project.name)}`)) return false;
    if (!builder.appendSystemLine(`- Schema version: ${selection.project.schemaVersion}`)) {
      return false;
    }
  }
  if (selection.sessions.length > 0) {
    if (!heading(builder, 2, 'Sessions')) return false;
    for (let index = 0; index < selection.sessions.length; index += 1) {
      const session = selection.sessions[index];
      if (session === undefined || !heading(builder, 3, `Session ${index + 1}`)) return false;
      if (!builder.appendSystemLine(`- ID: ${inlineValue(session.id)}`)) return false;
      if (!builder.appendSystemLine(`- Name: ${inlineValue(session.name)}`)) return false;
      if (!builder.appendSystemLine(`- Season: ${inlineValue(session.seasonId)}`)) return false;
      if (!builder.appendSystemLine(`- Audience: ${inlineValue(session.audience)}`)) return false;
      if (!builder.appendSystemLine(`- Scene count: ${session.requestedSceneCount}`)) return false;
    }
  }
  if (selection.groups.length > 0) {
    if (!heading(builder, 2, 'Groups')) return false;
    for (const group of selection.groups) {
      if (!heading(builder, 3, `Group ${group.groupNumber}`)) return false;
      if (!builder.appendSystemLine(`- ID: ${inlineValue(group.id)}`)) return false;
      if (!builder.appendSystemLine(`- Group by: ${inlineValue(group.groupBy)}`)) return false;
      if (!builder.appendSystemLine(`- Key: ${inlineValue(group.key)}`)) return false;
      if (!builder.appendSystemLine(`- Scene IDs: ${group.sceneIds.map(inlineValue).join(', ')}`)) {
        return false;
      }
    }
  }
  if (selection.scenes.length > 0) {
    if (!heading(builder, 2, 'Scenes')) return false;
    for (let index = 0; index < selection.scenes.length; index += 1) {
      const scene = selection.scenes[index];
      if (scene === undefined || !heading(builder, 3, `Scene ${index + 1}`)) return false;
      if (!builder.appendSystemLine(`- ID: ${inlineValue(scene.id)}`)) return false;
      if (!builder.appendSystemLine(`- Session ID: ${inlineValue(scene.sessionId)}`)) return false;
      if (!builder.appendSystemLine(`- Product ID: ${inlineValue(scene.productId)}`)) return false;
      if (!builder.appendSystemLine(`- View: ${inlineValue(scene.view)}`)) return false;
      if (!builder.appendSystemLine(`- Display: ${inlineValue(scene.displayMethod)}`)) return false;
    }
  }
  return true;
}

function appendPrompts(
  builder: BoundedDocumentBuilder,
  prepared: PreparedFormatterSource,
): boolean {
  const { selection } = prepared.plan;
  if (selection.outputsA.length > 0) {
    if (!heading(builder, 2, 'Output A Prompts')) return false;
    for (const outputA of selection.outputsA) {
      if (!heading(builder, 3, `Prompt ${inlineValue(outputA.label)}`)) return false;
      if (!builder.appendSystemLine(`Source ID: ${inlineValue(outputA.id)}`)) return false;
      if (!appendMarkdownOpaquePrompt(builder, outputA.label, outputA.promptText)) return false;
    }
  }
  if (selection.outputsB.length > 0) {
    if (!heading(builder, 2, 'Output B Prompts')) return false;
    for (const outputB of selection.outputsB) {
      if (!heading(builder, 3, `Prompt ${inlineValue(outputB.label)}`)) return false;
      if (
        !builder.appendSystemLine(
          `Source: ${outputB.sourceOutputALabel} (${inlineValue(outputB.sourceOutputAId)})`,
        )
      ) {
        return false;
      }
      if (!appendMarkdownOpaquePrompt(builder, outputB.label, outputB.promptText)) return false;
    }
  }
  if (selection.groupPlans.length > 0) {
    if (!heading(builder, 2, 'Group Plans')) return false;
    for (const group of selection.groupPlans) {
      if (!heading(builder, 3, `Group Plan ${group.groupNumber}`)) return false;
      if (!builder.appendSystemLine(`Group ID: ${inlineValue(group.groupId)}`)) return false;
      if (
        !appendMarkdownOpaquePrompt(
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
    if (!heading(builder, 2, 'Execution Plans')) return false;
    for (let index = 0; index < selection.executionPlans.length; index += 1) {
      const plan = selection.executionPlans[index];
      if (plan === undefined || !heading(builder, 3, `Execution Plan ${index + 1}`)) return false;
      if (!builder.appendSystemLine(`Session ID: ${inlineValue(plan.sessionId)}`)) return false;
      if (!builder.appendSystemLine('Phase 1 — Output A')) return false;
      for (const item of plan.phase1) {
        if (
          !builder.appendSystemLine(
            `- ${item.label}: scene ${inlineValue(item.sceneId)}, output ${inlineValue(item.outputAId)}`,
          )
        ) {
          return false;
        }
      }
      if (!builder.appendSystemLine('Phase 2 — Output B using matching A + PNG')) return false;
      for (const item of plan.phase2) {
        if (
          !builder.appendSystemLine(
            `- ${item.label}: scene ${inlineValue(item.sceneId)}, output ${inlineValue(item.outputBId)}, source ${item.sourceOutputALabel} ${inlineValue(item.sourceOutputAId)}`,
          )
        ) {
          return false;
        }
      }
    }
  }
  if (selection.covers.length > 0) {
    if (!heading(builder, 2, 'Cover')) return false;
    for (let index = 0; index < selection.covers.length; index += 1) {
      const cover = selection.covers[index];
      if (cover === undefined || !heading(builder, 3, `Cover ${index + 1}`)) return false;
      if (!builder.appendSystemLine(`Cover ID: ${inlineValue(cover.id)}`)) return false;
      if (!builder.appendSystemLine(`Output A sources: ${cover.sourceOutputALabels.join(', ')}`)) {
        return false;
      }
      if (!appendMarkdownOpaquePrompt(builder, `COVER (${cover.id})`, cover.promptText)) {
        return false;
      }
    }
  }
  return true;
}

function appendDiagnostics(
  builder: BoundedDocumentBuilder,
  prepared: PreparedFormatterSource,
): boolean {
  const plan = prepared.plan;
  if (plan.omissions.length > 0) {
    if (!heading(builder, 2, 'Omissions')) return false;
    for (const omission of plan.omissions) {
      const error = ERROR_BY_CODE[omission.code];
      if (
        !builder.appendSystemLine(
          `- Code ${omission.code}; severity ${error?.severity ?? ValidationSeverity.Blocking}; kind ${omission.artifactKind}; ID ${inlineValue(omission.entityId)}; location ${inlineValue(omission.field)}; reason ${inlineValue(error?.messageEn ?? omission.code)}`,
        )
      ) {
        return false;
      }
    }
  }
  const warnings = plan.issues.filter((issue) => issue.severity === ValidationSeverity.Warning);
  if (warnings.length > 0) {
    if (!heading(builder, 2, 'Warnings')) return false;
    for (const warning of warnings) {
      const error = ERROR_BY_CODE[warning.code];
      if (
        !builder.appendSystemLine(
          `- Code ${warning.code}; location ${inlineValue(warning.field)}; reason ${inlineValue(error?.messageEn ?? warning.code)}`,
        )
      ) {
        return false;
      }
    }
  }
  if (plan.issues.length > 0 || plan.selection.validationResults.length > 0) {
    if (!heading(builder, 2, 'Validation Summary')) return false;
    if (!builder.appendSystemLine(`- Partial: ${plan.partial}`)) return false;
    if (!builder.appendSystemLine(`- Issues: ${plan.issues.length}`)) return false;
    if (!builder.appendSystemLine(`- Omissions: ${plan.omissions.length}`)) return false;
    if (
      !builder.appendSystemLine(
        `- Source validation results: ${plan.selection.validationResults.length}`,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function formatMarkdown(input: ExportFormatterInput): ExportFormatResult {
  const prepared = prepareFormatterInput(input);
  if (!prepared.ok) return prepared;
  const builder = new BoundedDocumentBuilder(prepared.value.limits.maxArtifactBytes);
  if (
    !builder.appendSystemLine('# Mockup Photoshoot Director Export') ||
    !appendMetadata(builder, prepared.value) ||
    !appendNumbering(builder, prepared.value) ||
    !appendEntities(builder, prepared.value) ||
    !appendPrompts(builder, prepared.value) ||
    !appendDiagnostics(builder, prepared.value)
  ) {
    return formattingLimitFailure('formatter.markdown');
  }
  const built = builder.finish();
  return built
    ? successfulFormat(prepared.value, built, 'markdown', 'text/markdown;charset=utf-8', 'md')
    : formattingLimitFailure('formatter.markdown');
}
