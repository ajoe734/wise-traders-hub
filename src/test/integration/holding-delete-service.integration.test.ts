/**
 * 單檔持倉刪除 persistence service 的整合合約。
 * 覆蓋：rollback、未授權、最後一檔、duplicate、reload、replay、手動重加、
 * 截圖重匯、其他持倉不受影響，以及帳務 fingerprint（tradeRecordWrites=0 / cashDelta=0）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyHoldingExclusions,
  holdingLedgerFingerprint,
  parseExclusions,
  planScreenshotImport,
  FORBIDDEN_WRITE_TABLES,
  HOLDING_EXCLUSIONS_KEY,
  type HoldingLike,
} from '@/checkup/lib/holdingExclusions';
import {
  applyScreenshotImportWithExclusions,
  clearExclusionForManualAdd,
  deleteHoldingWithExclusion,
} from '@/checkup/lib/holdingDeleteService';
import {
  clearLocalExclusion,
  readLocalExclusions,
  writeLocalExclusions,
} from '@/checkup/lib/holdingExclusionsStorage';
import { createFakeGateway, runHoldingDeleteScenarios } from '@/pages/HoldingDeleteHarnessEntry';

const H = (code: string): HoldingLike => ({ code, name: code, shares: 1000 });
const BASE = [H('2330'), H('6706'), H('00708L')];

describe('holdingDeleteService · 刪除語意', () => {
  it('正常刪除：三個寫入點依序一致，其餘持倉完全不受影響', async () => {
    const { gateway, state } = createFakeGateway({ holdings: BASE });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    expect(r.ok).toBe(true);
    expect(r.steps).toEqual(['pf-holding-exclusions-v1', 'pf-holdings-v2', 'pf-calendar-holdings']);
    expect(r.holdings.map((h) => h.code)).toEqual(['2330', '00708L']);
    expect(state.calendar.holdingCodes).toBe('00708L,2330');
    expect(r.exclusions.map((e) => e.code)).toEqual(['6706']);
    // 其餘持倉物件 identity 不變（沒有被重建/改寫）
    expect(r.holdings[0]).toBe(BASE[0]);
    expect(r.holdings[1]).toBe(BASE[2]);
  });

  it('大小寫 / 空白不影響比對', async () => {
    const { gateway } = createFakeGateway({ holdings: [H('00708L')] });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: [H('00708L')], exclusions: [], code: ' 00708l ' });
    expect(r.ok).toBe(true);
    expect(r.code).toBe('00708L');
  });

  it('空 code → invalid-code，不寫任何東西', async () => {
    const { gateway, state } = createFakeGateway({ holdings: BASE });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '  ' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-code');
    expect(state.writes).toEqual([]);
  });

  it.each(['exclusions', 'holdings', 'calendar'] as const)('第 %s 步失敗 → 完整 rollback 回原值', async (failOn) => {
    const { gateway, state } = createFakeGateway({ holdings: BASE, failOn });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('write-failed');
    expect(r.rolledBack).toBe(true);
    expect(r.holdings).toEqual(BASE);
    expect(r.exclusions).toEqual([]);
    expect(state.holdings.map((h) => h.code)).toEqual(['2330', '6706', '00708L']);
    expect(state.exclusions).toEqual([]);
  });

  it.each(FORBIDDEN_WRITE_TABLES)('未授權：gateway 宣告會寫 %s → 直接拒絕且零寫入', async (table) => {
    const { gateway, state } = createFakeGateway({ holdings: BASE, writableTables: ['checkup_storage', table] });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('forbidden-table');
    expect(state.writes).toEqual([]);
    expect(r.holdings).toEqual(BASE);
  });

  it('最後一檔：持倉清空、日曆同步清空', async () => {
    const only = [H('2330')];
    const { gateway, state } = createFakeGateway({ holdings: only });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: only, exclusions: [], code: '2330' });
    expect(r.ok).toBe(true);
    expect(r.holdings).toEqual([]);
    expect(state.calendar).toEqual({ stocks: '', holdingCodes: '' });
  });

  it('重複刪除：第二次 not-found，排除標記不重複', async () => {
    const { gateway } = createFakeGateway({ holdings: BASE });
    const first = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    const second = await deleteHoldingWithExclusion({
      gateway, holdings: first.holdings, exclusions: first.exclusions, code: '6706',
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('not-found');
    expect(second.exclusions.filter((e) => e.code === '6706')).toHaveLength(1);
  });

  it('帳務 fingerprint 恆為 tradeRecordWrites=0 / cashDelta=0', async () => {
    const { gateway } = createFakeGateway({ holdings: BASE });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    expect(r.fingerprint.tradeRecordWrites).toBe(0);
    expect(r.fingerprint.cashDelta).toBe(0);
    expect(holdingLedgerFingerprint(r.holdings, r.exclusions)).toEqual({
      holdingCodes: '00708L,2330',
      exclusionCodes: '6706',
      calendarCodes: '00708L,2330',
      tradeRecordWrites: 0,
      cashDelta: 0,
    });
  });
});

describe('holding exclusions · reload / replay', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reload：寫進 storage 的排除標記重讀後仍生效', () => {
    writeLocalExclusions(parseExclusions(['6706']));
    expect(localStorage.getItem(HOLDING_EXCLUSIONS_KEY)).toContain('6706');
    const reread = readLocalExclusions();
    expect(applyHoldingExclusions(BASE, reread).map((h) => h.code)).toEqual(['2330', '00708L']);
  });

  it('trade replay 重建持倉後，被刪個股不得復活', () => {
    const replayed = [...BASE, H('6706')];
    const filtered = applyHoldingExclusions(replayed, parseExclusions(['6706']));
    expect(filtered.some((h) => h.code === '6706')).toBe(false);
    expect(filtered.map((h) => h.code)).toEqual(['2330', '00708L']);
  });

  it('沒有排除標記時 replay 結果原封不動', () => {
    expect(applyHoldingExclusions(BASE, [])).toBe(BASE);
  });
});

describe('手動重新加入 · 截圖重匯', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('手動重新加入 → gateway 清除排除標記', async () => {
    const exclusions = parseExclusions(['6706']);
    const { gateway, state } = createFakeGateway({ holdings: BASE, exclusions });
    const r = await clearExclusionForManualAdd({ gateway, exclusions, code: '6706' });
    expect(r).toMatchObject({ ok: true, cleared: true });
    expect(r.exclusions).toEqual([]);
    expect(state.exclusions).toEqual([]);
  });

  it('手動重新加入未被排除的個股 → no-op', async () => {
    const { gateway, state } = createFakeGateway({ holdings: BASE, exclusions: parseExclusions(['6706']) });
    const r = await clearExclusionForManualAdd({ gateway, exclusions: parseExclusions(['6706']), code: '2330' });
    expect(r).toMatchObject({ ok: true, cleared: false });
    expect(state.writes).toEqual([]);
  });

  it('clearLocalExclusion：TradeTab 手動路徑清掉本機標記', () => {
    writeLocalExclusions(parseExclusions(['6706', '2330']));
    expect(clearLocalExclusion('6706')).toBe(true);
    expect(readLocalExclusions().map((e) => e.code)).toEqual(['2330']);
    expect(clearLocalExclusion('6706')).toBe(false);
  });

  it('截圖重匯：預設略過已排除個股，標記保留', async () => {
    const exclusions = parseExclusions(['6706']);
    const { gateway, state } = createFakeGateway({ holdings: BASE, exclusions });
    const r = await applyScreenshotImportWithExclusions({ gateway, incoming: BASE, exclusions, confirmedCodes: [] });
    expect(r.ok).toBe(true);
    expect(r.skipped).toEqual(['6706']);
    expect(r.restored).toEqual([]);
    expect(r.accepted.map((h) => h.code)).toEqual(['2330', '00708L']);
    expect(state.writes).toEqual([]);
    expect(planScreenshotImport({ incoming: BASE, exclusions, confirmedCodes: [] }).skipped).toEqual(['6706']);
  });

  it('截圖重匯：明確確認才恢復並清標記', async () => {
    const exclusions = parseExclusions(['6706']);
    const { gateway, state } = createFakeGateway({ holdings: BASE, exclusions });
    const r = await applyScreenshotImportWithExclusions({ gateway, incoming: BASE, exclusions, confirmedCodes: ['6706'] });
    expect(r.ok).toBe(true);
    expect(r.restored).toEqual(['6706']);
    expect(r.accepted).toHaveLength(3);
    expect(r.exclusions).toEqual([]);
    expect(state.exclusions).toEqual([]);
  });

  it('截圖重匯：清標記失敗 → 保守整批不恢復', async () => {
    const exclusions = parseExclusions(['6706']);
    const { gateway } = createFakeGateway({ holdings: BASE, exclusions, failOn: 'exclusions' });
    const r = await applyScreenshotImportWithExclusions({ gateway, incoming: BASE, exclusions, confirmedCodes: ['6706'] });
    expect(r.ok).toBe(false);
    expect(r.restored).toEqual([]);
    expect(r.skipped).toEqual(['6706']);
    expect(r.accepted.map((h) => h.code)).toEqual(['2330', '00708L']);
    expect(r.exclusions).toEqual(exclusions);
  });
});

describe('harness scenarios（與 UI 同一組 production 案例）', () => {
  it('九類全部 pass 且零帳務寫入', async () => {
    const rows = await runHoldingDeleteScenarios();
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      expect({ id: r.id, ok: r.ok }).toEqual({ id: r.id, ok: true });
      expect(r.tradeRecordWrites).toBe(0);
      expect(r.cashDelta).toBe(0);
    }
  });
});
