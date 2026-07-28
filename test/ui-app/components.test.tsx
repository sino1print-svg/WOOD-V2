/**
 * Phase 10.5 — pure component tests for the Prompt Center results flow.
 * Output A and Output B must render separately with independent copy actions,
 * empty/loading states must exist, and the export bar must be disabled
 * without a valid result. No DOM required: pure components are tree-walked.
 */
import { describe, expect, it } from 'vitest';
import { ExportBar, FailuresPanel, ResultsPanel, UI_TEXT } from '../../src/ui/components';
import type { PromptResultRow } from '../../src/ui/view-state';
import type { PromptViewModel } from '../../src/ui-engine';
import { buttonsOf, collectHostElements, textOf } from './element-tree';

function prompt(kind: 'A' | 'B', id: string, text: string): PromptViewModel {
  return {
    id,
    sceneId: 'scene-1',
    kind,
    sourceOutputAId: kind === 'B' ? 'out-a' : null,
    sourceHash: kind === 'B' ? 'hash' : null,
    sourceContentHash: kind === 'B' ? 'hash' : null,
    artworkId: kind === 'B' ? 'artwork-1' : null,
    promptText: text,
    promptHash: 'hash',
    productId: 'product-bella-3001',
    colorId: 'color-white',
    view: 'front',
    placement: 'center_chest',
    printAreaProfileId: 'profile-1',
  };
}

const row: PromptResultRow = {
  sceneId: 'scene-1',
  sceneNumber: 1,
  outputA: prompt('A', 'out-a', 'PROMPT A TEXT'),
  outputB: prompt('B', 'out-b', 'PROMPT B TEXT'),
};

describe('Phase 10.5 ResultsPanel', () => {
  it('renders Output A and Output B as separate blocks with separate copy buttons', () => {
    const tree = ResultsPanel({ phase: 'ready', rows: [row], copyStatus: {}, onCopy: () => {} });
    const textareas = collectHostElements(tree).filter((element) => element.type === 'textarea');
    expect(textareas).toHaveLength(2);
    expect(textareas[0]!.props.value).toBe('PROMPT A TEXT');
    expect(textareas[1]!.props.value).toBe('PROMPT B TEXT');
    const copyButtons = buttonsOf(tree).filter(
      (button) => button.props['data-copy-kind'] !== undefined,
    );
    expect(copyButtons.map((button) => button.props['data-copy-kind'])).toEqual(['A', 'B']);
    expect(copyButtons.map((button) => button.props['data-prompt-id'])).toEqual(['out-a', 'out-b']);
  });

  it('Copy A copies only the A prompt id and Copy B only the B prompt id', () => {
    const copied: string[] = [];
    const tree = ResultsPanel({
      phase: 'ready',
      rows: [row],
      copyStatus: {},
      onCopy: (id) => copied.push(id),
    });
    const copyButtons = buttonsOf(tree).filter(
      (button) => button.props['data-copy-kind'] !== undefined,
    );
    (copyButtons[0]!.props.onClick as () => void)();
    expect(copied).toEqual(['out-a']);
    (copyButtons[1]!.props.onClick as () => void)();
    expect(copied).toEqual(['out-a', 'out-b']);
  });

  it('renders the A-only (partial pair) row without any B block', () => {
    const tree = ResultsPanel({
      phase: 'ready',
      rows: [{ ...row, outputB: null }],
      copyStatus: {},
      onCopy: () => {},
    });
    const textareas = collectHostElements(tree).filter((element) => element.type === 'textarea');
    expect(textareas).toHaveLength(1);
    expect(textareas[0]!.props.value).toBe('PROMPT A TEXT');
    expect(textOf(tree)).not.toContain(UI_TEXT.copyB);
  });

  it('shows the empty state before generation and the loading state while running', () => {
    const empty = ResultsPanel({ phase: 'empty', rows: [], copyStatus: {}, onCopy: () => {} });
    expect(textOf(empty)).toContain(UI_TEXT.emptyResults);
    const loading = ResultsPanel({ phase: 'loading', rows: [], copyStatus: {}, onCopy: () => {} });
    expect(textOf(loading)).toContain(UI_TEXT.loadingResults);
  });

  it('shows visible copy success and clipboard failure states', () => {
    const copiedTree = ResultsPanel({
      phase: 'ready',
      rows: [row],
      copyStatus: { 'out-a': 'copied' },
      onCopy: () => {},
    });
    expect(textOf(copiedTree)).toContain(UI_TEXT.copied);
    const failedTree = ResultsPanel({
      phase: 'ready',
      rows: [row],
      copyStatus: { 'out-b': 'failed' },
      onCopy: () => {},
    });
    expect(textOf(failedTree)).toContain(UI_TEXT.copyFailed);
  });
});

describe('Phase 10.5 ExportBar', () => {
  it('disables every export button when no valid result exists', () => {
    const tree = ExportBar({
      enabled: false,
      onExport: () => {},
      exportError: null,
      lastExported: null,
    });
    const buttons = buttonsOf(tree);
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect(button.props.disabled).toBe(true);
    expect(textOf(tree)).toContain(UI_TEXT.exportDisabledHint);
  });

  it('invokes onExport with the exact requested kind', () => {
    const kinds: string[] = [];
    const tree = ExportBar({
      enabled: true,
      onExport: (kind) => kinds.push(kind),
      exportError: null,
      lastExported: null,
    });
    for (const button of buttonsOf(tree)) (button.props.onClick as () => void)();
    expect(kinds).toEqual(['txt', 'markdown', 'readable_json', 'canonical_json']);
  });

  it('shows a visible export error message', () => {
    const tree = ExportBar({
      enabled: true,
      onExport: () => {},
      exportError: 'UI_DOWNLOAD_FAILED — تعذر تنزيل الملف من المتصفح.',
      lastExported: null,
    });
    expect(textOf(tree)).toContain('UI_DOWNLOAD_FAILED');
  });

  it('every button in these components has a handler or is disabled', () => {
    const trees = [
      ResultsPanel({ phase: 'ready', rows: [row], copyStatus: {}, onCopy: () => {} }),
      ExportBar({ enabled: true, onExport: () => {}, exportError: null, lastExported: null }),
    ];
    for (const tree of trees) {
      for (const button of buttonsOf(tree)) {
        expect(typeof button.props.onClick === 'function' || button.props.disabled === true).toBe(
          true,
        );
      }
    }
  });
});

describe('Phase 10.5 FailuresPanel', () => {
  it('renders blocking failures with code and Arabic message', () => {
    const tree = FailuresPanel({
      failures: [
        {
          code: 'UI_ARTWORK_REQUIRED',
          field: 'artwork',
          messageAr: 'معاينة B تتطلب رفع ملف الأعمال الفنية PNG أولًا.',
          severity: 'blocking',
          source: 'engine',
        },
      ],
      warnings: [],
    });
    const text = textOf(tree);
    expect(text).toContain('UI_ARTWORK_REQUIRED');
    expect(text).toContain('معاينة B تتطلب');
  });

  it('renders nothing when there are no failures', () => {
    expect(FailuresPanel({ failures: [], warnings: [] })).toBeNull();
  });
});
