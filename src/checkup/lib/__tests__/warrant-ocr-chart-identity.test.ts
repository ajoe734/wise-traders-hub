/**
 * 權證 OCR identity 回歸：054530「祥碩凱基5C購01」
 * 手動輸入與 OCR 匯入必須產出**完全相同**的 canonical 持倉代號與 chart request，
 * 且任何路徑都不得出現標的 5269。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  canonicalizeTradeCode,
  canonicalizeTradeRow,
  isSuspectImportedIdentity,
  looksLikeWarrantName,
} from '../importedTradeIdentity';
import { buildManualTradeRow } from '../manualTradeEntry';
import { twSubsetOf } from '../../hooks/useSparklines';

const WARRANT = { code: '054530', name: '祥碩凱基5C購01' };
const UNDERLYING = '5269';

describe('canonicalizeTradeCode', () => {
  it('OCR 把 054530 數值化成 54530 時還原前導 0', () => {
    expect(canonicalizeTradeCode(54530, WARRANT.name)).toBe('054530');
    expect(canonicalizeTradeCode('54530', WARRANT.name)).toBe('054530');
  });

  it('字串權證代號原樣保留', () => {
    expect(canonicalizeTradeCode('054530', WARRANT.name)).toBe('054530');
  });

  it('普通股／ETF／美股／非前導 0 六碼權證不得回歸', () => {
    expect(canonicalizeTradeCode('2330', '台積電')).toBe('2330');
    expect(canonicalizeTradeCode(2330, '台積電')).toBe('2330');
    expect(canonicalizeTradeCode('00878', '國泰永續高股息')).toBe('00878');
    expect(canonicalizeTradeCode('00637L', '元大滬深300正2')).toBe('00637L');
    expect(canonicalizeTradeCode('AAPL', 'Apple')).toBe('AAPL');
    expect(canonicalizeTradeCode('712345', '某某購01')).toBe('712345');
    expect(canonicalizeTradeCode('031234', '某某購02')).toBe('031234');
  });

  it('永遠不得回傳標的代號', () => {
    expect(canonicalizeTradeCode(54530, WARRANT.name)).not.toBe(UNDERLYING);
    expect(looksLikeWarrantName(WARRANT.name)).toBe(true);
  });
});

describe('手動 vs OCR canonical identity 一致', () => {
  const manual = buildManualTradeRow({
    action: '買進', code: WARRANT.code, name: WARRANT.name, qty: 1000, price: 0.61,
  });
  // OCR payload：模型把代號數值化
  const ocrRaw = { action: '買進', code: 54530, name: WARRANT.name, qty: 1000, price: 0.61 };
  const ocr = canonicalizeTradeRow(ocrRaw);

  it('持倉 code 相同且為 054530', () => {
    expect(manual.code).toBe('054530');
    expect(ocr.code).toBe('054530');
    expect(ocr.code).toBe(manual.code);
  });

  it('名稱維持權證名稱', () => {
    expect(manual.name).toBe(WARRANT.name);
    expect(ocr.name).toBe(WARRANT.name);
  });
});

describe('chart / 報價 request identity', () => {
  it('sparkline request 的 codes 是 054530，不是 5269', () => {
    const manualCode = buildManualTradeRow({ action: '買進', code: WARRANT.code, name: WARRANT.name, qty: 1000, price: 0.61 }).code;
    const ocrCode = String(canonicalizeTradeRow({ code: 54530, name: WARRANT.name }).code);
    const manualReq = twSubsetOf([manualCode]);
    const ocrReq = twSubsetOf([ocrCode]);
    expect(manualReq).toEqual(['054530']);
    expect(ocrReq).toEqual(manualReq);
    expect(manualReq).not.toContain(UNDERLYING);
    expect(ocrReq).not.toContain(UNDERLYING);
  });
});

describe('已錯存資料 repair predicate（唯讀判定）', () => {
  it('54530 與 名稱為權證但代號 4 碼者為可疑', () => {
    expect(isSuspectImportedIdentity('54530', WARRANT.name)).toBe(true);
    expect(isSuspectImportedIdentity(UNDERLYING, WARRANT.name)).toBe(true);
  });
  it('正常資料不可疑', () => {
    expect(isSuspectImportedIdentity('054530', WARRANT.name)).toBe(false);
    expect(isSuspectImportedIdentity('2330', '台積電')).toBe(false);
    expect(isSuspectImportedIdentity('00878', '國泰永續高股息')).toBe(false);
  });
});
