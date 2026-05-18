import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * useState 的 sessionStorage 持久化版本（每個 key 獨立鍵存）。
 *
 * 設計目標：替換大量「useState + useEffect setItem」樣板，
 * 同時保持與舊版測試/外部設定的 key 相容（單一字串值，非 JSON）。
 */
export function useSessionString(
  key: string,
  initial = '',
): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState<string>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      return sessionStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* noop */
    }
  }, [key, value]);
  return [value, setValue];
}

/**
 * Boolean 變體。
 * - 預設 true：sessionStorage 值為 'false' 才視為 false（其餘皆 true）
 * - 預設 false：sessionStorage 值為 'true' 才視為 true
 */
export function useSessionBool(
  key: string,
  defaultValue: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return defaultValue;
      return defaultValue ? raw !== 'false' : raw === 'true';
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, String(value));
    } catch {
      /* noop */
    }
  }, [key, value]);
  return [value, setValue];
}

/**
 * Nullable string：null/空字串時自動移除鍵。
 */
export function useSessionNullable(
  key: string,
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [value, setValue] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }, [key, value]);
  return [value, setValue];
}
