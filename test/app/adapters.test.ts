/**
 * Phase 10.5 — browser adapter tests (ports are injectable; no DOM needed).
 * The download adapter must pass formatter bytes through untouched with
 * deterministic names, and every failure path must stay typed and visible.
 */
import { describe, expect, it } from 'vitest';
import {
  createUiStatePersistencePort,
  downloadDocument,
  UI_STATE_STORAGE_KEY,
  type DownloadPort,
  type DownloadRequest,
} from '../../src/app/adapters';
import { copyExact, saveUiState, serializeUiState } from '../../src/ui-engine';
import { buildExportDocuments } from '../../src/app/commands';
import { createAppController } from '../../src/app/orchestrator';
import { stateWithDraft, testArtwork, validAppDraft } from './fixtures';

function capturePort(): { readonly port: DownloadPort; readonly requests: DownloadRequest[] } {
  const requests: DownloadRequest[] = [];
  return {
    port: {
      download: (request) => {
        requests.push(request);
      },
    },
    requests,
  };
}

describe('Phase 10.5 download adapter', () => {
  it('receives the exact formatter bytes and deterministic file names', async () => {
    const generated = await createAppController(testArtwork()).generate(
      stateWithDraft(validAppDraft()),
    );
    const documents = buildExportDocuments(generated, testArtwork());
    expect(documents.ok).toBe(true);
    if (!documents.ok) return;
    const { port, requests } = capturePort();
    for (const entry of documents.documents) {
      expect(downloadDocument(port, entry.fileName, entry.document)).toBeNull();
    }
    expect(requests.map((request) => request.fileName)).toEqual([
      'prompt-pack.txt',
      'prompt-pack.md',
      'prompt-pack.json',
      'prompt-pack.canonical.json',
    ]);
    for (const [index, request] of requests.entries()) {
      expect(request.bytes).toEqual(documents.documents[index]!.document.bytes);
      expect(request.mediaType).toBe(documents.documents[index]!.document.mediaType);
    }
  });

  it('maps a throwing download port to a typed visible failure', async () => {
    const generated = await createAppController(testArtwork()).generate(
      stateWithDraft(validAppDraft()),
    );
    const documents = buildExportDocuments(generated, testArtwork());
    if (!documents.ok) throw new Error('export fixture failed');
    const failing: DownloadPort = {
      download: () => {
        throw new Error('boom');
      },
    };
    const failure = downloadDocument(
      failing,
      documents.documents[0]!.fileName,
      documents.documents[0]!.document,
    );
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('UI_DOWNLOAD_FAILED');
    expect(failure!.messageAr.length).toBeGreaterThan(0);
  });
});

describe('Phase 10.5 clipboard adapter behavior', () => {
  it('reports a typed clipboard failure when the clipboard rejects', async () => {
    const failure = await copyExact(
      {
        writeText: () => Promise.reject(new Error('denied')),
      },
      'text',
    );
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('UI_CLIPBOARD_FAILED');
  });

  it('copies the literal text without modification on success', async () => {
    const written: string[] = [];
    const exact = 'A\r\nB\rC\n نص عربي 🎨  trailing   ';
    const failure = await copyExact(
      {
        writeText: async (text) => {
          written.push(text);
        },
      },
      exact,
    );
    expect(failure).toBeNull();
    expect(written).toEqual([exact]);
  });
});

describe('Phase 10.5 UI-state persistence port', () => {
  function memoryStorage(): {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  } {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    };
  }

  it('saves and loads a generated session through the approved contract', async () => {
    const storage = memoryStorage();
    const port = createUiStatePersistencePort(storage);
    const state = await createAppController(testArtwork()).generate(
      stateWithDraft(validAppDraft()),
    );
    expect(state.phase).toBe('prompts-ready');
    const saved = await saveUiState(port, state);
    expect(saved.phase).toBe('saved');
    expect(storage.getItem(UI_STATE_STORAGE_KEY)).toBe(
      serializeUiState({ ...state, phase: 'save-pending' }),
    );
    const loaded = await port.load();
    expect(loaded.ok).toBe(true);
  });

  it('returns typed failures when storage is unavailable or empty', async () => {
    const unavailable = createUiStatePersistencePort(null);
    const saveResult = await unavailable.save('{}');
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.failures[0]!.code).toBe('UI_PERSISTENCE_UNAVAILABLE');
    }
    const empty = createUiStatePersistencePort(memoryStorage());
    const loadResult = await empty.load();
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.failures[0]!.code).toBe('UI_PERSISTENCE_EMPTY');
    }
  });
});
