/**
 * AppShell — Phase 10.5 Runnable Application Integration.
 *
 * The single Prompt Center screen. The form drives the approved UI Engine
 * state machine; Generate invokes the official application controller
 * (Orchestrator → real engines); results render Output A and Output B as
 * separate, individually copyable prompts; export downloads real formatter
 * bytes. Generation happens only on explicit button press — no effects.
 */
import { useMemo, useRef, useState } from 'react';
import { Audience } from '../../shared/domain-model';
import type { Artwork, ColorId, ProductId, SeasonId } from '../../shared/domain-model';
import { AR } from '../../shared/i18n';
import {
  clearGeneratedOutputs,
  copyExact,
  createInitialUiState,
  isOutputStale,
  restoreUiState,
  saveUiState,
  updateDraft,
  validateDraft,
  type UiState,
} from '../../ui-engine';
import { createAppController, APP_UI_CATALOG } from '../../app/orchestrator';
import { buildExportDocuments, registerArtworkPng } from '../../app/commands';
import {
  createBrowserClipboardPort,
  createBrowserDownloadPort,
  createUiStatePersistencePort,
  downloadDocument,
} from '../../app/adapters';
import { ExportBar, FailuresPanel, ResultsPanel, UI_TEXT, type ExportKind } from '../components';
import {
  blockingFailures,
  buildResultRows,
  exportEnabled,
  resultsPhase,
  warningFailures,
  type CopyStatusMap,
} from '../view-state';

const catalog = APP_UI_CATALOG;

export function AppShell(): JSX.Element {
  const [state, setState] = useState<UiState>(() => createInitialUiState());
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatusMap>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExported, setLastExported] = useState<ExportKind | null>(null);
  const [persistenceNote, setPersistenceNote] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const generatingRef = useRef(false);

  const controller = useMemo(() => createAppController(artwork), [artwork]);
  const clipboard = useMemo(() => createBrowserClipboardPort(), []);
  const downloads = useMemo(() => createBrowserDownloadPort(), []);
  const persistence = useMemo(() => createUiStatePersistencePort(), []);

  const failures = useMemo(() => validateDraft(state.draft, catalog), [state.draft]);
  const stale = isOutputStale(state);
  const busy = state.phase === 'generating-scenes' || state.phase === 'generating-prompts';
  const productTotal = state.draft.products.reduce((sum, product) => sum + product.quantity, 0);
  const rows = useMemo(() => buildResultRows(state), [state]);

  function publish(next: UiState): void {
    stateRef.current = next;
    setState(next);
  }

  function resetFeedback(): void {
    setCopyStatus({});
    setExportError(null);
    setLastExported(null);
    setPersistenceNote(null);
  }

  function patch(patchValue: Partial<UiState['draft']>): void {
    resetFeedback();
    // The approved state machine forbids treating previous outputs as current
    // once the draft changes: clear generated outputs first, then edit.
    const current = stateRef.current;
    const base =
      current.prompts.length > 0 || current.scenes.length > 0
        ? clearGeneratedOutputs(current)
        : current;
    publish(updateDraft(base, patchValue));
  }

  function addProduct(productId: ProductId): void {
    if (state.draft.products.some((item) => item.productId === productId)) return;
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) return;
    patch({
      products: [
        ...state.draft.products,
        {
          productId,
          quantity: 1,
          selectedViews: [product.allowedViews[0]],
          displayMethods: [product.allowedDisplayMethods[0]],
        },
      ],
    });
  }

  function validate(): void {
    resetFeedback();
    publish(controller.validate(stateRef.current));
  }

  async function generate(): Promise<void> {
    if (generatingRef.current || busy) return;
    generatingRef.current = true;
    resetFeedback();
    try {
      const next = await controller.generate(stateRef.current, {
        getCurrentState: () => stateRef.current,
        publishPending: (pending) => {
          publish(pending);
        },
        publishFailure: (failed) => {
          publish(failed);
        },
      });
      publish(next);
    } finally {
      generatingRef.current = false;
    }
  }

  async function copyPrompt(promptId: string): Promise<void> {
    const prompt = stateRef.current.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    const failure = await copyExact(clipboard, prompt.promptText);
    setCopyStatus({ [promptId]: failure === null ? 'copied' : 'failed' });
  }

  function exportDocuments(kind: ExportKind): void {
    setExportError(null);
    setLastExported(null);
    const result = buildExportDocuments(stateRef.current, artwork);
    if (!result.ok) {
      const first = result.failures[0];
      setExportError(`${first?.code ?? 'EXPORT_FAILED'} — ${first?.message ?? 'تعذر التصدير.'}`);
      return;
    }
    const entry = result.documents.find((document) => document.kind === kind);
    if (!entry) {
      setExportError('EXPORT_FORMAT_UNAVAILABLE — الصيغة المطلوبة غير متاحة.');
      return;
    }
    const downloadFailure = downloadDocument(downloads, entry.fileName, entry.document);
    if (downloadFailure !== null) {
      setExportError(`${downloadFailure.code} — ${downloadFailure.messageAr}`);
      return;
    }
    setLastExported(kind);
  }

  async function uploadArtwork(file: File | null): Promise<void> {
    setArtworkError(null);
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const result = await registerArtworkPng(new Uint8Array(buffer), file.name);
      if (!result.ok) {
        setArtwork(null);
        setArtworkError(`${result.failure.code} — ${result.failure.messageAr}`);
        return;
      }
      resetFeedback();
      setArtwork(result.artwork);
    } catch {
      setArtwork(null);
      setArtworkError('ASSET_READ_FAILED — تعذر قراءة الملف من المتصفح.');
    }
  }

  async function saveSession(): Promise<void> {
    resetFeedback();
    const next = await saveUiState(persistence, stateRef.current);
    publish(next);
    setPersistenceNote(next.phase === 'failure' ? null : 'تم حفظ الجلسة محليًا.');
  }

  async function restoreSession(): Promise<void> {
    resetFeedback();
    const next = await restoreUiState(persistence);
    publish(next);
    setPersistenceNote(next.failures.length > 0 ? null : 'تم استرجاع الجلسة المحفوظة.');
  }

  const generateDisabled = failures.length > 0 || busy;

  return (
    <div className="workspace" dir="rtl" lang="ar">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <div className="brand">
          <span className="brand__mark">M</span>
          <div>
            <strong>{AR.appName}</strong>
            <small>{AR.appTagline}</small>
          </div>
        </div>
        <nav>
          <span className="nav-item active" aria-current="page">
            مركز البرومبتات
          </span>
        </nav>
        <div className="sidebar__footer">
          Phase 10.5 · تكامل تشغيلي
          <br />
          <span>واجهة عربية حتمية</span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">مركز البرومبتات</p>
            <h1>{state.draft.title || 'جلسة موك أب جديدة'}</h1>
          </div>
          <div className="topbar__actions">
            <button className="ghost" type="button" onClick={() => void restoreSession()}>
              {AR.actions.restore}
            </button>
            <button
              className="ghost"
              type="button"
              disabled={!(state.phase === 'prompts-ready' && state.dirty)}
              title="الحفظ متاح بعد توليد ناجح غير محفوظ (عقد آلة الحالة المعتمدة)."
              onClick={() => void saveSession()}
            >
              {AR.actions.save}
            </button>
          </div>
        </header>
        <section
          className={`state-banner ${stale ? 'warning' : failures.length ? 'neutral' : 'success'}`}
          aria-live="polite"
        >
          <strong>
            {busy
              ? UI_TEXT.generateBusy
              : stale
                ? AR.status.stale
                : state.phase === 'prompts-ready' || state.phase === 'ready'
                  ? AR.status.ready
                  : AR.status.editing}
          </strong>
          <span>التوليد يدوي فقط، ولن يحدث عند تغيير أي اختيار.</span>
        </section>
        {persistenceNote !== null && (
          <section className="state-banner success" role="status">
            <strong>{persistenceNote}</strong>
          </section>
        )}
        <div className="content-grid">
          <section className="panel form-panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">01</p>
                <h2>{AR.sections.configuration}</h2>
              </div>
              <span className="mode-pill">الوضع المتقدم</span>
            </div>
            <div className="form-grid">
              <label>
                <span>{AR.fields.title}</span>
                <input
                  value={state.draft.title}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="مثال: جلسة هالوين — Bella Canvas"
                />
              </label>
              <label>
                <span>{AR.fields.season}</span>
                <select
                  value={state.draft.seasonId ?? ''}
                  onChange={(event) =>
                    patch({ seasonId: (event.target.value || null) as SeasonId | null })
                  }
                >
                  <option value="">اختر الموسم</option>
                  {catalog.seasons.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{AR.fields.audience}</span>
                <select
                  value={state.draft.audience ?? ''}
                  onChange={(event) => patch({ audience: event.target.value as Audience })}
                >
                  <option value={Audience.All}>تلقائي حسب الموسم</option>
                  <option value={Audience.Adult}>بالغون</option>
                  <option value={Audience.Kids}>أطفال</option>
                  <option value={Audience.Unisex}>للجنسين</option>
                </select>
              </label>
              <label>
                <span>{AR.fields.targetCount}</span>
                <div className="number-control">
                  <button
                    type="button"
                    onClick={() => patch({ targetCount: Math.max(1, state.draft.targetCount - 1) })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={state.draft.targetCount}
                    onChange={(event) => patch({ targetCount: Number(event.target.value) })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch({ targetCount: Math.min(50, state.draft.targetCount + 1) })
                    }
                  >
                    +
                  </button>
                </div>
              </label>
              <label className="wide">
                <span>{AR.fields.customScene}</span>
                <textarea
                  value={state.draft.customSceneDescription}
                  onChange={(event) => patch({ customSceneDescription: event.target.value })}
                  placeholder="وصف اختياري للبيئة والإضاءة والمزاج فقط"
                />
              </label>
            </div>
            <div className="subsection">
              <div className="subsection__title">
                <h3>{AR.sections.products}</h3>
                <select
                  aria-label="إضافة منتج"
                  defaultValue=""
                  onChange={(event) => {
                    addProduct(event.target.value as ProductId);
                    event.target.value = '';
                  }}
                >
                  <option value="">+ {AR.actions.addProduct}</option>
                  {catalog.products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              {state.draft.products.length === 0 ? (
                <div className="empty-state">لم تتم إضافة منتجات بعد.</div>
              ) : (
                state.draft.products.map((product) => {
                  const info = catalog.products.find((item) => item.id === product.productId);
                  return (
                    <div className="product-row" key={product.productId}>
                      <div>
                        <strong>{info?.nameAr}</strong>
                        <small>{product.selectedViews.join(' • ')}</small>
                      </div>
                      <div className="number-control compact">
                        <button
                          type="button"
                          onClick={() =>
                            patch({
                              products: state.draft.products.map((item) =>
                                item.productId === product.productId
                                  ? { ...item, quantity: Math.max(1, item.quantity - 1) }
                                  : item,
                              ),
                            })
                          }
                        >
                          −
                        </button>
                        <input value={product.quantity} readOnly />
                        <button
                          type="button"
                          onClick={() =>
                            patch({
                              products: state.draft.products.map((item) =>
                                item.productId === product.productId
                                  ? { ...item, quantity: Math.min(50, item.quantity + 1) }
                                  : item,
                              ),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="إزالة المنتج"
                        onClick={() =>
                          patch({
                            products: state.draft.products.filter(
                              (item) => item.productId !== product.productId,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="subsection">
              <h3>{AR.fields.colors}</h3>
              <div className="swatches">
                {catalog.colors.map((color) => {
                  const selected = state.draft.colorIds.includes(color.id);
                  return (
                    <button
                      type="button"
                      key={color.id}
                      className={selected ? 'swatch selected' : 'swatch'}
                      aria-pressed={selected}
                      onClick={() =>
                        patch({
                          colorIds: selected
                            ? state.draft.colorIds.filter((id: ColorId) => id !== color.id)
                            : [...state.draft.colorIds, color.id],
                        })
                      }
                    >
                      <i style={{ background: color.hex }} />
                      {color.nameAr}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="subsection">
              <h3>ملف الأعمال الفنية (PNG)</h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={state.draft.includeOutputB}
                  onChange={(event) => patch({ includeOutputB: event.target.checked })}
                />
                <span>{AR.fields.includeB}</span>
              </label>
              {state.draft.includeOutputB && (
                <div className="artwork-upload">
                  <label>
                    <span>ملف PNG الشفاف المستخدم في معاينة B</span>
                    <input
                      type="file"
                      accept="image/png"
                      aria-label="رفع ملف PNG"
                      onChange={(event) => void uploadArtwork(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {artwork !== null && (
                    <p className="helper success" role="status" dir="ltr">
                      {artwork.fileName} · {artwork.widthPx}×{artwork.heightPx}px
                    </p>
                  )}
                  {artworkError !== null && (
                    <p className="helper danger" role="alert">
                      {artworkError}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="form-actions">
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  resetFeedback();
                  publish(createInitialUiState());
                }}
              >
                {AR.actions.reset}
              </button>
              <button className="primary" type="button" onClick={validate}>
                {AR.actions.validate}
              </button>
            </div>
          </section>
          <aside className="summary-column">
            <section className="panel summary-panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">02</p>
                  <h2>{AR.sections.summary}</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>العدد المستهدف</dt>
                  <dd>{state.draft.targetCount}</dd>
                </div>
                <div>
                  <dt>مجموع المنتجات</dt>
                  <dd className={productTotal !== state.draft.targetCount ? 'danger' : ''}>
                    {productTotal}
                  </dd>
                </div>
                <div>
                  <dt>الصور الناتجة</dt>
                  <dd>{state.draft.targetCount * (state.draft.includeOutputB ? 2 : 1)}</dd>
                </div>
                <div>
                  <dt>ألوان مختارة</dt>
                  <dd>{state.draft.colorIds.length}</dd>
                </div>
              </dl>
            </section>
            <section className="panel validation-panel">
              <div className="panel__header">
                <h2>{AR.sections.validation}</h2>
                <span className={failures.length ? 'count danger' : 'count ok'}>
                  {failures.length}
                </span>
              </div>
              {failures.length ? (
                <ul>
                  {failures.slice(0, 6).map((failure) => (
                    <li key={`${failure.code}-${failure.field}`}>
                      <strong>{failure.code}</strong>
                      <span>{failure.messageAr}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="success-state">جميع الحقول الأساسية صالحة.</div>
              )}
              <button
                className="primary full"
                type="button"
                disabled={generateDisabled}
                onClick={() => void generate()}
              >
                {busy ? UI_TEXT.generateBusy : AR.actions.generate}
              </button>
              <p className="helper">يتم استدعاء المحركات المعتمدة فقط بعد الضغط الصريح.</p>
            </section>
            <ExportBar
              enabled={exportEnabled(state)}
              onExport={exportDocuments}
              exportError={exportError}
              lastExported={lastExported}
            />
          </aside>
        </div>
        <FailuresPanel failures={blockingFailures(state)} warnings={warningFailures(state)} />
        <ResultsPanel
          phase={resultsPhase(state)}
          rows={rows}
          copyStatus={copyStatus}
          onCopy={(promptId) => void copyPrompt(promptId)}
        />
      </main>
    </div>
  );
}
