import { useEffect, useRef } from 'react';

/**
 * 後台表單草稿暫存 hook（遵循 mem://management/form-persistence-rules）。
 *
 * - 使用 sessionStorage（切換分頁／路由保留，關閉視窗清除）
 * - 每個 key 獨立暫存
 * - mount 時若有暫存，呼叫 onRestore(data) 還原
 * - value 變動時 debounce 寫入
 * - 由 caller 在「新增」「送出成功」「取消」時呼叫 discard()
 *
 * 規範要點：
 * 2. 開啟邏輯：點擊「新增」按鈕時須先 clearForm() + discard()
 * 3. 提交成功 / 主動取消 → discard()
 */
export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  value: T,
  onRestore: (data: T) => void,
  options?: { debounceMs?: number; enabled?: boolean }
) {
  const { debounceMs = 300, enabled = true } = options ?? {};
  const restoredRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount: 嘗試還原一次
  useEffect(() => {
    if (!enabled) return;
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        onRestore(parsed as T);
      }
    } catch {
      // ignore corrupt JSON
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Value 變動時 debounce 寫入
  useEffect(() => {
    if (!enabled) return;
    if (!restoredRef.current) return; // 還沒嘗試還原前不寫，避免空 value 蓋掉草稿
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      try {
        // 全部欄位都是空時不寫入，避免留下空殼
        const hasContent = Object.values(value).some((v) => {
          if (v == null) return false;
          if (typeof v === 'string') return v.trim() !== '';
          if (typeof v === 'number') return true;
          if (typeof v === 'boolean') return v;
          return true;
        });
        if (hasContent) {
          sessionStorage.setItem(key, JSON.stringify(value));
        } else {
          sessionStorage.removeItem(key);
        }
      } catch {
        // storage may be full or disabled
      }
    }, debounceMs);

    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, [key, value, debounceMs, enabled]);

  const discard = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* noop */
    }
  };

  return { discard };
}
