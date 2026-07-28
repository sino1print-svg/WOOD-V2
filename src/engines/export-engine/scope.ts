import {
  ExportScope,
  type GroupId,
  type PhotoshootSession,
  type Project,
  type SceneId,
  type SessionId,
  type ValidationFailure,
} from '../../shared/domain-model';
import type {
  ExportOperationalScope,
  ExportSourceSnapshot,
} from '../../shared/contracts/export-contracts';
import { exportFailure } from './failures';
import { canonicalGroups, canonicalSessions } from './ordering';
import { isPlainRecord } from './runtime';
import type {
  ExportPlanningFailureCode,
  ExportResolvedScope,
  ExportScopeContentPolicy,
} from './types';

export type ExportScopeResolutionResult =
  | { readonly ok: true; readonly value: ExportResolvedScope }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

const EMPTY_POLICY: ExportScopeContentPolicy = Object.freeze({
  projectMetadata: false,
  sessionMetadata: false,
  sceneMetadata: false,
  outputA: false,
  outputB: false,
  groupMetadata: false,
  groupPlans: false,
  executionPlans: false,
  cover: false,
  artworkMetadata: false,
  validationResults: false,
  versionMetadata: false,
  backupResolutionOnly: false,
});

function contentPolicy(values: Partial<ExportScopeContentPolicy>): ExportScopeContentPolicy {
  return { ...EMPTY_POLICY, ...values };
}

function failed(code: ExportPlanningFailureCode, field: string): ExportScopeResolutionResult {
  return { ok: false, failures: [exportFailure(code, field)] };
}

function getSession(project: Project, sessionId: SessionId): PhotoshootSession | null {
  if (!project.sessionOrder.includes(sessionId)) return null;
  return project.sessions[sessionId] ?? null;
}

function allSessionIds(project: Project): readonly SessionId[] {
  return project.sessionOrder.filter((sessionId) => project.sessions[sessionId] !== undefined);
}

function sceneIdsForSessions(
  project: Project,
  sessionIds: readonly SessionId[],
): readonly SceneId[] {
  return canonicalSessions(project, sessionIds).flatMap((session) => [...session.sceneOrder]);
}

function groupIdsForSessions(
  project: Project,
  sessionIds: readonly SessionId[],
): readonly GroupId[] {
  return canonicalSessions(project, sessionIds).flatMap((session) =>
    canonicalGroups(
      session,
      Object.values(session.groups).map((group) => group.id),
    ).map((group) => group.id),
  );
}

function collectEntityIds(
  project: Project,
  sessionIds: readonly SessionId[],
  sceneIds: readonly SceneId[],
): Pick<ExportResolvedScope, 'outputAIds' | 'outputBIds' | 'coverIds'> {
  const requestedScenes = new Set<string>(sceneIds);
  const outputAIds: ExportResolvedScope['outputAIds'][number][] = [];
  const outputBIds: ExportResolvedScope['outputBIds'][number][] = [];
  const coverIds: ExportResolvedScope['coverIds'][number][] = [];
  for (const session of canonicalSessions(project, sessionIds)) {
    for (const sceneId of session.sceneOrder) {
      if (!requestedScenes.has(sceneId)) continue;
      const scene = session.scenes[sceneId];
      if (!scene) continue;
      if (isPlainRecord(scene.outputA)) outputAIds.push(scene.outputA.id);
      if (isPlainRecord(scene.outputB)) outputBIds.push(scene.outputB.id);
    }
    if (isPlainRecord(session.cover)) coverIds.push(session.cover.id);
  }
  return { outputAIds, outputBIds, coverIds };
}

function resolved(
  project: Project,
  scope: ExportOperationalScope,
  sessionIds: readonly SessionId[],
  groupIds: readonly GroupId[],
  sceneIds: readonly SceneId[],
  outputAIds: ExportResolvedScope['outputAIds'],
  outputBIds: ExportResolvedScope['outputBIds'],
  coverIds: ExportResolvedScope['coverIds'],
  versionIds: ExportResolvedScope['versionIds'],
  policy: ExportScopeContentPolicy,
): ExportScopeResolutionResult {
  return {
    ok: true,
    value: {
      baseScope: scope.baseScope,
      scopeDetail: scope.scopeDetail,
      projectId: project.id,
      sessionIds: [...sessionIds],
      groupIds: [...groupIds],
      sceneIds: [...sceneIds],
      outputAIds: [...outputAIds],
      outputBIds: [...outputBIds],
      coverIds: [...coverIds],
      versionIds: [...versionIds],
      policy,
    },
  };
}

function resolveOneSession(
  project: Project,
  scope: ExportOperationalScope,
  session: PhotoshootSession,
  policy: ExportScopeContentPolicy,
): ExportScopeResolutionResult {
  if (session.sceneOrder.length === 0 && !policy.backupResolutionOnly) {
    return failed('EXPORT_SCOPE_002', `source.project.sessions.${session.id}.sceneOrder`);
  }
  const sessionIds = [session.id];
  const sceneIds = [...session.sceneOrder];
  const groupIds = groupIdsForSessions(project, sessionIds);
  const ids = collectEntityIds(project, sessionIds, sceneIds);
  return resolved(
    project,
    scope,
    sessionIds,
    groupIds,
    sceneIds,
    ids.outputAIds,
    ids.outputBIds,
    ids.coverIds,
    [],
    policy,
  );
}

/** Resolve every EX §3 selector into concrete entity IDs without formatting. */
export function resolveExportScope(
  source: ExportSourceSnapshot,
  scope: ExportOperationalScope,
): ExportScopeResolutionResult {
  const project = source.project as Project;

  if (scope.scopeDetail === 'output_a') {
    if (scope.baseScope !== ExportScope.Output) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    const scene = session?.scenes[scope.sceneId];
    if (!session || !session.sceneOrder.includes(scope.sceneId) || !scene) {
      return failed('EXPORT_SCOPE_001', 'scope.sceneId');
    }
    if (!isPlainRecord(scene.outputA)) {
      return failed(
        'EXPORT_MISSINGA_001',
        `source.project.sessions.${session.id}.scenes.${scene.id}.outputA`,
      );
    }
    if (scene.outputA.id !== scope.outputAId) {
      return failed('EXPORT_SCOPE_001', 'scope.outputAId');
    }
    return resolved(
      project,
      scope,
      [session.id],
      [],
      [scene.id],
      [scene.outputA.id],
      [],
      [],
      [],
      contentPolicy({ outputA: true }),
    );
  }

  if (scope.scopeDetail === 'output_b') {
    if (scope.baseScope !== ExportScope.Output) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    const scene = session?.scenes[scope.sceneId];
    if (!session || !session.sceneOrder.includes(scope.sceneId) || !scene) {
      return failed('EXPORT_SCOPE_001', 'scope.sceneId');
    }
    if (!isPlainRecord(scene.outputA)) {
      return failed(
        'EXPORT_MISSINGA_001',
        `source.project.sessions.${session.id}.scenes.${scene.id}.outputA`,
      );
    }
    if (!isPlainRecord(scene.outputB)) {
      return failed(
        'EXPORT_SCOPE_002',
        `source.project.sessions.${session.id}.scenes.${scene.id}.outputB`,
      );
    }
    if (scene.outputB.id !== scope.outputBId) {
      return failed('EXPORT_SCOPE_001', 'scope.outputBId');
    }
    return resolved(
      project,
      scope,
      [session.id],
      [],
      [scene.id],
      [scene.outputA.id],
      [scene.outputB.id],
      [],
      [],
      contentPolicy({ outputB: true, artworkMetadata: true }),
    );
  }

  if (scope.scopeDetail === 'pair') {
    if (scope.baseScope !== ExportScope.Output) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    const scene = session?.scenes[scope.sceneId];
    if (!session || !session.sceneOrder.includes(scope.sceneId) || !scene) {
      return failed('EXPORT_SCOPE_001', 'scope.sceneId');
    }
    if (!isPlainRecord(scene.outputA)) {
      return failed(
        'EXPORT_MISSINGA_001',
        `source.project.sessions.${session.id}.scenes.${scene.id}.outputA`,
      );
    }
    return resolved(
      project,
      scope,
      [session.id],
      [],
      [scene.id],
      [scene.outputA.id],
      isPlainRecord(scene.outputB) ? [scene.outputB.id] : [],
      [],
      [],
      contentPolicy({ outputA: true, outputB: true, artworkMetadata: true }),
    );
  }

  if (
    scope.scopeDetail === 'group' ||
    scope.scopeDetail === 'group_a' ||
    scope.scopeDetail === 'group_b'
  ) {
    if (scope.baseScope !== ExportScope.Group) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    const group = session?.groups[scope.groupId];
    if (!session || !group || group.sessionId !== session.id) {
      return failed('EXPORT_SCOPE_001', 'scope.groupId');
    }
    if (group.sceneIds.length === 0) {
      return failed(
        'EXPORT_SCOPE_002',
        `source.project.sessions.${session.id}.groups.${group.id}.sceneIds`,
      );
    }
    if (group.sceneIds.some((sceneId) => session.scenes[sceneId] === undefined)) {
      return failed(
        'EXPORT_GROUP_001',
        `source.project.sessions.${session.id}.groups.${group.id}.sceneIds`,
      );
    }
    const members = new Set<string>(group.sceneIds);
    const sceneIds = session.sceneOrder.filter((sceneId) => members.has(sceneId));
    const ids = collectEntityIds(project, [session.id], sceneIds);
    const groupPolicy =
      scope.scopeDetail === 'group_a'
        ? contentPolicy({ outputA: true, groupMetadata: true })
        : scope.scopeDetail === 'group_b'
          ? contentPolicy({ outputB: true, groupMetadata: true, artworkMetadata: true })
          : contentPolicy({
              outputA: true,
              outputB: true,
              groupMetadata: true,
              groupPlans: true,
              artworkMetadata: true,
            });
    return resolved(
      project,
      scope,
      [session.id],
      [group.id],
      sceneIds,
      ids.outputAIds,
      ids.outputBIds,
      [],
      [],
      groupPolicy,
    );
  }

  if (scope.scopeDetail === 'cover') {
    if (scope.baseScope !== ExportScope.Cover) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    if (!session) return failed('EXPORT_SCOPE_001', 'scope.sessionId');
    if (!isPlainRecord(session.cover)) {
      return failed('EXPORT_SCOPE_002', `source.project.sessions.${session.id}.cover`);
    }
    if (session.cover.id !== scope.coverId) return failed('EXPORT_SCOPE_001', 'scope.coverId');
    const ids = collectEntityIds(project, [session.id], session.sceneOrder);
    return resolved(
      project,
      scope,
      [session.id],
      [],
      [...session.sceneOrder],
      ids.outputAIds,
      ids.outputBIds,
      [session.cover.id],
      [],
      contentPolicy({ cover: true }),
    );
  }

  if (scope.scopeDetail === 'session' || scope.scopeDetail === 'execution_plan') {
    if (scope.baseScope !== ExportScope.Session) return failed('EXPORT_SCOPE_001', 'scope');
    const session = getSession(project, scope.sessionId);
    if (!session) return failed('EXPORT_SCOPE_001', 'scope.sessionId');
    return resolveOneSession(
      project,
      scope,
      session,
      scope.scopeDetail === 'execution_plan'
        ? contentPolicy({ executionPlans: true })
        : contentPolicy({
            sessionMetadata: true,
            sceneMetadata: true,
            outputA: true,
            outputB: true,
            groupMetadata: true,
            groupPlans: true,
            executionPlans: true,
            cover: true,
            artworkMetadata: true,
            validationResults: true,
          }),
    );
  }

  if (scope.scopeDetail === 'complete_project' || scope.scopeDetail === 'all') {
    if (scope.baseScope !== ExportScope.All) return failed('EXPORT_SCOPE_001', 'scope');
    const sessionIds = allSessionIds(project);
    if (sessionIds.length === 0) return failed('EXPORT_SCOPE_002', 'source.project.sessionOrder');
    const sceneIds = sceneIdsForSessions(project, sessionIds);
    if (sceneIds.length === 0) return failed('EXPORT_SCOPE_002', 'source.project.sessions');
    const groupIds = groupIdsForSessions(project, sessionIds);
    const ids = collectEntityIds(project, sessionIds, sceneIds);
    return resolved(
      project,
      scope,
      sessionIds,
      groupIds,
      sceneIds,
      ids.outputAIds,
      ids.outputBIds,
      ids.coverIds,
      [],
      contentPolicy({
        projectMetadata: true,
        sessionMetadata: true,
        sceneMetadata: true,
        outputA: true,
        outputB: true,
        groupMetadata: true,
        groupPlans: true,
        executionPlans: true,
        cover: true,
        artworkMetadata: true,
        validationResults: true,
      }),
    );
  }

  if (scope.scopeDetail === 'backup') {
    if (scope.baseScope !== ExportScope.All) return failed('EXPORT_SCOPE_001', 'scope');
    const sessionIds =
      scope.backupType === 'session'
        ? (() => {
            const session = getSession(project, scope.sessionId);
            return session ? [session.id] : [];
          })()
        : allSessionIds(project);
    if (scope.backupType === 'session' && sessionIds.length === 0) {
      return failed('EXPORT_SCOPE_001', 'scope.sessionId');
    }
    const sceneIds = sceneIdsForSessions(project, sessionIds);
    const groupIds = groupIdsForSessions(project, sessionIds);
    const ids = collectEntityIds(project, sessionIds, sceneIds);
    return resolved(
      project,
      scope,
      sessionIds,
      groupIds,
      sceneIds,
      ids.outputAIds,
      ids.outputBIds,
      ids.coverIds,
      scope.backupType === 'full_project' ? [...project.versionOrder] : [],
      contentPolicy({
        projectMetadata: true,
        sessionMetadata: true,
        sceneMetadata: true,
        groupMetadata: true,
        versionMetadata: scope.backupType === 'full_project',
        backupResolutionOnly: true,
      }),
    );
  }

  if (scope.scopeDetail === 'version_snapshot') {
    if (scope.baseScope !== ExportScope.All) return failed('EXPORT_SCOPE_001', 'scope');
    const snapshot = project.versionHistory[scope.versionId];
    if (!snapshot || !project.versionOrder.includes(scope.versionId)) {
      return failed('EXPORT_SCOPE_001', 'scope.versionId');
    }
    return resolved(
      project,
      scope,
      [],
      [],
      [],
      [],
      [],
      [],
      [snapshot.versionId],
      contentPolicy({ versionMetadata: true, backupResolutionOnly: true }),
    );
  }

  if (scope.scopeDetail === 'prompt_pack') {
    const sessionIds =
      scope.baseScope === ExportScope.Session
        ? (() => {
            const session = getSession(project, scope.sessionId);
            return session ? [session.id] : [];
          })()
        : scope.baseScope === ExportScope.All
          ? allSessionIds(project)
          : [];
    if (sessionIds.length === 0) return failed('EXPORT_SCOPE_001', 'scope');
    const sceneIds = sceneIdsForSessions(project, sessionIds);
    if (sceneIds.length === 0) return failed('EXPORT_SCOPE_002', 'source.project.sessions');
    const groupIds = groupIdsForSessions(project, sessionIds);
    const ids = collectEntityIds(project, sessionIds, sceneIds);
    return resolved(
      project,
      scope,
      sessionIds,
      groupIds,
      sceneIds,
      ids.outputAIds,
      ids.outputBIds,
      ids.coverIds,
      [],
      contentPolicy({
        projectMetadata: scope.baseScope === ExportScope.All,
        sessionMetadata: true,
        outputA: true,
        outputB: true,
        groupMetadata: true,
        groupPlans: true,
        executionPlans: true,
        cover: true,
        artworkMetadata: true,
      }),
    );
  }

  return failed('EXPORT_SCOPE_001', 'scope');
}
