import type {
  Group,
  GroupId,
  PhotoshootSession,
  Project,
  Scene,
  SceneId,
  SessionId,
} from '../../shared/domain-model';
import { compareUtf8, isPlainRecord } from './runtime';
import type {
  ExportGroupNumberingEntry,
  ExportGroupOutputALabel,
  ExportGroupOutputBLabel,
  ExportNumberingEntry,
  ExportOutputALabel,
  ExportOutputBLabel,
  ExportResolvedScope,
} from './types';

export function canonicalSessions(
  project: Project,
  requestedIds: readonly SessionId[],
): readonly PhotoshootSession[] {
  const requested = new Set<string>(requestedIds);
  return project.sessionOrder
    .filter((sessionId) => requested.has(sessionId))
    .map((sessionId) => project.sessions[sessionId])
    .filter((session): session is PhotoshootSession => session !== undefined);
}

export function canonicalGroups(
  session: PhotoshootSession,
  requestedIds: readonly GroupId[],
): readonly Group[] {
  const requested = new Set<string>(requestedIds);
  return Object.values(session.groups)
    .filter((group) => requested.has(group.id))
    .sort((left, right) => compareUtf8(left.key, right.key) || compareUtf8(left.id, right.id));
}

export function canonicalScenes(
  session: PhotoshootSession,
  requestedIds: readonly SceneId[],
): readonly Scene[] {
  const requested = new Set<string>(requestedIds);
  return session.sceneOrder
    .filter((sceneId) => requested.has(sceneId))
    .map((sceneId) => session.scenes[sceneId])
    .filter((scene): scene is Scene => scene !== undefined);
}

function outputALabel(sceneNumber: number): ExportOutputALabel {
  return `${sceneNumber}A` as ExportOutputALabel;
}

function outputBLabel(sceneNumber: number): ExportOutputBLabel {
  return `${sceneNumber}B` as ExportOutputBLabel;
}

function groupOutputALabel(groupNumber: number, groupSceneNumber: number): ExportGroupOutputALabel {
  return `${groupNumber}.${groupSceneNumber}-A` as ExportGroupOutputALabel;
}

function groupOutputBLabel(groupNumber: number, groupSceneNumber: number): ExportGroupOutputBLabel {
  return `${groupNumber}.${groupSceneNumber}-B` as ExportGroupOutputBLabel;
}

export function buildExportNumbering(
  project: Project,
  resolved: ExportResolvedScope,
): {
  readonly numbering: readonly ExportNumberingEntry[];
  readonly groupNumbering: readonly ExportGroupNumberingEntry[];
} {
  const numbering: ExportNumberingEntry[] = [];
  const groupNumbering: ExportGroupNumberingEntry[] = [];
  const requestedScenes = new Set<string>(resolved.sceneIds);

  for (const session of canonicalSessions(project, resolved.sessionIds)) {
    const bySceneId = new Map<SceneId, ExportNumberingEntry>();
    for (let sceneIndex = 0; sceneIndex < session.sceneOrder.length; sceneIndex += 1) {
      const sceneId = session.sceneOrder[sceneIndex]!;
      if (!requestedScenes.has(sceneId)) continue;
      const scene = session.scenes[sceneId];
      if (!scene || !isPlainRecord(scene.outputA)) continue;
      const sceneNumber = sceneIndex + 1;
      const entry: ExportNumberingEntry = {
        sessionId: session.id,
        sceneId,
        sceneNumber,
        outputAId: scene.outputA.id,
        outputALabel: outputALabel(sceneNumber),
        ...(isPlainRecord(scene.outputB)
          ? {
              outputBId: scene.outputB.id,
              outputBLabel: outputBLabel(sceneNumber),
            }
          : {}),
      };
      numbering.push(entry);
      bySceneId.set(sceneId, entry);
    }

    const requestedGroups = new Set<string>(resolved.groupIds);
    const groups = canonicalGroups(
      session,
      Object.values(session.groups).map((group) => group.id),
    );
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!;
      if (!requestedGroups.has(group.id)) continue;
      const members = new Set<string>(group.sceneIds);
      let groupSceneNumber = 0;
      for (const sceneId of session.sceneOrder) {
        if (!members.has(sceneId) || !requestedScenes.has(sceneId)) continue;
        const sceneNumbering = bySceneId.get(sceneId);
        if (!sceneNumbering) continue;
        groupSceneNumber += 1;
        groupNumbering.push({
          sessionId: session.id,
          groupId: group.id,
          groupNumber: groupIndex + 1,
          groupSceneNumber,
          sceneId,
          sceneNumber: sceneNumbering.sceneNumber,
          outputAId: sceneNumbering.outputAId,
          outputALabel: groupOutputALabel(groupIndex + 1, groupSceneNumber),
          ...(sceneNumbering.outputBId
            ? {
                outputBId: sceneNumbering.outputBId,
                outputBLabel: groupOutputBLabel(groupIndex + 1, groupSceneNumber),
              }
            : {}),
        });
      }
    }
  }

  return { numbering, groupNumbering };
}
