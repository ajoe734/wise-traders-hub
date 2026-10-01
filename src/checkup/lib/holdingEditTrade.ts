import { buildManualTradeRow } from './manualTradeEntry';
import { validateQty } from './stockIdentity';
import { formatTradeDate } from './manualTradeEntry';

/** 編輯的是持股目標；差額才是真正成交。不能以虛構賣出或零股數交易改寫成本。 */
export function buildHoldingEditTrade({ holding, targetQty, targetCost, executionPrice, now = new Date() }: {
  holding: { code?: string; name?: string; qty?: number; cost?: number };
  targetQty: unknown;
  targetCost: unknown;
  executionPrice: unknown;
  now?: Date;
}): { ok: true; entry: ReturnType<typeof buildManualTradeRow> & { id: string; qa: [] } } | { ok: false; error: string } {
  const code = String(holding?.code || '').trim();
  const before = Number(holding?.qty);
  const after = Number(targetQty);
  const previousCost = Number(holding?.cost);
  const desiredCost = Number(targetCost);
  const price = Number(executionPrice);
  if (!code || !Number.isFinite(before) || before <= 0) return { ok: false, error: '找不到有效持倉' };
  const qtyError = validateQty(code, after);
  if (qtyError) return { ok: false, error: qtyError };
  if (!Number.isFinite(desiredCost) || desiredCost <= 0 || !Number.isFinite(previousCost) || previousCost <= 0) return { ok: false, error: '成本需大於 0' };
  if (after === before) return { ok: false, error: '股數未變；請到交易紀錄修正原成交價格以調整成本' };
  if (after < before && Math.abs(desiredCost - previousCost) > 0.01) {
    return { ok: false, error: '賣出不會改變每股成本；請到交易紀錄修正原成交價格' };
  }
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: '實際成交價格需大於 0' };
  const delta = Math.abs(after - before);
  if (validateQty(code, delta)) return { ok: false, error: '成交股數格式不正確' };
  // 加碼後均價由既有持倉成本和真實買進價格推算，禁止直接覆寫成本。
  if (after > before && Number.isFinite(previousCost)) {
    const projected = (previousCost * before + price * delta) / after;
    if (Math.abs(Math.round(projected * 100) / 100 - desiredCost) > 0.01) {
      return { ok: false, error: `依成交價推算成本約 ${projected.toFixed(2)} 元；請修正目標成本或成交價` };
    }
  }
  return {
    ok: true,
    entry: {
      ...buildManualTradeRow({ action: after > before ? '買進' : '賣出', code, name: holding.name, qty: delta, price, date: formatTradeDate(now), time: now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' }) }),
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      qa: [],
    },
  };
}