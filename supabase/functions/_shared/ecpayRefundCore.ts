/**
 * ECPay 信用卡退刷（DoAction）純邏輯單一來源。
 *
 * 供 Edge Function `ecpay-refund` 使用，Vitest 直接 import 測試。
 * 只負責組參數、判環境端點、解析回應；不碰網路、不碰 DB。
 */

export interface RefundRequestInput {
  merchantTradeNo: string;
  tradeNo: string;
  totalAmount: number;
}

export type ValidateResult =
  | { ok: true; value: RefundRequestInput }
  | { ok: false; message: string };

export function validateRefundRequest(input: Partial<RefundRequestInput>): ValidateResult {
  const merchantTradeNo = String(input.merchantTradeNo ?? '').trim();
  const tradeNo = String(input.tradeNo ?? '').trim();
  const totalAmount = Number(input.totalAmount);

  if (!merchantTradeNo) return { ok: false, message: '缺少商家訂單編號（MerchantTradeNo）' };
  if (!tradeNo) return { ok: false, message: '缺少綠界交易編號（TradeNo）' };
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return { ok: false, message: '退刷金額必須是正整數' };
  }
  return { ok: true, value: { merchantTradeNo, tradeNo, totalAmount } };
}

/**
 * 信用卡 DoAction 參數（不含 CheckMacValue，簽章由呼叫端加）。
 *  - action='N'：退刷（請款前）
 *  - action='R'：退款（已關帳／已請款）
 * 兩種動作此端點都以 TotalAmount 傳金額（Action=R 傳 AmountToRefund 會被拒）。
 */
export function buildDoActionParams(
  input: RefundRequestInput,
  merchantId: string,
  action: 'N' | 'R' = 'N',
): Record<string, string> {
  return {
    MerchantID: merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    TradeNo: input.tradeNo,
    Action: action,
    TotalAmount: String(input.totalAmount),
  };
}

export function doActionUrl(env: 'stage' | 'production'): string {
  return env === 'production'
    ? 'https://payment.ecpay.com.tw/CreditDetail/DoAction'
    : 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction';
}

export interface DoActionResult {
  ok: boolean;
  rtnCode: string;
  rtnMsg: string;
}

/** 解析 DoAction 回應：支援 `1|OK` 與 `RtnCode=1&RtnMsg=...` 兩種形式。 */
export function parseDoActionResponse(text: string): DoActionResult {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, rtnCode: '', rtnMsg: '綠界回應為空' };

  if (raw.includes('|') && !raw.includes('=')) {
    const [code, ...rest] = raw.split('|');
    const rtnCode = code.trim();
    return { ok: rtnCode === '1', rtnCode, rtnMsg: rest.join('|').trim() };
  }

  const params = parseUrlencoded(raw);
  const rtnCode = (params.RtnCode ?? '').trim();
  const rtnMsg = (params.RtnMsg ?? '').trim();
  if (!rtnCode) return { ok: false, rtnCode: '', rtnMsg: rtnMsg || raw };
  return { ok: rtnCode === '1', rtnCode, rtnMsg };
}

function parseUrlencoded(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
  }
  return params;
}

/** 訂單查詢（QueryTradeInfo V5）參數，不含 CheckMacValue。 */
export function buildQueryParams(
  merchantTradeNo: string,
  merchantId: string,
  timestamp: number,
): Record<string, string> {
  return {
    MerchantID: merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(timestamp),
  };
}

export function queryUrl(env: 'stage' | 'production'): string {
  return env === 'production'
    ? 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
    : 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5';
}

export interface QueryResult {
  ok: boolean;
  fields: Record<string, string>;
}

/** 解析 QueryTradeInfo 回應（urlencoded）；RtnCode=1 為查詢成功。 */
export function parseQueryResponse(text: string): QueryResult {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, fields: {} };
  const fields = parseUrlencoded(raw);
  const ok = (fields.RtnCode ?? '').trim() === '1';
  return { ok, fields };
}
