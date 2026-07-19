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

// Regression: 同一位老師同時有「張／股」兩種單位 → 本週總計必須分段標示
const MENTOR_D_ROWS: JournalRowExport[] = [
  {
    id: 'sig-d-1', status: 'published', instrument: '2330 台積電', action: 'buy',
    price_hint: 1050, quantity: 2, quantity_unit: '張',
    reason_summary: 'D-summary-a', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
    expert_id: 'expert-d',
    experts: { name: '雙棲老師', slug: 'dual-unit-master', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-d-2', status: 'published', instrument: '00878 國泰永續高股息', action: 'buy',
    price_hint: 25, quantity: 500, quantity_unit: '股',
    reason_summary: 'D-summary-b', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-14T02:00:00Z', created_at: '2026-07-14T01:30:00Z',
    expert_id: 'expert-d',
    experts: { name: '雙棲老師', slug: 'dual-unit-master', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-d-3', status: 'published', instrument: '2454 聯發科', action: 'sell',
    price_hint: 1400, quantity: 1, quantity_unit: '張',
    reason_summary: 'D-summary-c', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-15T02:00:00Z', created_at: '2026-07-15T01:30:00Z',
    expert_id: 'expert-d',
    experts: { name: '雙棲老師', slug: 'dual-unit-master', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
  {
    id: 'sig-d-4', status: 'published', instrument: '0056 元大高股息', action: 'sell',
    price_hint: 35, quantity: 300, quantity_unit: '股',
    reason_summary: 'D-summary-d', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-15T03:00:00Z', created_at: '2026-07-15T02:30:00Z',
    expert_id: 'expert-d',
    experts: { name: '雙棲老師', slug: 'dual-unit-master', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];

// Regression: 完全缺失 slug / asset_class / currency（experts 存在但欄位為 null）
const MENTOR_E_ROWS: JournalRowExport[] = [
  {
    id: 'sig-e-1', status: 'published', instrument: '2330 台積電', action: 'buy',
    price_hint: 1050, quantity: 3, quantity_unit: '張',
    reason_summary: 'E-summary-null-slug', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
    expert_id: 'expert-e',
    experts: { name: '缺欄位老師', slug: null, role: 'mentor', asset_class: null, currency: null },
  },
  {
    id: 'sig-e-2', status: 'published', instrument: '00878 國泰永續高股息', action: 'sell',
    price_hint: 25, quantity: 100, quantity_unit: '股',
    reason_summary: 'E-summary-2', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-15T02:00:00Z', created_at: '2026-07-15T01:30:00Z',
    expert_id: 'expert-e',
    experts: { name: '缺欄位老師', slug: null, role: 'mentor', asset_class: null, currency: null },
  },
];

// Regression: experts 物件本身為 null（極端 fallback，僅剩 expert_id 可用）
const MENTOR_F_ROWS: JournalRowExport[] = [
  {
    id: 'sig-f-1', status: 'published', instrument: 'NVDA', action: 'buy',
    price_hint: 180, quantity: 10, quantity_unit: null,
    reason_summary: 'F-summary-no-experts', reason_detail: null, risk_notes: null, learning_points: null,
    published_at: '2026-07-14T13:30:00Z', created_at: '2026-07-14T13:00:00Z',
    expert_id: 'expert-f',
    experts: null,
  },
];

// Regression: 兩位不同 expert_id 但 slug 相同（撞名）
// 匯出時檔名必須被自動 dedup，且各自檔案內容不得跨老師污染。
const MENTOR_G1_ROWS: JournalRowExport[] = [
  {
    id: 'sig-g1-1', status: 'published', instrument: '2330 台積電', action: 'buy',
    price_hint: 1050, quantity: 2, quantity_unit: '張',
    reason_summary: 'G1-summary-同週記標題',
    reason_detail: null, risk_notes: null, learning_points: 'G1-learning-token',
    published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
    expert_id: 'expert-g1',
    experts: { name: '同名老師甲', slug: 'shared-slug', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];
const MENTOR_G2_ROWS: JournalRowExport[] = [
  {
    id: 'sig-g2-1', status: 'published', instrument: 'AAPL', action: 'buy',
    price_hint: 220, quantity: 30, quantity_unit: '股',
    reason_summary: 'G2-summary-同週記標題', // 故意同標題
    reason_detail: null, risk_notes: null, learning_points: 'G2-learning-token',
    published_at: '2026-07-15T13:30:00Z', created_at: '2026-07-15T13:00:00Z',
    expert_id: 'expert-g2',
    experts: { name: '同名老師乙', slug: 'shared-slug', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
  },
];

// Regression: slug 缺失（fallback 到 expert_id）且 expert_id 也剛好與別位 slug 撞名
const MENTOR_H1_ROWS: JournalRowExport[] = [
  {
    id: 'sig-h1-1', status: 'published', instrument: '2454 聯發科', action: 'sell',
    price_hint: 1400, quantity: 1, quantity_unit: '張',
    reason_summary: 'H1-summary', reason_detail: null, risk_notes: null, learning_points: 'H1-token',
    published_at: '2026-07-14T02:00:00Z', created_at: '2026-07-14T01:30:00Z',
    expert_id: 'clash-id',
    experts: { name: 'H1老師', slug: null, role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];
const MENTOR_H2_ROWS: JournalRowExport[] = [
  {
    id: 'sig-h2-1', status: 'published', instrument: 'NVDA', action: 'buy',
    price_hint: 180, quantity: 10, quantity_unit: '股',
    reason_summary: 'H2-summary', reason_detail: null, risk_notes: null, learning_points: 'H2-token',
    published_at: '2026-07-15T13:30:00Z', created_at: '2026-07-15T13:00:00Z',
    expert_id: 'expert-h2',
    experts: { name: 'H2老師', slug: 'clash-id', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
  },
];

// Regression: 同一位 expert_id 出現在多筆 row，理應被聚合為單一檔案（不重複產出）
const MENTOR_DUP_ID_ROWS: JournalRowExport[] = [
  ...MENTOR_A_ROWS,
  {
    id: 'sig-a-dup', status: 'published', instrument: '2317 鴻海', action: 'buy',
    price_hint: 200, quantity: 5, quantity_unit: '張',
    reason_summary: 'A-summary-dup-title', reason_detail: null, risk_notes: null,
    learning_points: 'A-learning-dup-token',
    published_at: '2026-07-16T01:00:00Z', created_at: '2026-07-16T00:30:00Z',
    expert_id: 'expert-a',
    experts: { name: '老周', slug: 'master-zhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
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

  const runMultiReversed = async () => {
    setStatus('running-multi-reversed');
    // 反轉輸入順序：先 Wendy，再老周
    const res = await buildJournalExport([MENTOR_B_ROW, ...MENTOR_A_ROWS], RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi-reversed:${res.kind}:${res.filename}`);
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

  const runMultiMixedReversed = async () => {
    setStatus('running-multi-mixed-reversed');
    // 反轉：先助教小陳，再老周
    const res = await buildJournalExport([...MENTOR_C_ROWS, ...MENTOR_A_ROWS], RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi-mixed-reversed:${res.kind}:${res.filename}`);
  };

  const runMultiInterleaved = async () => {
    setStatus('running-multi-interleaved');
    // 交錯：A1, C1, A2, C2, ... 檢查 header 不會混入其他老師欄位
    const inter: JournalRowExport[] = [];
    const maxLen = Math.max(MENTOR_A_ROWS.length, MENTOR_C_ROWS.length);
    for (let i = 0; i < maxLen; i++) {
      if (MENTOR_A_ROWS[i]) inter.push(MENTOR_A_ROWS[i]);
      if (MENTOR_C_ROWS[i]) inter.push(MENTOR_C_ROWS[i]);
    }
    const res = await buildJournalExport(inter, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi-interleaved:${res.kind}:${res.filename}`);
  };


  const runDualUnit = async () => {
    setStatus('running-dual-unit');
    const res = await buildJournalExport(MENTOR_D_ROWS, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`dual-unit:${res.kind}:${res.filename}`);
  };

  const runMissingFields = async () => {
    setStatus('running-missing-fields');
    const res = await buildJournalExport(MENTOR_E_ROWS, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`missing-fields:${res.kind}:${res.filename}`);
  };

  const runNoExperts = async () => {
    setStatus('running-no-experts');
    const res = await buildJournalExport(MENTOR_F_ROWS, RANGE, true);
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`no-experts:${res.kind}:${res.filename}`);
  };

  const runMultiMissingMixed = async () => {
    setStatus('running-multi-missing-mixed');
    // 完整資料 + 缺欄位 + experts=null 三種老師混在同一次匯出
    const res = await buildJournalExport(
      [...MENTOR_A_ROWS, ...MENTOR_E_ROWS, ...MENTOR_F_ROWS],
      RANGE,
      true,
    );
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`multi-missing-mixed:${res.kind}:${res.filename}`);
  };

  const runDuplicateSlug = async () => {
    setStatus('running-duplicate-slug');
    // 兩位不同 expert_id 但 slug 同為 shared-slug
    const res = await buildJournalExport(
      [...MENTOR_G1_ROWS, ...MENTOR_G2_ROWS],
      RANGE,
      true,
    );
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`duplicate-slug:${res.kind}:${res.filename}`);
  };

  const runDuplicateSlugReversed = async () => {
    setStatus('running-duplicate-slug-reversed');
    const res = await buildJournalExport(
      [...MENTOR_G2_ROWS, ...MENTOR_G1_ROWS],
      RANGE,
      true,
    );
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`duplicate-slug-reversed:${res.kind}:${res.filename}`);
  };

  const runSlugFallbackClash = async () => {
    setStatus('running-slug-fallback-clash');
    // H1 slug=null → fallback expert_id "clash-id"，恰好與 H2.slug="clash-id" 撞名
    const res = await buildJournalExport(
      [...MENTOR_H1_ROWS, ...MENTOR_H2_ROWS],
      RANGE,
      true,
    );
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`slug-fallback-clash:${res.kind}:${res.filename}`);
  };

  const runDuplicateExpertId = async () => {
    setStatus('running-duplicate-expert-id');
    // 同 expert_id 出現多次 + 另一位老師 → zip 應僅產出 2 份檔案
    const res = await buildJournalExport(
      [...MENTOR_DUP_ID_ROWS, MENTOR_B_ROW],
      RANGE,
      true,
    );
    if (!res) { setStatus('empty'); return; }
    downloadBlob(res.filename, res.blob);
    setStatus(`duplicate-expert-id:${res.kind}:${res.filename}`);
  };



  const slugMap = {
    'expert-a': 'master-zhou',
    'expert-b': 'wendy-us',
    'expert-c': 'assistant-chen',
    'expert-d': 'dual-unit-master',
    // E/F 老師沒有 slug → 應 fallback 為 expert_id
    'expert-e': 'expert-e',
    'expert-f': 'expert-f',
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
      <button data-testid="je-export-multi-mixed" onClick={runMultiMixed} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export mixed units (老周 張 + 助教小陳 股)
      </button>
      <button data-testid="je-export-multi-reversed" onClick={runMultiReversed} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export multi reversed (Wendy → 老周)
      </button>
      <button data-testid="je-export-multi-mixed-reversed" onClick={runMultiMixedReversed} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export multi-mixed reversed (助教 → 老周)
      </button>
      <button data-testid="je-export-multi-interleaved" onClick={runMultiInterleaved} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export multi interleaved (A1,C1,A2,C2,…)
      </button>
      <button data-testid="je-export-dual-unit" onClick={runDualUnit} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export dual-unit mentor (雙棲老師 張+股)
      </button>
      <button data-testid="je-export-missing-fields" onClick={runMissingFields} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export missing slug/asset/currency (缺欄位老師)
      </button>
      <button data-testid="je-export-no-experts" onClick={runNoExperts} style={{ marginRight: 8, marginBottom: 8, padding: '6px 12px' }}>
        Export experts=null (F)
      </button>
      <button data-testid="je-export-multi-missing-mixed" onClick={runMultiMissingMixed} style={{ padding: '6px 12px' }}>
        Export multi missing mixed (A + E + F)
      </button>

    </div>
  );
}
