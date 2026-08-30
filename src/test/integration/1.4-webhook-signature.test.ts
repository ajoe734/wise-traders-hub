/**
 * Group 1.4 — Webhook 簽名驗證與冪等性
 *
 * 測試路徑：
 *   1.1-1 ACPay 3DS 正確 SHA-256 → 驗證通過
 *   1.1-2 ACPay 3DS 錯誤 merchantKey → 簽名不符（被拒絕）
 *   1.1-3 ACPay 定期 正確 AES-CBC → 解密明文一致
 *   1.1-4 ACPay 定期 無法解密 payload → 拒絕
 *   1.1-5 ECPay 正確 CheckMacValue → 驗證通過
 *   1.1-6 ECPay 錯誤 hashIV → CheckMacValue 不符（被拒絕）
 *   1.1-7 LINE Pay 正確 HMAC-SHA256 → 驗證通過
 *   1.1-8 LINE Pay 錯誤 secret → HMAC 不符（被拒絕）
 *   1.2-1 ACPay 3DS 重複 provider_tx_id → isDuplicate = true
 *   1.2-2 ACPay 定期 重複 provider_tx_id → isDuplicate = true
 *   1.2-3 ECPay 重複 provider_tx_id → isDuplicate = true
 *   +1    首次 provider_tx_id → isDuplicate = false（反向 guardrail）
 *
 * Cross-validation 策略：
 *   1.1-1/1.1-5：crypto.subtle.digest (Web Crypto) vs createHash (Node.js crypto)
 *   1.1-3：     Node.js createCipheriv 加密 → acpayAesDecrypt 解密（不同實作路徑）
 *   1.1-7：     crypto.subtle.sign (Web Crypto) vs createHmac (Node.js crypto)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash, createHmac, createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  acpayGenerateSign,
  acpayParseXml,
  acpayDeriveKeyAndIv,
  acpayAesDecrypt,
  ecpayGenerateCheckMacValue,
  linepayHmacSha256Base64,
  lineWebhookVerifySignature,
  isDuplicatePaymentTx,
  acpayExtractTxId,
  acpayRecurringExtractTxId,
  ecpayExtractTxId,
} from '../../../supabase/functions/_shared/paymentVerify';
import { createQueryMock } from '../mocks/supabase';

// ── 參考實作（Node.js crypto，不依賴 Web Crypto API）─────────────────────────

/** Node.js SHA-256，用於 ACPay 3DS 簽名的交叉驗證 */
function refAcpaySign(params: Record<string, string>, merchantKey: string): string {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== '' && v != null)
    .sort(([a], [b]) => a.localeCompare(b));
  const str = filtered.map(([k, v]) => `${k}=${v}`).join('&') + `&key=${merchantKey}`;
  return createHash('sha256').update(str).digest('hex').toUpperCase();
}

/** Node.js SHA-256，用於 ECPay CheckMacValue 的交叉驗證 */
function refEcpayCheckMac(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): string {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;
  let encoded = encodeURIComponent(raw).toLowerCase();
  encoded = encoded
    .replace(/%2d/g, '-').replace(/%5f/g, '_').replace(/%2e/g, '.')
    .replace(/%21/g, '!').replace(/%2a/g, '*').replace(/%28/g, '(')
    .replace(/%29/g, ')').replace(/%20/g, '+').replace(/%7e/g, '~');
  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

/** Node.js HMAC-SHA256 Base64，用於 LINE Pay 簽名的交叉驗證 */
function refLinepayHmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64');
}

/**
 * Node.js AES-256-CBC 加密（PKCS7 padding），用於產生 1.1-3 測試用密文
 * 模擬 ACPay ACREC 端發送的加密 payload
 */
function nodeAesCbcEncrypt(plaintext: string, merchantKey: string, nonceStr: string): string {
  const keyStr = merchantKey.replace(/-/g, '').slice(0, 32);
  const ivStr = nonceStr.replace(/-/g, '').slice(0, 16);
  const key = Buffer.from(keyStr, 'utf-8');
  const iv = Buffer.from(ivStr, 'utf-8');
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return encrypted.toString('base64');
}

// ── 測試 fixtures ──────────────────────────────────────────────────────────────
// MERCHANT_KEY: 32 chars（去除 hyphen 後剛好 32，滿足 AES-256 key 長度）
const MERCHANT_KEY = 'TESTMERCHANTKEY1234567890ABCDEF1';
// NONCE_STR: 16 chars（去除 hyphen 後剛好 16，滿足 AES-CBC IV 長度）
const NONCE_STR = 'TESTNONCE1234567';
const ECPAY_HASH_KEY = 'TEST_ECPAY_HASHKEY';
const ECPAY_HASH_IV = 'TEST_ECPAY_HASHIV';
const LINEPAY_SECRET = 'LINEPAY_CHANNEL_SECRET_FOR_TESTS';

// ── 1.1 Webhook 簽名驗證 ──────────────────────────────────────────────────────

describe('1.1 ACPay 3DS (SHA-256)', () => {
  // 測試 params 包含 sign（應被過濾）、空字串欄位（應被過濾）
  const ACPAY_PARAMS: Record<string, string> = {
    merchant_id: 'MERCHANT_TEST_001',
    out_trade_no: 'ORDER-20260413-001',
    total_fee: '1000',
    nonce_str: 'randomnonce12345',
    attach: '{"plan_id":"plan-abc","billing_cycle":"monthly","user_id":"user-001"}',
    pay_result: '0',
    sign: 'PLACEHOLDER_SIGN_SHOULD_BE_FILTERED',  // 此欄位應排除在外
    empty_field: '',                               // 此欄位應排除在外
  };

  it('1.1-1 正確 merchantKey → 簽名與 Node.js SHA-256 參考一致（cross-validation）', async () => {
    const sign = await acpayGenerateSign(ACPAY_PARAMS, MERCHANT_KEY);

    // Node.js reference（不依賴 Web Crypto API）
    const expected = refAcpaySign(ACPAY_PARAMS, MERCHANT_KEY);

    expect(sign).toBe(expected);
    // 確保 sign 格式正確：64 字元大寫 hex
    expect(sign).toMatch(/^[0-9A-F]{64}$/);
    // 確保 sign 欄位被排除（不同 merchantKey 但 params 相同 → 不會因 sign 欄位影響結果）
    const paramsWithoutSign = { ...ACPAY_PARAMS };
    delete (paramsWithoutSign as any).sign;
    expect(await acpayGenerateSign(paramsWithoutSign, MERCHANT_KEY)).toBe(sign);
  });

  it('1.1-2 錯誤 merchantKey → 簽名不符正確值（請求會被拒絕）', async () => {
    const correctSign = await acpayGenerateSign(ACPAY_PARAMS, MERCHANT_KEY);
    const wrongSign = await acpayGenerateSign(ACPAY_PARAMS, 'WRONG_KEY_0000000000000000000000');

    expect(wrongSign).not.toBe(correctSign);
    // 驗證不同 key 產生不同 hash（排除巧合相等的可能）
    expect(wrongSign).toMatch(/^[0-9A-F]{64}$/);
  });

  it('acpayParseXml 正確解析 CDATA 與純文字標籤', () => {
    const xml = `<xml>
      <pay_result><![CDATA[0]]></pay_result>
      <out_trade_no><![CDATA[ORDER-001]]></out_trade_no>
      <total_fee>1000</total_fee>
      <sign><![CDATA[ABCDEF1234]]></sign>
    </xml>`;

    const result = acpayParseXml(xml);

    expect(result.pay_result).toBe('0');
    expect(result.out_trade_no).toBe('ORDER-001');
    expect(result.total_fee).toBe('1000');
    expect(result.sign).toBe('ABCDEF1234');
  });
});

describe('1.1 ACPay 定期扣款（AES-CBC）', () => {
  it('1.1-3 正確加密資料 → 解密後明文完全一致（Node.js 加密 × Web Crypto 解密）', async () => {
    const originalPayload = JSON.stringify({
      currentPeriodPayResult: '0',
      out_trade_no: 'RECURRING-20260413-001',
      total_fee: '299',
      transaction_id: 'ACREC-TX-001',
      attach: '{"plan_id":"plan-monthly","billing_cycle":"monthly","user_id":"user-abc"}',
    });

    // 以 Node.js AES-256-CBC 加密（PKCS7 padding）
    const encryptedBase64 = nodeAesCbcEncrypt(originalPayload, MERCHANT_KEY, NONCE_STR);

    // 以 paymentVerify 函數解密（Web Crypto AES-CBC）
    const { key, iv } = acpayDeriveKeyAndIv(MERCHANT_KEY, NONCE_STR);
    const decrypted = await acpayAesDecrypt(encryptedBase64, key, iv);

    expect(decrypted).toBe(originalPayload);
    // 確認可以 JSON.parse 回原始結構
    const parsed = JSON.parse(decrypted);
    expect(parsed.out_trade_no).toBe('RECURRING-20260413-001');
    expect(parsed.total_fee).toBe('299');
  });

  it('1.1-4 無效 payload（非 AES block 倍數）→ 解密拒絕 Promise', async () => {
    const { key, iv } = acpayDeriveKeyAndIv(MERCHANT_KEY, NONCE_STR);
    // 'invalid!' = 8 bytes，不是 AES block size (16) 的倍數 → decrypt 失敗
    const invalidBase64 = btoa('invalid!');
    await expect(acpayAesDecrypt(invalidBase64, key, iv)).rejects.toThrow();
  });

  it('acpayDeriveKeyAndIv 正確去除 hyphen 後取前 N 碼', () => {
    const keyWithHyphens = 'TEST-MERCHANT-KEY-12345678901234'; // 含 hyphen
    const nonceWithHyphens = 'TEST-NONCE-12345'; // 含 hyphen

    const { key, iv } = acpayDeriveKeyAndIv(keyWithHyphens, nonceWithHyphens);

    // keyStr = 'TESTMERCHANTKEY12345678901234' (28 chars < 32, 取前 28)
    expect(key.length).toBeLessThanOrEqual(32);
    // ivStr = 'TESTNONCE12345' (14 chars < 16, 取前 14)
    expect(iv.length).toBeLessThanOrEqual(16);
    // key 不能包含 hyphen 的 ASCII 碼（45）
    expect(Array.from(key).includes(45)).toBe(false);
  });
});

describe('1.1 ECPay（CheckMacValue SHA-256）', () => {
  const ECPAY_PARAMS: Record<string, string> = {
    MerchantID: 'TEST_MERCHANT_EC',
    TradeAmt: '1290',
    MerchantTradeNo: 'ECORDER-001',
    ItemName: 'Monthly Plan',    // 空白 → %20 → + （測試 URL encoding 邏輯）
    CustomField1: 'plan-abc',
    CustomField4: 'user-xyz',
    RtnCode: '1',
    TradeNo: 'ECPAY-TX-001',
  };

  it('1.1-5 正確 hashKey/hashIV → CheckMacValue 與 Node.js 參考一致（cross-validation）', async () => {
    const mac = await ecpayGenerateCheckMacValue(ECPAY_PARAMS, ECPAY_HASH_KEY, ECPAY_HASH_IV);

    // Node.js reference（不依賴 Web Crypto API）
    const expected = refEcpayCheckMac(ECPAY_PARAMS, ECPAY_HASH_KEY, ECPAY_HASH_IV);

    expect(mac).toBe(expected);
    expect(mac).toMatch(/^[0-9A-F]{64}$/);
  });

  it('1.1-6 錯誤 hashIV → CheckMacValue 不符正確值（請求會被拒絕）', async () => {
    const correctMac = await ecpayGenerateCheckMacValue(ECPAY_PARAMS, ECPAY_HASH_KEY, ECPAY_HASH_IV);
    const wrongMac = await ecpayGenerateCheckMacValue(ECPAY_PARAMS, ECPAY_HASH_KEY, 'WRONG_IV_!!!');

    expect(wrongMac).not.toBe(correctMac);
    expect(wrongMac).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe('1.1 LINE Pay（HMAC-SHA256）', () => {
  const apiUri = '/v3/payments/9876543210/confirm';
  const bodyStr = JSON.stringify({ amount: 590, currency: 'TWD' });
  const nonce = 'test-nonce-uuid-1234-5678';
  // LINE Pay 簽名訊息格式：channelSecret + apiUri + bodyStr + nonce
  const signatureMessage = LINEPAY_SECRET + apiUri + bodyStr + nonce;

  it('1.1-7 正確 channelSecret → HMAC 與 Node.js 參考一致（cross-validation）', async () => {
    const sig = await linepayHmacSha256Base64(LINEPAY_SECRET, signatureMessage);

    // Node.js reference（不依賴 Web Crypto API）
    const expected = refLinepayHmac(LINEPAY_SECRET, signatureMessage);

    expect(sig).toBe(expected);
    // Base64 格式：44 chars（256-bit HMAC = 32 bytes → 44 base64 chars with padding）
    expect(sig).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('1.1-8 錯誤 channelSecret → HMAC 不符正確值（LINE Pay API 會拒絕）', async () => {
    const correctSig = await linepayHmacSha256Base64(LINEPAY_SECRET, signatureMessage);
    const wrongSig = await linepayHmacSha256Base64('WRONG_SECRET_000000000000000000', signatureMessage);

    expect(wrongSig).not.toBe(correctSig);
  });
});

// ── 1.2 Webhook 冪等性 ────────────────────────────────────────────────────────

describe('1.2 Webhook 冪等性（isDuplicatePaymentTx）', () => {
  it('1.2-1 ACPay 3DS 重複 provider_tx_id → isDuplicate = true，查詢條件正確', async () => {
    const txId = 'ACPAY3DS-DUPLICATE-001';
    const queryMock = createQueryMock({ data: [{ id: 'existing-tx-acpay3ds' }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, txId);

    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('payment_transactions');
    expect(queryMock.eq).toHaveBeenCalledWith('provider_tx_id', txId);
    expect(queryMock.eq).toHaveBeenCalledWith('status', 'paid');
  });

  it('1.2-2 ACPay 定期 重複 provider_tx_id → isDuplicate = true，查詢條件正確', async () => {
    const txId = 'ACREC-DUPLICATE-002';
    const queryMock = createQueryMock({ data: [{ id: 'existing-tx-acrec' }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, txId);

    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('payment_transactions');
    expect(queryMock.eq).toHaveBeenCalledWith('provider_tx_id', txId);
    expect(queryMock.eq).toHaveBeenCalledWith('status', 'paid');
  });

  it('1.2-3 ECPay 重複回呼 → isDuplicate = true，查詢條件正確', async () => {
    const txId = 'ECPAY-TX-DUPLICATE-003';
    const queryMock = createQueryMock({ data: [{ id: 'existing-tx-ecpay' }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, txId);

    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('payment_transactions');
    expect(queryMock.eq).toHaveBeenCalledWith('provider_tx_id', txId);
    expect(queryMock.eq).toHaveBeenCalledWith('status', 'paid');
  });

  it('首次 provider_tx_id → isDuplicate = false（新交易不被誤判為重複）', async () => {
    const txId = 'BRAND-NEW-TX-9999';
    const queryMock = createQueryMock({ data: [], error: null });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, txId);

    expect(result).toBe(false);
    expect(supabase.from).toHaveBeenCalledWith('payment_transactions');
  });

  it('DB query error → isDuplicate = false（fail-open：不因 DB 錯誤阻擋新交易）', async () => {
    const queryMock = createQueryMock({ data: null, error: { message: 'connection refused' } });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, 'TX-DB-ERROR');

    expect(result).toBe(false);
  });

  it('data = null（查無資料）→ isDuplicate = false', async () => {
    const queryMock = createQueryMock({ data: null, error: null });
    const supabase = { from: vi.fn().mockReturnValue(queryMock) };

    const result = await isDuplicatePaymentTx(supabase as any, 'TX-NULL-DATA');

    expect(result).toBe(false);
  });
});

// ── txId 提取邏輯（Vulnerability 3：fallback 順序） ──────────────────────────

describe('provider_tx_id 提取邏輯', () => {
  describe('ACPay 3DS（acpayExtractTxId）', () => {
    it('transaction_id 存在 → 優先使用 transaction_id，忽略 out_trade_no', () => {
      expect(acpayExtractTxId({ transaction_id: 'TX-001', out_trade_no: 'ORDER-001' }))
        .toBe('TX-001');
    });

    it('transaction_id 缺失 → fallback 使用 out_trade_no', () => {
      expect(acpayExtractTxId({ out_trade_no: 'ORDER-001' })).toBe('ORDER-001');
      expect(acpayExtractTxId({ transaction_id: '', out_trade_no: 'ORDER-002' })).toBe('ORDER-002');
    });
  });

  describe('ACPay 定期（acpayRecurringExtractTxId）', () => {
    it('transaction_id 最優先（snake_case）', () => {
      const order = { transaction_id: 'TX-A', transactionId: 'TX-B', out_trade_no: 'ORDER-C' };
      expect(acpayRecurringExtractTxId(order)).toBe('TX-A');
    });

    it('transaction_id 缺失 → transactionId（camelCase）', () => {
      const order = { transactionId: 'TX-B', out_trade_no: 'ORDER-C', outTradeNo: 'ORDER-D' };
      expect(acpayRecurringExtractTxId(order)).toBe('TX-B');
    });

    it('transaction_id / transactionId 均缺失 → out_trade_no / outTradeNo', () => {
      expect(acpayRecurringExtractTxId({ out_trade_no: 'ORDER-C' })).toBe('ORDER-C');
      expect(acpayRecurringExtractTxId({ outTradeNo: 'ORDER-D' })).toBe('ORDER-D');
    });
  });

  describe('ECPay（ecpayExtractTxId）', () => {
    it('TradeNo 存在 → 優先使用（ECPay 系統 ID）', () => {
      expect(ecpayExtractTxId({ TradeNo: 'ECPAY-001', MerchantTradeNo: 'MERCH-001' }))
        .toBe('ECPAY-001');
    });

    it('TradeNo 缺失 → fallback MerchantTradeNo', () => {
      expect(ecpayExtractTxId({ MerchantTradeNo: 'MERCH-001' })).toBe('MERCH-001');
      expect(ecpayExtractTxId({ TradeNo: '', MerchantTradeNo: 'MERCH-002' })).toBe('MERCH-002');
    });
  });
});

// ── LINE Messaging Webhook 驗章（3.4 scope 提前覆蓋） ────────────────────────

describe('3.4 LINE Messaging Webhook X-Line-Signature 驗證', () => {
  const CHANNEL_SECRET = 'LINE_CHANNEL_SECRET_FOR_WEBHOOK';
  const RAW_BODY = JSON.stringify({
    events: [{ type: 'message', source: { userId: 'Uabcdef' }, replyToken: 'tok-001',
      message: { type: 'text', text: 'ABCD12' } }],
  });

  it('3.4-1 正確 X-Line-Signature → 驗證通過（cross-validation 與 Node.js HMAC）', async () => {
    // 以 Node.js HMAC 計算正確簽名（代表 LINE 平台發出的 header 值）
    const correctSig = createHmac('sha256', CHANNEL_SECRET).update(RAW_BODY).digest('base64');

    const result = await lineWebhookVerifySignature(RAW_BODY, correctSig, CHANNEL_SECRET);

    expect(result).toBe(true);
  });

  it('3.4-2 缺少 X-Line-Signature header（null）→ 驗證失敗', async () => {
    const result = await lineWebhookVerifySignature(RAW_BODY, null, CHANNEL_SECRET);
    expect(result).toBe(false);
  });

  it('3.4-3 偽造 X-Line-Signature（錯誤 secret）→ 驗證失敗', async () => {
    const fakeSig = createHmac('sha256', 'WRONG_SECRET').update(RAW_BODY).digest('base64');
    const result = await lineWebhookVerifySignature(RAW_BODY, fakeSig, CHANNEL_SECRET);
    expect(result).toBe(false);
  });
});

// ── drift-detection：Edge Functions 使用共用 _shared/paymentVerify.ts ─────────

describe('drift-detection: Edge Functions 使用共用 _shared/paymentVerify.ts', () => {
  const edgeFn = (name: string) =>
    readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), 'utf-8');

  it('acpay-notify 從 _shared/ 取用 generateSign、parseXml、txId 提取和冪等性檢查', () => {
    const src = edgeFn('acpay-notify');
    expect(src).toContain('../_shared/paymentVerify.ts');
    expect(src).toContain('acpayGenerateSign');
    expect(src).toContain('acpayParseXml');
    expect(src).toContain('acpayExtractTxId');
    expect(src).toContain('isDuplicatePaymentTx');
  });

  it('acpay-recurring-notify 從 _shared/ 取用 deriveKeyAndIv、aesDecrypt、txId 提取和冪等性檢查', () => {
    const src = edgeFn('acpay-recurring-notify');
    expect(src).toContain('../_shared/paymentVerify.ts');
    expect(src).toContain('acpayDeriveKeyAndIv');
    expect(src).toContain('acpayAesDecrypt');
    expect(src).toContain('acpayRecurringExtractTxId');
    expect(src).toContain('isDuplicatePaymentTx');
  });

  it('ecpay-callback 從 _shared/ 取用 generateCheckMacValue、txId 提取和冪等性檢查', () => {
    const src = edgeFn('ecpay-callback');
    expect(src).toContain('../_shared/paymentVerify.ts');
    expect(src).toContain('ecpayGenerateCheckMacValue');
    expect(src).toContain('ecpayExtractTxId');
    expect(src).toContain('isDuplicatePaymentTx');
  });

  it('confirm-linepay 從 _shared/ 取用 linepayHmacSha256Base64', () => {
    expect(edgeFn('confirm-linepay')).toContain('../_shared/linepayConfirm.ts');
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/linepayConfirm.ts'),
      'utf-8',
    );
    expect(src).toContain('./paymentVerify.ts');
    expect(src).toContain('linepayHmacSha256Base64');
  });

  it('line-webhook 從 _shared/ 取用 lineWebhookVerifySignature', () => {
    const src = edgeFn('line-webhook');
    expect(src).toContain('../_shared/paymentVerify.ts');
    expect(src).toContain('lineWebhookVerifySignature');
  });
});
