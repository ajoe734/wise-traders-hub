// @ts-nocheck
/**
 * Preview-only E2E harness: 逐行渲染每份 fixture 的 Markdown「header 區塊」
 * （L0..L8：H1 → 週別 → Slug → 資產類別 → 幣別 → 則數 → 空行 → --- 分隔線），
 * 供 E2E 做 **DOM ↔ 檔案文字一致性** 與（可選）**截圖視覺回歸** 斷言，
 * 確保 slug/asset_class/currency 缺失時 fallback 不會造成 header 錯位。
 */
import { useMemo } from 'react';
import {
  buildMentorMarkdown,
  groupRowsByMentor,
  type JournalRowExport,
  type WeekRangeLabels,
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

const RANGE: WeekRangeLabels = { startLabel: '2026-07-13', endLabel: '2026-07-19' };

const ROW_A: JournalRowExport = {
  id: 'a1', status: 'published', instrument: '2330', action: 'buy',
  price_hint: 1050, quantity: 2, quantity_unit: '張',
  reason_summary: 'A-summary', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
  expert_id: 'expert-a',
  experts: { name: '老周', slug: 'master-zhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
};

const ROW_E1: JournalRowExport = {
  id: 'e1', status: 'published', instrument: '2330', action: 'buy',
  price_hint: 1050, quantity: 3, quantity_unit: '張',
  reason_summary: 'E-summary-1', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
  expert_id: 'expert-e',
  experts: { name: '缺欄位老師', slug: null, role: 'mentor', asset_class: null, currency: null },
};
const ROW_E2: JournalRowExport = {
  ...ROW_E1,
  id: 'e2', instrument: '00878', action: 'sell', price_hint: 25, quantity: 100, quantity_unit: '股',
  reason_summary: 'E-summary-2',
  published_at: '2026-07-15T02:00:00Z', created_at: '2026-07-15T01:30:00Z',
};

const ROW_F: JournalRowExport = {
  id: 'f1', status: 'published', instrument: 'NVDA', action: 'buy',
  price_hint: 180, quantity: 10, quantity_unit: null,
  reason_summary: 'F-summary', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-14T13:30:00Z', created_at: '2026-07-14T13:00:00Z',
  expert_id: 'expert-f',
  experts: null,
};

// 覆蓋更多 fallback 排列：只缺 asset_class、只缺 currency、只缺 slug（三種單一缺失）
const ROW_ONLY_MISSING_ASSET: JournalRowExport = {
  id: 'ma1', status: 'published', instrument: '2454', action: 'buy',
  price_hint: 1400, quantity: 1, quantity_unit: '張',
  reason_summary: 'MA-summary', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
  expert_id: 'expert-ma',
  experts: { name: '缺資產老師', slug: 'missing-asset', role: 'mentor', asset_class: null, currency: 'TWD' },
};
const ROW_ONLY_MISSING_CURRENCY: JournalRowExport = {
  id: 'mc1', status: 'published', instrument: 'AAPL', action: 'sell',
  price_hint: 220, quantity: 50, quantity_unit: '股',
  reason_summary: 'MC-summary', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-15T13:30:00Z', created_at: '2026-07-15T13:00:00Z',
  expert_id: 'expert-mc',
  experts: { name: '缺幣別老師', slug: 'missing-currency', role: 'mentor', asset_class: 'us_stock', currency: null },
};
const ROW_ONLY_MISSING_SLUG: JournalRowExport = {
  id: 'ms1', status: 'published', instrument: '2317', action: 'buy',
  price_hint: 200, quantity: 5, quantity_unit: '張',
  reason_summary: 'MS-summary', reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-14T02:00:00Z', created_at: '2026-07-14T01:30:00Z',
  expert_id: 'expert-ms',
  experts: { name: '缺 Slug 老師', slug: null, role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
};

const FIXTURES: Array<{ key: string; label: string; rows: JournalRowExport[] }> = [
  { key: 'complete',        label: '完整資料（對照組）',      rows: [ROW_A] },
  { key: 'missing-fields',  label: '缺 slug/asset/currency', rows: [ROW_E1, ROW_E2] },
  { key: 'no-experts',      label: 'experts 為 null',        rows: [ROW_F] },
  { key: 'only-asset',      label: '只缺 asset_class',       rows: [ROW_ONLY_MISSING_ASSET] },
  { key: 'only-currency',   label: '只缺 currency',          rows: [ROW_ONLY_MISSING_CURRENCY] },
  { key: 'only-slug',       label: '只缺 slug',              rows: [ROW_ONLY_MISSING_SLUG] },
];

export default function JournalsExportHeaderDomHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const items = useMemo(() => {
    return FIXTURES.map((f) => {
      const groups = groupRowsByMentor(f.rows);
      // 每個 fixture 對應唯一 mentor（單老師），取第一組即可
      const [expertId, mentorRows] = Array.from(groups.entries())[0];
      const md = buildMentorMarkdown(mentorRows, RANGE);
      const lines = md.split('\n');
      const header = lines.slice(0, 9); // L0..L8
      return { ...f, expertId, md, header };
    });
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 16, marginBottom: 8 }}>Journals Export Header DOM Harness</h1>
      <div data-testid="jehd-status" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>
        ready:{items.length}
      </div>
      {items.map((it) => (
        <section
          key={it.key}
          data-testid={`jehd-block-${it.key}`}
          data-expert-id={it.expertId}
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            background: '#fff',
            width: 720,
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{it.label}</div>
          {/* 完整 markdown 藏在 data-md attribute，供 DOM/text parity 對照 */}
          <div
            data-testid={`jehd-md-${it.key}`}
            data-md={it.md}
            style={{ display: 'none' }}
          />
          {/* 逐行 header，供 DOM ↔ text 一致性斷言 */}
          <pre
            data-testid={`jehd-header-${it.key}`}
            style={{
              margin: 0,
              padding: 12,
              background: '#f7f7f5',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              lineHeight: '20px',
              whiteSpace: 'pre',
              color: '#292520',
              borderRadius: 4,
            }}
          >
            {it.header.map((line, idx) => (
              <div key={idx} data-testid={`jehd-line-${it.key}-${idx}`}>
                {line === '' ? '\u00A0' : line}
              </div>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
