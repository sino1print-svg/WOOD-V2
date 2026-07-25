import { useMemo, useState } from 'react';
import { Audience, DisplayMethod, GarmentView } from '../../shared/domain-model';
import type { ColorId, ProductId, SeasonId } from '../../shared/domain-model';
import { AR } from '../../shared/i18n';
import {
  createInitialUiState,
  isOutputStale,
  updateDraft,
  validateDraft,
  type UiCatalog,
  type UiState,
} from '../../ui-engine';

const catalog: UiCatalog = {
  products: [
    {
      id: 'product-bella-3001' as ProductId,
      nameAr: 'Bella Canvas 3001',
      allowedViews: [GarmentView.Front, GarmentView.Back],
      allowedDisplayMethods: [
        DisplayMethod.OnModel,
        DisplayMethod.Hanger,
        DisplayMethod.FlatLay,
        DisplayMethod.Folded,
      ],
      allowedAudiences: [Audience.Adult, Audience.Unisex, Audience.All],
      allowedColorIds: ['color-white', 'color-black', 'color-sand', 'color-gray'] as ColorId[],
    },
    {
      id: 'product-kids-tee' as ProductId,
      nameAr: 'تيشيرت أطفال',
      allowedViews: [GarmentView.Front, GarmentView.Back],
      allowedDisplayMethods: [DisplayMethod.OnModel, DisplayMethod.Hanger, DisplayMethod.FlatLay],
      allowedAudiences: [Audience.Kids, Audience.All],
      allowedColorIds: ['color-white', 'color-black', 'color-sand'] as ColorId[],
    },
  ],
  colors: [
    { id: 'color-white' as ColorId, nameAr: 'أبيض', hex: '#ffffff' },
    { id: 'color-black' as ColorId, nameAr: 'أسود', hex: '#111111' },
    { id: 'color-gray' as ColorId, nameAr: 'رمادي ميلانج', hex: '#b8b8b8' },
    { id: 'color-sand' as ColorId, nameAr: 'رملي', hex: '#d9c3a3' },
  ],
  seasons: [
    { id: 'season-halloween' as SeasonId, nameAr: 'الهالوين' },
    { id: 'season-christmas' as SeasonId, nameAr: 'الكريسماس' },
    { id: 'season-minimal' as SeasonId, nameAr: 'استوديو بسيط' },
  ],
};

export function AppShell(): JSX.Element {
  const [state, setState] = useState<UiState>(() => createInitialUiState());
  const failures = useMemo(() => validateDraft(state.draft, catalog), [state.draft]);
  const stale = isOutputStale(state);
  const productTotal = state.draft.products.reduce((sum, product) => sum + product.quantity, 0);

  function patch(patchValue: Partial<UiState['draft']>): void {
    setState((current) => updateDraft(current, patchValue));
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
    setState((current) =>
      failures.length
        ? { ...current, phase: 'invalid', failures }
        : { ...current, phase: 'ready', failures: [], validatedFingerprint: 'validated' },
    );
  }

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
          {Object.values(AR.nav).map((label, index) => (
            <button
              key={label}
              className={index === 1 ? 'nav-item active' : 'nav-item'}
              disabled={index > 1}
            >
              {label}
              {index > 1 && <span>قريبًا</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          Phase 6 · UI Engine
          <br />
          <span>واجهة عربية حتمية</span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">مشروع جديد</p>
            <h1>{state.draft.title || 'جلسة موك أب جديدة'}</h1>
          </div>
          <div className="topbar__actions">
            <button className="ghost">{AR.actions.restore}</button>
            <button className="ghost">{AR.actions.save}</button>
          </div>
        </header>
        <div className="stepper" aria-label="مراحل سير العمل">
          {['الإعداد', 'المنتجات', 'التحقق', 'التخطيط', 'البرومبتات'].map((item, index) => (
            <div className={index < 2 ? 'step active' : 'step'} key={item}>
              <span>{index + 1}</span>
              {item}
            </div>
          ))}
        </div>
        <section
          className={`state-banner ${stale ? 'warning' : failures.length ? 'neutral' : 'success'}`}
          aria-live="polite"
        >
          <strong>
            {stale
              ? AR.status.stale
              : state.phase === 'ready'
                ? AR.status.ready
                : AR.status.editing}
          </strong>
          <span>التوليد يدوي فقط، ولن يحدث عند تغيير أي اختيار.</span>
        </section>
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
                      key={color.id}
                      className={selected ? 'swatch selected' : 'swatch'}
                      aria-pressed={selected}
                      onClick={() =>
                        patch({
                          colorIds: selected
                            ? state.draft.colorIds.filter((id) => id !== color.id)
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
            <div className="form-actions">
              <button className="ghost" onClick={() => setState(createInitialUiState())}>
                {AR.actions.reset}
              </button>
              <button className="primary" onClick={validate}>
                {AR.actions.validate}
              </button>
            </div>
          </section>
          <aside className="summary-column">
            <section className="panel summary-panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">LIVE</p>
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
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={state.draft.includeOutputB}
                  onChange={(event) => patch({ includeOutputB: event.target.checked })}
                />
                <span>{AR.fields.includeB}</span>
              </label>
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
              <button className="primary full" disabled={failures.length > 0}>
                {AR.actions.generate}
              </button>
              <p className="helper">يتم استدعاء المحركات المعتمدة فقط بعد الضغط الصريح.</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
