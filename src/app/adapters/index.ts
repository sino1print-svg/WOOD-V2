/**
 * Browser adapters — Phase 10.5 Runnable Application Integration.
 *
 * Thin, injectable ports around browser APIs so the application commands stay
 * pure and testable: clipboard writing, Blob file download (with Object URL
 * cleanup), and the UI-state persistence port over `localStorage`. Formatter
 * bytes are passed through untouched — no re-encoding, trimming, or newline
 * conversion happens here.
 */
import {
  EngineId,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';
import type { ClipboardPort, PersistencePort } from '../../ui-engine';
import type { ExportFormattedDocument } from '../../export';

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Clipboard port over the native asynchronous Clipboard API. */
export function createBrowserClipboardPort(): ClipboardPort {
  return {
    writeText: async (text: string): Promise<void> => {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        throw new Error('clipboard-unavailable');
      }
      await clipboard.writeText(text);
    },
  };
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

export interface DownloadRequest {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface DownloadPort {
  download(request: DownloadRequest): void;
}

export interface DownloadFailure {
  readonly code: 'UI_DOWNLOAD_FAILED';
  readonly messageAr: string;
}

/**
 * Browser download adapter: exact formatter bytes → Blob → temporary anchor
 * click → Object URL revoked. File names are deterministic (caller-supplied).
 */
export function createBrowserDownloadPort(): DownloadPort {
  return {
    download: (request: DownloadRequest): void => {
      const blobPart = new Uint8Array(request.bytes);
      const blob = new Blob([blobPart], { type: request.mediaType });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = request.fileName;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
}

/** Sends one formatted export document through a download port, fail-closed. */
export function downloadDocument(
  port: DownloadPort,
  fileName: string,
  document: ExportFormattedDocument,
): DownloadFailure | null {
  try {
    port.download({ fileName, mediaType: document.mediaType, bytes: document.bytes });
    return null;
  } catch {
    return { code: 'UI_DOWNLOAD_FAILED', messageAr: 'تعذر تنزيل الملف من المتصفح.' };
  }
}

// ---------------------------------------------------------------------------
// UI-state persistence (localStorage)
// ---------------------------------------------------------------------------

export const UI_STATE_STORAGE_KEY = 'mockup-photoshoot-director:ui-state:v1';

interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StringStorage | null {
  try {
    const storage = (globalThis as { localStorage?: StringStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function persistenceFailure(code: string, messageAr: string) {
  const failure: ValidationFailure = {
    check: ValidationCheck.Products,
    field: 'persistence',
    code,
    message: messageAr,
    severity: ValidationSeverity.Blocking,
    ruleId: null,
    priorityClass: null,
    domain: null,
    originEngine: EngineId.Persistence,
  };
  return { ok: false as const, failures: [failure] };
}

/**
 * UI-state persistence port over `localStorage`, honoring the approved
 * `PersistencePort` contract. `storage` is injectable for tests.
 */
export function createUiStatePersistencePort(storage?: StringStorage | null): PersistencePort {
  const resolved = storage === undefined ? browserStorage() : storage;
  return {
    save: async (serialized: string) => {
      if (!resolved) {
        return persistenceFailure('UI_PERSISTENCE_UNAVAILABLE', 'التخزين المحلي غير متاح.');
      }
      try {
        resolved.setItem(UI_STATE_STORAGE_KEY, serialized);
        return { ok: true as const, value: true as const };
      } catch {
        return persistenceFailure('UI_PERSISTENCE_WRITE_FAILED', 'تعذر حفظ الجلسة محليًا.');
      }
    },
    load: async () => {
      if (!resolved) {
        return persistenceFailure('UI_PERSISTENCE_UNAVAILABLE', 'التخزين المحلي غير متاح.');
      }
      try {
        const value = resolved.getItem(UI_STATE_STORAGE_KEY);
        if (value === null) {
          return persistenceFailure('UI_PERSISTENCE_EMPTY', 'لا توجد جلسة محفوظة للاسترجاع.');
        }
        return { ok: true as const, value };
      } catch {
        return persistenceFailure('UI_PERSISTENCE_READ_FAILED', 'تعذر قراءة الجلسة المحفوظة.');
      }
    },
    clear: async () => {
      if (!resolved) {
        return persistenceFailure('UI_PERSISTENCE_UNAVAILABLE', 'التخزين المحلي غير متاح.');
      }
      try {
        resolved.removeItem(UI_STATE_STORAGE_KEY);
        return { ok: true as const, value: true as const };
      } catch {
        return persistenceFailure('UI_PERSISTENCE_WRITE_FAILED', 'تعذر مسح الجلسة المحفوظة.');
      }
    },
  };
}
