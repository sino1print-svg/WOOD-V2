import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../src/shared/domain-model';
import {
  InMemoryDeterministicStorageAdapter,
  ProjectStore,
  assetDataStorageKey,
  projectStorageKey,
  storageToken,
  validateDomainIdentifier,
} from '../../src/persistence';
import { createProject, T0 } from './fixtures';

describe('Unicode domain IDs and safe internal storage keys', () => {
  it.each(['project-001', 'مشروع-١', 'Project مشروع ١'])('accepts NFC non-empty ID %s', (id) => {
    expect(validateDomainIdentifier(id).ok).toBe(true);
  });

  it('rejects empty, control-character and non-NFC persisted IDs', () => {
    expect(validateDomainIdentifier('').ok).toBe(false);
    expect(validateDomainIdentifier('abc\u0000def').ok).toBe(false);
    expect(validateDomainIdentifier('Cafe\u0301').ok).toBe(false);
    expect(validateDomainIdentifier('Café').ok).toBe(true);
  });

  it('normalizes equivalent Unicode only for internal key derivation', async () => {
    expect(await storageToken('project', 'Cafe\u0301')).toBe(await storageToken('project', 'Café'));
  });

  it('does not expose traversal/domain text in filesystem-like keys', async () => {
    const id = '../مشروع/فرعي' as ProjectId;
    const key = await projectStorageKey(id);
    expect(key).toMatch(/^projects\/by-id\/[a-f0-9]{64}\.json$/u);
    expect(key).not.toContain('..');
    expect(key).not.toContain('مشروع');
    const assetKey = await assetDataStorageKey('opaque/../asset-ref');
    expect(assetKey).toMatch(/^assets\/v2\/data\/[a-f0-9]{64}\.png$/u);
  });

  it('produces distinct deterministic keys for distinct normalized IDs', async () => {
    const ids = ['مشروع-١', 'مشروع-٢', 'project-1'];
    const keys = await Promise.all(ids.map((id) => projectStorageKey(id)));
    expect(new Set(keys).size).toBe(ids.length);
    expect(await Promise.all(ids.map((id) => projectStorageKey(id)))).toEqual(keys);
  });

  it('saves and loads Arabic/mixed IDs through public ProjectStore APIs', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    const id = 'مشروع Mixed ١' as ProjectId;
    const saved = await store.save(createProject({ id }), { overwrite: false, timestamp: T0 });
    expect(saved.ok).toBe(true);
    const loaded = await store.load(id);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project.id).toBe(id);
    expect(Object.keys(storage.dump()).some((key) => key.includes(id))).toBe(false);
  });

  it('rejects unsafe internal adapter keys independently of domain ID rules', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    expect((await storage.read('../secret')).ok).toBe(false);
    expect((await storage.read('/absolute')).ok).toBe(false);
    expect((await storage.read('a\\b')).ok).toBe(false);
  });
});
