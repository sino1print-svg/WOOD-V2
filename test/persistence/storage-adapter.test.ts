import { describe, expect, it } from 'vitest';
import { InMemoryDeterministicStorageAdapter } from '../../src/persistence';

describe('in-memory deterministic storage adapter', () => {
  it('commits a batch atomically and lists keys lexicographically', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const committed = await storage.commit([
      { kind: 'put', key: 'z', value: new Uint8Array([2]) },
      { kind: 'put', key: 'a', value: new Uint8Array([1]) },
    ]);
    expect(committed.ok).toBe(true);
    expect(await storage.list('')).toEqual({ ok: true, value: ['a', 'z'] });
  });

  it('returns defensive byte copies', async () => {
    const storage = new InMemoryDeterministicStorageAdapter({ a: new Uint8Array([1]) });
    const first = await storage.read('a');
    expect(first.ok).toBe(true);
    if (first.ok && first.value) first.value[0] = 9;
    expect(await storage.read('a')).toEqual({ ok: true, value: new Uint8Array([1]) });
  });

  it('rolls back every operation on injected mid-commit failure', async () => {
    const storage = new InMemoryDeterministicStorageAdapter({ stable: new Uint8Array([7]) });
    storage.setFaultPlan({ failCommitNumber: 1, failAfterOperation: 1 });
    const result = await storage.commit([
      { kind: 'put', key: 'first', value: new Uint8Array([1]) },
      { kind: 'delete', key: 'stable' },
    ]);
    expect(result.ok).toBe(false);
    expect(Object.keys(storage.dump())).toEqual(['stable']);
  });

  it('enforces requireAbsent without replacing existing data', async () => {
    const storage = new InMemoryDeterministicStorageAdapter({ a: new Uint8Array([1]) });
    const result = await storage.commit([
      { kind: 'put', key: 'a', value: new Uint8Array([2]), requireAbsent: true },
    ]);
    expect(result.ok).toBe(false);
    expect(await storage.read('a')).toEqual({ ok: true, value: new Uint8Array([1]) });
  });
});
