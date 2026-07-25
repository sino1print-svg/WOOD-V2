import { fail, ok, type PersistenceResult } from './result';

export interface StoragePutOperation {
  readonly kind: 'put';
  readonly key: string;
  readonly value: Uint8Array;
  readonly requireAbsent?: boolean;
}

export interface StorageDeleteOperation {
  readonly kind: 'delete';
  readonly key: string;
  readonly requirePresent?: boolean;
}

export type StorageOperation = StoragePutOperation | StorageDeleteOperation;

export interface AtomicStorageAdapter {
  read(key: string): Promise<PersistenceResult<Uint8Array | null>>;
  exists(key: string): Promise<PersistenceResult<boolean>>;
  list(prefix: string): Promise<PersistenceResult<readonly string[]>>;
  commit(operations: readonly StorageOperation[]): Promise<PersistenceResult<void>>;
}

export interface StorageFaultPlan {
  readonly failCommitNumber: number;
  readonly failAfterOperation?: number;
  readonly message?: string;
}

function cloneBytes(value: Uint8Array): Uint8Array {
  return value.slice();
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function validStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    !key.split('/').includes('..') &&
    !hasControlCharacters(key)
  );
}

function invalidStorageKey<T>(phase: 'read' | 'write'): PersistenceResult<T> {
  return fail('STORAGE_FAILURE', phase, {
    messageEn: 'The internal storage key is invalid.',
    messageAr: 'مفتاح التخزين الداخلي غير صالح.',
    retryable: false,
    causeCategory: 'security',
  });
}

/**
 * Deterministic copy-on-write storage for tests and local foundations.
 * A commit swaps the backing map only after every operation and fault hook succeeds.
 */
export class InMemoryDeterministicStorageAdapter implements AtomicStorageAdapter {
  private state = new Map<string, Uint8Array>();
  private commitCount = 0;
  private faultPlan: StorageFaultPlan | null = null;

  public constructor(seed?: Readonly<Record<string, Uint8Array>>) {
    if (seed) {
      for (const key of Object.keys(seed).sort()) this.state.set(key, cloneBytes(seed[key]));
    }
  }

  public setFaultPlan(plan: StorageFaultPlan | null): void {
    this.faultPlan = plan;
  }

  public dump(): Readonly<Record<string, Uint8Array>> {
    const result: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    for (const key of [...this.state.keys()].sort()) result[key] = cloneBytes(this.state.get(key)!);
    return result;
  }

  public async read(key: string): Promise<PersistenceResult<Uint8Array | null>> {
    if (!validStorageKey(key)) return invalidStorageKey('read');
    const value = this.state.get(key);
    return ok(value ? cloneBytes(value) : null);
  }

  public async exists(key: string): Promise<PersistenceResult<boolean>> {
    if (!validStorageKey(key)) return invalidStorageKey('read');
    return ok(this.state.has(key));
  }

  public async list(prefix: string): Promise<PersistenceResult<readonly string[]>> {
    if (prefix.length > 0 && !validStorageKey(prefix)) return invalidStorageKey('read');
    return ok([...this.state.keys()].filter((key) => key.startsWith(prefix)).sort());
  }

  public async commit(operations: readonly StorageOperation[]): Promise<PersistenceResult<void>> {
    if (operations.some((operation) => !validStorageKey(operation.key))) {
      return invalidStorageKey('write');
    }
    this.commitCount += 1;
    const plan = this.faultPlan;
    if (plan?.failCommitNumber === this.commitCount && plan.failAfterOperation === undefined) {
      return fail('STORAGE_FAILURE', 'write', plan.message ?? 'Injected commit failure.', true);
    }

    const next = new Map<string, Uint8Array>();
    for (const [key, value] of this.state) next.set(key, cloneBytes(value));

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (operation.kind === 'put') {
        if (operation.requireAbsent && next.has(operation.key)) {
          return fail('PROJECT_ALREADY_EXISTS', 'write', 'Internal storage key already exists.');
        }
        next.set(operation.key, cloneBytes(operation.value));
      } else {
        if (operation.requirePresent && !next.has(operation.key)) {
          return fail('PROJECT_NOT_FOUND', 'write', 'Required internal storage key is missing.');
        }
        next.delete(operation.key);
      }
      if (plan?.failCommitNumber === this.commitCount && plan.failAfterOperation === index + 1) {
        return fail(
          'STORAGE_FAILURE',
          'write',
          plan.message ?? 'Injected mid-commit failure.',
          true,
        );
      }
    }

    this.state = next;
    return ok(undefined);
  }
}
