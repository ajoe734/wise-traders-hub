/**
 * OCR → 持倉 → K 線 symbol 的整合證據。
 *
 * 缺口誠實標示：使用者提供的是「結果畫面」而非原始券商截圖，故無法重跑真實
 * 影像 OCR。本測試改用 checkup-parse 實際回傳格式的 payload（JSON.parse 會把
 * "054530" 這種代號在模型輸出無引號時變成 number 54530）作為輸入，覆蓋
 * normalization → parsed trade → holding → sparkline request 全鏈。
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeTradeRow } from '../importedTradeIdentity';
import { planSparklineFetch, twSubsetOf } from '@/checkup/hooks/useSparklines';

// checkup-parse 回傳的原始字串（模型未加引號 → 數值化，前導 0 消失）
const OCR_RAW = '{"trades":[{"action":"buy","code":054530,"name":"祥碩凱基5C購01","qty":10,"price":0.61,"date":"2026/09/08"}]}';
// 另一種常見壞掉輸出：模型照舊 prompt 只回 4 碼，填成標的
const OCR_RAW_UNDERLYING = '{"trades":[{"action":"buy","code":"5269","name":"祥碩凱基5C購01","qty":10,"price":0.61}]}';

function parseOcr(raw: string) {
  // 054530 不是合法 JSON number（前導 0），實際模型輸出為 54530
  return JSON.parse(raw.replace(':054530', ':54530'));
}

describe('OCR payload → chart symbol', () => {
  it('數值化的 54530 還原為 054530，並成為 sparkline 請求代號', () => {
    const { trades } = parseOcr(OCR_RAW);
    expect(trades[0].code).toBe(54530); // 證實 JSON 端已遺失前導 0

    const row = canonicalizeTradeRow(trades[0]);
    expect(row.code).toBe('054530');

    const holdings = [{ code: row.code, name: row.name }];
    const codes = holdings.map((h) => h.code);
    expect(twSubsetOf(codes)).toContain('054530');
    const planned = planSparklineFetch(codes, {});
    expect(planned).toContain('054530');
    // negative assertion：任何階段都不得出現標的代號
    expect(planned).not.toContain('5269');
    expect(JSON.stringify({ codes, planned })).not.toContain('5269');
  });

  it('模型若誤填標的 5269，會被判定為可疑 identity（不靜默採用）', async () => {
    const { isSuspectImportedIdentity } = await import('../importedTradeIdentity');
    const { trades } = JSON.parse(OCR_RAW_UNDERLYING);
    const row = canonicalizeTradeRow(trades[0]);
    expect(isSuspectImportedIdentity(row.code, row.name)).toBe(true);
  });

  it('手動輸入與 OCR 匯入產出的 chart symbol 完全相同', async () => {
    const { buildManualTradeRow } = await import('../manualTradeEntry');
    const manual = buildManualTradeRow({
      code: '054530', name: '祥碩凱基5C購01', qty: '10', price: '0.61',
      action: '買進', date: '2026-09-08',
    } as never);
    const ocr = canonicalizeTradeRow(parseOcr(OCR_RAW).trades[0]);
    expect(manual.code).toBe(ocr.code);
    expect(planSparklineFetch([manual.code], {})).toEqual(planSparklineFetch([ocr.code], {}));
  });

  it('普通股／ETF／美股不回歸', () => {
    for (const c of ['2330', '00637L', '00878', 'AMD']) {
      expect(canonicalizeTradeRow({ code: c, name: '' }).code).toBe(c);
    }
  });
});
