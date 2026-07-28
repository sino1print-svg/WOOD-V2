/**
 * UI View State — Phase 10.5 Runnable Application Integration.
 *
 * Pure, deterministic projections from the approved `UiState` to what the
 * Prompt Center screen renders: per-scene result rows with Output A and
 * Output B kept strictly separate, plus banner/status derivations. No engine
 * imports, no side effects, no time, no randomness.
 */
import type { PromptViewModel, UiFailure, UiState } from '../../ui-engine';

/** One scene row: Output A and Output B stay separate results end to end. */
export interface PromptResultRow {
  readonly sceneId: string;
  readonly sceneNumber: number;
  readonly outputA: PromptViewModel;
  readonly outputB: PromptViewModel | null;
}

/**
 * Pairs the generated prompts by scene, in the authoritative scene order.
 * Output A and Output B are never merged into one text.
 */
export function buildResultRows(state: UiState): readonly PromptResultRow[] {
  const bySceneKind = new Map<string, { a?: PromptViewModel; b?: PromptViewModel }>();
  for (const prompt of state.prompts) {
    const entry = bySceneKind.get(prompt.sceneId) ?? {};
    if (prompt.kind === 'A') entry.a = prompt;
    else entry.b = prompt;
    bySceneKind.set(prompt.sceneId, entry);
  }
  const rows: PromptResultRow[] = [];
  for (const [index, scene] of state.scenes.entries()) {
    const entry = bySceneKind.get(scene.id);
    if (!entry?.a) continue;
    rows.push({
      sceneId: scene.id,
      sceneNumber: index + 1,
      outputA: entry.a,
      outputB: entry.b ?? null,
    });
  }
  return rows;
}

export type ResultsPhase = 'empty' | 'loading' | 'ready' | 'failed';

/** Results-area phase: empty before any generation, loading while running. */
export function resultsPhase(state: UiState): ResultsPhase {
  if (state.phase === 'generating-scenes' || state.phase === 'generating-prompts') {
    return 'loading';
  }
  if (state.phase === 'prompts-ready' && state.prompts.length > 0) return 'ready';
  if (state.failures.some((failure) => failure.severity === 'blocking')) return 'failed';
  return 'empty';
}

export function blockingFailures(state: UiState): readonly UiFailure[] {
  return state.failures.filter((failure) => failure.severity === 'blocking');
}

export function warningFailures(state: UiState): readonly UiFailure[] {
  return state.failures.filter((failure) => failure.severity === 'warning');
}

/** Per-prompt copy feedback (persistent until the next action; no timers). */
export type CopyStatus = 'copied' | 'failed';
export type CopyStatusMap = Readonly<Record<string, CopyStatus>>;

/** Export is available only for a valid, current generation result. */
export function exportEnabled(state: UiState): boolean {
  return state.phase === 'prompts-ready' && state.prompts.length > 0;
}
