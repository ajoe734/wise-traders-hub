import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Currency } from '@/lib/currency';

/**
 * 顯示幣別偏好（會員 /app 專用切換）：
 * - `auto`：以資料原生幣別顯示（現有預設行為）。
 * - `TWD`：USD 內容一律再換算並顯示 TWD 近似值。
 * - `USD`：TWD 內容一律再換算並顯示 USD 近似值。
 *
 * 偏好存 localStorage，跨頁刷新保留。
 */
export type DisplayCurrencyMode = 'auto' | 'TWD' | 'USD';

interface Ctx {
  mode: DisplayCurrencyMode;
  setMode: (m: DisplayCurrencyMode) => void;
  /** 給定原生幣別，回傳「是否應顯示 FX 換算 hint」與目標幣別。 */
  shouldShowHint: (nativeCurrency: Currency | undefined) => { show: boolean; target: Currency };
}

const STORAGE_KEY = 'app:displayCurrency';

const DisplayCurrencyContext = createContext<Ctx>({
  mode: 'auto',
  setMode: () => {},
  shouldShowHint: (c) => ({ show: c === 'USD', target: 'TWD' }),
});

function readInitial(): DisplayCurrencyMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'TWD' || v === 'USD' || v === 'auto') return v;
  } catch {}
  return 'auto';
}

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DisplayCurrencyMode>(readInitial);

  const setMode = (m: DisplayCurrencyMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  };

  // 跨分頁同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'TWD' || e.newValue === 'USD' || e.newValue === 'auto')) {
        setModeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<Ctx>(() => ({
    mode,
    setMode,
    shouldShowHint: (native) => {
      if (mode === 'auto') return { show: native === 'USD', target: 'TWD' };
      if (mode === 'TWD') return { show: native === 'USD', target: 'TWD' };
      // mode === 'USD'
      return { show: native === 'TWD', target: 'USD' };
    },
  }), [mode]);

  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

export function useDisplayCurrency() {
  return useContext(DisplayCurrencyContext);
}
