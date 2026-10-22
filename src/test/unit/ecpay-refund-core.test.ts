import { describe, it, expect } from 'vitest';
import {
  validateRefundRequest,
  buildDoActionParams,
  doActionUrl,
  parseDoActionResponse,
} from '../../../supabase/functions/_shared/ecpayRefundCore';

describe('validateRefundRequest', () => {
  const base = { merchantTradeNo: 'CK1792589247358', tradeNo: '2610212127277634', totalAmount: 699 };

  it('缺商家訂單編號或綠界交易編號 → 拒絕', () => {
    expect(validateRefundRequest({ ...base, merchantTradeNo: '' }).ok).toBe(false);
    expect(validateRefundRequest({ ...base, tradeNo: '  ' }).ok).toBe(false);
  });

  it('金額必須是正整數', () => {
    expect(validateRefundRequest({ ...base, totalAmount: 0 }).ok).toBe(false);
    expect(validateRefundRequest({ ...base, totalAmount: -5 }).ok).toBe(false);
    expect(validateRefundRequest({ ...base, totalAmount: 699.5 }).ok).toBe(false);
  });

  it('合法輸入通過並保留原值', () => {
    const r = validateRefundRequest(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(base);
  });
});

describe('buildDoActionParams', () => {
  it('退刷參數：Action=N、金額為整數字串、不自行帶簽章', () => {
    const p = buildDoActionParams(
      { merchantTradeNo: 'CK1792589247358', tradeNo: '2610212127277634', totalAmount: 699 },
      '2000132',
    );
    expect(p).toEqual({
      MerchantID: '2000132',
      MerchantTradeNo: 'CK1792589247358',
      TradeNo: '2610212127277634',
      Action: 'N',
      TotalAmount: '699',
    });
    expect(p.CheckMacValue).toBeUndefined();
  });
});

describe('doActionUrl', () => {
  it('正式／測試環境端點不同', () => {
    expect(doActionUrl('production')).toBe('https://payment.ecpay.com.tw/CreditDetail/DoAction');
    expect(doActionUrl('stage')).toBe('https://payment-stage.ecpay.com.tw/CreditDetail/DoAction');
  });
});

describe('parseDoActionResponse', () => {
  it('"1|OK" 為成功', () => {
    const r = parseDoActionResponse('1|OK');
    expect(r.ok).toBe(true);
    expect(r.rtnCode).toBe('1');
  });

  it('"0|..." 為失敗並保留訊息', () => {
    const r = parseDoActionResponse('0|訂單不存在');
    expect(r.ok).toBe(false);
    expect(r.rtnMsg).toContain('訂單不存在');
  });

  it('key=value 形式（RtnCode/RtnMsg）也支援', () => {
    expect(parseDoActionResponse('RtnCode=1&RtnMsg=OK').ok).toBe(true);
    const f = parseDoActionResponse('RtnCode=0&RtnMsg=交易失敗');
    expect(f.ok).toBe(false);
    expect(f.rtnMsg).toContain('交易失敗');
  });

  it('空回應為失敗', () => {
    expect(parseDoActionResponse('').ok).toBe(false);
  });
});
