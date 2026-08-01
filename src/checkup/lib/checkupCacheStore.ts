/**
 * checkupCacheStore — 持倉看板唯一的「本地快取」深模組（候選 B）。
 *
 * 為什麼存在：抽屜的資料曾散在三套互不相識的快取裡 ——
 *   1. 記憶體 Map（籌碼面，已於候選 A 交給 TanStack Query）
 *   2. localStorage 手刻讀寫（權威價鏡像）
 *   3. 元件 state（sparkline，重整即消失、換頁即重抓）
 * 每一套都有自己的 TTL 語意、序列化錯誤處理、跨分頁行為與逐出策略，
 * 導致「為什麼這筆資料還在／不在」永遠要開三個檔案才能回答。
 *
 * 這裡把它收斂成兩種命名空間，介面刻意極小：
 *   - createCacheNamespace<T>()：key → value 的多筆快取（TTL + LRU + 跨分頁同步）
 *   - createDocumentCache<T>()：單一文件（整包物件）的快取，保留既有 storage 格式
 *
 * 鐵則：
 *   - 所有 storage 例外都在這裡吞掉，呼叫端永遠不需要 try/catch。
 *   - SSR / 無 localStorage 環境自動退化成純記憶體，行為一致。
 *   - 命中率統計集中在 `getCheckupCacheStats()`，供 telemetry 與除錯使用。
 */

const PREFIX = 'lf.checkup.cache';

export interface CacheEntry<T> {
  value: T;
  /** 寫入時間（epoch ms） */
  updatedAt: number;
  /** 是否已超過 TTL（TTL 未設定時恆為 false） */
  stale: boolean;
  /** 距今毫秒數 */
  ageMs: number;
}

export interface CacheNamespace<T> {
  readonly name: string;
  /** 取值；已過 TTL 回傳 null（要讀過期值請用 getEntry）。 */
  get(key: string): T | null;
  /** 取完整條目，含 stale 標記；不存在回傳 null。 */
  getEntry(key: string): CacheEntry<T> | null;
  set(key: string, value: T): void;
  setMany(entries: Record<string, T>): void;
  /** 只取仍新鮮的鍵，配合 `missing()` 決定要打幾次網路。 */
  getMany(keys: string[]): Record<string, T>;
  /** 傳入想要的鍵，回傳其中「快取沒有或已過期」的鍵。 */
  missing(keys: string[]): string[];
  delete(key: string): void;
  clear(): void;
  keys(): string[];
  /** 任何寫入／清除後通知；回傳 unsubscribe。 */
  subscribe(listener: () => void): () => void;
}

export interface CacheNamespaceOptions {
  /** 命名空間名稱，決定 storage key：`lf.checkup.cache.<name>.v<version>`。 */
  name: string;
  /** 存活時間；未設定代表永不過期。 */
  ttlMs?: number;
  /** 結構版本；改版即自動作廢舊資料。 */
  version?: number;
  /** 是否寫入 localStorage（預設 true）。 */
  persist?: boolean;
  /** 最多保留幾筆，超過以最舊優先逐出（預設 300）。 */
  maxEntries?: number;
}

interface RawEntry<T> {
  v: T;
  t: number;
}

type Stats = { hit: number; miss: number; stale: number; evicted: number; writes: number };

const stats = new Map<string, Stats>();

function bump(name: string, field: keyof Stats, by = 1) {
  const s = stats.get(name) ?? { hit: 0, miss: 0, stale: 0, evicted: 0, writes: 0 };
  s[field] += by;
  stats.set(name, s);
}

/** 各命名空間的命中統計（測試與 telemetry 用）。 */
export function getCheckupCacheStats(): Record<string, Stats> {
  return Object.fromEntries([...stats.entries()].map(([k, v]) => [k, { ...v }]));
}

export function resetCheckupCacheStats(): void {
  stats.clear();
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

const namespaces = new Map<string, CacheNamespace<any>>();

export function createCacheNamespace<T>(opts: CacheNamespaceOptions): CacheNamespace<T> {
  const { name, ttlMs, version = 1, persist = true, maxEntries = 300 } = opts;
  const cached = namespaces.get(name);
  if (cached) return cached as CacheNamespace<T>;

  const storageKey = `${PREFIX}.${name}.v${version}`;
  const mem = new Map<string, RawEntry<T>>();
  const listeners = new Set<() => void>();
  let loaded = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function load() {
    if (loaded) return;
    loaded = true;
    if (!persist || !hasStorage()) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, RawEntry<T>>;
      for (const [k, e] of Object.entries(parsed || {})) {
        if (e && typeof e.t === 'number') mem.set(k, e);
      }
    } catch {
      /* 壞掉的 payload 直接忽略，等下次寫入覆蓋 */
    }
  }

  function scheduleFlush() {
    if (!persist || !hasStorage()) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      try {
        localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(mem)));
      } catch {
        // 空間不足 → 先砍一半最舊的再試一次，仍失敗就只留記憶體版本
        try {
          const half = Math.ceil(mem.size / 2);
          [...mem.keys()].slice(0, half).forEach((k) => mem.delete(k));
          localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(mem)));
        } catch {
          /* memory-only */
        }
      }
    }, 0);
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* listener 自己的錯不該炸掉寫入端 */
      }
    });
  }

  function evict() {
    if (mem.size <= maxEntries) return;
    const sorted = [...mem.entries()].sort((a, b) => a[1].t - b[1].t);
    const drop = mem.size - maxEntries;
    for (let i = 0; i < drop; i++) mem.delete(sorted[i][0]);
    bump(name, 'evicted', drop);
  }

  function entryOf(key: string): CacheEntry<T> | null {
    load();
    const raw = mem.get(key);
    if (!raw) return null;
    const ageMs = Date.now() - raw.t;
    const stale = ttlMs != null && ageMs > ttlMs;
    return { value: raw.v, updatedAt: raw.t, stale, ageMs };
  }

  const ns: CacheNamespace<T> = {
    name,
    getEntry: entryOf,
    get(key) {
      const e = entryOf(key);
      if (!e) {
        bump(name, 'miss');
        return null;
      }
      if (e.stale) {
        bump(name, 'stale');
        return null;
      }
      bump(name, 'hit');
      return e.value;
    },
    set(key, value) {
      load();
      mem.set(key, { v: value, t: Date.now() });
      bump(name, 'writes');
      evict();
      scheduleFlush();
      notify();
    },
    setMany(entries) {
      load();
      const now = Date.now();
      let n = 0;
      for (const [k, v] of Object.entries(entries || {})) {
        mem.set(k, { v, t: now });
        n += 1;
      }
      if (!n) return;
      bump(name, 'writes', n);
      evict();
      scheduleFlush();
      notify();
    },
    getMany(keys) {
      const out: Record<string, T> = {};
      for (const k of keys) {
        const v = ns.get(k);
        if (v != null) out[k] = v;
      }
      return out;
    },
    missing(keys) {
      return keys.filter((k) => {
        const e = entryOf(k);
        return !e || e.stale;
      });
    },
    delete(key) {
      load();
      if (mem.delete(key)) {
        scheduleFlush();
        notify();
      }
    },
    clear() {
      mem.clear();
      loaded = true;
      if (persist && hasStorage()) {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
      notify();
    },
    keys() {
      load();
      return [...mem.keys()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  namespaces.set(name, ns);
  return ns;
}

/** 測試用：丟掉已建立的命名空間實例（下次 create 會重新讀 storage）。 */
export function __resetCacheNamespaces(): void {
  namespaces.clear();
}

/* ---------------------------------------------------------------------------
 * Document cache — 單一文件（整包物件）的記憶體 + localStorage 兩層快取。
 * 給「本來就以一個 JSON 物件落地、且格式不能變」的既有資料用（例如權威價鏡像）。
 * ------------------------------------------------------------------------- */

export interface DocumentCache<T> {
  read(): T;
  write(value: T): T;
  reset(): void;
}

export function createDocumentCache<T>(opts: {
  /** 完整 storage key（不加前綴，維持既有格式相容）。 */
  storageKey: string;
  /** 讀不到／解析失敗時的初始值工廠。 */
  empty: () => T;
}): DocumentCache<T> {
  const { storageKey, empty } = opts;
  let memory: T = empty();
  let raw: string | null = null;
  let primed = false;

  function read(): T {
    if (!hasStorage()) {
      if (!primed) primed = true;
      return memory;
    }
    try {
      const next = localStorage.getItem(storageKey);
      if (primed && next === raw) return memory;
      primed = true;
      raw = next;
      memory = next ? ((JSON.parse(next) as T) ?? empty()) : empty();
    } catch {
      memory = empty();
    }
    return memory;
  }

  function write(value: T): T {
    memory = value;
    primed = true;
    try {
      const serialized = JSON.stringify(value);
      raw = serialized;
      if (hasStorage()) localStorage.setItem(storageKey, serialized);
    } catch {
      /* storage 滿了／不可用 —— 記憶體副本仍服務本次 session */
    }
    return memory;
  }

  function reset(): void {
    memory = empty();
    raw = null;
    primed = false;
    try {
      if (hasStorage()) localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  return { read, write, reset };
}
