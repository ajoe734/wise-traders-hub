// @ts-nocheck
/**
 * Preview-only E2E harness for weekly journal Markdown export.
 *
 * Exercises `buildJournalExport` + `downloadBlob` with fixture data so the
 * test can assert:
 *   - single-mentor → downloads one `.md` with correct filename & content
 *   - multi-mentor  → downloads a `.zip` containing one `<slug>.md` per mentor
 *   - quantity_unit empty / missing / null / whitespace → defaults to "股"
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { useState } from 'react';
import {
  buildJournalExport,
  downloadBlob,
  type JournalRowExport,
} from '@/lib/journalsExport';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const DEFAULT_RANGE = { startLabel: '2026-07-13', endLabel: '2026-07-19' };

function readRangeFromQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('start');
    const e = p.get('end');
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && e && /^\d{4}-\d{2}-\d{2}$/.test(e)) {
      return { startLabel: s, endLabel: e };
    }
  } catch {}
  return DEFAULT_RANGE;
}

const MENTOR_A_ROWS: JournalRowExport[] = [
  {
    id: 'sig-a-1',
    status: 'published',
    instrument: '2330 台積電',
    action: 'buy',
    price_hint: 1050,
    quantity: 2,
    quantity_unit: '張',
    reason_summary: 'A-summary-alpha',
    reason_detail: '<p>A-detail-alpha</p>',
    risk_notes: 'A-risk-alpha',
    learning_points: 'A-learning-alpha',
    published_at: '2026-07-14T01:00:00Z',
    created_at: '2026-07-14T00:30:00Z',
    expert_id: 'expert-a',
    experts: { name: '老周', slug: 'master-zhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-a-2',
    status: 'published',
    instrument: '2454 聯發科',
    action: 'sell',
    price_hint: 1400,
    quantity: 1,
    quantity_unit: '張',
    reason_summary: 'A-summary-beta',
    reason_detail: null,
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-15T02:00:00Z',
    created_at: '2026-07-15T01:30:00Z',
    expert_id: 'expert-a',
    experts: { name: '老周', slug: 'master-zhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];

const MENTOR_B_ROW: JournalRowExport = {
  id: 'sig-b-1',
  status: 'published',
  instrument: 'AAPL',
  action: 'buy',
  price_hint: 220,
  quantity: 50,
  quantity_unit: '股',
  reason_summary: 'B-summary-alpha',
  reason_detail: '<p>B-detail-alpha</p>',
  risk_notes: null,
  learning_points: 'B-learning-alpha',
  published_at: '2026-07-16T13:30:00Z',
  created_at: '2026-07-16T13:00:00Z',
  expert_id: 'expert-b',
  experts: { name: 'Wendy', slug: 'wendy-us', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
};

// Regression: quantity_unit empty / missing / null / whitespace → must default to "股"
const MENTOR_C_ROWS: JournalRowExport[] = [
  {
    id: 'sig-c-1',
    status: 'published',
    instrument: '0050 元大台灣50',
    action: 'buy',
    price_hint: 150,
    quantity: 3,
    quantity_unit: '', // empty string
    reason_summary: 'C-summary-empty',
    reason_detail: '<p>C-detail-empty</p>',
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-17T01:00:00Z',
    created_at: '2026-07-17T00:30:00Z',
    expert_id: 'expert-c',
    experts: { name: '助教小陳', slug: 'assistant-chen', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-c-2',
    status: 'published',
    instrument: '0056 元大高股息',
    action: 'sell',
    price_hint: 35,
    quantity: 5,
    // quantity_unit omitted → undefined
    reason_summary: 'C-summary-undefined',
    reason_detail: null,
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-17T02:00:00Z',
    created_at: '2026-07-17T01:30:00Z',
    expert_id: 'expert-c',
    experts: { name: '助教小陳', slug: 'assistant-chen', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-c-3',
    status: 'published',
    instrument: '00878 國泰永續高股息',
    action: 'buy',
    price_hint: 25,
    quantity: 7,
    quantity_unit: null,
    reason_summary: 'C-summary-null',
    reason_detail: null,
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-17T03:00:00Z',
    created_at: '2026-07-17T02:30:00Z',
    expert_id: 'expert-c',
    experts: { name: '助教小陳', slug: 'assistant-chen', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-c-4',
    status: 'published',
    instrument: '00692 富邦台50',
    action: 'sell',
    price_hint: 45,
    quantity: 9,
    quantity_unit: '   ', // whitespace-only
    reason_summary: 'C-summary-whitespace',
    reason_detail: null,
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-17T04:00:00Z',
    created_at: '2026-07-17T03:30:00Z',
    expert_id: 'expert-c',
    experts: { name: '助教小陳', slug: 'assistant-chen', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];

export default function JournalsExportHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const [status, setStatus] = useState<string>('idle');
  const RANGE = readRangeFromQuery();

  const runSingle = async () => {
    setStatus('running-single');
    const res = await buildJournalExport(MENTOR_A_ROWS, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`single:${res.kind}:${res.filename}`);
  };

  const runMulti = async () => {
    setStatus('running-multi');
    const res = await buildJournalExport([...MENTOR_A_ROWS, MENTOR_B_ROW], RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi:${res.kind}:${res.filename}`);
  };

  const runEmptyUnit = async () => {
    setStatus('running-empty-unit');
    const res = await buildJournalExport(MENTOR_C_ROWS, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`empty-unit:${res.kind}:${res.filename}`);
  };

  const runMultiMixed = async () => {
    setStatus('running-multi-mixed');
    const res = await buildJournalExport([...MENTOR_A_ROWS, ...MENTOR_C_ROWS], RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi-mixed:${res.kind}:${res.filename}`);
  };

  const weekDisplay = `${RANGE.startLabel} ~ ${RANGE.endLabel}`;

  const slugMap = {
    'expert-a': 'master-zhou',
    'expert-b': 'wendy-us',
    'expert-c': 'assistant-chen',
  };

  return (
    <div id="je-harness-root" style={{ padding: 24, background: '#fff', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Journals Export Harness</h1>
      <div data-testid="je-week-display" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>
        {weekDisplay}
      </div>
      <div data-testid="je-slug-map" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>
        {JSON.stringify(slugMap)}
      </div>
      <div data-testid="je-status" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>
        {status}
      </div>
      <button data-testid="je-export-single" onClick={runSingle} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export single mentor (老周)
      </button>
      <button data-testid="je-export-multi" onClick={runMulti} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export multiple mentors (老周 + Wendy)
      </button>
      <button data-testid="je-export-empty-unit" onClick={runEmptyUnit} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export mentor with empty/missing unit (助教小陳)
      </button>
      <button data-testid="je-export-multi-mixed" onClick={runMultiMixed} style={{ padding: '6px 12px' }}>
        Export mixed units (老周 張 + 助教小陳 股)
      </button>
    </div>
  );
}
