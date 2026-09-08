/**
 * OCR 匯入 fail-closed identity gate 的證據測試。
 * 測 production helper `screenImportedTradeIdentities` 與其消費端（FreeCheckup OCR 路徑）：
 * 權證名稱 + 4 碼標的代號必須整批拒絕，accepted 0、holding 0、chart request 0，且永不出現 5269。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canonicalizeTradeRow,
  screenImportedTradeIdentities,
  WARRANT_UNDERLYING_IMPORT_ERROR,
} from '../importedTradeIdentity';
import { planSparklineFetch } from '@/checkup/hooks/useSparklines';

const OCR_UNDERLYING = { code: '5269', name: '祥碩凱基5C購01', qty: 10, price: 0.61, action: '買進' };
const OCR_NUMERIC_WARRANT = { code: 54530, name: '祥碩凱基5C購01', qty: 10, price: 0.61, action: '買進' };

describe('OCR import identity gate', () => {
  it('權證名稱 + 標的代號 → 拒絕整批，accepted 0、holding 0、chart request 0', () => {
    const rows = [canonicalizeTradeRow(OCR_UNDERLYING)];
    const gate = screenImportedTradeIdentities(rows);

    expect(gate.ok).toBe(false);
    expect(gate.accepted).toHaveLength(0);
    expect(gate.rejected).toHaveLength(1);
    expect(gate.error).toContain(WARRANT_UNDERLYING_IMPORT_ERROR);

    // 消費端契約：gate 失敗時不得建立持倉，也不得規劃任何 sparkline 請求
    const holdings = gate.ok ? gate.accepted.map((r) => ({ code: r.code })) : [];
    expect(holdings).toHaveLength(0);
    const planned = planSparklineFetch(holdings.map((h) => String(h.code)), {});
    expect(planned).toHaveLength(0);
    expect(JSON.stringify(planned)).not.toContain('5269');
  });

  it('OCR 54530 → 054530 可通過 gate 並取得 K 線', () => {
    const rows = [canonicalizeTradeRow(OCR_NUMERIC_WARRANT)];
    const gate = screenImportedTradeIdentities(rows);
    expect(gate.ok).toBe(true);
    expect(gate.accepted[0].code).toBe('054530');
    expect(planSparklineFetch(['054530'], {})).toContain('054530');
  });

  it('手動 054530 與普通股 5269 不受影響', () => {
    const manualWarrant = screenImportedTradeIdentities([
      { code: '054530', name: '祥碩凱基5C購01' },
    ]);
    expect(manualWarrant.ok).toBe(true);

    const plainStock = screenImportedTradeIdentities([
      { code: '5269', name: '祥碩' },
      { code: '2330', name: '台積電' },
      { code: '00637L', name: '元大滬深300正2' },
      { code: 'AMD', name: 'AMD' },
    ]);
    expect(plainStock.ok).toBe(true);
    expect(plainStock.accepted).toHaveLength(4);
  });

  it('production 消費端 FreeCheckup 真的在 setParsed 之前套用 gate', () => {
    const src = readFileSync('src/pages/FreeCheckup.jsx', 'utf8');
    const gateAt = src.indexOf('screenImportedTradeIdentities(preparedTrades)');
    const setParsedAt = src.indexOf('setParsed(parsedResult)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(setParsedAt).toBeGreaterThan(gateAt);
    expect(src.slice(gateAt, setParsedAt)).toContain('return { ok: false');
  });
});
