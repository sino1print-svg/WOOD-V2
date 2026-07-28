/**
 * UI Components — Phase 10.5 Runnable Application Integration.
 *
 * Pure presentational components for the Prompt Center results flow. No hooks,
 * no side effects, no engine imports: every action is received as a prop, so
 * the primary workflow is fully testable without a browser. Output A and
 * Output B are always rendered, copied, and labelled separately.
 */
import type { UiFailure } from '../../ui-engine';
import type { CopyStatusMap, PromptResultRow, ResultsPhase } from '../view-state';

export const UI_TEXT = {
  results: 'النتائج',
  emptyResults: 'لم يتم التوليد بعد — عبّئ النموذج ثم اضغط "توليد البرومبتات".',
  loadingResults: 'جارٍ التوليد عبر المحركات المعتمدة…',
  copyA: 'نسخ A',
  copyB: 'نسخ B',
  copied: 'تم النسخ ✓',
  copyFailed: 'فشل النسخ إلى الحافظة',
  outputA: 'Output A — صورة بيع فارغة',
  outputB: 'Output B — معاينة مطابقة بالأعمال الفنية',
  scene: 'مشهد',
  exportTitle: 'تصدير النتائج',
  exportTxt: 'تنزيل TXT',
  exportMarkdown: 'تنزيل Markdown',
  exportJson: 'تنزيل JSON',
  exportCanonicalJson: 'تنزيل JSON قياسي',
  exportDisabledHint: 'التصدير متاح بعد توليد ناجح فقط.',
  failuresTitle: 'أخطاء يجب معالجتها',
  warningsTitle: 'تحذيرات',
  generateBusy: 'جارٍ التوليد…',
} as const;

export type ExportKind = 'txt' | 'markdown' | 'readable_json' | 'canonical_json';

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export interface FailuresPanelProps {
  readonly failures: readonly UiFailure[];
  readonly warnings: readonly UiFailure[];
}

export function FailuresPanel({ failures, warnings }: FailuresPanelProps): JSX.Element | null {
  if (failures.length === 0 && warnings.length === 0) return null;
  return (
    <section className="panel failures-panel" aria-live="polite">
      {failures.length > 0 && (
        <div>
          <h3>{UI_TEXT.failuresTitle}</h3>
          <ul>
            {failures.map((failure) => (
              <li key={`${failure.code}-${failure.field}`}>
                <strong>{failure.code}</strong>
                <span>{failure.messageAr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <h3>{UI_TEXT.warningsTitle}</h3>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.code}-${warning.field}`} className="warning">
                <strong>{warning.code}</strong>
                <span>{warning.messageAr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prompt result rows (Output A / Output B strictly separate)
// ---------------------------------------------------------------------------

interface PromptBlockProps {
  readonly title: string;
  readonly kindLabel: 'A' | 'B';
  readonly promptId: string;
  readonly promptText: string;
  readonly copyLabel: string;
  readonly copyStatus: CopyStatusMap;
  readonly onCopy: (promptId: string) => void;
}

function PromptBlock(props: PromptBlockProps): JSX.Element {
  const status = props.copyStatus[props.promptId];
  return (
    <div className={`prompt-block prompt-block-${props.kindLabel.toLowerCase()}`}>
      <div className="prompt-block__header">
        <h4>{props.title}</h4>
        <div className="prompt-block__actions">
          {status === 'copied' && <span className="copy-status ok">{UI_TEXT.copied}</span>}
          {status === 'failed' && <span className="copy-status danger">{UI_TEXT.copyFailed}</span>}
          <button
            type="button"
            className="ghost copy-button"
            data-copy-kind={props.kindLabel}
            data-prompt-id={props.promptId}
            onClick={() => props.onCopy(props.promptId)}
          >
            {props.copyLabel}
          </button>
        </div>
      </div>
      <textarea
        readOnly
        dir="ltr"
        lang="en"
        className="prompt-text"
        aria-label={props.title}
        value={props.promptText}
        rows={8}
      />
    </div>
  );
}

export interface ResultsPanelProps {
  readonly phase: ResultsPhase;
  readonly rows: readonly PromptResultRow[];
  readonly copyStatus: CopyStatusMap;
  readonly onCopy: (promptId: string) => void;
}

export function ResultsPanel(props: ResultsPanelProps): JSX.Element {
  return (
    <section className="panel results-panel" aria-label={UI_TEXT.results}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">03</p>
          <h2>{UI_TEXT.results}</h2>
        </div>
        <span className="count ok">{props.rows.length}</span>
      </div>
      {props.phase === 'loading' && (
        <div className="empty-state" role="status">
          {UI_TEXT.loadingResults}
        </div>
      )}
      {props.phase !== 'loading' && props.rows.length === 0 && (
        <div className="empty-state">{UI_TEXT.emptyResults}</div>
      )}
      {props.phase === 'ready' &&
        props.rows.map((row) => (
          <article className="scene-result" key={row.sceneId} data-scene-id={row.sceneId}>
            <header className="scene-result__header">
              <strong>
                {UI_TEXT.scene} {row.sceneNumber}
              </strong>
              <small dir="ltr">{row.sceneId}</small>
            </header>
            <PromptBlock
              title={`${UI_TEXT.outputA} (${row.sceneNumber}A)`}
              kindLabel="A"
              promptId={row.outputA.id}
              promptText={row.outputA.promptText}
              copyLabel={UI_TEXT.copyA}
              copyStatus={props.copyStatus}
              onCopy={props.onCopy}
            />
            {row.outputB !== null && (
              <PromptBlock
                title={`${UI_TEXT.outputB} (${row.sceneNumber}B)`}
                kindLabel="B"
                promptId={row.outputB.id}
                promptText={row.outputB.promptText}
                copyLabel={UI_TEXT.copyB}
                copyStatus={props.copyStatus}
                onCopy={props.onCopy}
              />
            )}
          </article>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Export bar
// ---------------------------------------------------------------------------

export interface ExportBarProps {
  readonly enabled: boolean;
  readonly onExport: (kind: ExportKind) => void;
  readonly exportError: string | null;
  readonly lastExported: ExportKind | null;
}

const EXPORT_BUTTONS: readonly (readonly [ExportKind, string])[] = [
  ['txt', UI_TEXT.exportTxt],
  ['markdown', UI_TEXT.exportMarkdown],
  ['readable_json', UI_TEXT.exportJson],
  ['canonical_json', UI_TEXT.exportCanonicalJson],
];

export function ExportBar(props: ExportBarProps): JSX.Element {
  return (
    <section className="panel export-panel" aria-label={UI_TEXT.exportTitle}>
      <div className="panel__header">
        <h2>{UI_TEXT.exportTitle}</h2>
      </div>
      <div className="export-buttons">
        {EXPORT_BUTTONS.map(([kind, label]) => (
          <button
            type="button"
            key={kind}
            className="ghost export-button"
            data-export-kind={kind}
            disabled={!props.enabled}
            onClick={() => props.onExport(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {!props.enabled && <p className="helper">{UI_TEXT.exportDisabledHint}</p>}
      {props.exportError !== null && (
        <p className="helper danger" role="alert">
          {props.exportError}
        </p>
      )}
      {props.exportError === null && props.lastExported !== null && (
        <p className="helper success" role="status">
          تم إنشاء الملف وتنزيله.
        </p>
      )}
    </section>
  );
}
