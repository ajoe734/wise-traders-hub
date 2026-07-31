/**
 * prefsStore — localStorage 偏好設定的單一抽象（ADR-0001 深模組 / C5）
 *
 * 介面刻意很小：createPrefsStore(...) 回傳 { load, save, update, reset, subscribe }。
 * 背後藏起來的複雜度：
 *   - SSR / 無 localStorage 環境的安全降級（永遠回 defaults，不丟例外）
 *   - 版本欄位：schema 變更時舊資料自動丟棄或走 migrate()
 *   - 壞資料（非 JSON、非物件、null）一律回 defaults，不再靠呼叫端 try/catch
 *   - sanitize()：欄位型別校正，避免手改 localStorage 造成 UI 崩潰
 *   - 記憶體快取 + subscribe()，同頁多處讀取一致
 *
 * 儲存格式：{"__v":<version>,"data":{...}}。
 * 為了相容既有 key，讀到「沒有 __v 的裸物件」時視為 v1 資料（legacy）。
 */

export type PrefsMigrate<T> = (raw: unknown, fromVersion: number | null) => Partial<T> | null;

export interface PrefsStoreOptions<T extends object> {
  /** localStorage key */
  key: string;
  /** 預設值；load() 永遠以此為底做 merge */
  defaults: T;
  /** schema 版本，預設 1。版本不符且無 migrate 時丟棄舊資料 */
  version?: number;
  /** 版本不符時的資料轉換；回 null 代表放棄舊資料 */
  migrate?: PrefsMigrate<T>;
  /** 欄位校正（例如列舉值白名單）。在 merge defaults 之後執行 */
  sanitize?: (value: T) => T;
}

export interface PrefsStore<T extends object> {
  readonly key: string;
  readonly defaults: T;
  load(): T;
  /** 覆寫整份設定（會先 merge defaults + sanitize），回傳寫入後的值 */
  save(next: Partial<T>): T;
  /** 以目前值為底套用 patch */
  update(patch: Partial<T>): T;
  reset(): T;
  subscribe(fn: (value: T) => void): () => void;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function createPrefsStore<T extends object>(options: PrefsStoreOptions<T>): PrefsStore<T> {
  const { key, defaults, version = 1, migrate, sanitize } = options;
  const listeners = new Set<(value: T) => void>();
  let cache: T | null = null;

  const finalize = (partial: unknown): T => {
    const merged = { ...defaults, ...(isPlainObject(partial) ? (partial as Partial<T>) : {}) } as T;
    return sanitize ? sanitize(merged) : merged;
  };

  const read = (): T => {
    const ls = storage();
    if (!ls) return finalize(null);
    let raw: string | null = null;
    try {
      raw = ls.getItem(key);
    } catch {
      return finalize(null);
    }
    if (!raw) return finalize(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return finalize(null);
    }
    if (!isPlainObject(parsed)) return finalize(null);

    const hasEnvelope = Object.prototype.hasOwnProperty.call(parsed, '__v');
    const storedVersion = hasEnvelope ? Number(parsed.__v) : null;
    const payload = hasEnvelope ? parsed.data : parsed;

    if (storedVersion === version) return finalize(payload);

    // legacy（無 __v）視為與目前版本相容的裸物件；其餘走 migrate 或丟棄
    if (storedVersion === null && version === 1) return finalize(payload);
    if (migrate) {
      try {
        return finalize(migrate(payload, storedVersion));
      } catch {
        return finalize(null);
      }
    }
    return finalize(null);
  };

  const write = (value: T): T => {
    const ls = storage();
    if (ls) {
      try {
        ls.setItem(key, JSON.stringify({ __v: version, data: value }));
      } catch {
        /* quota / private mode — 記憶體快取仍有效 */
      }
    }
    cache = value;
    for (const fn of listeners) {
      try {
        fn(value);
      } catch {
        /* listener 不得影響寫入 */
      }
    }
    return value;
  };

  return {
    key,
    defaults,
    load() {
      if (!cache) cache = read();
      return { ...cache };
    },
    save(next) {
      return { ...write(finalize(next)) };
    },
    update(patch) {
      const base = this.load();
      return { ...write(finalize({ ...base, ...patch })) };
    },
    reset() {
      return { ...write(finalize(null)) };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
