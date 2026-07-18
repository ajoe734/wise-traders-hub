// @ts-nocheck
/**
 * Preview-only E2E harness for weekly journal Markdown export.
 *
 * Exercises `buildJournalExport` + `downloadBlob` with fixture data so the
 * test can assert:
 *   - single-mentor → downloads one `.md` with correct filename & content
 *   - multi-mentor  → downloads a `.zip` containing one `<slug>.md` per mentor
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
  reason_summary: 'B-summary-alpha',
  reason_detail: '<p>B-detail-alpha</p>',
  risk_notes: null,
  learning_points: 'B-learning-alpha',
  published_at: '2026-07-16T13:30:00Z',
  created_at: '2026-07-16T13:00:00Z',
  expert_id: 'expert-b',
  experts: { name: 'Wendy', slug: 'wendy-us', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
};

export default function JournalsExportHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const [status, setStatus] = useState<string>('idle');

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

  // Mirror the exact week-range display string used in
  // `src/pages/company/JournalsExport.tsx` (`{startLabel} ~ {endLabel}`),
  // so E2E can assert parity between the on-screen label and the
  // `- 週別：...` header written inside each exported Markdown file.
  const weekDisplay = `${RANGE.startLabel} ~ ${RANGE.endLabel}`;

  // Slug map (expert_id → slug) exposed for E2E filename assertions;
  // lets the test verify every mentor file is named after its own slug
  // without hard-coding the mapping inside the spec.
  const slugMap = {
    'expert-a': 'master-zhou',
    'expert-b': 'wendy-us',
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
      <button data-testid="je-export-single" onClick={runSingle} style={{ marginRight: 8, padding: '6px 12px' }}>
        Export single mentor (老周)
      </button>
      <button data-testid="je-export-multi" onClick={runMulti} style={{ padding: '6px 12px' }}>
        Export multiple mentors (老周 + Wendy)
      </button>
    </div>
  );
}

