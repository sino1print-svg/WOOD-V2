import { canonicalStringify, deterministicFingerprint } from './canonical';
import {
  engineFailuresToUi,
  type ResolvedUiGenerationPlan,
  type UiCatalog,
  type UiEnginePorts,
  type UiFailure,
  type UiState,
} from './types';
import { validateDraft } from './validation';
import { createInitialUiState, transitionUiState, withFailures } from './state';
import { validateRuntimeUiState } from './runtime-validation';
import { validatePromptCollection, validateSceneCollection } from './generated-validation';

const nativePromiseResolve = Promise.resolve.bind(Promise) as (value: unknown) => Promise<unknown>;
const nativePromiseThen = Promise.prototype.then;

function observePromise<TValue, TResult>(
  promise: Promise<TValue>,
  onFulfilled: (value: TValue) => TResult | PromiseLike<TResult>,
  onRejected: (reason: unknown) => TResult | PromiseLike<TResult>,
): Promise<TResult> {
  return Reflect.apply(nativePromiseThen, promise, [onFulfilled, onRejected]) as Promise<TResult>;
}

export interface GenerationOwnership {
  readonly getCurrentState: () => UiState;
  readonly publishPending: (state: UiState) => void | Promise<void>;
  readonly publishFailure: (state: UiState) => void | Promise<void>;
}

type OwnershipPublication = 'publishPending' | 'publishFailure';
type OwnershipFailureField =
  | 'ownership.publishPending'
  | 'ownership.publishFailure'
  | 'ownership.getCurrentState';

type OwnershipReadResult =
  | { readonly ok: true; readonly state: UiState; readonly source: UiState }
  | { readonly ok: false };

interface OwnershipReconciliationResult {
  readonly state: UiState;
  readonly reconciliation: {
    readonly attempted: true;
    readonly succeeded: boolean;
    readonly field: 'ownership.publishFailure' | 'ownership.getCurrentState' | null;
  };
}

type PlanResult =
  | { readonly ok: true; readonly state: UiState; readonly plan: ResolvedUiGenerationPlan }
  | { readonly ok: false; readonly state: UiState };

export class UiController {
  private inFlight = false;
  public constructor(
    private readonly ports: UiEnginePorts,
    private readonly catalog: UiCatalog,
  ) {}

  private resolvePlan(state: UiState): PlanResult {
    const started = transitionUiState(state, { type: 'VALIDATION_STARTED' });
    if (!started.ok) return { ok: false, state: withFailures(state, [started.failure]) };
    const local = validateDraft(state.draft, this.catalog);
    if (local.length) {
      const failed = transitionUiState(started.value, {
        type: 'VALIDATION_FAILED',
        failures: local,
      });
      return { ok: false, state: failed.ok ? failed.value : withFailures(state, [failed.failure]) };
    }
    const domain = this.ports.validation.validate(state.draft);
    if (!domain.ok) return this.failedPlan(started.value, engineFailuresToUi(domain.failures));
    const rules = this.ports.rule.evaluate(state.draft);
    if (!rules.ok) return this.failedPlan(started.value, engineFailuresToUi(rules.failures));
    const palette = this.ports.palette.resolve(state.draft);
    if (!palette.ok) return this.failedPlan(started.value, engineFailuresToUi(palette.failures));
    const printArea = this.ports.printArea.resolve(state.draft);
    if (!printArea.ok)
      return this.failedPlan(started.value, engineFailuresToUi(printArea.failures));
    const draft = structuredClone(state.draft);
    const fingerprint = deterministicFingerprint(draft);
    const succeeded = transitionUiState(started.value, {
      type: 'VALIDATION_SUCCEEDED',
      fingerprint,
    });
    if (!succeeded.ok) return { ok: false, state: withFailures(state, [succeeded.failure]) };
    return {
      ok: true,
      state: succeeded.value,
      plan: Object.freeze({
        draft,
        rules: structuredClone(rules.value),
        palette: structuredClone(palette.value),
        printArea: structuredClone(printArea.value),
        fingerprint,
        canonicalTargetCount: draft.targetCount,
      }),
    };
  }
  private failedPlan(state: UiState, failures: readonly UiFailure[]): PlanResult {
    const failed = transitionUiState(state, { type: 'VALIDATION_FAILED', failures });
    return { ok: false, state: failed.ok ? failed.value : withFailures(state, [failed.failure]) };
  }
  private validateControllerInput(state: unknown): UiState | null {
    const inspected = validateRuntimeUiState(state);
    return inspected.ok ? inspected.value : null;
  }
  private invalidControllerInput(): UiState {
    return withFailures(createInitialUiState(), [
      {
        code: 'UI_RUNTIME_INPUT_INVALID',
        field: 'state',
        messageAr: 'مدخلات وحدة التحكم غير صالحة أو غير آمنة.',
        severity: 'blocking',
        source: 'ui',
      },
    ]);
  }
  public validate(state: UiState): UiState {
    const safeState = this.validateControllerInput(state);
    if (!safeState) return this.invalidControllerInput();
    const result = this.resolvePlan(safeState);
    return result.state;
  }

  private owns(
    current: UiState,
    sequence: number,
    fingerprint: string,
    phase: 'generating-scenes' | 'generating-prompts',
  ): boolean {
    return (
      current.activeRequestSequence === sequence &&
      current.requestSequence === sequence &&
      current.phase === phase &&
      deterministicFingerprint(current.draft) === fingerprint
    );
  }

  private sameAuthoritativeState(left: UiState, right: UiState): boolean {
    return canonicalStringify(left) === canonicalStringify(right);
  }

  private invokeOwnershipPublication(
    ownership: GenerationOwnership,
    property: OwnershipPublication,
    state: UiState,
  ): boolean | Promise<boolean> {
    let callback: unknown;
    try {
      callback = Reflect.get(ownership as object, property);
    } catch {
      return false;
    }
    if (typeof callback !== 'function') return false;

    let returned: unknown;
    try {
      returned = Reflect.apply(callback, ownership, [state]);
    } catch {
      return false;
    }
    if (returned === undefined) return true;

    try {
      return observePromise(
        nativePromiseResolve(returned),
        (settled: unknown) => settled === undefined,
        () => false,
      );
    } catch {
      return false;
    }
  }

  private readOwnershipState(ownership: GenerationOwnership): OwnershipReadResult {
    let callback: unknown;
    try {
      callback = Reflect.get(ownership as object, 'getCurrentState');
    } catch {
      return { ok: false };
    }
    if (typeof callback !== 'function') return { ok: false };

    try {
      const source = Reflect.apply(callback, ownership, []) as unknown;
      const state = this.validateControllerInput(source);
      if (state) return { ok: true, state, source: source as UiState };
      observePromise(
        nativePromiseResolve(source),
        () => undefined,
        () => undefined,
      );
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  private createOwnershipFailure(state: UiState, field: OwnershipFailureField): UiState {
    const failure: UiFailure = {
      code: 'UI_GENERATION_OWNERSHIP_INVALID',
      field,
      messageAr: 'تعذر الوصول إلى حالة طلب التوليد بأمان.',
      severity: 'blocking',
      source: 'ui',
    };
    const transitioned =
      state.phase === 'generating-scenes' || state.phase === 'generating-prompts'
        ? transitionUiState(state, { type: 'GENERATION_FAILED', failures: [failure] })
        : null;
    const transitionedCandidate =
      transitioned?.ok === true
        ? transitioned.value
        : {
            ...state,
            phase: 'invalid' as const,
            step: 'validation' as const,
            prompts: [],
            selectedPromptId: null,
            failures: [failure],
            activeRequestSequence: null,
            persisted: false,
          };
    const candidate = {
      ...transitionedCandidate,
      prompts: [],
      selectedPromptId: null,
      persisted: false,
    };
    return this.validateControllerInput(candidate) ?? candidate;
  }

  public async generate(state: UiState, ownership?: GenerationOwnership): Promise<UiState> {
    if (this.inFlight) return state;
    const safeState = this.validateControllerInput(state);
    if (!safeState) return this.invalidControllerInput();
    if (safeState.activeRequestSequence !== null) return safeState;
    const resolved = this.resolvePlan(safeState);
    if (!resolved.ok) return resolved.state;
    const sequence = resolved.state.requestSequence + 1;
    const start = transitionUiState(resolved.state, {
      type: 'SCENE_GENERATION_STARTED',
      requestSequence: sequence,
    });
    if (!start.ok) return withFailures(resolved.state, [start.failure]);
    let internalCurrent = start.value;
    const access: GenerationOwnership =
      ownership === undefined
        ? {
            getCurrentState: () => internalCurrent,
            publishPending: (next) => {
              internalCurrent = next;
            },
            publishFailure: (next) => {
              internalCurrent = next;
            },
          }
        : ownership;
    this.inFlight = true;
    let trustedCurrent = start.value;
    let untrustedStage: 'scene' | 'prompt' = 'scene';

    const reconcileOwnershipFailure = async (
      field: OwnershipFailureField,
    ): Promise<OwnershipReconciliationResult> => {
      const failureState = this.createOwnershipFailure(trustedCurrent, field);
      trustedCurrent = failureState;

      const publication = this.invokeOwnershipPublication(access, 'publishFailure', failureState);
      const published = typeof publication === 'boolean' ? publication : await publication;
      if (!published)
        return {
          state: failureState,
          reconciliation: {
            attempted: true,
            succeeded: false,
            field: 'ownership.publishFailure',
          },
        };

      const reconciled = this.readOwnershipState(access);
      if (!reconciled.ok)
        return {
          state: failureState,
          reconciliation: {
            attempted: true,
            succeeded: false,
            field: 'ownership.getCurrentState',
          },
        };
      if (!this.sameAuthoritativeState(reconciled.state, failureState))
        return {
          state: failureState,
          reconciliation: {
            attempted: true,
            succeeded: false,
            field: 'ownership.publishFailure',
          },
        };
      trustedCurrent = reconciled.state;
      return {
        state: reconciled.state,
        reconciliation: { attempted: true, succeeded: true, field: null },
      };
    };

    type PendingPublicationResult =
      | { readonly ok: true }
      | { readonly ok: false; readonly state: UiState };

    const publishPending = (
      pending: UiState,
    ): PendingPublicationResult | Promise<PendingPublicationResult> => {
      const validated = this.validateControllerInput(pending);
      if (!validated)
        return reconcileOwnershipFailure('ownership.publishPending').then((outcome) => ({
          ok: false as const,
          state: outcome.state,
        }));
      trustedCurrent = validated;
      const publication = this.invokeOwnershipPublication(access, 'publishPending', validated);
      const finish = (
        published: boolean,
      ): PendingPublicationResult | Promise<PendingPublicationResult> => {
        if (!published)
          return reconcileOwnershipFailure('ownership.publishPending').then((outcome) => ({
            ok: false as const,
            state: outcome.state,
          }));

        const authoritative = this.readOwnershipState(access);
        if (!authoritative.ok)
          return reconcileOwnershipFailure('ownership.getCurrentState').then((outcome) => ({
            ok: false as const,
            state: outcome.state,
          }));
        if (!this.sameAuthoritativeState(authoritative.state, validated))
          return reconcileOwnershipFailure('ownership.publishPending').then((outcome) => ({
            ok: false as const,
            state: outcome.state,
          }));
        trustedCurrent = authoritative.state;
        return { ok: true as const };
      };
      return typeof publication === 'boolean'
        ? finish(publication)
        : observePromise(publication, finish, () => finish(false));
    };

    const getCurrentState = () => {
      const current = this.readOwnershipState(access);
      if (!current.ok) return { ok: false as const };
      trustedCurrent = current.state;
      return { ok: true as const, state: current.state, source: current.source };
    };

    try {
      const startPublication = publishPending(start.value);
      const publishedStart =
        startPublication instanceof Promise ? await startPublication : startPublication;
      if (!publishedStart.ok) return publishedStart.state;
      const sceneResult = await this.ports.scene.generate(resolved.plan);
      const sceneCurrent = getCurrentState();
      if (!sceneCurrent.ok)
        return (await reconcileOwnershipFailure('ownership.getCurrentState')).state;
      if (!this.owns(sceneCurrent.state, sequence, resolved.plan.fingerprint, 'generating-scenes'))
        return sceneCurrent.source;
      if (!sceneResult.ok) {
        const failed = transitionUiState(sceneCurrent.state, {
          type: 'GENERATION_FAILED',
          failures: engineFailuresToUi(sceneResult.failures),
        });
        return failed.ok ? failed.value : withFailures(sceneCurrent.state, [failed.failure]);
      }
      const validatedScenes = validateSceneCollection(
        sceneResult.value,
        resolved.plan.draft.includeOutputB,
      );
      if (!validatedScenes.ok) {
        const failed = transitionUiState(sceneCurrent.state, {
          type: 'GENERATION_FAILED',
          failures: [validatedScenes.failure],
        });
        return failed.ok ? failed.value : withFailures(sceneCurrent.state, [failed.failure]);
      }
      const scenesReady = transitionUiState(sceneCurrent.state, {
        type: 'SCENE_GENERATION_SUCCEEDED',
        requestSequence: sequence,
        generationFingerprint: resolved.plan.fingerprint,
        scenes: validatedScenes.value,
      });
      if (!scenesReady.ok) return withFailures(sceneCurrent.state, [scenesReady.failure]);
      const promptStart = transitionUiState(scenesReady.value, {
        type: 'PROMPT_GENERATION_STARTED',
      });
      if (!promptStart.ok) return withFailures(scenesReady.value, [promptStart.failure]);
      const promptPublication = publishPending(promptStart.value);
      const publishedPrompt =
        promptPublication instanceof Promise ? await promptPublication : promptPublication;
      if (!publishedPrompt.ok) return publishedPrompt.state;
      untrustedStage = 'prompt';
      const promptResult = await this.ports.prompt.generate(validatedScenes.value, resolved.plan);
      const promptCurrent = getCurrentState();
      if (!promptCurrent.ok)
        return (await reconcileOwnershipFailure('ownership.getCurrentState')).state;
      if (
        !this.owns(promptCurrent.state, sequence, resolved.plan.fingerprint, 'generating-prompts')
      )
        return promptCurrent.source;
      if (!promptResult.ok) {
        const failed = transitionUiState(promptCurrent.state, {
          type: 'GENERATION_FAILED',
          failures: engineFailuresToUi(promptResult.failures),
        });
        return failed.ok ? failed.value : withFailures(promptCurrent.state, [failed.failure]);
      }
      const validatedPrompts = validatePromptCollection(
        promptResult.value,
        validatedScenes.value,
        resolved.plan.draft.includeOutputB,
      );
      if (!validatedPrompts.ok) {
        const failed = transitionUiState(promptCurrent.state, {
          type: 'GENERATION_FAILED',
          failures: [validatedPrompts.failure],
        });
        return failed.ok ? failed.value : withFailures(promptCurrent.state, [failed.failure]);
      }
      const completed = transitionUiState(promptCurrent.state, {
        type: 'PROMPT_GENERATION_SUCCEEDED',
        requestSequence: sequence,
        generationFingerprint: resolved.plan.fingerprint,
        prompts: validatedPrompts.value,
      });
      return completed.ok
        ? completed.value
        : withFailures(promptCurrent.state, [completed.failure]);
    } catch {
      const currentResult = getCurrentState();
      if (!currentResult.ok)
        return (await reconcileOwnershipFailure('ownership.getCurrentState')).state;
      const current = currentResult.state;
      const runtimeFailure: UiFailure = {
        code: untrustedStage === 'scene' ? 'INVALID_SCENE_RESULT' : 'INVALID_PROMPT_RESULT',
        field: untrustedStage === 'scene' ? 'scenes' : 'prompts',
        messageAr:
          untrustedStage === 'scene'
            ? 'تعذر فحص نتيجة المشاهد بأمان.'
            : 'تعذر فحص نتيجة البرومبتات بأمان.',
        severity: 'blocking',
        source: 'engine',
      };
      if (current.phase === 'generating-scenes' || current.phase === 'generating-prompts') {
        const failed = transitionUiState(current, {
          type: 'GENERATION_FAILED',
          failures: [runtimeFailure],
        });
        return failed.ok ? failed.value : withFailures(current, [runtimeFailure]);
      }
      return withFailures(current, [runtimeFailure]);
    } finally {
      this.inFlight = false;
    }
  }
}
