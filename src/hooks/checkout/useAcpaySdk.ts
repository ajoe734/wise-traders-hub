import { useCallback, useEffect, useRef } from 'react';

const ACPAY_SDK_URL = 'https://js.payloop.com.tw/sdk/v1.0/acpay.js';

export interface AcpayFieldElements {
  numberEl: string;
  expirationDateEl: string;
  ccvEl: string;
}

/**
 * Loads the ACpay JS SDK when `enabled` becomes true, mounts secure card fields
 * into the elements identified by `fieldEls`, and exposes a `getPrime()` helper.
 *
 * Centralises the SDK loader that was duplicated in Checkout.tsx / AppCheckout.tsx.
 */
export function useAcpaySdk(enabled: boolean, fieldEls: AcpayFieldElements) {
  const sdkLoadedRef = useRef(false);
  const fieldsRef = useRef<any>(null);

  const initFields = useCallback(() => {
    if (!(window as any).ACPay) return;
    try {
      const ACPay = (window as any).ACPay;
      const fields = ACPay.setupSDK({
        fields: {
          number: { element: fieldEls.numberEl, placeholder: '卡號' },
          expirationDate: { element: fieldEls.expirationDateEl, placeholder: 'MM/YY' },
          ccv: { element: fieldEls.ccvEl, placeholder: '安全碼' },
        },
      });
      fieldsRef.current = fields;
    } catch (e) {
      console.error('ACpay SDK init error:', e);
    }
  }, [fieldEls.numberEl, fieldEls.expirationDateEl, fieldEls.ccvEl]);

  useEffect(() => {
    if (!enabled || sdkLoadedRef.current) return;
    const existing = document.querySelector(`script[src="${ACPAY_SDK_URL}"]`);
    if (existing) {
      sdkLoadedRef.current = true;
      initFields();
      return;
    }
    const script = document.createElement('script');
    script.src = ACPAY_SDK_URL;
    script.async = true;
    script.onload = () => {
      sdkLoadedRef.current = true;
      initFields();
    };
    script.onerror = () => console.error('Failed to load ACpay SDK');
    document.head.appendChild(script);
  }, [enabled, initFields]);

  /** Resolves the prime token; resolves to `'SIMULATE_PRIME'` if SDK is unavailable. */
  const getPrime = useCallback(async (): Promise<string> => {
    const ACPay = (window as any).ACPay;
    if (!ACPay || !fieldsRef.current) {
      console.warn('ACpay SDK not available, using simulate mode');
      return 'SIMULATE_PRIME';
    }
    return new Promise<string>((resolve, reject) => {
      ACPay.getPrime(fieldsRef.current, (r: any) => {
        if (r.status !== 0) reject(new Error(r.msg || '取得 prime token 失敗'));
        else resolve(r.prime);
      });
    });
  }, []);

  return { getPrime };
}
