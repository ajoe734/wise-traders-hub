/**
 * FreeCheckup pure constants & helpers
 * Extracted from src/pages/FreeCheckup.jsx (lines 40-462) to reduce the
 * monolith's size and improve HMR / edit speed. No React state — only
 * pure functions, constants, and module-level side effects (auth listener,
 * session token cache) that previously lived at module top.
 *
 * IMPORTANT — inline 憲法仍適用：JSX 與 React hooks 留在 FreeCheckup.jsx；
 * 這個檔案只負責「不依賴 component state」的部分。
 */
import { memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INIT_HOLDINGS as SEED_HOLDINGS } from "@/checkup/seedData";
import { L as ThemeL } from "@/checkup/theme";
import { useRenderCounter } from "@/checkup/hooks/useRenderCounter";

// #region Constants & Helpers — 政策、顏色、種子、純函式（不依賴 React state）
export const SUPABASE_FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// ── AI 失敗分類 ─────────────────────────────────────
// 將 attempts 歸類為：quota(402) / rateLimit(429) / serverError(5xx) / modelUnavailable(404/400 model) / network / other
export function classifyAttempt(a) {
  if (a?.ok) return { kind: 'ok', label: '成功', tone: 'up' };
  const s = Number(a?.status) || 0;
  const body = String(a?.errorBody || a?.errorMessage || '').toLowerCase();
  if (s === 402 || body.includes('payment_required') || body.includes('not enough credits') || body.includes('insufficient')) {
    return { kind: 'quota', label: '配額用盡 (402)', tone: 'amber' };
  }
  if (s === 429 || body.includes('rate limit') || body.includes('quota') || body.includes('exceeded')) {
    return { kind: 'rateLimit', label: '限流 (429)', tone: 'amber' };
  }
  if (s === 503 || body.includes('unavailable') || body.includes('overloaded') || body.includes('high demand')) {
    return { kind: 'serverBusy', label: '服務忙碌 (503)', tone: 'amber' };
  }
  if (s >= 500) return { kind: 'serverError', label: `服務端錯誤 (${s})`, tone: 'down' };
  if (s === 404 || body.includes('not found') || body.includes('model')) {
    return { kind: 'modelUnavailable', label: `模型不可用 (${s || '—'})`, tone: 'down' };
  }
  if (s === 401 || s === 403) return { kind: 'auth', label: `認證失敗 (${s})`, tone: 'down' };
  if (!s) return { kind: 'network', label: '網路錯誤', tone: 'down' };
  return { kind: 'other', label: `其他 (${s})`, tone: 'down' };
}

// 失敗分類 → 重試規則對應表
export const RETRY_POLICY = {
  quota:            { maxRetries: 0, waitSec: 0,    switchPath: 'yes',      desc: '配額用盡，重試無意義' },
  rateLimit:        { maxRetries: 3, waitSec: 60,   switchPath: 'optional', desc: '指數退避：60s → 120s → 240s' },
  serverBusy:       { maxRetries: 3, waitSec: 30,   switchPath: 'optional', desc: '指數退避：30s → 60s → 120s' },
  serverError:      { maxRetries: 2, waitSec: 15,   switchPath: 'optional', desc: '短退避後重試' },
  modelUnavailable: { maxRetries: 0, waitSec: 0,    switchPath: 'no',       desc: '改用其他模型名稱' },
  auth:             { maxRetries: 0, waitSec: 0,    switchPath: 'no',       desc: '檢查並更新 API Key' },
  network:          { maxRetries: 5, waitSec: 5,    switchPath: 'no',       desc: '檢查網路後重試' },
  other:            { maxRetries: 1, waitSec: 10,   switchPath: 'optional', desc: '回報並查看 logs' },
};

export const SOURCE_TO_FN = {
  predict: 'checkup-predict-events',
  calendar: 'checkup-calendar',
};

export function deriveSuggestion(attempts, source) {
  if (!attempts?.length) return null;
  const kinds = attempts.map(classifyAttempt);
  if (kinds.some(k => k.kind === 'ok')) return null;
  const gw = attempts.filter(a => a.path === 'gateway');
  const direct = attempts.filter(a => a.path === 'gemini-direct');
  const gwAllQuota = gw.length > 0 && gw.every(a => classifyAttempt(a).kind === 'quota');
  const directAllQuota = direct.length > 0 && direct.every(a => ['quota','rateLimit'].includes(classifyAttempt(a).kind));

  const order = ['auth','modelUnavailable','quota','rateLimit','serverBusy','serverError','network','other'];
  let primary = 'other';
  for (const k of order) {
    if (kinds.some(x => x.kind === k)) { primary = k; break; }
  }
  const policy = RETRY_POLICY[primary] || RETRY_POLICY.other;

  let text;
  let tone = policy.maxRetries === 0 ? 'down' : 'amber';
  if (gwAllQuota && directAllQuota) {
    text = 'Gateway 與直連配額皆用盡：補值 Lovable Gateway 或升級 Gemini API 方案後再試。';
    tone = 'down';
  } else if (gwAllQuota && direct.length === 0) {
    text = 'Lovable Gateway 配額用盡：建議立即切換直連 Gemini（無需等待）。';
  } else if (primary === 'rateLimit') {
    text = `限流：等待 ${policy.waitSec}s 後重試，最多 ${policy.maxRetries} 次（指數退避）。`;
  } else if (primary === 'serverBusy') {
    text = `服務忙碌：等待 ${policy.waitSec}s 後重試，可考慮切換另一條路徑。`;
  } else if (primary === 'modelUnavailable') {
    text = '模型不可用：請改用其他模型（如 gemini-2.5-flash），勿原樣重試。';
  } else if (primary === 'auth') {
    text = '認證失敗：檢查 LOVABLE_API_KEY 或 GOOGLE_GEMINI_API_KEY 是否有效，重試無意義。';
  } else if (primary === 'serverError') {
    text = `服務端錯誤：等待 ${policy.waitSec}s 後重試最多 ${policy.maxRetries} 次。`;
  } else if (primary === 'network') {
    text = `網路錯誤：檢查連線後等待 ${policy.waitSec}s 重試（最多 ${policy.maxRetries} 次）。`;
  } else {
    text = '多種錯誤混合：建議延後重試；持續失敗請切換直連或檢查金鑰。';
  }

  const fn = SOURCE_TO_FN[source] || 'checkup-predict-events';
  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co'}/functions/v1/${fn}`;
  const curl =
`curl -X POST '${baseUrl}?debug=1' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_ANON_KEY' \\
  -d '{"debug": true${primary === 'modelUnavailable' ? ', "model": "google/gemini-2.5-flash"' : ''}}'`;

  return { tone, text, primary, policy, curl };
}

// ── 目標價資料庫（分析師共識）─────────────────────────────────────
// reports: [{firm, target, date}]  avg 自動計算
export const INIT_TARGETS = {
  "1503": { reports:[{firm:"自行估算",target:260,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "1717": { reports:[{firm:"自行估算",target:75,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "2308": { reports:[{firm:"元大",target:1200,date:"2026/01"},{firm:"富邦",target:1150,date:"2026/02"}], updatedAt:"2026/02/10", isNew:false },
  "2313": { reports:[{firm:"凱基",target:280,date:"2026/01"},{firm:"FactSet共識",target:280,date:"2026/01"}], updatedAt:"2026/01/15", isNew:false },
  "2543": { reports:[{firm:"自行估算",target:90,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "3006": { reports:[{firm:"華南投顧",target:200,date:"2026/03/11"},{firm:"法人A",target:205,date:"2026/03/16"},{firm:"法人B",target:246,date:"2026/03/16"}], updatedAt:"2026/03/16", isNew:true },
  "3013": { reports:[{firm:"自行估算",target:120,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "3017": { reports:[{firm:"國際共識",target:2037,date:"2026/03"},{firm:"大摩",target:1800,date:"2025/11"},{firm:"大和",target:1840,date:"2025/10"}], updatedAt:"2026/03/17", isNew:true },
  "3231": { reports:[{firm:"中信投顧",target:195,date:"2026/03/16"}], updatedAt:"2026/03/16", isNew:true },
  "3443": { reports:[{firm:"中信投顧",target:3600,date:"2026/02"},{firm:"元大投顧",target:3400,date:"2026/02"},{firm:"大摩",target:3288,date:"2026/02"}], updatedAt:"2026/02/04", isNew:true },
  "3491": { reports:[{firm:"自行估算",target:1600,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "4583": { reports:[{firm:"自行估算",target:750,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "6274": { reports:[{firm:"中信投顧",target:710,date:"2026/03/12"}], updatedAt:"2026/03/12", isNew:true },
  "6770": { reports:[{firm:"自行估算",target:100,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "6862": { reports:[{firm:"自行估算",target:230,date:"2026/03"}], updatedAt:"2026/03/17", isNew:false },
  "8227": { reports:[{firm:"中信投顧",target:190,date:"2026/01/23"}], updatedAt:"2026/01/23", isNew:false },
};

export const avgTarget = (code) => {
  const d = INIT_TARGETS[code];
  if (!d || !d.reports.length) return null;
  return Math.round(d.reports.reduce((s,r)=>s+r.target,0) / d.reports.length);
};

// ── 初始持倉（空，由上傳成交明細產生）────────────────────────────
export const INIT_HOLDINGS = SEED_HOLDINGS;

export const INIT_WATCHLIST = [
  { code:"1513", name:"中興電",  price:158.5, target:193,  status:"等Q4財報",  catalyst:"3–4月財報",      note:"積極163–165元；保守155–160元；催化：台電GIS+台積電" },
  { code:"4588", name:"玖鼎電力",price:69.1,  target:154,  status:"持有中",    catalyst:"台電電表訂單",    note:"訂單排到2028；現價已偏高不追；持有者繼續抱" },
  { code:"6274", name:"台燿",    price:505,   target:710,  status:"⚡今日法說", catalyst:"3/18法說+財報",  note:"成本507；毛利率回沖→補足2/3；展望差→停損430" },
];

// EVENTS 不再寫死，由 AI 根據持倉動態產生，存於 calendarEvents state

// ── 事件分析資料庫 ────────────────────────────────────────────────
// 不再寫死，由行事曆自動同步並由 AI 產生預判
// status: "pending"=待觀察(>7天) / "verifying"=待驗證(≤7天,已有AI預測) / "past"=已發生
// pred: "up"=預測漲 / "down"=預測跌 / "neutral"=中性
// actual: "up"/"down"/"neutral"/null（null=尚未驗證）
// correct: true/false/null

// 使用統一主題
export const C = ThemeL;

// ── Workbench 配色 Token（僅用於 /free-checkup 持倉工作台，本頁破例採單色橘紅；不污染他頁）──
export const WB = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSoft: '#FAFAFA',
  ink: '#0A0A0A',
  inkSub: '#3A3A3A',
  inkMute: '#6B6862',
  inkLight: '#9B968D',
  hair: '#ECEAE5',
  hairStrong: '#D4D1C9',
  accent: '#FF4D1F',
  accentSoft: 'rgba(255,77,31,0.06)',
  // K 線：依台股慣例紅漲綠跌（獨立於損益色）
  klineUp: '#D93025',
  klineDown: '#1E8E3E',
};

export const wbTone = (n) => (Number(n) >= 0 ? WB.accent : WB.ink);
// P3-perf: 空 sparkline 共用 reference，避免 HoldingCard memo 因每次新陣列而失效
export const EMPTY_SPARK = Object.freeze([]);
// B-P2 (holdings audit 2026-05): holdings 為 null 時的單一空陣列 reference，
// 與 H 的 value-key memo 搭配，避免下游 9 個 useMemo 因每次空陣列而失效
export const EMPTY_HOLDINGS = Object.freeze([]);

// ── Sparkline：純 SVG，無依賴 ── (P3-perf: memo'd 避免持倉每秒 quote tick 重繪)
export const Sparkline = memo(function Sparkline({ data = [], width = 120, height = 36, color = WB.accent, strokeWidth = 1.4, opacity = 0.85 }) {
  // dev/test：全域彙總 Sparkline 實際渲染次數；生產環境 no-op
  useRenderCounter('Sparkline', { warnThreshold: 60 });
  const arr = Array.isArray(data) ? data.filter((n) => Number.isFinite(n)) : [];
  if (arr.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke={WB.hair} strokeWidth={1} strokeDasharray="2 3" />
      </svg>
    );
  }
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min || 1;
  const stepX = arr.length > 1 ? width / (arr.length - 1) : width;
  const points = arr.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = arr[arr.length - 1];
  const lastX = (arr.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        points={points.join(' ')}
      />
      <circle cx={lastX} cy={lastY} r={1.8} fill={color} opacity={Math.min(1, opacity + 0.1)} />
    </svg>
  );
});

export const TYPE_COLOR = {
  法說: C.blue,
  財報: C.cyan,
  營收: C.teal,
  催化: C.olive,
  操作: C.amber,
  總經: C.stone,
  權證: C.orange,
  除息: C.lavender,
};

export const MEMO_Q = {
  "買進": ["為什麼選這檔？核心邏輯是什麼？", "進場的技術或籌碼依據？", "出場計畫：目標價？停損價？"],
  "賣出": ["為什麼在這個價位賣？", "達成原本預期了嗎？", "這筆資金的下一步？"],
};

export const PARSE_PROMPT = `你是台股券商成交回報截圖的解析器。解析截圖中的每一筆交易，以JSON格式輸出，不輸出其他文字：
{"trades":[{"action":"買進或賣出","code":"代碼","name":"名稱","qty":股數,"price":成交價,"market_price":市價或現價或null,"amount":金額或null,"total_cost":成本或null,"fee":手續費或null}],"targetPriceUpdates":[{"code":"代碼","firm":"券商名稱","target":目標價數字,"date":"日期"}],"note":"有疑問時說明"}

【最重要規則】
1. price（成交價/成本價）必須完整保留原始小數位數，絕對不可四捨五入或省略！
   例如：截圖顯示 0.61 就輸出 0.61（不可寫成 0.6）；顯示 1.55 就輸出 1.55（不可寫成 1.5 或 2）；顯示 524.5 就輸出 524.5（不可寫成 524 或 525）。
2. market_price（市價/現價/即時價格）：截圖中若有「現價」「市價」「即時」「收盤」欄位，必須精確辨識並填入，同樣保留完整小數位數。若截圖中無此欄位則填 null。
3. qty（股數）必須精確，例如 3000股 就是 3000，2000股 就是 2000，2股 就是 2。
4. 權證名稱通常包含「購」「售」「牛」「熊」等字，其價格可能很小（如 0.61、1.55），務必精確辨識。
5. total_cost（成本）：截圖中若有「成本」欄位，必須精確辨識並填入整數金額。若截圖中無此欄位則填 null。
6. fee（手續費）：截圖中若有「手續費」欄位，必須精確辨識並填入整數金額。若截圖中無此欄位則填 null。
7. 若截圖其實是「持倉/庫存/未實現損益」列表，沒有明確顯示買進或賣出，仍要輸出 trades；此時 action 留空即可，不要亂猜賣出。

targetPriceUpdates：如果截圖中有提到分析師目標價或研究報告目標價，請一併擷取。否則為空陣列。`;

// ── helpers ─────────────────────────────────────────────────────
// calcPnlWithNet / calcNetSettlement / calcWeightedAvgCost / calcRemainingCostAfterPartialSell
// 已提取至 src/checkup/lib/holdingMath.ts（可測試純函數）
// 台股慣例：紅=漲/獲利，綠=跌/虧損
export const pc    = (p) => p==null ? C.textSec : p>=0 ? C.up : C.down;
export const pcBg  = (p) => p==null ? "transparent" : p>=0 ? C.upBg : C.downBg;
export const fmtN  = (n) => {
  if (n == null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return Math.abs(num) >= 10000 ? (num/10000).toFixed(1) + "萬" : num.toLocaleString();
};
export const card  = { background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" };
export const lbl   = { fontSize:11, color:C.textSec, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600, marginBottom:6 };

// 所有 pf-* key 的雲端同步 key 清單
export const CLOUD_SYNC_KEYS = [
  "pf-holdings-v2", "pf-targets-v1", "pf-news-events-v1",
  "pf-analysis-history-v1", "pf-reversal-v1", "pf-brain-v1", "pf-calendar-v1",
];

export const LOCAL_STORAGE_OWNER_KEY = "pf-storage-owner-v1";
export const SNAPSHOT_IMPORT_ACTION = "持倉匯入";

// 持倉數量上限：避免 AI 分析 token 爆量、UI 渲染卡頓、行事曆 / 事件預測超載
// 觸發點：截圖解析新增 / 手動新增 / 批次匯入。超過上限直接擋下並提示使用者整理。
export const MAX_HOLDINGS = 50;

export const inferHoldingType = (code, name = "") => {
  if (String(code || "").startsWith("00")) return "ETF";
  if (String(code || "").length === 6 || /(購|售|牛|熊)/.test(String(name || ""))) return "權證";
  return "股票";
};

export const normalizeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const isSameNumber = (a, b) => {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  return Math.abs(na - nb) < 0.0001;
};

export const DEMO_HOLDING_LOOKUP = new Map(INIT_HOLDINGS.map((holding) => [holding.code, holding]));
// Authenticated 模式下永遠不准混入 seed 個股的代碼黑名單（單一憲法來源）
export const DEMO_SEED_CODES = new Set(INIT_HOLDINGS.map((holding) => String(holding?.code || "").trim()).filter(Boolean));

export const isExactDemoHolding = (holding) => {
  const demoHolding = DEMO_HOLDING_LOOKUP.get(holding?.code);
  if (!demoHolding) return false;

  return (
    isSameNumber(holding?.qty, demoHolding.qty) &&
    isSameNumber(holding?.cost, demoHolding.cost) &&
    isSameNumber(holding?.price, demoHolding.price) &&
    isSameNumber(holding?.value, demoHolding.value) &&
    isSameNumber(holding?.pnl, demoHolding.pnl) &&
    isSameNumber(holding?.pct, demoHolding.pct)
  );
};

// 是否有「真實使用者來源」標記。只要任一為真，視為使用者真的持有此代號，不剔除。
export const holdingHasUserOrigin = (holding) => {
  if (!holding) return false;
  if (holding.userOrigin === true) return true;
  if (holding.tradeLogTouched === true) return true;
  const src = String(holding.priceSource || "").toLowerCase();
  if (src === "screenshot" || src === "manual") return true;
  return false;
};

// authenticated 入口統一打標：使用者真的動到這筆持倉時呼叫。
export const markUserOwnedHolding = (holding) => {
  if (!holding || typeof holding !== "object") return holding;
  if (holding.userOrigin === true) return holding;
  return { ...holding, userOrigin: true };
};

/**
 * 剔除 demo seed 殘留。
 * - 未登入 demo 模式請勿呼叫（demo 模式應保留 seed）。
 * - authenticated 模式：只要 code 命中 DEMO_SEED_CODES，且該筆沒有任何使用者來源標記，一律剔除。
 *   舊「全欄位等值比對」會被 realtime 報價 / backfill 改寫後失效，故已淘汰，僅留 isExactDemoHolding 給 demo 內部使用。
 */
export const stripDemoSeedHoldings = (holdingsList = []) =>
  (Array.isArray(holdingsList) ? holdingsList : []).filter((holding) => {
    const code = String(holding?.code || "").trim();
    if (!code) return false;
    if (!DEMO_SEED_CODES.has(code)) return true;
    return holdingHasUserOrigin(holding);
  });

export const getHoldingCodesKey = (holdingsList = []) =>
  (Array.isArray(holdingsList) ? holdingsList : [])
    .map((holding) => String(holding?.code || "").trim())
    .filter(Boolean)
    .sort()
    .join(",");

export const setLocalStorageOwner = (userId) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_OWNER_KEY, userId || "demo");
  } catch {}
};

export const loadScopedLocal = (key, fallback, userId) => {
  if (!userId) return loadLocal(key, fallback);
  try {
    const ownerId = localStorage.getItem(LOCAL_STORAGE_OWNER_KEY);
    if (ownerId !== userId) return fallback;
  } catch {
    return fallback;
  }
  return loadLocal(key, fallback);
};

export async function loadAllFromCloud(userId) {
  if (!userId) return {};
  try {
    const { data: rows } = await supabase
      .from("checkup_storage")
      .select("key, data")
      .eq("user_id", userId)
      .in("key", CLOUD_SYNC_KEYS);
    const map = {};
    (rows || []).forEach(r => { map[r.key] = r.data; });
    return map;
  } catch { return {}; }
}

export function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

let _currentUserId = null;
export function setCurrentUserId(uid) { _currentUserId = uid; }
export function getCurrentUserId() { return _currentUserId; }

export async function save(key, data, userId) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
  const uid = userId || _currentUserId;
  if (uid) setLocalStorageOwner(uid);
  if (!uid) return;
  // 雲端同步（fire-and-forget）
  try {
    supabase.from("checkup_storage").upsert(
      { user_id: uid, key, data: data ?? {}, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    ).then(() => {});
  } catch {}
}

// ── 配額顯示工具 ──────────────────────────────────────────────────
// 計算「距離重置」倒數文字（自然週/月，UTC+8 — RPC 已用 Asia/Taipei）
export function formatResetCountdown(resetsAt) {
  if (!resetsAt) return "";
  const target = new Date(resetsAt).getTime();
  if (!Number.isFinite(target)) return "";
  const now = Date.now();
  const ms = target - now;
  if (ms <= 0) return "即將重置";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days >= 1) return `${days} 天 ${hours} 小時後重置`;
  if (hours >= 1) return `${hours} 小時 ${mins} 分後重置`;
  return `${mins} 分鐘後重置`;
}
// 將 resets_at 格式化為 YYYY/MM/DD HH:mm（依專案日期規範）
export function formatResetDateTime(resetsAt) {
  if (!resetsAt) return "";
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}
// 解析後端回應，判斷是否為個人配額用盡（QUOTA_EXCEEDED）
// 回傳 true 代表已是配額用盡，呼叫端應彈 modal 而非當錯誤處理
export async function isQuotaExceeded(res) {
  if (!res || res.status !== 429) return false;
  try {
    const cloned = res.clone();
    const body = await cloned.json().catch(() => null);
    if (!body) return false;
    const code = body.code || body.error_code || body.error?.code;
    const msg = String(body.error || body.message || body.detail || "");
    return code === "QUOTA_EXCEEDED" || msg.includes("QUOTA_EXCEEDED");
  } catch {
    return false;
  }
}

// 取得 AI edge function 呼叫所需的 Authorization header（配額辨識用）
// Session 快取 60 秒，避免每次 AI 呼叫都打一次 supabase.auth.getSession()（mount 時數十次）
let _sessionCache = { token: null, ts: 0 };
const SESSION_TTL = 60_000;
export async function aiAuthHeaders() {
  const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  try {
    const now = Date.now();
    let token = _sessionCache.token;
    if (!token || now - _sessionCache.ts > SESSION_TTL) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || null;
      _sessionCache = { token, ts: now };
    }
    if (token) return { Authorization: `Bearer ${token}`, apikey: ANON };
    return { Authorization: `Bearer ${ANON}`, apikey: ANON };
  } catch {
    return { Authorization: `Bearer ${ANON}`, apikey: ANON };
  }
}
// Auth 狀態變動時清除 session cache（登入/登出/refresh）
try {
  supabase.auth.onAuthStateChange((_evt, session) => {
    _sessionCache = { token: session?.access_token || null, ts: Date.now() };
  });
} catch {}
