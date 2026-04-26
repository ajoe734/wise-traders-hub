import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import Md from "@/checkup/components/Md";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useCheckupMode } from "@/checkup/contexts/CheckupModeContext";
import { DEMO_ANALYSIS, DEMO_BRAIN, DEMO_EVENTS } from "@/checkup/data/demoData";
import { INIT_HOLDINGS as SEED_HOLDINGS, STOCK_META, IND_COLOR } from "@/checkup/seedData";
import { C as ThemeC, L as ThemeL, A, alpha } from "@/checkup/theme";
import { calcWeightedAvgCost, calcNetSettlement, calcPnlWithNet, calcRemainingCostAfterPartialSell } from "@/checkup/lib/holdingMath";
import { buildDecision, sortByDecisionPriority, isEventOpen, getEffectiveStatus } from "@/checkup/lib/holdingEventUtils";
import { normalizeEventRecord } from "@/checkup/lib/eventUtils";
import { assignCardVariants } from "@/checkup/hooks/useHoldingDecision";

const SUPABASE_FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// ── AI 失敗分類 ─────────────────────────────────────
// 將 attempts 歸類為：quota(402) / rateLimit(429) / serverError(5xx) / modelUnavailable(404/400 model) / network / other
function classifyAttempt(a) {
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
const RETRY_POLICY = {
  quota:            { maxRetries: 0, waitSec: 0,    switchPath: 'yes',      desc: '配額用盡，重試無意義' },
  rateLimit:        { maxRetries: 3, waitSec: 60,   switchPath: 'optional', desc: '指數退避：60s → 120s → 240s' },
  serverBusy:       { maxRetries: 3, waitSec: 30,   switchPath: 'optional', desc: '指數退避：30s → 60s → 120s' },
  serverError:      { maxRetries: 2, waitSec: 15,   switchPath: 'optional', desc: '短退避後重試' },
  modelUnavailable: { maxRetries: 0, waitSec: 0,    switchPath: 'no',       desc: '改用其他模型名稱' },
  auth:             { maxRetries: 0, waitSec: 0,    switchPath: 'no',       desc: '檢查並更新 API Key' },
  network:          { maxRetries: 5, waitSec: 5,    switchPath: 'no',       desc: '檢查網路後重試' },
  other:            { maxRetries: 1, waitSec: 10,   switchPath: 'optional', desc: '回報並查看 logs' },
};

const SOURCE_TO_FN = {
  predict: 'checkup-predict-events',
  calendar: 'checkup-calendar',
};

function deriveSuggestion(attempts, source) {
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
    text = '🔴 Gateway 與直連配額皆用盡：補值 Lovable Gateway 或升級 Gemini API 方案後再試。';
    tone = 'down';
  } else if (gwAllQuota && direct.length === 0) {
    text = '🟡 Lovable Gateway 配額用盡：建議立即切換直連 Gemini（無需等待）。';
  } else if (primary === 'rateLimit') {
    text = `🟡 限流：等待 ${policy.waitSec}s 後重試，最多 ${policy.maxRetries} 次（指數退避）。`;
  } else if (primary === 'serverBusy') {
    text = `🟡 服務忙碌：等待 ${policy.waitSec}s 後重試，可考慮切換另一條路徑。`;
  } else if (primary === 'modelUnavailable') {
    text = '🔴 模型不可用：請改用其他模型（如 gemini-2.5-flash），勿原樣重試。';
  } else if (primary === 'auth') {
    text = '🔴 認證失敗：檢查 LOVABLE_API_KEY 或 GOOGLE_GEMINI_API_KEY 是否有效，重試無意義。';
  } else if (primary === 'serverError') {
    text = `🔴 服務端錯誤：等待 ${policy.waitSec}s 後重試最多 ${policy.maxRetries} 次。`;
  } else if (primary === 'network') {
    text = `🟡 網路錯誤：檢查連線後等待 ${policy.waitSec}s 重試（最多 ${policy.maxRetries} 次）。`;
  } else {
    text = '🟡 多種錯誤混合：建議延後重試；持續失敗請切換直連或檢查金鑰。';
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
const INIT_TARGETS = {
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

const avgTarget = (code) => {
  const d = INIT_TARGETS[code];
  if (!d || !d.reports.length) return null;
  return Math.round(d.reports.reduce((s,r)=>s+r.target,0) / d.reports.length);
};

// ── 初始持倉（空，由上傳成交明細產生）────────────────────────────
const INIT_HOLDINGS = SEED_HOLDINGS;

const INIT_WATCHLIST = [
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
const C = ThemeL;

// ── Workbench 配色 Token（僅用於 /free-checkup 持倉工作台，本頁破例採單色橘紅；不污染他頁）──
const WB = {
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
};
const wbTone = (n) => (Number(n) >= 0 ? WB.accent : WB.ink);

// ── Sparkline：純 SVG，無依賴 ──
function Sparkline({ data = [], width = 120, height = 36, color = WB.accent, strokeWidth = 1.4, opacity = 0.85 }) {
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
}

const TYPE_COLOR = {
  法說: C.blue,
  財報: C.cyan,
  營收: C.teal,
  催化: C.olive,
  操作: C.amber,
  總經: C.stone,
  權證: C.orange,
  除息: C.lavender,
};

const MEMO_Q = {
  "買進": ["為什麼選這檔？核心邏輯是什麼？", "進場的技術或籌碼依據？", "出場計畫：目標價？停損價？"],
  "賣出": ["為什麼在這個價位賣？", "達成原本預期了嗎？", "這筆資金的下一步？"],
};

const PARSE_PROMPT = `你是台股券商成交回報截圖的解析器。解析截圖中的每一筆交易，以JSON格式輸出，不輸出其他文字：
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
const pc    = (p) => p==null ? C.textMute : p>=0 ? C.up : C.down;
const pcBg  = (p) => p==null ? "transparent" : p>=0 ? C.upBg : C.downBg;
const fmtN  = (n) => n==null?"—":Math.abs(n)>=10000?(n/10000).toFixed(1)+"萬":n.toLocaleString();
const card  = { background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" };
const lbl   = { fontSize:11, color:C.textMute, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:400, marginBottom:6 };

// 所有 pf-* key 的雲端同步 key 清單
const CLOUD_SYNC_KEYS = [
  "pf-holdings-v2", "pf-targets-v1", "pf-news-events-v1",
  "pf-analysis-history-v1", "pf-reversal-v1", "pf-brain-v1", "pf-calendar-v1",
];

const LOCAL_STORAGE_OWNER_KEY = "pf-storage-owner-v1";
const SNAPSHOT_IMPORT_ACTION = "持倉匯入";

// 持倉數量上限：避免 AI 分析 token 爆量、UI 渲染卡頓、行事曆 / 事件預測超載
// 觸發點：截圖解析新增 / 手動新增 / 批次匯入。超過上限直接擋下並提示使用者整理。
const MAX_HOLDINGS = 50;

const inferHoldingType = (code, name = "") => {
  if (String(code || "").startsWith("00")) return "ETF";
  if (String(code || "").length === 6 || /(購|售|牛|熊)/.test(String(name || ""))) return "權證";
  return "股票";
};

const normalizeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isSameNumber = (a, b) => {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  return Math.abs(na - nb) < 0.0001;
};

const DEMO_HOLDING_LOOKUP = new Map(INIT_HOLDINGS.map((holding) => [holding.code, holding]));

const isExactDemoHolding = (holding) => {
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

const stripDemoSeedHoldings = (holdingsList = []) =>
  (Array.isArray(holdingsList) ? holdingsList : []).filter((holding) => !isExactDemoHolding(holding));

const getHoldingCodesKey = (holdingsList = []) =>
  (Array.isArray(holdingsList) ? holdingsList : [])
    .map((holding) => String(holding?.code || "").trim())
    .filter(Boolean)
    .sort()
    .join(",");

const setLocalStorageOwner = (userId) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_OWNER_KEY, userId || "demo");
  } catch {}
};

const loadScopedLocal = (key, fallback, userId) => {
  if (!userId) return loadLocal(key, fallback);
  try {
    const ownerId = localStorage.getItem(LOCAL_STORAGE_OWNER_KEY);
    if (ownerId !== userId) return fallback;
  } catch {
    return fallback;
  }
  return loadLocal(key, fallback);
};

async function loadAllFromCloud(userId) {
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

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

let _currentUserId = null;
function setCurrentUserId(uid) { _currentUserId = uid; }

async function save(key, data, userId) {
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

// ── Main ─────────────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();
  const { isDemo, isReady: authReady, canUpload, hasReachedDailyLimit, startLineLogin, incrementUploadCount, lineProfile, demoData } = useCheckupMode();
  const [tab, setTab]     = useState("holdings");
  const [ready, setReady] = useState(false);

  // persistent state
  const [holdings,  setHoldings]  = useState(null);
  const [tradeLog,  setTradeLog]  = useState(null);
  const [targets,   setTargets]   = useState(null);

  // upload / memo
  const [img, setImg]           = useState(null);
  const [b64, setB64]           = useState(null);
  const [parsing, setParsing]   = useState(false);
  const [parsed,  setParsed]    = useState(null);
  const [parseErr,setParseErr]  = useState(null);
  // 解析/同步進度追蹤：{ stage, label, progress(0-100), detail }
  // stage: 'upload' | 'ai' | 'retry' | 'persist' | 'refresh' | 'done' | 'error'
  const [parseStep, setParseStep] = useState(null);
  // 報價刷新狀態：{ phase, total, ok, fail, missingNames }
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [dragOver,setDragOver]  = useState(false);
  const [memoStep,setMemoStep]  = useState(0);
  const [memoAns, setMemoAns]   = useState([]);
  const [memoIn,  setMemoIn]    = useState("");
  const [saved,   setSaved]     = useState("");

  // dashboard UI
  const [sortBy,      setSortBy]      = useState("decision");
  const [viewMode,    setViewMode]    = useState("grid"); // 'grid' | 'list'
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filterType,  setFilterType]  = useState("全部");
  const [showAll,     setShowAll]     = useState(false);
  // Viewport-aware grid columns（繞過 CSS cascade 在某些 Chromium dev/preview 環境
  // 下對 `<style>` 內 `grid-template-columns: 1fr !important` 不生效的詭異問題）
  // 使用 useLayoutEffect 在 paint 前同步設定，避免 hydration race
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    // mount 後立即同步一次（覆寫 useState 初值，處理 SSR/hydration 落差）
    setVw(window.innerWidth);
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const cardGridCols = vw <= 640
    ? '1fr'
    : vw <= 1023
      ? 'repeat(2, minmax(0, 1fr))'
      : vw <= 1279
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(3, minmax(0, 1fr))';
  const [expandedNews, setExpandedNews] = useState(new Set());
  const [newsPendingExpanded, setNewsPendingExpanded] = useState(false);
  const [newsVerifyingExpanded, setNewsVerifyingExpanded] = useState(false);
  const [newsPastExpanded, setNewsPastExpanded] = useState(false);
  const [predictingEvents, setPredictingEvents] = useState(false);
  const toggleNews = (id) => setExpandedNews(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const [tpCode, setTpCode] = useState("");
  const [tpFirm, setTpFirm] = useState("");
  const [tpVal,  setTpVal]  = useState("");

  // refresh prices
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const REFRESH_COOLDOWN = 30 * 60 * 1000; // 30 minutes
  const [cooldownText, setCooldownText] = useState("");
  // 任務日誌：{ id, ts, task, status, attempt, detail } — 用於下載排錯
  const [syncLog, setSyncLog] = useState([]);
  // 持倉覆蓋率彈窗
  const [coverageOpen, setCoverageOpen] = useState(false);
  // 立即同步排程（呼叫 stock-price-sync edge function）
  const [serverSyncing, setServerSyncing] = useState(false);

  const appendLog = (entry) => {
    setSyncLog(prev => {
      const next = [{ id: Date.now() + Math.random(), ts: new Date().toISOString(), ...entry }, ...prev];
      return next.slice(0, 200); // 最多保留 200 筆
    });
  };

  const downloadSyncLog = () => {
    const lines = [
      `# Free Checkup 同步任務日誌 (${new Date().toLocaleString('zh-TW')})`,
      `# 共 ${syncLog.length} 筆事件`,
      '',
      ...syncLog.map(e => `[${e.ts}] ${e.task} | ${e.status}${e.attempt?` | 嘗試 ${e.attempt}`:''}${e.detail?` | ${e.detail}`:''}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freecheckup-sync-log-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 立即觸發後端排程：stock-price-sync
  const triggerServerSync = async () => {
    if (serverSyncing) return;
    setServerSyncing(true);
    appendLog({ task: 'server-sync', status: 'start', detail: '呼叫 stock-price-sync edge function' });
    const MAX = 3;
    let lastErr = '';
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_FN_BASE}/stock-price-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        appendLog({
          task: 'server-sync', status: 'ok', attempt,
          detail: `symbols=${data.symbols ?? '?'} fetched=${data.prices_fetched ?? '?'}`
        });
        setSaved(`✅ 排程已執行：拉取 ${data.prices_fetched ?? 0} 檔報價`);
        setTimeout(() => setSaved(''), 4000);
        // 後端 sync 完，前台再拉一次最新價
        setLastUpdate(null);
        setTimeout(() => { refreshPrices().catch(() => {}); }, 800);
        setServerSyncing(false);
        return;
      } catch (e) {
        lastErr = e?.message || '網路錯誤';
        appendLog({ task: 'server-sync', status: 'retry', attempt, detail: lastErr });
        if (attempt < MAX) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    appendLog({ task: 'server-sync', status: 'error', detail: `所有重試失敗：${lastErr}` });
    setSaved(`✕ 排程失敗：${lastErr}`);
    setTimeout(() => setSaved(''), 5000);
    setServerSyncing(false);
  };

  // Countdown timer for refresh cooldown
  useEffect(() => {
    if (!lastUpdate) { setCooldownText(""); return; }
    const tick = () => {
      const elapsed = Date.now() - lastUpdate.getTime();
      const remaining = REFRESH_COOLDOWN - elapsed;
      if (remaining <= 0) { setCooldownText(""); return; }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCooldownText(`${m}:${s.toString().padStart(2,"0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);

  // daily analysis
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeStep, setAnalyzeStep]   = useState("");
  const [dailyReport, setDailyReport]   = useState(null);
  const [analysisHistory, setAnalysisHistory] = useState(null);
  const [newsEvents, setNewsEvents]     = useState(() => isDemo ? DEMO_EVENTS : null);
  const [reviewingEvent, setReviewingEvent] = useState(null);
  const [reviewForm, setReviewForm]     = useState({actual:"up",actualNote:"",lessons:""});
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent]         = useState({date:"",title:"",detail:"",stocks:"",pred:"up",predReason:""});
  const [reversalConditions, setReversalConditions] = useState(null);
  const [strategyBrain, setStrategyBrain] = useState(null);
  const [cloudSync, setCloudSync]         = useState(false);
  const [calendarEvents, setCalendarEvents] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  // 自動更新狀態徽章：'idle' | 'fetching' | 'throttled' | 'skipped-idempotent' | 'aborted' | 'success' | 'error'
  const [calendarAutoStatus, setCalendarAutoStatus] = useState({ status: 'idle', msg: '' });
  const [predictAutoStatus, setPredictAutoStatus] = useState({ status: 'idle', msg: '' });
  const calendarStatusTimerRef = useRef(null);
  const predictStatusTimerRef = useRef(null);
  // 最近一次失敗錯誤明細：{ message, reason: 'network'|'data'|'server'|'unknown', at: ISOString }
  const [calendarLastError, setCalendarLastError] = useState(null);
  const [predictLastError, setPredictLastError] = useState(null);
  // AI 模型嘗試紀錄（debug）：{ source, at, attempts: [{path, model, status, ok, errorBody, errorMessage}], succeededWith }
  const [calendarLastDebug, setCalendarLastDebug] = useState(null);
  const [predictLastDebug, setPredictLastDebug] = useState(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  // 重試計數與冷卻：每連續失敗一次累計，達上限或冷卻期內禁止重試
  const RETRY_MAX = 3;
  const RETRY_COOLDOWN_MS = 15_000;
  const [calendarRetry, setCalendarRetry] = useState({ count: 0, cooldownUntil: 0 });
  const [predictRetry, setPredictRetry] = useState({ count: 0, cooldownUntil: 0 });
  // 更新日誌：記錄手動/自動觸發的時間、狀態、batchKey/requestKey，用於除錯
  // entry: { id, ts, source: 'calendar'|'predict', trigger: 'manual'|'auto', status, key, msg }
  const [updateLog, setUpdateLog] = useState([]);
  const [updateLogOpen, setUpdateLogOpen] = useState(false);
  const updateLogIdRef = useRef(0);
  const pushUpdateLog = (entry) => {
    setUpdateLog(prev => {
      const next = [{
        id: ++updateLogIdRef.current,
        ts: Date.now(),
        ...entry,
      }, ...prev];
      // 保留最近 50 筆
      return next.slice(0, 50);
    });
  };
  // 強制每秒 re-render 以更新冷卻倒數
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const inCooldown = calendarRetry.cooldownUntil > Date.now() || predictRetry.cooldownUntil > Date.now();
    if (!inCooldown) return;
    const t = setInterval(() => setNowTick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [calendarRetry.cooldownUntil, predictRetry.cooldownUntil]);
  // Decision System v6
  const [userOverrides, setUserOverrides] = useState({});
  const [expandedDecision, setExpandedDecision] = useState(null);
  const [debugMode, setDebugMode] = useState(false);
  const [sparklines, setSparklines] = useState({}); // { [code]: number[] }

  // ── 持倉資料庫（Notion 模式）：搜尋 / 篩選 / 排序方向 / Drawer ──
  const [searchQ, setSearchQ] = useState("");
  const [filterDecision, setFilterDecision] = useState(new Set()); // hold/review/exit
  const [filterThesis, setFilterThesis] = useState(new Set());     // intact/weakening/broken
  const [filterUrgency, setFilterUrgency] = useState(new Set());   // now/soon/monitor
  const [filterConflict, setFilterConflict] = useState(new Set()); // conflict/no_conflict
  const [filterPnl, setFilterPnl] = useState(new Set());           // win/loss/flat
  const [filterStrategy, setFilterStrategy] = useState(new Set()); // dynamic
  const [sortDir, setSortDir] = useState("desc");                  // asc / desc
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCode, setActiveCode] = useState(null);
  const [drawerSource, setDrawerSource] = useState(null); // {type:'priority-global'|'category'|'list'|'search', key?, label}
  const [draftNote, setDraftNote] = useState("");
  const [draftExitCue, setDraftExitCue] = useState("");
  const scrollPosRef = useRef(0);
  const draftDirtyRef = useRef(false);

  const toggleSetItem = (setter) => (val) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };
  const clearAllFilters = () => {
    setSearchQ("");
    setFilterDecision(new Set());
    setFilterThesis(new Set());
    setFilterUrgency(new Set());
    setFilterConflict(new Set());
    setFilterPnl(new Set());
    setFilterStrategy(new Set());
  };

  // reset guard — 清除全部後忽略 in-flight 的行事曆回應
  const resetGuardRef = useRef(0);
  // 追蹤是否為使用者主動操作（上傳截圖）造成的持倉變動
  const holdingsChangedByUserRef = useRef(false);

  // ── Calendar 節流與冪等控制 ──
  // - inflightKey：當下正在抓取的 holdingCodes，若相同則略過
  // - lastFetch：{ key, at } 上次成功完成的請求（30 秒內相同 key 視為重複）
  // - controller：保留中斷器，新請求進來會 abort 前一個
  const calendarInflightKeyRef = useRef(null);
  const calendarLastFetchRef = useRef({ key: null, at: 0 });
  const calendarAbortRef = useRef(null);
  const CALENDAR_DEDUP_MS = 30_000;

  // 錯誤分類：根據 Error/HTTP status/訊息內容判斷錯誤類型
  const classifyError = (err, httpStatus) => {
    if (httpStatus) {
      if (httpStatus >= 500) return { reason: 'server', label: '伺服器錯誤' };
      if (httpStatus === 429) return { reason: 'server', label: '請求過於頻繁' };
      if (httpStatus >= 400) return { reason: 'data', label: '資料錯誤' };
    }
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror')) {
      return { reason: 'network', label: '網路連線錯誤' };
    }
    if (msg.includes('timeout') || msg.includes('aborted')) return { reason: 'network', label: '請求逾時' };
    if (msg.includes('json') || msg.includes('parse')) return { reason: 'data', label: '資料解析錯誤' };
    return { reason: 'unknown', label: '未知錯誤' };
  };

  // 短暫顯示節流/冪等/結果狀態（fetching 持續到完成；其餘 4 秒後回 idle）
  const flashCalendarStatus = (status, msg = '') => {
    setCalendarAutoStatus({ status, msg });
    if (calendarStatusTimerRef.current) clearTimeout(calendarStatusTimerRef.current);
    if (status === 'success') {
      // 成功後重置重試計數與錯誤記錄
      setCalendarRetry({ count: 0, cooldownUntil: 0 });
      setCalendarLastError(null);
    }
    if (status !== 'fetching' && status !== 'idle') {
      calendarStatusTimerRef.current = setTimeout(() => setCalendarAutoStatus({ status: 'idle', msg: '' }), 4000);
    }
  };
  const flashPredictStatus = (status, msg = '') => {
    setPredictAutoStatus({ status, msg });
    if (predictStatusTimerRef.current) clearTimeout(predictStatusTimerRef.current);
    if (status === 'success') {
      setPredictRetry({ count: 0, cooldownUntil: 0 });
      setPredictLastError(null);
    }
    if (status !== 'fetching' && status !== 'idle') {
      predictStatusTimerRef.current = setTimeout(() => setPredictAutoStatus({ status: 'idle', msg: '' }), 4000);
    }
  };

  // 記錄錯誤明細並啟動冷卻；回傳是否仍在可重試範圍
  const recordCalendarError = (err, httpStatus) => {
    const { reason, label } = classifyError(err, httpStatus);
    const message = String(err?.message || err || '').slice(0, 240) || label;
    setCalendarLastError({ message, reason, label, at: new Date().toISOString() });
    setCalendarRetry(prev => {
      const count = prev.count + 1;
      const cooldownUntil = count >= RETRY_MAX
        ? Date.now() + RETRY_COOLDOWN_MS * 4   // 達上限：長冷卻
        : Date.now() + RETRY_COOLDOWN_MS;
      return { count, cooldownUntil };
    });
  };
  const recordPredictError = (err, httpStatus) => {
    const { reason, label } = classifyError(err, httpStatus);
    const message = String(err?.message || err || '').slice(0, 240) || label;
    setPredictLastError({ message, reason, label, at: new Date().toISOString() });
    setPredictRetry(prev => {
      const count = prev.count + 1;
      const cooldownUntil = count >= RETRY_MAX
        ? Date.now() + RETRY_COOLDOWN_MS * 4
        : Date.now() + RETRY_COOLDOWN_MS;
      return { count, cooldownUntil };
    });
  };

  const mapFallbackCodeToStatus = (code) => {
    if (code === 'AI_BILLING_REQUIRED') return 402;
    if (code === 'AI_RATE_LIMITED') return 429;
    if (code === 'AI_AUTH_FAILED') return 401;
    return 503;
  };

  // ── 根據持倉自動產生行事曆事件 ──
  const fetchCalendarEvents = async (holdingsList, guard, existingEvents = [], trigger = 'auto') => {
    if (!holdingsList || holdingsList.length === 0) {
      setCalendarEvents([]);
      save("pf-calendar-v1", { events: [], holdingCodes: "" });
      setCalendarAutoStatus({ status: 'idle', msg: '' });
      pushUpdateLog({ source:'calendar', trigger, status:'skipped', key:'(empty)', msg:'尚無持倉' });
      return;
    }
    const requestKey = holdingsList.map(h => h.code).sort().join(",");
    // 1) 同一個 key 已在飛行中 → 略過（避免併發）
    if (calendarInflightKeyRef.current === requestKey) {
      flashCalendarStatus('skipped-idempotent');
      pushUpdateLog({ source:'calendar', trigger, status:'skipped-idempotent', key:requestKey, msg:'同 key 進行中' });
      return;
    }
    // 2) 30 秒內剛抓過相同 key → 略過（節流）
    const last = calendarLastFetchRef.current;
    if (last.key === requestKey && Date.now() - last.at < CALENDAR_DEDUP_MS) {
      flashCalendarStatus('throttled');
      pushUpdateLog({ source:'calendar', trigger, status:'throttled', key:requestKey, msg:`30s 內已更新` });
      return;
    }
    // 3) 不同 key 但有舊請求飛行中 → 中斷之
    if (calendarAbortRef.current) {
      try { calendarAbortRef.current.abort(); } catch { /* noop */ }
      calendarAbortRef.current = null;
    }
    calendarInflightKeyRef.current = requestKey;
    setCalendarLoading(true);
    setCalendarAutoStatus({ status: 'fetching', msg: '' });
    pushUpdateLog({ source:'calendar', trigger, status:'fetching', key:requestKey, msg:`${holdingsList.length} 檔` });
    try {
      const stockList = holdingsList.map(h => `${h.code} ${h.name}`).join("、");
      const today = new Date().toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      const endDate = oneYearLater.toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");

      const controller = new AbortController();
      calendarAbortRef.current = controller;
      const timer = setTimeout(() => controller.abort(), 300000); // 5 min timeout
      const { newCorrelationId } = await import('../checkup/lib/correlationId.js');
      const cid = newCorrelationId('cal');
      const res = await fetch(`${SUPABASE_FN_BASE}/checkup-calendar?debug=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": cid },
        body: JSON.stringify({ stocks: stockList, today, endDate, debug: true }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const result = await res.json();
      if (result?.debug) {
        setCalendarLastDebug({ source: 'calendar', at: new Date().toISOString(), httpStatus: res.status, cid: result.cid || cid, ...result.debug });
      }
      if (guard !== undefined && guard !== resetGuardRef.current) {
        pushUpdateLog({ source:'calendar', trigger, status:'aborted', key:requestKey, msg:'guard 變更' });
        return;
      }
      if (result?.fallback) {
        const fallbackStatus = mapFallbackCodeToStatus(result.code);
        const fallbackErr = new Error(result.error || '行事曆暫時不可用');
        recordCalendarError(fallbackErr, fallbackStatus);
        flashCalendarStatus('error', result.error || '行事曆暫時不可用');
        pushUpdateLog({ source:'calendar', trigger, status:'error', key:requestKey, msg:result.error || `fallback (${result.code || 'unknown'})` });
        return;
      }
      const text = result.text || result.response || "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const newEvents = JSON.parse(jsonMatch[0]).filter(e => e && e.label);
        // 合併去重：以 label+date 為 key
        const existing = Array.isArray(existingEvents) ? existingEvents : [];
        const seen = new Set(existing.map(e => `${e.label}||${e.date}`));
        const merged = [...existing];
        for (const ne of newEvents) {
          const key = `${ne.label}||${ne.date}`;
          if (!seen.has(key)) { merged.push(ne); seen.add(key); }
        }
        merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        const holdingCodes = holdingsList.map(h => h.code).sort().join(",");
        merged._holdingCodes = holdingCodes;
        const saveObj = { events: merged, holdingCodes };
        save("pf-calendar-v1", saveObj);
        setCalendarEvents(merged);
        // 同步到事件分析
        syncCalendarToNews(merged);
      }
      calendarLastFetchRef.current = { key: requestKey, at: Date.now() };
      // 成功：重置重試計數與錯誤
      setCalendarRetry({ count: 0, cooldownUntil: 0 });
      setCalendarLastError(null);
      setCalendarAutoStatus({ status: 'idle', msg: '' });
      pushUpdateLog({ source:'calendar', trigger, status:'success', key:requestKey, msg:'完成' });
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error("Calendar fetch error:", e);
        recordCalendarError(e);
        const { label } = classifyError(e);
        flashCalendarStatus('error', label);
        pushUpdateLog({ source:'calendar', trigger, status:'error', key:requestKey, msg:label });
        throw e;
      } else {
        flashCalendarStatus('aborted');
        pushUpdateLog({ source:'calendar', trigger, status:'aborted', key:requestKey, msg:'AbortError' });
      }
    } finally {
      // 只有當前 key 還是這次請求的 key 才清除（避免被新請求覆寫後誤清）
      if (calendarInflightKeyRef.current === requestKey) {
        calendarInflightKeyRef.current = null;
      }
      if (calendarAbortRef.current && calendarAbortRef.current.signal.aborted === false) {
        // 保留：可能已被新請求覆寫，不主動清
      }
      setCalendarLoading(false);
    }
  };

  // ── 將行事曆事件自動同步至事件分析 ──────────────────────────────
  const syncCalendarToNews = (calEvents) => {
    if (!calEvents || !Array.isArray(calEvents)) return;
    setNewsEvents(prev => {
      const existing = prev || [];

      const makeKey = (label, date) => {
        const code = (label || "").match(/\d{4}/)?.[0] || "";
        const d = (date || "").replace(/[^\d]/g, "").slice(0, 8);
        const keywords = ["法說","財報","營收","除息","催化","配息","股利","展望","獲利"];
        const kw = keywords.find(k => (label || "").includes(k)) || "event";
        return `${code}-${kw}-${d}`;
      };

      // 1) 移除舊的行事曆同步項目（source === "calendar"），只保留手動或其他來源
      const manual = existing.filter(e => e.source !== "calendar");

      // 2) 對手動項目建立去重 set
      const seenKeys = new Map();
      manual.forEach(e => {
        const key = makeKey(e.title, e.date);
        if (key && key !== "--event-") seenKeys.set(key, true);
      });

      // 3) 新增不重複的行事曆事件，標記 source
      const newEntries = calEvents
        .filter(ce => {
          if (!ce.label) return false;
          const key = makeKey(ce.label, ce.date);
          if (seenKeys.has(key)) return false;
          seenKeys.set(key, true);
          return true;
        })
        .map(ce => {
          const codeMatch = ce.label.match(/\d{4}/);
          return {
            id: Date.now() + Math.random(),
            date: ce.date || "",
            title: ce.label,
            detail: ce.sub || "",
            stocks: codeMatch
              ? [{ code: codeMatch[0], name: ce.label.replace(/\d{4}/, "").replace(/[—\-\s]+/g, " ").trim() }]
              : [],
            pred: ce.pred || "neutral",
            predReason: ce.predReason || "",
            status: "pending",
            actual: null, actualNote: "", correct: null,
            source: "calendar",
          };
        });
      return [...manual, ...newEntries];
    });
  };

  // boot
  // 一次性清除所有舊版寫死持倉快取（v1 遷移標記）
  useEffect(() => {
    try {
      const migrated = localStorage.getItem("pf-holdings-v2-migrated");
      if (!migrated) {
        localStorage.removeItem("pf-holdings-v2");
        localStorage.setItem("pf-holdings-v2-migrated", "1");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!authReady) return; // wait for auth state to be determined
    (async () => {
      // ── Demo 模式：直接使用假資料 ──
      if (isDemo) {
        setLocalStorageOwner("demo");
        setHoldings(SEED_HOLDINGS);
        setTradeLog([]);
        setTargets(INIT_TARGETS);
        setNewsEvents(DEMO_EVENTS);
        setAnalysisHistory([]);
        setReversalConditions({});
        setStrategyBrain(DEMO_BRAIN);
        setCalendarEvents([]);
        setReady(true);
        return;
      }

      // ── 雲端優先：批次載入所有 pf-* key ──
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userId = currentUser?.id;
      if (userId) setCurrentUserId(userId);

      const wasReset = sessionStorage.getItem("pf-reset-flag") || localStorage.getItem("pf-reset-flag");
      if (wasReset) {
        sessionStorage.removeItem("pf-reset-flag");
        localStorage.removeItem("pf-reset-flag");
      }

      let cloud = {};
      if (!wasReset && userId) {
        cloud = await loadAllFromCloud(userId);
      }

      const pick = (key, fallback) => {
        if (Object.prototype.hasOwnProperty.call(cloud, key)) {
          if (userId) setLocalStorageOwner(userId);
          try { localStorage.setItem(key, JSON.stringify(cloud[key])); } catch {}
          return cloud[key];
        }
        return loadScopedLocal(key, fallback, userId);
      };

      const h = pick("pf-holdings-v2", []);
      const t = pick("pf-targets-v1", {});
      const ne = pick("pf-news-events-v1", []);
      const ah = pick("pf-analysis-history-v1", []);
      const rc = pick("pf-reversal-v1", {});
      const sb = pick("pf-brain-v1", null);
      const ceRaw = pick("pf-calendar-v1", null);

      let ce;
      if (ceRaw && !Array.isArray(ceRaw) && ceRaw.events) {
        ce = ceRaw.events;
        ce._holdingCodes = ceRaw.holdingCodes || "";
      } else {
        ce = ceRaw || [];
      }

      const sanitizedHoldings = stripDemoSeedHoldings(Array.isArray(h) ? h : []);
      const removedDemoSeedCount = (Array.isArray(h) ? h.length : 0) - sanitizedHoldings.length;
      const holdingCodesKey = getHoldingCodesKey(sanitizedHoldings);
      const storedCalendarHoldingCodes = Array.isArray(ce) ? (ce._holdingCodes || "") : "";
      const shouldRebuildDerivedEvents =
        holdingCodesKey.length > 0 &&
        (removedDemoSeedCount > 0 || storedCalendarHoldingCodes !== holdingCodesKey);
      const manualNewsEvents = (Array.isArray(ne) ? ne : []).filter((event) => event?.source !== "calendar");

      let l = [];
      try {
        const { data } = await supabase.from("checkup_trade_memos").select("*").order("created_at", { ascending: false });
        if (data && data.length > 0) {
          l = data.map(row => ({
            id: row.id,
            date: row.trade_date || "",
            time: row.trade_time || "",
            action: row.action || "",
            code: row.code || "",
            name: row.name || "",
            qty: row.qty != null ? Number(row.qty) : 0,
            price: row.price != null ? Number(row.price) : 0,
            qa: Array.isArray(row.qa) ? row.qa : [],
          }));
        } else {
          l = loadLocal("pf-log-v2", []);
        }
      } catch {
        l = loadLocal("pf-log-v2", []);
      }

      setHoldings(sanitizedHoldings); setTradeLog(l); setTargets(t);
      setStrategyBrain(sb); setCalendarEvents(shouldRebuildDerivedEvents ? [] : ce);

      const hasHoldings = sanitizedHoldings.length > 0;
      if (!hasHoldings) {
        setNewsEvents([]); setAnalysisHistory([]); setReversalConditions({});
        setStrategyBrain(null); setCalendarEvents([]);
        save("pf-news-events-v1", []); save("pf-analysis-history-v1", []);
        save("pf-reversal-v1", {}); save("pf-brain-v1", null); save("pf-calendar-v1", []);
        save("pf-targets-v1", {});
        setTargets({});
      } else {
        setNewsEvents(shouldRebuildDerivedEvents ? manualNewsEvents : ne);
        setAnalysisHistory(ah); setReversalConditions(rc);
      }
      setReady(true);
      setCloudSync(true);

      if (shouldRebuildDerivedEvents) {
        fetchCalendarEvents(sanitizedHoldings, resetGuardRef.current, []);
      }
    })();
  }, [authReady, isDemo]);

  // auto-save
  // 雲端 upsert debounce + 錯誤處理（避免快速操作時觸發過多請求）
  const cloudHoldingsTimerRef = useRef(null);
  const cloudHoldingsErrorShownRef = useRef(false);
  useEffect(() => {
    if (!(ready && holdings && !isDemo)) return;
    save("pf-holdings-v2", holdings);
    const uid = _currentUserId;
    if (!uid) return;
    if (cloudHoldingsTimerRef.current) clearTimeout(cloudHoldingsTimerRef.current);
    cloudHoldingsTimerRef.current = setTimeout(async () => {
      try {
        const codes = holdings.map(h => `${h.code} ${h.name}`).join("、");
        const codesKey = holdings.map(h => h.code).sort().join(",");
        const { error } = await supabase
          .from("checkup_storage")
          .upsert({ user_id: uid, key: "pf-calendar-holdings", data: { stocks: codes, holdingCodes: codesKey } }, { onConflict: "user_id,key" });
        if (error) throw error;
        cloudHoldingsErrorShownRef.current = false;
      } catch (e) {
        console.error("[cloud-sync] pf-holdings-v2 upsert failed:", e);
        if (!cloudHoldingsErrorShownRef.current) {
          cloudHoldingsErrorShownRef.current = true;
          toast.error("持倉雲端同步失敗，僅保存於本機");
        }
      }
    }, 800);
    return () => {
      if (cloudHoldingsTimerRef.current) clearTimeout(cloudHoldingsTimerRef.current);
    };
  }, [holdings, ready, isDemo, _currentUserId]);
  // tradeLog 存到 Supabase — 改用「scoped delete + insert」並加 debounce/錯誤通知
  // 重要：原本 .delete().neq() 沒帶 user_id 篩選，僅靠 RLS 保護；改為明確 .eq('user_id', ...) 雙保險
  const cloudTradeLogTimerRef = useRef(null);
  const cloudTradeLogErrorShownRef = useRef(false);
  const saveTradeLogToCloud = async (logs) => {
    if (!logs || !_currentUserId) return;
    const uid = _currentUserId;
    try {
      const rows = logs.map(l => ({
        ...(typeof l.id === "string" && l.id.length === 36 ? { id: l.id } : {}),
        user_id: uid,
        trade_date: l.date || null,
        trade_time: l.time || null,
        action: l.action || null,
        code: l.code || null,
        name: l.name || null,
        qty: l.qty != null ? l.qty : null,
        price: l.price != null ? l.price : null,
        qa: l.qa || [],
      }));
      // 僅刪除自己的資料（RLS + 顯式 user_id 雙重保險）
      const { error: delErr } = await supabase
        .from("checkup_trade_memos")
        .delete()
        .eq("user_id", uid);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("checkup_trade_memos").insert(rows);
        if (insErr) throw insErr;
      }
      cloudTradeLogErrorShownRef.current = false;
    } catch (e) {
      console.error("[cloud-sync] trade memos save failed:", e);
      if (!cloudTradeLogErrorShownRef.current) {
        cloudTradeLogErrorShownRef.current = true;
        toast.error("交易紀錄雲端同步失敗，僅保存於本機");
      }
    }
  };
  useEffect(() => {
    if (!(ready && tradeLog && !isDemo)) return;
    save("pf-log-v2", tradeLog);
    if (cloudTradeLogTimerRef.current) clearTimeout(cloudTradeLogTimerRef.current);
    cloudTradeLogTimerRef.current = setTimeout(() => saveTradeLogToCloud(tradeLog), 800);
    return () => {
      if (cloudTradeLogTimerRef.current) clearTimeout(cloudTradeLogTimerRef.current);
    };
  }, [tradeLog, ready, isDemo]);
  useEffect(() => { if (ready && targets && !isDemo)  save("pf-targets-v1",  targets);  }, [targets, ready, isDemo]);
  useEffect(() => { if (ready && newsEvents && !isDemo) save("pf-news-events-v1", newsEvents); }, [newsEvents, ready, isDemo]);

  // ── 7天內事件自動觸發AI預測 → 移入「待驗證」 ──
  const predictedIdsRef = useRef(new Set());
  const predictBatchInflightRef = useRef(null);
  const predictLastRunRef = useRef(0);
  const PREDICT_MIN_INTERVAL_MS = 30_000;

  // 共用：執行一次預測（force=true 會繞過節流並重置已嘗試清單）
  const runPredictEvents = (force = false) => {
    const trigger = force ? 'manual' : 'auto';
    // 重試上限與冷卻檢查（僅作用於 force 觸發；自動觸發不受限）
    if (force) {
      const now = Date.now();
      if (predictRetry.cooldownUntil > now) {
        const sec = Math.ceil((predictRetry.cooldownUntil - now) / 1000);
        const reachedMax = predictRetry.count >= RETRY_MAX;
        const msg = reachedMax
          ? `已達重試上限 ${RETRY_MAX} 次，請 ${sec}s 後再試`
          : `冷卻中，請 ${sec}s 後再試`;
        flashPredictStatus('error', msg);
        pushUpdateLog({ source:'predict', trigger, status:'cooldown', key:'(n/a)', msg });
        return;
      }
    }
    if (!ready || !newsEvents || newsEvents.length === 0) {
      if (force) {
        flashPredictStatus('error', '尚無事件可預測');
        pushUpdateLog({ source:'predict', trigger, status:'skipped', key:'(empty)', msg:'尚無事件' });
      }
      return;
    }
    if (predictingEvents) {
      if (force) flashPredictStatus('skipped-idempotent');
      pushUpdateLog({ source:'predict', trigger, status:'skipped-idempotent', key:'(inflight)', msg:'進行中' });
      return;
    }
    if (!force && Date.now() - predictLastRunRef.current < PREDICT_MIN_INTERVAL_MS) {
      flashPredictStatus('throttled');
      pushUpdateLog({ source:'predict', trigger, status:'throttled', key:'(n/a)', msg:'30s 內已執行' });
      return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    if (force) predictedIdsRef.current = new Set();

    const needsPrediction = newsEvents.filter(e => {
      if (e.status !== "pending") return false;
      if (predictedIdsRef.current.has(e.id)) return false;
      if (!e.date || !e.date.match(/^\d{4}\/\d{2}\/\d{2}/)) return false;
      const evDate = new Date(e.date.replace(/\//g, "-"));
      evDate.setHours(0, 0, 0, 0);
      return evDate >= now && evDate <= sevenDaysLater;
    });

    if (needsPrediction.length === 0) {
      if (force) {
        flashPredictStatus('error', '7 天內無待預測事件');
        pushUpdateLog({ source:'predict', trigger, status:'skipped', key:'(empty-7d)', msg:'7 天內無待預測' });
      }
      return;
    }

    const batchKey = needsPrediction.map(e => e.id).sort().join("|");
    if (predictBatchInflightRef.current === batchKey) {
      flashPredictStatus('skipped-idempotent');
      pushUpdateLog({ source:'predict', trigger, status:'skipped-idempotent', key:batchKey, msg:'同 batch 進行中' });
      return;
    }
    predictBatchInflightRef.current = batchKey;
    needsPrediction.forEach(e => predictedIdsRef.current.add(e.id));
    predictLastRunRef.current = Date.now();

    setPredictingEvents(true);
    setPredictAutoStatus({ status: 'fetching', msg: '' });
    pushUpdateLog({ source:'predict', trigger, status:'fetching', key:batchKey, msg:`${needsPrediction.length} 件` });
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_FN_BASE}/checkup-predict-events?debug=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: needsPrediction.map((e, i) => ({
              index: i + 1,
              date: e.date,
              title: e.title,
              detail: e.detail,
              stocks: e.stocks,
            })),
            holdings: holdings || [],
            debug: true,
          }),
        });
        // Try to parse body even on failure (it may carry debug attempts)
        let data = null;
        try { data = await res.json(); } catch { /* ignore */ }
        if (data?.debug) {
          setPredictLastDebug({ source: 'predict', at: new Date().toISOString(), httpStatus: res.status, ...data.debug });
        }
        if (!res.ok) {
          console.error("Predict events failed:", res.status);
          needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
          const httpErr = new Error(`HTTP ${res.status}`);
          recordPredictError(httpErr, res.status);
          const { label } = classifyError(httpErr, res.status);
          flashPredictStatus('error', `${label}（${res.status}）`);
          pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg:`${label} (${res.status})` });
          return;
        }
        if (data?.fallback) {
          needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
          const fallbackStatus = mapFallbackCodeToStatus(data.code);
          const fallbackErr = new Error(data.error || '事件預測暫時不可用');
          recordPredictError(fallbackErr, fallbackStatus);
          flashPredictStatus('error', data.error || '事件預測暫時不可用');
          pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg:data.error || `fallback (${data.code || 'unknown'})` });
          return;
        }
        const preds = data?.predictions || [];

        setNewsEvents(prev => {
          const arr = [...(prev || [])];
          needsPrediction.forEach((e, i) => {
            const idx = arr.findIndex(x => x.id === e.id);
            if (idx < 0) return;
            const p = preds.find(pp => pp.index === i + 1);
            arr[idx] = {
              ...arr[idx],
              status: "verifying",
              pred: p?.pred || "neutral",
              predReason: p?.predReason || "AI 自動預測",
            };
          });
          return arr;
        });
        flashPredictStatus('success', `已預測 ${needsPrediction.length} 件`);
        pushUpdateLog({ source:'predict', trigger, status:'success', key:batchKey, msg:`已預測 ${needsPrediction.length} 件` });
      } catch (err) {
        console.error("Predict events error:", err);
        needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
        recordPredictError(err);
        const { label } = classifyError(err);
        flashPredictStatus('error', label);
        pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg:label });
      } finally {
        setPredictingEvents(false);
        if (predictBatchInflightRef.current === batchKey) {
          predictBatchInflightRef.current = null;
        }
      }
    })();
  };

  // 持倉代碼字串作為穩定依賴，避免 holdings array reference 變動觸發過多預測
  const holdingsCodesKey = useMemo(
    () => (holdings || []).map(h => h.code).sort().join(","),
    [holdings]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runPredictEvents(false); }, [newsEvents, ready, holdingsCodesKey]);

  // 手動刷新行事曆（繞過 30 秒節流，但保留 inflight 冪等保護）
  const manualRefreshCalendar = async () => {
    // 重試上限與冷卻檢查
    const now = Date.now();
    if (calendarRetry.cooldownUntil > now) {
      const sec = Math.ceil((calendarRetry.cooldownUntil - now) / 1000);
      const reachedMax = calendarRetry.count >= RETRY_MAX;
      flashCalendarStatus('error', reachedMax
        ? `已達重試上限 ${RETRY_MAX} 次，請 ${sec}s 後再試`
        : `冷卻中，請 ${sec}s 後再試`);
      return;
    }
    if (!holdings || holdings.length === 0) {
      flashCalendarStatus('error', '尚無持倉');
      return;
    }
    if (calendarLoading) {
      flashCalendarStatus('skipped-idempotent');
      return;
    }
    calendarLastFetchRef.current = { key: null, at: 0 };
    try {
      await fetchCalendarEvents(holdings, resetGuardRef.current, calendarEvents || [], 'manual');
      flashCalendarStatus('success', '行事曆已更新');
    } catch {
      // fetchCalendarEvents 內部已 recordCalendarError + flash error
    }
  };

  useEffect(() => { if (ready && analysisHistory) save("pf-analysis-history-v1", analysisHistory); }, [analysisHistory, ready]);
  useEffect(() => { if (ready && reversalConditions) save("pf-reversal-v1", reversalConditions); }, [reversalConditions, ready]);
  useEffect(() => { if (ready && strategyBrain) save("pf-brain-v1", strategyBrain); }, [strategyBrain, ready]);
  useEffect(() => {
    if (ready && calendarEvents) {
      const saveObj = {
        events: calendarEvents,
        holdingCodes: calendarEvents._holdingCodes || "",
      };
      save("pf-calendar-v1", saveObj);
    }
  }, [calendarEvents, ready]);

  // 持倉組合（代碼集合）變動時自動重新抓取行事曆
  // 原本以 holdingsChangedByUserRef 旗標判斷僅在「截圖上傳」觸發，導致手動編輯/刪除/清空持倉時行事曆未跟著更新
  // 改用 codes 字串比對 prevCodes，價格刷新不會觸發（codes 不變），但任何組合變動皆會觸發
  useEffect(() => {
    if (!ready) return;
    const codes = holdingsCodesKey;
    if (!codes) {
      setCalendarEvents([]);
      return;
    }
    const prevCodes = calendarEvents?._holdingCodes || "";
    if (codes !== prevCodes) {
      // 重置舊有的「使用者旗標」以保持向後相容（仍允許截圖路徑顯式設置）
      holdingsChangedByUserRef.current = false;
      fetchCalendarEvents(holdings, resetGuardRef.current, calendarEvents || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsCodesKey, ready]);
  const H = holdings || [];

  // ── Sparkline 載入：持倉變動時，僅補抓還沒快取的代碼 ──
  useEffect(() => {
    if (!H || H.length === 0) return;
    const codes = H.map((h) => String(h.code).trim()).filter(Boolean);
    const missing = codes.filter((c) => !sparklines[c]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('checkup-sparkline', {
          body: { codes: missing.slice(0, 30) },
        });
        if (cancelled || error || !data?.result) return;
        setSparklines((prev) => ({ ...prev, ...data.result }));
      } catch {
        /* silent — sparkline 為非關鍵裝飾 */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [H.map((h) => h.code).join(',')]);

  const totalVal  = H.reduce((s,h)=>s+h.value,0);
  const totalCost = H.reduce((s,h)=> s + (h.totalCost != null ? h.totalCost : h.cost * h.qty), 0);
  const totalPnl  = H.reduce((s,h)=>s+h.pnl,0);
  const retPct    = totalCost>0 ? totalPnl/totalCost*100 : 0;
  const holdingCodes = new Set(H.map(h => h.code));
  const CE = Array.isArray(calendarEvents) ? calendarEvents : [];
  // Match today's date against calendar events (YYYY/MM/DD format)
  const todayStr = new Date().toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");
  const todayEvents = CE.filter(e => e.date === todayStr);
  const urgentCount = todayEvents.length;

  // Decision System v6: compute decisions for all holding codes
  const normalizedEvents = useMemo(() =>
    (Array.isArray(newsEvents) ? newsEvents : []).map(e => normalizeEventRecord(e)).filter(Boolean),
    [newsEvents]
  );
  const decisionsMap = useMemo(() => {
    const map = {};
    const now = new Date();
    H.forEach(h => {
      map[h.code] = buildDecision(h.code, normalizedEvents, userOverrides, now);
    });
    return map;
  }, [H, normalizedEvents, userOverrides]);


  // ── 持倉資料庫：篩選 + 排序 ──
  // 動態題材選項
  const strategyOptions = useMemo(() => {
    const set = new Set();
    H.forEach(h => {
      const s = STOCK_META[h.code]?.strategy;
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [H]);

  const URGENCY_RANK = { now: 3, soon: 2, monitor: 1 };
  const CONF_RANK = { high: 3, medium: 2, low: 1 };

  const getUpdatedAt = (h, dec) => {
    const candidates = [];
    if (dec?.lastUpdatedAt) candidates.push(new Date(dec.lastUpdatedAt).getTime());
    const evts = normalizedEvents.filter(e => (e.relatedCodes || []).includes(h.code));
    evts.forEach(e => { if (e.occurredAt) candidates.push(new Date(e.occurredAt).getTime()); });
    if (h.priceUpdatedAt) candidates.push(new Date(h.priceUpdatedAt).getTime());
    return candidates.length ? Math.max(...candidates) : 0;
  };

  // Phase 2.5: 決策優先度（4 階）
  const priorityOf = useCallback((h) => {
    const dec = decisionsMap[h.code];
    if (!dec) return 5;
    if (dec.actionType === 'exit') return 0;
    if (dec.actionType === 'review') return 1;
    if (dec.urgency === 'now' || dec.hasConflict) return 2;
    if (dec.urgency === 'soon') return 3;
    if (dec.thesisState === 'weakening') return 4;
    return 5;
  }, [decisionsMap]);

  const compareByPriority = useCallback((a, b) => {
    const pa = priorityOf(a), pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    const da = decisionsMap[a.code], db = decisionsMap[b.code];
    const ua = URGENCY_RANK[da?.urgency] || 0, ub = URGENCY_RANK[db?.urgency] || 0;
    if (ua !== ub) return ub - ua;
    const ca = CONF_RANK[da?.confidence] || 0, cb = CONF_RANK[db?.confidence] || 0;
    if (ca !== cb) return cb - ca;
    return (b.value || 0) - (a.value || 0);
  }, [priorityOf, decisionsMap]);

  // 全局優先排序（不受 filter 影響）
  const globalSortedList = useMemo(() => {
    return [...H].sort(compareByPriority);
  }, [H, compareByPriority]);

  const globalPriorityList = useMemo(
    () => globalSortedList.filter(h => priorityOf(h) <= 4).slice(0, 3),
    [globalSortedList, priorityOf]
  );

  const exitList = useMemo(
    () => globalSortedList.filter(h => decisionsMap[h.code]?.actionType === 'exit'),
    [globalSortedList, decisionsMap]
  );
  const reviewList = useMemo(
    () => globalSortedList.filter(h => {
      const d = decisionsMap[h.code];
      return d?.actionType === 'review' || d?.hasConflict;
    }),
    [globalSortedList, decisionsMap]
  );
  const upcomingList = useMemo(
    () => globalSortedList.filter(h => {
      const d = decisionsMap[h.code];
      if (!d) return false;
      if (d.actionType === 'exit' || d.actionType === 'review') return false;
      return d.urgency === 'now' || d.urgency === 'soon';
    }),
    [globalSortedList, decisionsMap]
  );

  // 過濾
  const filteredSortedList = useMemo(() => {
    const tokens = searchQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchSearch = (h) => {
      if (!tokens.length) return true;
      const meta = STOCK_META[h.code] || {};
      const hay = [
        h.code, h.name,
        meta.strategy, meta.industry, meta.position, meta.leader,
        ...(Array.isArray(meta.themes) ? meta.themes : []),
      ].filter(Boolean).join(" ").toLowerCase();
      return tokens.every(t => hay.includes(t));
    };
    const list = H.filter(h => {
      if (!matchSearch(h)) return false;
      const dec = decisionsMap[h.code];
      if (filterDecision.size && !filterDecision.has(dec?.actionType || "hold")) return false;
      if (filterThesis.size && !filterThesis.has(dec?.thesisState || "intact")) return false;
      if (filterUrgency.size && !filterUrgency.has(dec?.urgency || "monitor")) return false;
      if (filterConflict.size) {
        const key = dec?.hasConflict ? "conflict" : "no_conflict";
        if (!filterConflict.has(key)) return false;
      }
      if (filterPnl.size) {
        const key = h.pnl > 0 ? "win" : h.pnl < 0 ? "loss" : "flat";
        if (!filterPnl.has(key)) return false;
      }
      if (filterStrategy.size) {
        const s = STOCK_META[h.code]?.strategy;
        if (!s || !filterStrategy.has(s)) return false;
      }
      return true;
    });

    const dirMul = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === "decision") {
        // 決策優先（4 階）：desc=最緊急在前，asc=反向
        return compareByPriority(a, b) * (sortDir === "asc" ? -1 : 1);
      }
      if (sortBy === "value")  return (b.value - a.value) * dirMul;
      if (sortBy === "pnl")    return (b.pnl - a.pnl) * dirMul;
      if (sortBy === "pct")    return (b.pct - a.pct) * dirMul;
      if (sortBy === "urgency") {
        const ra = URGENCY_RANK[decisionsMap[a.code]?.urgency] || 0;
        const rb = URGENCY_RANK[decisionsMap[b.code]?.urgency] || 0;
        return (rb - ra) * dirMul;
      }
      if (sortBy === "confidence") {
        const ra = CONF_RANK[decisionsMap[a.code]?.confidence] || 0;
        const rb = CONF_RANK[decisionsMap[b.code]?.confidence] || 0;
        return (rb - ra) * dirMul;
      }
      if (sortBy === "updated") {
        return (getUpdatedAt(b, decisionsMap[b.code]) - getUpdatedAt(a, decisionsMap[a.code])) * dirMul;
      }
      return 0;
    });
    return list;
  }, [H, searchQ, filterDecision, filterThesis, filterUrgency, filterConflict, filterPnl, filterStrategy, sortBy, sortDir, decisionsMap, normalizedEvents, compareByPriority]);

  const sorted = filteredSortedList; // 保留原命名相容性
  const displayed = showAll ? sorted : sorted.slice(0,12);

  // ── 來源清單推導：依 drawerSource 決定 prev/next 的循環範圍 ──
  const sourceList = useMemo(() => {
    if (!drawerSource) return filteredSortedList;
    if (drawerSource.type === 'priority-global') return globalPriorityList;
    if (drawerSource.type === 'category') {
      if (drawerSource.key === 'exit') return exitList;
      if (drawerSource.key === 'review') return reviewList;
      if (drawerSource.key === 'upcoming') return upcomingList;
    }
    return filteredSortedList;
  }, [drawerSource, filteredSortedList, globalPriorityList, exitList, reviewList, upcomingList]);

  // ── activeCode 安全處理：sourceList 改變時防 undefined ──
  const activeIndex = useMemo(
    () => sourceList.findIndex(h => h.code === activeCode),
    [sourceList, activeCode]
  );
  const activeIndexInFiltered = useMemo(
    () => filteredSortedList.findIndex(h => h.code === activeCode),
    [filteredSortedList, activeCode]
  );
  useEffect(() => {
    if (!drawerOpen) return;
    if (activeIndex !== -1) return;
    if (sourceList.length === 0) {
      setDrawerOpen(false);
      setActiveCode(null);
      setDrawerSource(null);
    } else {
      setActiveCode(sourceList[0].code);
    }
  }, [drawerOpen, activeIndex, sourceList]);

  // 同步 drawer draft 內容
  useEffect(() => {
    if (!drawerOpen || !activeCode) return;
    const ov = userOverrides[activeCode] || {};
    setDraftNote(ov.note || "");
    setDraftExitCue(ov.exitCue || "");
    draftDirtyRef.current = false;
  }, [drawerOpen, activeCode, userOverrides]);

  const persistDraftIfDirty = useCallback(() => {
    if (!draftDirtyRef.current || !activeCode) return;
    setUserOverrides(prev => ({
      ...prev,
      [activeCode]: { ...(prev[activeCode] || {}), note: draftNote, exitCue: draftExitCue },
    }));
    draftDirtyRef.current = false;
  }, [activeCode, draftNote, draftExitCue]);

  const goPrev = useCallback(() => {
    if (sourceList.length < 2 || activeIndex < 0) return;
    persistDraftIfDirty();
    const next = (activeIndex - 1 + sourceList.length) % sourceList.length;
    setActiveCode(sourceList[next].code);
  }, [sourceList, activeIndex, persistDraftIfDirty]);
  const goNext = useCallback(() => {
    if (sourceList.length < 2 || activeIndex < 0) return;
    persistDraftIfDirty();
    const next = (activeIndex + 1) % sourceList.length;
    setActiveCode(sourceList[next].code);
  }, [sourceList, activeIndex, persistDraftIfDirty]);

  // ── 鍵盤快捷鍵 ←/→ ──
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, goPrev, goNext]);

  // ── Drawer 開啟期間追蹤背景 scroll，關閉時還原 ──
  useEffect(() => {
    if (!drawerOpen) return;
    const onScroll = () => { scrollPosRef.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [drawerOpen]);

  const handleDrawerOpenChange = (open) => {
    if (!open) {
      persistDraftIfDirty();
      const src = drawerSource;
      setDrawerOpen(false);
      setActiveCode(null);
      setDrawerSource(null);
      if (src && (src.type === 'priority-global' || src.type === 'category')) {
        requestAnimationFrame(() => {
          const el = document.getElementById('action-banner');
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
      } else {
        const y = scrollPosRef.current;
        requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
      }
    } else {
      setDrawerOpen(true);
    }
  };

  const openHoldingDrawer = (code, source = null) => {
    scrollPosRef.current = window.scrollY;
    setActiveCode(code);
    if (source) {
      setDrawerSource(source);
    } else {
      const hasSearch = !!searchQ.trim();
      const hasFilter = filterDecision.size || filterThesis.size || filterUrgency.size || filterConflict.size || filterPnl.size || filterStrategy.size;
      setDrawerSource(hasSearch || hasFilter
        ? { type: 'search', label: '📋 持倉列表（篩選結果）' }
        : { type: 'list', label: '📋 持倉列表' });
    }
    setDrawerOpen(true);
  };


  const activeHolding = activeIndex >= 0 ? sourceList[activeIndex] : null;
  const top5 = [...H].sort((a,b)=>b.value-a.value).slice(0,5);
  const topColors = [C.blue, C.amber, C.lavender, C.olive, C.teal];
  const winners = H.filter(h=>h.pnl>0).sort((a,b)=>b.pct-a.pct);
  const losers  = H.filter(h=>h.pnl<0).sort((a,b)=>a.pct-b.pct);

  const filteredEvents = filterType==="全部" ? CE : CE.filter(e=>e.type===filterType);

  // ── 刷新即時股價（TWSE MIS API）───────────────────────────────
  // REFRESH_COOLDOWN moved above (near state declarations)
  const refreshPrices = async () => {
    if (refreshing) return;
    // 30分鐘冷卻
    if (lastUpdate && (Date.now() - lastUpdate.getTime()) < REFRESH_COOLDOWN) {
      const remaining = Math.ceil((REFRESH_COOLDOWN - (Date.now() - lastUpdate.getTime())) / 60000);
      setSaved(`⏳ 請等待 ${remaining} 分鐘後再刷新`);
      setTimeout(() => setSaved(""), 3000);
      return;
    }
    setRefreshing(true);
    const codes = H.map(h => h.code);
    if (codes.length === 0) { setRefreshing(false); return; }
    setRefreshStatus({ phase: 'fetching', total: codes.length, ok: 0, fail: codes.length, missingNames: [] });
    appendLog({ task: 'refresh-prices', status: 'start', detail: `${codes.length} 檔` });

    const MAX_RETRIES = 3;
    let lastErr = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 同時嘗試上市(tse)、上櫃/興櫃(otc)、權證/盤後(oa/ob)
        const queries = codes.flatMap(c => {
          const base = [`tse_${c}.tw`, `otc_${c}.tw`];
          if (c.length >= 6) base.push(`oa_${c}.tw`);
          return base;
        });
        const exCh = queries.join('|');
        const url = `${SUPABASE_FN_BASE}/checkup-twse?ex_ch=${encodeURIComponent(exCh)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`報價伺服器回應 ${res.status}`);
        const data = await res.json();

        if (data.msgArray && data.msgArray.length > 0) {
          // 每筆 symbol 回報來源：live(成交)/high(最高)/ask(賣一)/yclose(昨收)
          const priceMap = {};
          data.msgArray.forEach(item => {
            if (!item.c || priceMap[item.c]) return;
            const z = parseFloat(item.z);
            const hp = parseFloat(item.h);
            const vol = parseInt(item.v, 10) || 0;
            const bestAsk = item.a ? parseFloat(item.a.split('_')[0]) : NaN;
            const yClose = parseFloat(item.y);
            let price = null, source = null;
            if (!isNaN(z) && z > 0) { price = z; source = 'live'; }
            else if (vol > 0 && !isNaN(hp) && hp > 0) { price = hp; source = 'high'; }
            else if (!isNaN(bestAsk) && bestAsk > 0) { price = bestAsk; source = 'ask'; }
            else if (!isNaN(yClose) && yClose > 0) { price = yClose; source = 'yclose'; }
            if (price) priceMap[item.c] = { price, source };
          });

          const nowIso = new Date().toISOString();
          setHoldings(prev => (prev || []).map(h => {
            const hit = priceMap[h.code];
            if (!hit) {
              return { ...h, priceError: '無即時報價（可能停牌、興櫃或非交易時段）' };
            }
            const { value, pnl, pct } = calcPnlWithNet(h, hit.price);
            return {
              ...h,
              price: hit.price,
              value, pnl, pct,
              priceSource: hit.source,
              priceUpdatedAt: nowIso,
              priceError: null,
            };
          }));

          const updated = Object.keys(priceMap).length;
          const total = codes.length;
          const stillMissed = codes.filter(c => !priceMap[c]);
          const missedNames = stillMissed.map(c => { const hh = H.find(x=>x.code===c); return hh ? hh.name : c; });
          setLastUpdate(new Date());
          setRefreshStatus({ phase: 'done', total, ok: updated, fail: stillMissed.length, missingNames: missedNames });
          appendLog({
            task: 'refresh-prices', status: 'ok', attempt,
            detail: `${updated}/${total} 成功${stillMissed.length?`，缺：${missedNames.slice(0,10).join(',')}`:''}`,
          });
          if (stillMissed.length > 0 && stillMissed.length < total) {
            setSaved(`✅ ${updated}/${total} 檔已更新（${missedNames.join('、')} 無即時報價）`);
          } else {
            setSaved(`✅ ${updated} 檔股價已更新`);
          }
          setTimeout(() => setSaved(""), 4000);
          setTimeout(() => setRefreshStatus(null), 6000);
          setRefreshing(false);
          return;
        } else {
          lastErr = '報價來源無回應（可能非交易時段）';
          appendLog({ task: 'refresh-prices', status: 'retry', attempt, detail: lastErr });
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
        }
      } catch (err) {
        lastErr = err?.message || '網路錯誤';
        console.warn(`refreshPrices attempt ${attempt}/${MAX_RETRIES} failed:`, err);
        appendLog({ task: 'refresh-prices', status: 'retry', attempt, detail: lastErr });
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
      }
    }

    // 全部重試失敗
    appendLog({ task: 'refresh-prices', status: 'error', detail: `所有重試失敗：${lastErr}` });
    setRefreshStatus({ phase: 'error', total: codes.length, ok: 0, fail: codes.length, missingNames: [], error: lastErr });
    setSaved(`✕ 刷新失敗：${lastErr}`);
    setTimeout(() => setSaved(""), 4000);
    setTimeout(() => setRefreshStatus(null), 8000);
    setRefreshing(false);
  };

  // ── 每日收盤分析 ─────────────────────────────────────────────────
  const runDailyAnalysis = async () => {
    if (analyzing) return;
    // Demo 模式 → 要求先 LINE 登入
    if (isDemo) {
      startLineLogin();
      return;
    }
    // LINE 免費用戶每日 1 次 AI 分析限制（與截圖解析共用配額）
    if (hasReachedDailyLimit) {
      setSaved("今日免費 AI 分析次數已用完，明天再來");
      setTimeout(() => setSaved(""), 4000);
      return;
    }
    setAnalyzing(true);
    setAnalyzeStep("取得即時股價...");
    try {
      // 1. 取得最新股價
      const codes = H.map(h => h.code);
      if (codes.length === 0) { setAnalyzing(false); return; }
      const queries = codes.flatMap(c => {
        const base = [`tse_${c}.tw`, `otc_${c}.tw`];
        if (c.length >= 6) base.push(`oa_${c}.tw`);
        return base;
      });
      const exCh = queries.join('|');
      const url = `${SUPABASE_FN_BASE}/checkup-twse?ex_ch=${encodeURIComponent(exCh)}`;
      const res = await fetch(url);
      const data = await res.json();

      const priceMap = {};
      if (data.msgArray) {
        data.msgArray.forEach(item => {
          const latest = parseFloat(item.z);
          const yClose = parseFloat(item.y);
          const price = (!isNaN(latest) && latest > 0) ? latest : (!isNaN(yClose) && yClose > 0) ? yClose : null;
          const yesterday = (!isNaN(yClose) && yClose > 0) ? yClose : null;
          if (price && !priceMap[item.c]) {
            priceMap[item.c] = { price, yesterday, change: yesterday ? price - yesterday : 0, changePct: yesterday ? ((price / yesterday - 1) * 100) : 0 };
          }
        });
      }

      // 2. 計算每檔今日漲跌
      const changes = H.map(h => {
        const pm = priceMap[h.code];
        return {
          code: h.code, name: h.name, type: h.type,
          price: pm?.price || h.price,
          yesterday: pm?.yesterday || h.price,
          change: pm?.change || 0,
          changePct: pm?.changePct || 0,
          cost: h.cost, qty: h.qty,
          todayPnl: pm ? Math.round(pm.change * h.qty) : 0,
          totalPnl: pm ? Math.round((pm.price - h.cost) * h.qty) : h.pnl,
          totalPct: pm ? Math.round(((pm.price / h.cost) - 1) * 10000) / 100 : h.pct,
        };
      }).sort((a, b) => b.changePct - a.changePct);

      const totalTodayPnl = changes.reduce((s, c) => s + c.todayPnl, 0);

      // 3. 事件連動分析
      const NE = newsEvents || [];
      const today = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/");
      const pendingEvents = NE.filter(e => e.status === "pending" || e.status === "verifying" || e.status === "tracking");
      const eventCorrelations = pendingEvents.map(e => {
        const relatedStocks = e.stocks.map(s => {
          const raw = typeof s === "string" ? s : (s.code || s.name || "");
          const code = raw.match(/\d+/)?.[0];
          const ch = changes.find(c => c.code === code);
          return ch ? { name: ch.name, code: ch.code, changePct: ch.changePct, change: ch.change, price: ch.price } : null;
        }).filter(Boolean);
        return { ...e, relatedStocks };
      }).filter(e => e.relatedStocks.length > 0 && e.relatedStocks.some(s => Math.abs(s.changePct) > 1));

      // 4. 異常波動（漲跌幅 > 3%）
      const anomalies = changes.filter(c => Math.abs(c.changePct) > 3);

      // 5. 需要復盤的事件（日期已過但未標記結果）
      const needsReview = pendingEvents.filter(e => {
        if (!e.date.match(/^\d{4}\/\d{2}/)) return false;
        return e.date <= today;
      });

      // 5.5 自動驗證事件：根據股價漲跌自動判定 pending 事件結果
      const autoVerified = [];
      if (needsReview.length > 0) {
        setNewsEvents(prev => {
          const arr = [...(prev || [])];
          needsReview.forEach(e => {
            const idx = arr.findIndex(x => x.id === e.id);
            if (idx < 0) return;
            // 找到相關股票的漲跌
            const relatedStocks = (e.stocks || []).map(s => {
              const raw = typeof s === "string" ? s : (s.code || s.name || "");
              const code = raw.match(/\d+/)?.[0];
              const ch = changes.find(c => c.code === code);
              return ch ? { name: ch.name, code: ch.code, changePct: ch.changePct } : null;
            }).filter(Boolean);
            if (relatedStocks.length === 0) return;
            const avgChange = relatedStocks.reduce((s, r) => s + r.changePct, 0) / relatedStocks.length;
            const actual = avgChange > 1 ? "up" : avgChange < -1 ? "down" : "neutral";
            const correct = e.pred === actual;
            const stockSummary = relatedStocks.map(s => `${s.name} ${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%`).join("、");
            arr[idx] = {
              ...arr[idx],
              status: "past",
              actual,
              correct,
              actualNote: `[自動驗證] 相關股票表現：${stockSummary}，平均漲跌 ${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`,
              reviewDate: today,
            };
            autoVerified.push({ title: e.title, pred: e.pred, actual, correct });
          });
          return arr;
        });
      }

      // 6. 呼叫 Claude API 產生策略分析（含策略大腦上下文）
      setAnalyzeStep("AI 策略分析中（約15-30秒）...");
      let aiInsight = null;
      try {
        const holdingSummary = changes.map(c =>
          `${c.name}(${c.code}) 今日${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(2)}% 累計${c.totalPct >= 0 ? "+" : ""}${c.totalPct}%`
        ).join("\n");
        const eventSummary = pendingEvents.map(e =>
          `[${e.date}] ${e.title} — 預測:${e.pred==="up"?"看漲":e.pred==="down"?"看跌":"中性"}`
        ).join("\n");
        const anomalySummary = anomalies.length > 0
          ? anomalies.map(a => `${a.name} ${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%`).join(", ")
          : "無";

        // 組裝策略大腦上下文
        const brain = strategyBrain;
        const brainContext = brain ? `
══ 策略大腦（累積知識庫）══
核心策略規則：
${(brain.rules||[]).map((r,i)=>`${i+1}. ${r}`).join("\n")}

歷史教訓：
${(brain.lessons||[]).slice(-10).map(l=>`- [${l.date}] ${l.text}`).join("\n")}

勝率統計：${brain.stats?.hitRate||"尚無"}
常犯錯誤：${(brain.commonMistakes||[]).join("、")||"尚無"}
══════════════════════════` : "";

        // 反轉追蹤上下文
        const revContext = losers.length > 0 ? `
反轉追蹤持股：
${losers.map(h=>{
  const rc = (reversalConditions||{})[h.code];
  return `${h.name}(${h.code}) ${h.pct}% | 反轉條件：${rc?.signal||"未設定"} | 停損：${rc?.stopLoss||"未設定"}`;
}).join("\n")}` : "";

        const analyzeController = new AbortController();
        const analyzeTimer = setTimeout(() => analyzeController.abort(), 120000); // 2 min timeout
        const aiRes = await fetch(`${SUPABASE_FN_BASE}/checkup-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: analyzeController.signal,
          body: JSON.stringify({
            systemPrompt: `你是一位專業的台股策略分析師，也是用戶的長期策略顧問。
你擁有用戶過去所有分析的記憶（策略大腦），必須基於累積的教訓和規則來給出建議。
用戶是積極型事件驅動交易者，持有股票+權證，專注電子科技族群。

請用繁體中文，以精準簡潔的風格分析今日收盤表現。格式：

## 今日總結
（一句話概括）

## 事件連動分析
（哪些股價變動與待觀察事件有關聯？邏輯是什麼？）

## 反轉追蹤
（虧損持股今日表現如何？有沒有接近反轉訊號？）

## 風險提醒
（基於策略大腦的歷史教訓，需要注意什麼？）

## 明日觀察重點
（明天盤中應該關注什麼？）

## 操作建議
（具體的買賣建議或等待條件）

## 策略進化建議
（基於今日表現，策略大腦應該新增或修改什麼規則？）`,
            userPrompt: `今日日期：${today}
今日持倉損益：${totalTodayPnl >= 0 ? "+" : ""}${totalTodayPnl.toLocaleString()} 元
${brainContext}
${revContext}

持倉明細：
${holdingSummary}

異常波動（>3%）：${anomalySummary}

待觀察事件：
${eventSummary}

${autoVerified.length > 0 ? `今日自動驗證事件（${autoVerified.length}件）：
${autoVerified.map(v => `- ${v.title}：預測${v.pred==="up"?"看漲":"看跌"} → 實際${v.actual==="up"?"漲":"跌"} → ${v.correct?"✓正確":"✗有誤"}`).join("\n")}` : ""}

請分析今日收盤表現，事件連動，並給出策略建議。特別注意策略大腦中的歷史教訓。${autoVerified.length > 0 ? "同時針對今日自動驗證的事件進行覆盤分析。" : ""}`
          })
        });
        clearTimeout(analyzeTimer);
        if (!aiRes.ok) {
          console.error("AI 分析 HTTP 錯誤:", aiRes.status, await aiRes.text());
        } else {
          const aiData = await aiRes.json();
          aiInsight = aiData.content?.[0]?.text || aiData.text || aiData.response || null;
        }
      } catch (e) {
        console.error("AI 分析失敗:", e);
      }

      // 7. 組裝報告
      const report = {
        id: Date.now(),
        date: today,
        time: new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
        totalTodayPnl,
        changes,
        anomalies,
        eventCorrelations,
        needsReview: needsReview.filter(e => !autoVerified.find(v => v.title === e.title)),
        autoVerified,
        aiInsight,
      };

      setDailyReport(report);
      setAnalysisHistory(prev => [report, ...(prev || []).filter(r => r.date !== today)].slice(0, 30));
      incrementUploadCount(); // 計入今日 AI 配額（與截圖解析共用）

      // 8. 策略大腦進化 — 讓 AI 更新策略知識庫
      setAnalyzeStep("策略大腦進化中...");
      if (aiInsight) {
        try {
          const NE = newsEvents || [];
          const pastEvents = NE.filter(e => e.status === "past");
          const hits = pastEvents.filter(e => e.correct === true).length;
          const total = pastEvents.filter(e => e.correct !== null).length;

          const brainRes = await fetch(`${SUPABASE_FN_BASE}/checkup-analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemPrompt: `你是策略知識庫管理器。根據今日分析結果，更新策略大腦。
回傳**純JSON**格式（不要markdown code block），結構：
{"rules":["規則1","規則2",...],"lessons":[{"date":"日期","text":"教訓"}],"commonMistakes":["錯誤1",...],"stats":{"hitRate":"X/Y","totalAnalyses":N},"lastUpdate":"日期"}

規則：基於累積經驗的核心交易策略（最多15條，去掉過時的）
教訓：今日新增的具體教訓（只加新的，保留舊的）
常犯錯誤：反覆出現的錯誤模式`,
              userPrompt: `今日分析：
${aiInsight}

現有策略大腦：
${JSON.stringify(strategyBrain || { rules: [], lessons: [], commonMistakes: [], stats: {} })}

預測命中率：${hits}/${total}
今日損益：${totalTodayPnl >= 0 ? "+" : ""}${totalTodayPnl.toLocaleString()} 元

請更新策略大腦，保留有效的舊規則，加入今日新教訓。`
            })
          });
          const brainData = await brainRes.json();
          const brainText = brainData.content?.[0]?.text || "";
          const cleanBrain = brainText.replace(/```json|```/g, "").trim();
          const newBrain = JSON.parse(cleanBrain);
          setStrategyBrain(newBrain);
        } catch (e) {
          console.error("策略大腦更新失敗:", e);
        }
      }

      // 同步更新持倉價格
      setHoldings(prev => (prev || []).map(h => {
        const pm = priceMap[h.code];
        if (!pm) return h;
        const { value, pnl, pct } = calcPnlWithNet(h, pm.price);
        return { ...h, price: pm.price, value, pnl, pct };
      }));

      setLastUpdate(new Date());
    } catch (err) {
      console.error("收盤分析失敗:", err);
      setSaved("❌ 分析失敗");
      setTimeout(() => setSaved(""), 3000);
    }
    setAnalyzing(false);
    setAnalyzeStep("");
  };

  // ── 事件復盤 ─────────────────────────────────────────────────────
  const submitReview = (eventId) => {
    setNewsEvents(prev => {
      const arr = [...(prev || [])];
      const idx = arr.findIndex(e => e.id === eventId);
      if (idx < 0) return arr;
      arr[idx] = {
        ...arr[idx],
        status: "past",
        actual: reviewForm.actual,
        actualNote: reviewForm.actualNote,
        correct: arr[idx].pred === reviewForm.actual,
        lessons: reviewForm.lessons,
        reviewDate: new Date().toLocaleDateString("zh-TW"),
      };
      return arr;
    });
    setReviewingEvent(null);
    setReviewForm({ actual: "up", actualNote: "", lessons: "" });
    setSaved("✅ 復盤已儲存");
    setTimeout(() => setSaved(""), 2500);
  };

  // ── 新增事件 ─────────────────────────────────────────────────────
  const addEvent = () => {
    if (!newEvent.title.trim() || !newEvent.date.trim()) return;
    const evt = {
      id: Date.now(),
      date: newEvent.date,
      status: "pending",
      title: newEvent.title,
      detail: newEvent.detail,
      stocks: newEvent.stocks.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
      pred: newEvent.pred,
      predReason: newEvent.predReason,
      actual: null, actualNote: "", correct: null,
    };
    setNewsEvents(prev => [...(prev || []), evt]);
    setNewEvent({ date: "", title: "", detail: "", stocks: "", pred: "up", predReason: "" });
    setShowAddEvent(false);
    setSaved("✅ 事件已新增");
    setTimeout(() => setSaved(""), 2500);
  };

  // ── 反轉條件更新 ─────────────────────────────────────────────────
  const updateReversal = (code, conditions) => {
    setReversalConditions(prev => ({
      ...(prev || {}),
      [code]: { ...conditions, updatedAt: new Date().toLocaleDateString("zh-TW") },
    }));
    setSaved("✅ 反轉條件已儲存");
    setTimeout(() => setSaved(""), 2500);
  };

  // 收盤分析完全手動觸發，不自動執行

  // file
  const processFile = (file) => {
    if (!file?.type.startsWith("image/")) return;
    setImg(URL.createObjectURL(file));
    setParsed(null); setParseErr(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    const r = new FileReader();
    r.onload = e => setB64(e.target.result.split(",")[1]);
    r.readAsDataURL(file);
  };

  const mergeTradeIntoHoldings = (holdingsList, trade) => {
    const action = String(trade?.action || "").trim();
    const code = String(trade?.code || "").trim();
    const name = String(trade?.name || "").trim();
    const qty = Number(trade?.qty) || 0;
    const price = Number(trade?.price) || 0;
    const tradeTotalCost = trade?.total_cost != null ? Number(trade.total_cost) : null;
    const tradeFee = trade?.fee != null ? Number(trade.fee) : null;

    if (!code || qty <= 0 || price <= 0) return holdingsList;

    const arr = [...holdingsList];
    const idx = arr.findIndex(h => h.code === code);

    const mktPrice = Number(trade?.market_price) || price; // 市價，若無則用成交價

    if (action === "買進") {
      if (idx >= 0) {
        const h = arr[idx];
        const nq = h.qty + qty;
        const nc = calcWeightedAvgCost(h.cost, h.qty, price, qty);
        const mp = mktPrice || h.price;
        // 合併 totalCost 和 fee
        const newTotalCost = (h.totalCost != null && tradeTotalCost != null)
          ? h.totalCost + tradeTotalCost
          : (tradeTotalCost != null ? tradeTotalCost : h.totalCost);
        const newFee = (h.fee != null && tradeFee != null)
          ? h.fee + tradeFee
          : (tradeFee != null ? tradeFee : h.fee);
        const { value, pnl, pct } = calcPnlWithNet(
          { ...h, qty: nq, cost: nc, totalCost: newTotalCost, fee: newFee, code },
          mp
        );
        arr[idx] = {
          ...h,
          name: h.name || name,
          qty: nq,
          price: mp,
          cost: Math.round(nc * 100) / 100,
          totalCost: newTotalCost,
          fee: newFee,
          value, pnl, pct,
          priceSource: 'screenshot',
          priceUpdatedAt: new Date().toISOString(),
          priceError: null,
        };
      } else {
        const newH = {
          code, name, qty,
          price: mktPrice,
          cost: price,
          totalCost: tradeTotalCost,
          fee: tradeFee,
          type: inferHoldingType(code, name),
          priceSource: 'screenshot',
          priceUpdatedAt: new Date().toISOString(),
          priceError: null,
        };
        const { value, pnl, pct } = calcPnlWithNet(newH, mktPrice);
        arr.push({ ...newH, value, pnl, pct });
      }
      return arr;
    }

    if (idx >= 0) {
      const h = arr[idx];
      const nq = Math.max(0, h.qty - qty);
      if (nq === 0) {
        arr.splice(idx, 1);
      } else {
        const mp = mktPrice || h.price;
        // 賣出時按比例縮減 totalCost 和 fee
        const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(h.totalCost, h.fee, nq, h.qty);
        const { value, pnl, pct } = calcPnlWithNet(
          { ...h, qty: nq, totalCost: newTotalCost, fee: newFee, code: h.code },
          mp
        );
        arr[idx] = {
          ...h, qty: nq, price: mp, totalCost: newTotalCost, fee: newFee,
          value, pnl, pct,
        };
      }
    }

    return arr;
  };

  const hasExplicitTradeAction = (trade) => {
    const action = String(trade?.action || "").trim();
    return action === "買進" || action === "賣出";
  };

  const upsertSnapshotHolding = (holdingsList, trade) => {
    const code = String(trade?.code || "").trim();
    const name = String(trade?.name || "").trim();
    const qty = Number(trade?.qty) || 0;
    const cost = Number(trade?.price) || 0;
    const marketPrice = Number(trade?.market_price) || cost;
    const totalCost = trade?.total_cost != null ? Number(trade.total_cost) : null;
    const fee = trade?.fee != null ? Number(trade.fee) : null;

    if (!code || qty <= 0 || cost <= 0) return holdingsList;

    const arr = [...holdingsList];
    const idx = arr.findIndex((holding) => holding.code === code);
    const prev = idx >= 0 ? arr[idx] : null;
    const nextHolding = {
      ...(prev || {}),
      code,
      name: name || prev?.name || code,
      qty,
      price: marketPrice,
      cost,
      totalCost,
      fee,
      type: prev?.type || inferHoldingType(code, name),
      priceSource: 'screenshot',
      priceUpdatedAt: new Date().toISOString(),
      priceError: null,
    };
    const { value, pnl, pct } = calcPnlWithNet(nextHolding, marketPrice);
    const finalizedHolding = { ...nextHolding, value, pnl, pct };

    if (idx >= 0) arr[idx] = finalizedHolding;
    else arr.push(finalizedHolding);

    return arr;
  };

  const parseShot = async () => {
    if (!b64) return;
    // Demo 模式 → 要求先 LINE 登入
    if (isDemo) {
      startLineLogin();
      return;
    }
    // LINE 免費用戶每日限制
    if (hasReachedDailyLimit) {
      setSaved("今日免費健檢次數已用完，明天再來");
      setTimeout(() => setSaved(""), 4000);
      return;
    }
    setParsing(true); setParseErr(null);
    setParseStep({ stage: 'upload', label: '上傳截圖至 AI Vision', progress: 10, detail: `影像大小約 ${Math.round((b64?.length || 0) * 0.75 / 1024)} KB` });

    const MAX_RETRIES = 3;
    let lastErr = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        setParseStep({
          stage: attempt === 1 ? 'ai' : 'retry',
          label: attempt === 1 ? 'AI 解析持倉資料中' : `AI 解析重試 ${attempt}/${MAX_RETRIES}`,
          progress: attempt === 1 ? 30 : 30 + (attempt - 1) * 10,
          detail: attempt === 1 ? '使用 Gemini 2.5 Pro Vision' : `上次失敗：${lastErr || '未知錯誤'}`,
        });
        const res = await fetch(`${SUPABASE_FN_BASE}/checkup-parse`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            systemPrompt: PARSE_PROMPT,
            base64: b64,
            mediaType: "image/jpeg",
          })
        });
        const data = await res.json();

        // 後端回傳 error 表示所有模型都失敗，嘗試重試
        if (data.error) {
          lastErr = data.error;
          console.warn(`Parse attempt ${attempt}/${MAX_RETRIES} failed:`, data.error);
          appendLog({ task: 'parse-screenshot', status: 'retry', attempt, detail: data.error });
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
          break;
        }

        const clean = (data.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
        const parsedResult = JSON.parse(clean);
        const parsedTrades = Array.isArray(parsedResult?.trades) ? parsedResult.trades : [];
        const isSnapshotImport = parsedTrades.length > 0 && parsedTrades.every((trade) => !hasExplicitTradeAction(trade));
        const preparedTrades = parsedTrades.map((trade) => ({
          ...trade,
          action: hasExplicitTradeAction(trade)
            ? String(trade.action).trim()
            : (isSnapshotImport ? SNAPSHOT_IMPORT_ACTION : "買進"),
        }));
        parsedResult.trades = preparedTrades;
        setParsed(parsedResult);
        setParseStep({ stage: 'persist', label: '寫入持倉與交易記錄', progress: 70, detail: `辨識出 ${preparedTrades.length} 筆部位` });

        // 解析成功後立即同步持倉 & 交易記錄
        if (preparedTrades.length) {
          // 50 檔上限防呆：估算合併後的代碼數，超過則擋下整批匯入
          const currentCodes = new Set((holdings || []).map(h => h.code));
          const incomingCodes = new Set(preparedTrades.map(t => String(t?.code || "").trim()).filter(Boolean));
          const merged = new Set([...currentCodes, ...incomingCodes]);
          if (merged.size > MAX_HOLDINGS) {
            setParseErr(
              `持倉上限 ${MAX_HOLDINGS} 檔，目前 ${currentCodes.size} 檔、本次解析新增 ${incomingCodes.size} 檔`
              + `（合計 ${merged.size} 檔超出 ${merged.size - MAX_HOLDINGS} 檔），請先整理或減少匯入筆數`
            );
            setParseStep({ stage: 'error', label: '持倉超出上限', progress: 70, detail: `合計 ${merged.size} / 上限 ${MAX_HOLDINGS}` });
            setParsing(false);
            return;
          }
          holdingsChangedByUserRef.current = true; // 標記為使用者主動變動持倉
          setHoldings(prev => preparedTrades.reduce(
            (acc, trade) => isSnapshotImport ? upsertSnapshotHolding(acc, trade) : mergeTradeIntoHoldings(acc, trade),
            stripDemoSeedHoldings(prev || []),
          ));
          setTradeLog(prev => {
            const existing = prev || [];
            const newEntries = preparedTrades.map(t => ({
              id: Date.now() + Math.random(),
              date: t.date || new Date().toLocaleDateString("zh-TW"),
              time: t.time || new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"}),
              action: t.action === SNAPSHOT_IMPORT_ACTION ? "匯入" : t.action,
              code: t.code, name: t.name, qty: t.qty, price: t.price,
              qa: [],
            }));
            return [...newEntries, ...existing];
          });
          setSaved("✅ 成交已更新到持倉與記錄");
          incrementUploadCount(); // 記錄今日上傳次數
          setTimeout(() => setSaved(""), 2500);
          // ✨ 解析成功後自動拉一次 TWSE 即時報價，避免依賴截圖內 market_price
          setParseStep({ stage: 'refresh', label: '同步 TWSE 即時報價', progress: 90, detail: '繞過冷卻自動執行一次' });
          try {
            setLastUpdate(null);
            setTimeout(() => { refreshPrices().catch(() => {}); }, 600);
          } catch (e) { console.warn('auto-refresh after parse failed:', e); }
        }
        setParseStep({ stage: 'done', label: '解析完成', progress: 100, detail: `共 ${preparedTrades.length} 筆持倉已寫入` });
        appendLog({ task: 'parse-screenshot', status: 'ok', attempt, detail: `${preparedTrades.length} 筆部位` });
        setTimeout(() => setParseStep(null), 4000);
        setParsing(false);
        return; // 成功，直接返回
      } catch (e) {
        lastErr = e?.message || "網路錯誤";
        console.warn(`Parse attempt ${attempt}/${MAX_RETRIES} exception:`, e);
        appendLog({ task: 'parse-screenshot', status: 'retry', attempt, detail: lastErr });
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
      }
    }

    // 所有重試都失敗
    const finalErr = lastErr || "解析失敗，請確認截圖清晰";
    setParseErr(finalErr);
    setParseStep({ stage: 'error', label: 'AI 解析失敗', progress: 100, detail: finalErr });
    appendLog({ task: 'parse-screenshot', status: 'error', detail: `所有重試失敗：${finalErr}` });
    setTimeout(() => setParseStep(null), 6000);
    setParsing(false);
  };

  const submitMemo = () => {
    if (!parsed?.trades?.length) return;
    const t = parsed.trades[0];
    const qs = MEMO_Q[t.action]||MEMO_Q["買進"];
    const ans = [...memoAns, memoIn];
    setMemoIn("");
    if (memoStep < qs.length-1) { setMemoAns(ans); setMemoStep(memoStep+1); return; }

    const entry = {
      id:Date.now(),
      date:new Date().toLocaleDateString("zh-TW"),
      time:new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"}),
      action:t.action, code:t.code, name:t.name, qty:t.qty, price:t.price,
      qa: qs.map((q,i)=>({q, a:ans[i]||""})),
    };
    setTradeLog(prev=>[entry,...(prev||[])]);

    setSaved("✅ 已儲存備忘錄");
    setTimeout(()=>setSaved(""),2500);

    // 若截圖含目標價更新
    if (parsed.targetPriceUpdates?.length) {
      setTargets(prev => {
        const updated = {...(prev||{})};
        parsed.targetPriceUpdates.forEach(u => {
          const existing = updated[u.code] || {reports:[]};
          const already  = existing.reports.find(r=>r.firm===u.firm);
          const newReport = {firm:u.firm, target:u.target, date:u.date||new Date().toLocaleDateString("zh-TW")};
          const newReports = already
            ? existing.reports.map(r=>r.firm===u.firm ? newReport : r)
            : [...existing.reports, newReport];
          updated[u.code] = { reports:newReports, updatedAt:new Date().toLocaleDateString("zh-TW"), isNew:true };
        });
        return updated;
      });
    }

    setImg(null); setB64(null); setParsed(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    setTab("holdings");
  };

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const clearAnalysisAndLessons = () => {
    if (!confirm("確定要清除『歷史分析記錄』與『最近教訓』嗎？")) return;

    setAnalysisHistory([]);
    setStrategyBrain(null);
    setDailyReport(null);
    save("pf-analysis-history-v1", []);
    save("pf-brain-v1", null);

    setSaved("🧹 已清除歷史分析與最近教訓");
    setTimeout(() => setSaved(""), 2500);
  };

  const resetAll = () => {
    resetGuardRef.current += 1;
    // 清除 localStorage
    ["pf-holdings-v2","pf-log-v2","pf-targets-v1","pf-news-events-v1",
     "pf-analysis-history-v1","pf-reversal-v1","pf-brain-v1","pf-calendar-v1"].forEach(k => localStorage.removeItem(k));
    setHoldings([]); setTradeLog([]); setTargets({});
    setNewsEvents([]); setAnalysisHistory([]); setReversalConditions({});
    setStrategyBrain(null); setDailyReport(null); setCalendarEvents(null);
    setCalendarLoading(false);
    setImg(null); setB64(null); setParsed(null); setParseErr(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    setTab("holdings");
    setShowResetConfirm(false);

    // 雲端清空所有 pf-* key
    const uid = _currentUserId;
    if (uid) {
      CLOUD_SYNC_KEYS.forEach(k => {
        const emptyVal = k === "pf-calendar-v1" ? { events: [], holdingCodes: "" }
          : k === "pf-brain-v1" ? {} : (k.includes("history") || k.includes("news") ? [] : {});
        supabase.from("checkup_storage").upsert({ user_id: uid, key: k, data: emptyVal, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {}).catch(() => {});
      });
      supabase.from("checkup_storage").upsert({ user_id: uid, key: "pf-calendar-holdings", data: { stocks: "", holdingCodes: "" }, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {}).catch(() => {});
      // 清除雲端交易備忘錄
      supabase.from("checkup_trade_memos").delete().neq("id", "00000000-0000-0000-0000-000000000000").then(() => {}).catch(() => {});
    }

    setSaved("🗑️ 已全部清除");
    setTimeout(() => setSaved(""), 2500);
  };

  const qs = parsed?.trades?.[0] ? (MEMO_Q[parsed.trades[0].action]||MEMO_Q["買進"]) : [];

  if (!ready) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",
      alignItems:"center",justifyContent:"center",color:C.textMute,
      fontFamily:"sans-serif",fontSize:15}}>載入中...</div>
  );

  const TABS = [
    {k:"holdings", label:"持倉"},
    {k:"watchlist",label:"觀察股"},
    {k:"events",   label:`行事曆${urgentCount>0?" ·":""}`},
    {k:"news",     label:"事件分析"},
    {k:"daily",    label:analyzing?"分析中...":"收盤分析"},
    {k:"trade",    label:"上傳成交"},
    {k:"log",      label:"交易日誌"},
  ];

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,
      fontFamily:"'Inter','Noto Sans TC',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",paddingBottom:40,
      WebkitFontSmoothing:"antialiased",MozOsxFontSmoothing:"grayscale"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        html{-webkit-text-size-adjust:100%}
        body{-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
        textarea::placeholder,input::placeholder{color:${C.textMute}}
        input,textarea,button{font-family:inherit;-webkit-appearance:none}
        @keyframes progress{0%{width:5%}50%{width:70%}100%{width:95%}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @media(max-width:480px){
          body{font-size:14px}
        }
        /* Hero RWD：inline fontSize:88 在窄螢幕會壓爆右側，必須用 className 覆寫 */
        @media(max-width:560px){
          .wb-hero-grid{
            grid-template-columns: 1fr !important;
            align-items: flex-start !important;
            gap: 14px !important;
          }
          .wb-hero-market{
            align-items: flex-start !important;
          }
          .wb-hero-pnl-num{
            font-size: 56px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-hero-pnl-pct{
            font-size: 18px !important;
          }
          .wb-hero-kpi{
            grid-template-columns: repeat(2, minmax(0,1fr)) !important;
            gap: 14px 18px !important;
          }
          .wb-card-pnl-num{
            font-size: 36px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-card-pnl-pct{
            font-size: 14px !important;
          }
        }
        @media(max-width:380px){
          .wb-hero-pnl-num{ font-size: 44px !important; }
          .wb-card-pnl-num{ font-size: 30px !important; }
        }
      `}</style>

      {/* ── BACK BUTTON + 戰情室入口 ── */}
      <div style={{background:C.bg,borderBottom:`1px solid ${C.border}`,padding:"8px 16px",position:"sticky",top:0,zIndex:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={()=>navigate("/")} style={{
          background:"none",border:"none",cursor:"pointer",padding:"2px 0",
          color:C.textMute,fontSize:13,fontWeight:400,display:"flex",alignItems:"center",gap:4,
          letterSpacing:"0.01em",
        }}>
          ← 返回
        </button>
        {!isDemo && (
          <button onClick={()=>navigate("/app")} style={{
            background:C.blue,border:"none",cursor:"pointer",padding:"4px 12px",borderRadius:6,
            color:"#fff",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:4,
          }}>
            前往戰情室 →
          </button>
        )}
      </div>

      {/* ── HEADER ── */}
      <div style={{background:C.bg,borderBottom:`1px solid ${C.border}`,
        padding:"14px 16px 0",position:"sticky",top:34,zIndex:10}}>

        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <div>
            <div style={{fontSize:11,color:C.textMute,letterSpacing:"0.1em",fontWeight:400,marginBottom:4}}>
              {isDemo && <span style={{color:C.textMute,padding:"2px 0",fontSize:10,fontWeight:400,marginRight:6}}>DEMO</span>}
              {lineProfile && <span style={{color:C.textMute,padding:"2px 0",fontSize:10,fontWeight:400,marginRight:6}}>{lineProfile.displayName}</span>}
              <span style={{color:C.textMute,fontSize:10,letterSpacing:"0.04em"}}>{cloudSync?"雲端":"本地"}</span>
              {saved && <span style={{color:C.textMute,marginLeft:6,fontWeight:400,fontSize:11}}>{saved}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:18,fontWeight:400,color:C.text,letterSpacing:"-0.01em"}}>持倉看板</span>
              <button onClick={() => setShowResetConfirm(true)} style={{
                background: "transparent", color: C.textMute, border:`1px solid ${C.border}`,
                borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:400,
                cursor:"pointer", whiteSpace:"nowrap",
              }}>清除</button>
              {H.length > 0 && (
                <>
                  <button
                    onClick={triggerServerSync}
                    disabled={serverSyncing}
                    title="繞過 30 分冷卻，立即向後端排程要求最新報價"
                    style={{
                      background: serverSyncing ? alpha(C.subtle,'aa') : C.text,
                      color: serverSyncing ? C.textMute : C.bg,
                      border:`1px solid ${serverSyncing ? C.border : C.text}`,
                      borderRadius:6, padding:"3px 10px", fontSize:11, fontWeight:500,
                      cursor: serverSyncing ? 'wait' : 'pointer', whiteSpace:"nowrap",
                      letterSpacing:'0.04em',
                    }}>
                    {serverSyncing ? '同步中…' : '⟳ 立即更新'}
                  </button>
                  <button
                    onClick={() => setCoverageOpen(true)}
                    title="檢視持倉同步覆蓋率與缺失代碼"
                    style={{
                      background:'transparent', color:C.textSec, border:`1px solid ${C.border}`,
                      borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:400,
                      cursor:"pointer", whiteSpace:"nowrap",
                    }}>覆蓋率</button>
                </>
              )}
              {syncLog.length > 0 && (
                <button
                  onClick={downloadSyncLog}
                  title={`下載任務日誌（共 ${syncLog.length} 筆）`}
                  style={{
                    background:'transparent', color:C.textMute, border:`1px solid ${C.border}`,
                    borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:400,
                    cursor:"pointer", whiteSpace:"nowrap",
                  }}>↓ Log ({syncLog.length})</button>
              )}
              {refreshing && (
                <span style={{fontSize:11,color:C.amber,letterSpacing:'0.04em'}}>
                  ⟳ 同步報價中
                </span>
              )}
              {lastUpdate && !refreshing && (
                <span style={{fontSize:11,color:C.textMute}}>
                  {lastUpdate.toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}
                </span>
              )}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.textMute,marginBottom:2,letterSpacing:"0.05em"}}>未實現損益</div>
            <div style={{fontSize:20,fontWeight:500,color:pc(totalPnl),letterSpacing:"-0.01em",lineHeight:1.2}}>
              {totalPnl>=0?"+":""}{totalPnl.toLocaleString()}
            </div>
            <div style={{fontSize:12,fontWeight:400,color:pc(retPct),opacity:0.6}}>
              {retPct>=0?"+":""}{retPct.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* 報價同步狀態 — 顯示成功/失敗檔數與卡關標的 */}
        {refreshStatus && (
          <div style={{
            margin:'10px 0 4px', padding:'8px 12px',
            borderRadius:6,
            border:`1px solid ${refreshStatus.phase==='error'?alpha(C.down,'44'):refreshStatus.phase==='done' && refreshStatus.fail===0?alpha(C.olive,'44'):C.border}`,
            background: alpha(C.subtle,'88'),
            display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',
          }}>
            <span style={{fontSize:11,fontWeight:500,letterSpacing:'0.06em',color:refreshStatus.phase==='error'?C.down:C.text}}>
              {refreshStatus.phase==='fetching' && '⟳ 抓取 TWSE 報價'}
              {refreshStatus.phase==='done' && refreshStatus.fail===0 && '✓ 報價同步完成'}
              {refreshStatus.phase==='done' && refreshStatus.fail>0 && `△ 同步部分完成 ${refreshStatus.ok}/${refreshStatus.total}`}
              {refreshStatus.phase==='error' && '✕ 同步失敗'}
            </span>
            {refreshStatus.phase!=='fetching' && refreshStatus.missingNames?.length>0 && (
              <span style={{fontSize:11,color:C.textMute}}>
                無報價：{refreshStatus.missingNames.slice(0,5).join('、')}{refreshStatus.missingNames.length>5?` 等 ${refreshStatus.missingNames.length} 檔`:''}
              </span>
            )}
            {refreshStatus.error && (
              <span style={{fontSize:11,color:C.down}}>{refreshStatus.error}</span>
            )}
          </div>
        )}

        {/* today alert - match calendar events by today's date */}
        {todayEvents.length>0 && (
          <div style={{
            borderRadius:4,padding:"7px 10px",marginBottom:10,
            fontSize:12,color:C.textSec,lineHeight:1.7,fontWeight:400}}>
            今日 · {todayEvents.map(e=>e.label).join(" · ")}
          </div>
        )}

        <div style={{display:"flex",gap:0,overflowX:"auto",paddingBottom:0,marginTop:2}}>
          {TABS.map(t=>(
            <button key={t.k} onClick={()=>{setTab(t.k);window.scrollTo({top:0,behavior:"smooth"})}} style={{
              background:"transparent",
              color: tab===t.k ? C.text : C.textMute,
              border:"none",
              borderBottom: tab===t.k ? `1px solid ${C.textSec}` : "1px solid transparent",
              padding:"7px 11px",
              fontSize:12, fontWeight:400,
              cursor:"pointer", whiteSpace:"nowrap",
              transition:"all 0.15s",
              letterSpacing:"0.01em",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{padding:"14px 14px"}}>

        {/* ══════════ HOLDINGS ══════════ */}
        {tab==="holdings" && <>
          {/* ── Hero：橫向 2 欄構圖（左大數字 + 右市場狀態），底部 4 欄 KPI ── */}
          {(()=>{
            const totalPnl = totalVal - totalCost;
            const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
            const isUp = totalPnl >= 0;
            const heroColor = wbTone(totalPnl);
            const winRate = H.length > 0 ? Math.round((winners.length / H.length) * 100) : 0;
            const today = new Date();
            const dateStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;
            const timeStr = today.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
            const pendingCount = (exitList?.length || 0) + (reviewList?.length || 0);

            return (
              <section
                aria-label="Portfolio Overview"
                style={{
                  padding: '20px 4px 22px',
                  marginBottom: 18,
                  borderBottom: `1px solid ${WB.hair}`,
                }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
                  gap: 24,
                  alignItems: 'flex-end',
                  marginBottom: 22,
                }} className="wb-hero-grid">
                  {/* 左：Today's P&L 大字 */}
                  <div>
                    <div style={{
                      fontSize: 11, color: WB.inkMute, letterSpacing: '0.12em',
                      textTransform: 'uppercase', fontWeight: 500, marginBottom: 14,
                    }}>
                      Today's P&amp;L
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
                    }}>
                      <span className="wb-hero-pnl-num" style={{
                        fontSize: 88, fontWeight: 500, color: WB.ink,
                        letterSpacing: '-0.045em', lineHeight: 0.92,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {isUp ? '+' : ''}{Math.round(totalPnl).toLocaleString()}
                      </span>
                      <span className="wb-hero-pnl-pct" style={{
                        fontSize: 22, fontWeight: 500, color: WB.accent,
                        letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
                      }}>
                        {isUp ? '+' : ''}{totalPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  {/* 右：Market 狀態 */}
                  <div className="wb-hero-market" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                    gap: 6, paddingBottom: 8,
                  }}>
                    <div style={{
                      fontSize: 9.5, color: WB.inkMute, letterSpacing: '0.22em',
                      textTransform: 'uppercase', fontWeight: 500,
                      display: 'inline-flex', alignItems: 'baseline', gap: 8,
                    }}>
                      Market <span style={{ color: WB.ink }}>TAIWAN</span>
                      <span style={{
                        display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                        background: WB.accent,
                      }} />
                    </div>
                    <div style={{
                      fontSize: 11, color: WB.inkMute, letterSpacing: '0.04em',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      Updated {dateStr} {timeStr}
                    </div>
                    {pendingCount > 0 && (
                      <div style={{
                        fontSize: 11, color: WB.accent, letterSpacing: '0.04em',
                        marginTop: 2, fontWeight: 500,
                      }}>
                        {pendingCount} pending action{pendingCount > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4 欄 KPI 帶 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 18,
                  paddingTop: 16,
                  borderTop: `1px solid ${WB.hair}`,
                }} className="wb-hero-kpi">
                  {[
                    { label: 'Total Value', value: totalVal > 0 ? Math.round(totalVal).toLocaleString() : '—', sub: 'TWD' },
                    { label: 'Holdings', value: H.length > 0 ? `${H.length} / ${MAX_HOLDINGS}` : '—', sub: H.length > 0 ? (H.length >= MAX_HOLDINGS - 5 ? '⚠ 接近上限' : 'positions') : '' },
                    { label: 'Win Rate', value: H.length > 0 ? `${winRate}` : '—', sub: H.length > 0 ? '%' : '' },
                    { label: 'Cost Basis', value: totalCost > 0 ? Math.round(totalCost).toLocaleString() : '—', sub: 'TWD' },
                  ].map((item) => (
                    <div key={item.label}>
                      <div style={{
                        fontSize: 9, color: WB.inkLight, letterSpacing: '0.20em',
                        marginBottom: 6, textTransform: 'uppercase', fontWeight: 500,
                      }}>
                        {item.label}
                      </div>
                      <div style={{
                        fontSize: 18, fontWeight: 400, color: WB.ink,
                        letterSpacing: '-0.005em', fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {item.value}
                        {item.sub && (
                          <span style={{
                            fontSize: 10.5, color: WB.inkLight, marginLeft: 4, fontWeight: 400, letterSpacing: '0.04em',
                          }}>
                            {item.sub}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}


          {/* 反轉追蹤（虧損持股）— 預設折疊，避免擠壓卡片牆 */}
          {losers.length>0 && (
            <details style={{marginBottom:14}}>
              <summary style={{
                cursor:"pointer", listStyle:"none",
                fontSize:11, color:C.textMute, fontWeight:400, letterSpacing:"0.06em",
                padding:"6px 0", display:"inline-flex", alignItems:"center", gap:6,
              }}>
                <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:C.down}}/>
                反轉追蹤 · {losers.length} 檔虧損持股
                <span style={{opacity:0.5, marginLeft:2}}>展開設定</span>
              </summary>
              <div style={{paddingLeft:12, marginTop:6}}>
                {losers.map(h=>{
                  const rc = (reversalConditions||{})[h.code];
                  const [editing, setEditing] = [
                    reviewingEvent===`rev-${h.code}`,
                    (v)=>setReviewingEvent(v?`rev-${h.code}`:null)
                  ];
                  return <div key={h.code} style={{marginTop:8,padding:"8px 0",
                    borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <span style={{fontSize:13,fontWeight:400,color:C.text}}>{h.name}</span>
                        <span style={{fontSize:12,color:C.down,marginLeft:6}}>{h.pct}%</span>
                      </div>
                      <button onClick={()=>setEditing(!editing)} style={{
                         padding:"3px 9px",borderRadius:5,fontSize:11,cursor:"pointer",
                         background:"transparent",
                         border:`1px solid ${C.border}`,
                         color:C.textMute}}>
                        {rc?"查看條件":"設定反轉條件"}
                      </button>
                    </div>
                    {rc && !editing && (
                      <div style={{fontSize:12,color:C.textSec,marginTop:4,lineHeight:1.7}}>
                        反轉訊號：{rc.signal} | 目標：{rc.target} | 停損：{rc.stopLoss}
                      </div>
                    )}
                    {editing && (()=>{
                      const draft = rc || {signal:"",target:"",stopLoss:"",note:""};
                      return <div style={{marginTop:8,background:C.subtle,borderRadius:7,padding:10}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                          <div>
                            <div style={{fontSize:12,color:C.textMute,marginBottom:2}}>反轉目標價</div>
                            <input defaultValue={draft.target} id={`rv-t-${h.code}`}
                              placeholder="如 130"
                              style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                                borderRadius:6,padding:"6px 8px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                          </div>
                          <div>
                            <div style={{fontSize:12,color:C.textMute,marginBottom:2}}>停損價</div>
                            <input defaultValue={draft.stopLoss} id={`rv-s-${h.code}`}
                              placeholder="如 85"
                              style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                                borderRadius:6,padding:"6px 8px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                          </div>
                        </div>
                        <div style={{marginBottom:6}}>
                          <div style={{fontSize:12,color:C.textMute,marginBottom:2}}>反轉訊號（什麼條件出現代表反轉？）</div>
                          <input defaultValue={draft.signal} id={`rv-g-${h.code}`}
                            placeholder="如：月營收連續兩月成長、法人轉買超"
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:6,padding:"6px 8px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                        </div>
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:12,color:C.textMute,marginBottom:2}}>備註</div>
                          <input defaultValue={draft.note} id={`rv-n-${h.code}`}
                            placeholder="其他觀察..."
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:6,padding:"6px 8px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                        </div>
                        <button onClick={()=>{
                          updateReversal(h.code, {
                            signal: document.getElementById(`rv-g-${h.code}`).value,
                            target: document.getElementById(`rv-t-${h.code}`).value,
                            stopLoss: document.getElementById(`rv-s-${h.code}`).value,
                            note: document.getElementById(`rv-n-${h.code}`).value,
                          });
                          setEditing(false);
                         }} style={{width:"100%",padding:"8px",borderRadius:6,border:`1px solid ${C.border}`,
                           background:"transparent",color:C.textSec,fontSize:13,fontWeight:400,cursor:"pointer"}}>
                          儲存反轉條件
                        </button>
                      </div>;
                    })()}
                  </div>;
                })}
              </div>
            </details>
          )}

          {/* ══════════ Action Priority（單行 inline 文字流） ══════════ */}
          {(() => {
            const items = (globalPriorityList || []).slice(0, 3);
            if (items.length === 0) {
              return (
                <div style={{
                  marginBottom: 18, padding: '6px 2px',
                  fontSize: 11, color: WB.inkLight, fontWeight: 400, letterSpacing: '0.04em',
                }}>
                  No pending actions · Portfolio in good standing
                </div>
              );
            }
            return (
              <div style={{
                marginBottom: 18, padding: '8px 0 12px',
                borderBottom: `1px solid ${WB.hair}`,
                display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: 9.5, color: WB.inkMute, letterSpacing: '0.22em',
                  textTransform: 'uppercase', fontWeight: 500,
                  display: 'inline-flex', alignItems: 'baseline', gap: 8, flexShrink: 0,
                }}>
                  Action Priority
                  <span style={{
                    display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                    background: WB.accent, transform: 'translateY(-1px)',
                  }} />
                </span>
                <span style={{
                  display: 'flex', flexWrap: 'wrap',
                  gap: '14px 28px', flex: 1,
                }}>
                  {items.map((h) => {
                    const dec = decisionsMap[h.code];
                    const tag = dec?.actionType === 'exit' ? 'EXIT'
                      : dec?.actionType === 'review' ? 'REVIEW' : 'WATCH';
                    const desc = dec?.actionText
                      ? (dec.actionText.length > 32 ? dec.actionText.slice(0,30) + '…' : dec.actionText)
                      : (STOCK_META[h.code]?.strategy || '持續監控');
                    return (
                      <button
                        key={h.code}
                        onClick={() => setExpandedDecision(h.code)}
                        style={{
                          background: 'transparent', border: 'none', padding: 0,
                          fontFamily: 'inherit', cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                          gap: 3, textAlign: 'left',
                        }}
                      >
                        <span style={{
                          display: 'inline-flex', alignItems: 'baseline', gap: 6,
                          fontSize: 12, color: WB.ink, fontWeight: 500, letterSpacing: '0.01em',
                        }}>
                          <span style={{
                            fontSize: 9, color: WB.accent, letterSpacing: '0.16em',
                            fontWeight: 500,
                          }}>{tag}</span>
                          <span>{h.code}</span>
                          <span style={{ color: WB.inkSub, fontWeight: 400 }}>{h.name}</span>
                          <span style={{
                            color: WB.inkLight, fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 400,
                          }}>
                            {(h.pct ?? 0) >= 0 ? '+' : ''}{(h.pct ?? 0).toFixed(1)}%
                          </span>
                        </span>
                        <span style={{
                          fontSize: 11, color: WB.inkMute, letterSpacing: '0.01em',
                          lineHeight: 1.5,
                        }}>{desc}</span>
                      </button>
                    );
                  })}
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: '50%',
                  border: `1px solid ${WB.hair}`, color: WB.inkMute, fontSize: 12,
                  flexShrink: 0,
                }}>→</span>
              </div>
            );
          })()}


          {/* ── 持倉資料庫 Filter Bar ── */}

          {(() => {
            const totalCount = H.length;
            const filteredCount = filteredSortedList.length;
            const chipBtn = (active, onClick, label, key) => (
              <button key={key} onClick={onClick} style={{
                background: active ? alpha(C.text, '12') : "transparent",
                color: active ? C.text : C.textMute,
                border: `1px solid ${active ? alpha(C.text,'20') : C.border}`,
                borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 400,
                cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.02em",
              }}>{label}</button>
            );
            const FilterGroup = ({label, options, set, setter}) => (
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.08em",fontWeight:400,minWidth:36}}>{label}</span>
                {options.map(([val, l]) =>
                  chipBtn(set.has(val), () => toggleSetItem(setter)(val), l, val)
                )}
              </div>
            );
            const decLabel = { hold:"持有", review:"檢查", exit:"出場" };
            const thLabel  = { intact:"完整", weakening:"弱化", broken:"破裂" };
            const urLabel  = { now:"立即", soon:"近期", monitor:"觀察" };
            const cfLabel  = { conflict:"有衝突", no_conflict:"無衝突" };
            const pnlLabel = { win:"獲利", loss:"虧損", flat:"平盤" };
            const activeTags = [];
            if (searchQ.trim()) activeTags.push({key:"q", label:`🔍 "${searchQ.trim()}"`, clear:()=>setSearchQ("")});
            filterDecision.forEach(v => activeTags.push({key:`d-${v}`, label:`決策：${decLabel[v]||v}`, clear:()=>toggleSetItem(setFilterDecision)(v)}));
            filterThesis.forEach(v => activeTags.push({key:`t-${v}`, label:`論點：${thLabel[v]||v}`, clear:()=>toggleSetItem(setFilterThesis)(v)}));
            filterUrgency.forEach(v => activeTags.push({key:`u-${v}`, label:`緊急：${urLabel[v]||v}`, clear:()=>toggleSetItem(setFilterUrgency)(v)}));
            filterConflict.forEach(v => activeTags.push({key:`c-${v}`, label:cfLabel[v]||v, clear:()=>toggleSetItem(setFilterConflict)(v)}));
            filterPnl.forEach(v => activeTags.push({key:`p-${v}`, label:`損益：${pnlLabel[v]||v}`, clear:()=>toggleSetItem(setFilterPnl)(v)}));
            filterStrategy.forEach(v => activeTags.push({key:`s-${v}`, label:`題材：${v}`, clear:()=>toggleSetItem(setFilterStrategy)(v)}));

            return (
              <div id="holdings-filter-bar" style={{
                marginBottom:14, padding:"10px 12px",
                background: alpha(C.textMute,'04'),
                border:`1px solid ${alpha(C.textMute,'10')}`,
                borderRadius:8, display:"flex", flexDirection:"column", gap:10,
                position:"sticky", top:0, zIndex:5,
              }}>
                {/* 搜尋框 */}
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{position:"relative",flex:1}}>
                    <input
                      type="text" value={searchQ}
                      onChange={e=>setSearchQ(e.target.value)}
                      placeholder="搜尋代碼／名稱／題材／策略"
                      style={{
                        width:"100%", padding:"7px 28px 7px 30px",
                        background:C.card, border:`1px solid ${C.border}`,
                        borderRadius:6, fontSize:12, color:C.text,
                        outline:"none", fontFamily:"inherit",
                      }}
                    />
                    <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:C.textMute}}>🔍</span>
                    {searchQ && (
                      <button onClick={()=>setSearchQ("")} style={{
                        position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
                        background:"transparent",border:"none",color:C.textMute,fontSize:14,cursor:"pointer",lineHeight:1,padding:0,
                      }}>✕</button>
                    )}
                  </div>
                </div>

                {/* Filter chips（預設折疊） */}
                <details>
                  <summary style={{
                    cursor:"pointer", listStyle:"none",
                    fontSize:10, color:C.textMute, fontWeight:400, letterSpacing:"0.10em",
                    textTransform:"uppercase", padding:"2px 0",
                  }}>
                    Filters {activeTags.length > 0 ? `(${activeTags.length})` : ''} <span style={{opacity:0.5,marginLeft:4}}>▾</span>
                  </summary>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
                    <FilterGroup label="決策" options={[["hold","持有"],["review","檢查"],["exit","出場"]]} set={filterDecision} setter={setFilterDecision} />
                    <FilterGroup label="論點" options={[["intact","完整"],["weakening","弱化"],["broken","破裂"]]} set={filterThesis} setter={setFilterThesis} />
                    <FilterGroup label="緊急" options={[["now","立即"],["soon","近期"],["monitor","觀察"]]} set={filterUrgency} setter={setFilterUrgency} />
                    <FilterGroup label="衝突" options={[["conflict","有衝突"],["no_conflict","無衝突"]]} set={filterConflict} setter={setFilterConflict} />
                    <FilterGroup label="損益" options={[["win","獲利"],["loss","虧損"],["flat","平盤"]]} set={filterPnl} setter={setFilterPnl} />
                    {strategyOptions.length > 0 && (
                      <FilterGroup label="題材" options={strategyOptions.map(s=>[s,s])} set={filterStrategy} setter={setFilterStrategy} />
                    )}
                  </div>
                </details>

                {/* Active tags + counter */}
                {activeTags.length > 0 && (
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",borderTop:`1px dashed ${alpha(C.textMute,'15')}`,paddingTop:8}}>
                    {activeTags.map(t => (
                      <span key={t.key} style={{
                        display:"inline-flex",alignItems:"center",gap:4,
                        background:alpha(C.text,'08'),color:C.textSec,
                        padding:"2px 4px 2px 8px",borderRadius:4,fontSize:11,fontWeight:400,
                      }}>
                        {t.label}
                        <button onClick={t.clear} style={{background:"transparent",border:"none",color:C.textMute,cursor:"pointer",padding:"0 4px",fontSize:12,lineHeight:1}}>✕</button>
                      </span>
                    ))}
                    <span style={{flex:1}} />
                    <span style={{fontSize:11,color:C.textMute,fontWeight:400}}>
                      已篩選 {filteredCount} / {totalCount} 檔
                    </span>
                    <button onClick={clearAllFilters} style={{
                      background:"transparent",border:"none",color:C.textMute,fontSize:11,cursor:"pointer",
                      textDecoration:"underline",fontWeight:400,
                    }}>清除全部</button>
                  </div>
                )}
                {activeTags.length === 0 && (
                  <div style={{fontSize:11,color:C.textMute,textAlign:"right",fontWeight:400}}>
                    共 {totalCount} 檔
                  </div>
                )}
              </div>
            );
          })()}

          {/* 排序 */}
          <div style={{display:"flex",gap:4,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.08em",fontWeight:400}}>排序</span>
            {[["value","市值"],["pnl","損益"],["pct","報酬%"],["urgency","緊急"],["confidence","信心"],["updated","更新"],["decision","決策"]].map(([k,l])=>{
              const active = sortBy === k;
              return (
                <button key={k} onClick={()=>{
                  if (active) setSortDir(d => d === "desc" ? "asc" : "desc");
                  else { setSortBy(k); setSortDir("desc"); }
                }} style={{
                  background:"transparent",
                  color: active ? C.textSec : C.textMute,
                  border:"none",
                  borderBottom: active ? `1px solid ${C.textMute}` : "1px solid transparent",
                  borderRadius:0, padding:"3px 8px", fontSize:11, fontWeight:400, cursor:"pointer",
                  transition:"all 0.15s",
                  display:"inline-flex", alignItems:"center", gap:2,
                }}>
                  {l}
                  {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </button>
              );
            })}
          </div>

          {/* ══════════ 持倉決策工作台：左卡片牆 + 右 Detail Panel ══════════ */}
          {(() => {
            const selectedCode = expandedDecision;
            const selected = selectedCode ? displayed.find(x => x.code === selectedCode) || sorted.find(x => x.code === selectedCode) : null;

            // 配額：最多 1 張 ink（exit 第一張），最多 2 張 accent（其餘 exit 或最緊急 review）
            const variantsMap = assignCardVariants(displayed, {
              getActionType: (it) => decisionsMap[it.code]?.actionType || 'hold',
              getPct: (it) => it.pct ?? 0,
            });

            // 固定節奏：ink → accent → plain（保留原排序）
            // 第一格永遠是 feature（ink 若存在則 span 2；否則保持 grid 整齊）
            const variantOrder = { ink: 0, accent: 1, plain: 2 };
            const orderedDisplayed = [...displayed].sort((a, b) => {
              const va = variantOrder[variantsMap.get(a.code) || 'plain'];
              const vb = variantOrder[variantsMap.get(b.code) || 'plain'];
              if (va !== vb) return va - vb;
              return 0;
            }).map((h, idx) => ({ ...h, __featureSlot: idx === 0 }));

            const renderCard = (h) => {
              const variant = variantsMap.get(h.code) || 'plain';
              const T      = targets?.[h.code];
              const tp     = T ? avgTarget(h.code) : null;
              const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
              const meta   = STOCK_META[h.code] || null;
              const dec    = decisionsMap[h.code];
              const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';
              const isActive = selectedCode === h.code;
              const pctVal = h.pct ?? 0;
              const sparkData = sparklines[h.code] || [];

              // ── Workbench 配色：feature card 採 ink 黑底；其餘白底 ──
              const isInk = variant === 'ink';
              const cardBg = isInk ? WB.ink : WB.surface;
              const cardColor = isInk ? '#F4F1EC' : WB.ink;
              const cardBorder = isInk
                ? 'none'
                : `1px solid ${isActive ? WB.hairStrong : WB.hair}`;
              // span 由 CSS class 控制 (.wb-span-feature 在 ≥641px 時 span 2)
              const isFeatureCard = isInk && h.__featureSlot;
              const MIN_H = 320;

              // ROI / 損益顏色憲法：正→accent 橘 + ↑、負→暖灰 + ↓、零→inkLight
              const muteColor = isInk ? 'rgba(244,241,236,0.50)' : WB.inkLight;
              const subColor = isInk ? 'rgba(244,241,236,0.80)' : WB.inkSub;
              const hairColor = isInk ? 'rgba(244,241,236,0.14)' : WB.hair;
              const lossColor = isInk ? 'rgba(244,241,236,0.55)' : '#8A857F';
              const pnlColor = pctVal > 0 ? WB.accent : pctVal < 0 ? lossColor : muteColor;
              const pnlWeight = pctVal > 0 ? 500 : 400;
              const pnlArrow = pctVal > 0 ? '↑' : pctVal < 0 ? '↓' : '';

              // 報價來源徽章：screenshot=截圖價 / live=即時 / high=最高(成交清空) / ask=賣一(無成交) / yclose=昨收
              const SRC_LABEL = { screenshot: '截圖', live: '即時', high: '最高', ask: '賣一', yclose: '昨收' };
              const srcLabel = h.priceSource ? SRC_LABEL[h.priceSource] : null;
              const srcTitle = h.priceError
                ? `報價問題：${h.priceError}`
                : h.priceUpdatedAt
                  ? `來源：${srcLabel || '—'}　更新於 ${new Date(h.priceUpdatedAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`
                  : '尚未同步即時報價';

              // ─── Feature card (ink + span 2)：黑底，橘紅 ROI，五層雜誌排版 ───
              if (isInk && h.__featureSlot) {
                return (
                  <button
                    key={h.code}
                    className="wb-card wb-card-feature wb-span-feature"
                    onClick={() => setExpandedDecision(prev => prev === h.code ? null : h.code)}
                    onDoubleClick={() => openHoldingDrawer(h.code)}
                    style={{
                      position: 'relative',
                      minHeight: MIN_H,
                      textAlign: 'left',
                      background: cardBg,
                      border: 'none',
                      borderRadius: 0,
                      padding: '24px 28px 20px',
                      cursor: 'pointer',
                      display: 'flex', flexDirection: 'column',
                      transition: 'background 160ms ease',
                      fontFamily: 'inherit',
                      color: cardColor,
                      overflow: 'hidden',
                    }}
                  >
                    {/* L1：股號 + 名稱 + sparkline + FEATURE tag */}
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:6}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:8,minWidth:0,flex:1}}>
                        <span style={{fontSize:11,color:muteColor,fontVariantNumeric:'tabular-nums',letterSpacing:'0.04em'}}>{h.code}</span>
                        <span style={{fontSize:15,fontWeight:400,color:cardColor,letterSpacing:'-0.005em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{h.name}</span>
                      </div>
                      {sparkData.length >= 2 ? (
                        <span className="wb-spark" style={{display:'inline-flex',flexShrink:0}}>
                          <Sparkline data={sparkData} width={60} height={20} color={isInk ? '#F4F1EC' : (pctVal >= 0 ? WB.accent : '#9B968D')} opacity={pctVal >= 0 ? 0.85 : 0.6} />
                        </span>
                      ) : (
                        <span className="wb-spark" aria-hidden style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:60,height:20,fontSize:11,color:muteColor,opacity:0.4,flexShrink:0,letterSpacing:'0.3em'}}>———</span>
                      )}
                      <span style={{
                        fontSize:9,fontWeight:500,letterSpacing:'0.20em',
                        color:WB.accent,textTransform:'uppercase',flexShrink:0,
                      }}>{actionLabel}</span>
                    </div>

                    {/* L2：ROI 主視覺（橘=正、灰=負，加方向箭頭） */}
                    <div style={{
                      display:'flex',alignItems:'baseline',gap:14,marginTop:8,marginBottom:10,
                    }}>
                      <span className="wb-roi" style={{
                        fontSize:'clamp(40px, 6vw + 12px, 64px)',fontWeight:pnlWeight,color:pnlColor,
                        letterSpacing:'-0.04em',lineHeight:1,
                        fontVariantNumeric:'tabular-nums',
                        display:'inline-flex',alignItems:'baseline',gap:6,
                      }}>
                        {pnlArrow && <span style={{fontSize:'0.40em',opacity:0.7,fontWeight:400}}>{pnlArrow}</span>}
                        <span>{pctVal>=0?'+':''}{pctVal.toFixed(2)}<span style={{fontSize:'0.55em',marginLeft:3,opacity:0.6,fontWeight:500,verticalAlign:'baseline'}}>%</span></span>
                      </span>
                      <span style={{fontSize:13,color:subColor,fontVariantNumeric:'tabular-nums',letterSpacing:'0.02em'}}>
                        {h.pnl>=0?'+':''}{Math.round(h.pnl||0).toLocaleString()}
                      </span>
                    </div>

                    {/* L3：分類 tags（filled chip） */}
                    {(meta?.industry || meta?.strategy) && (
                      <div className="wb-tags" style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                        {meta?.industry && (
                          <span style={{fontSize:10,color:'rgba(244,241,236,0.78)',letterSpacing:'0.08em',padding:'4px 8px',background:'rgba(255,255,255,0.08)',border:'none',borderRadius:0}}>{meta.industry}</span>
                        )}
                        {meta?.strategy && (
                          <span style={{fontSize:10,color:'rgba(244,241,236,0.78)',letterSpacing:'0.08em',padding:'4px 8px',background:'rgba(255,255,255,0.08)',border:'none',borderRadius:0}}>{meta.strategy}</span>
                        )}
                      </div>
                    )}

                    {/* L4：說明 */}
                    <div style={{flex:1,display:'flex',alignItems:'center',gap:18,minHeight:48}}>
                      <div style={{flex:1,fontSize:11,color:subColor,lineHeight:1.7,letterSpacing:'0.01em'}}>
                        {dec?.actionText
                          ? (dec.actionText.length > 90 ? dec.actionText.slice(0,88) + '…' : dec.actionText)
                          : (meta?.strategy || '持續監控基本面與籌碼變動。')}
                      </div>
                    </div>

                    {/* L5：底部雙區塊 TODAY / VALUE — 固定 grid 對齊 baseline */}
                    <div className="wb-bottom" style={{
                      paddingTop:12,marginTop:8,
                      borderTop:`1px solid ${hairColor}`,
                      display:'grid',
                      gridTemplateColumns:'minmax(0,1fr) 1px minmax(0,1fr)',
                      gridTemplateRows:'auto auto',
                      columnGap:16,rowGap:2,
                      alignItems:'baseline',
                    }}>
                      <span style={{gridColumn:'1',gridRow:'1',fontSize:9,color:muteColor,letterSpacing:'0.16em',opacity:0.7,lineHeight:1}}>TODAY</span>
                      <span style={{gridColumn:'3',gridRow:'1',fontSize:9,color:muteColor,letterSpacing:'0.16em',opacity:0.7,lineHeight:1}}>VALUE</span>
                      <div style={{gridColumn:'2',gridRow:'1 / span 2',background:hairColor,width:1,height:'100%'}} />
                      <span className="wb-bottom-val" style={{gridColumn:'1',gridRow:'2',fontSize:'clamp(10.5px, 0.9vw + 8px, 12px)',color:subColor,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>
                        {h.pnl>=0?'+':''}{Math.round(h.pnl||0).toLocaleString()}
                        <span style={{marginLeft:6,color:muteColor}}>{pctVal>=0?'+':''}{pctVal.toFixed(2)}%</span>
                      </span>
                      <span className="wb-bottom-val" style={{gridColumn:'3',gridRow:'2',fontSize:'clamp(10.5px, 0.9vw + 8px, 12px)',color:subColor,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>
                        {h.value?.toLocaleString() || '—'}
                        {tp && upside != null && (
                          <span style={{marginLeft:6,color:muteColor}}>TGT {upside>=0?'+':''}{upside.toFixed(1)}%</span>
                        )}
                      </span>
                    </div>
                  </button>
                );
              }

              // ─── Normal card：白底，相同 5 層結構，ROI 52px ───
              return (
                <button
                  key={h.code}
                  className="wb-card wb-span-1"
                  onClick={() => setExpandedDecision(prev => prev === h.code ? null : h.code)}
                  onDoubleClick={() => openHoldingDrawer(h.code)}
                  style={{
                    position: 'relative',
                    minHeight: MIN_H,
                    textAlign: 'left',
                    background: cardBg,
                    border: cardBorder,
                    borderRadius: 0,
                    padding: '22px 22px 18px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'background 160ms ease, border-color 160ms ease',
                    fontFamily: 'inherit',
                    color: cardColor,
                    overflow: 'hidden',
                  }}
                >
                  {/* L1：股號 + 名稱 + sparkline + action tag */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:4}}>
                    <div style={{display:'flex',alignItems:'baseline',gap:8,minWidth:0,flex:1}}>
                      <span style={{fontSize:11,color:muteColor,fontVariantNumeric:'tabular-nums',letterSpacing:'0.04em',flexShrink:0}}>{h.code}</span>
                      <span style={{fontSize:13,fontWeight:400,color:cardColor,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{h.name}</span>
                    </div>
                    {sparkData.length >= 2 ? (
                      <span className="wb-spark" style={{display:'inline-flex',flexShrink:0}}>
                        <Sparkline data={sparkData} width={60} height={20} color={pctVal >= 0 ? WB.accent : '#9B968D'} opacity={pctVal >= 0 ? 0.85 : 0.55} />
                      </span>
                    ) : (
                      <span className="wb-spark" aria-hidden style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:60,height:20,fontSize:11,color:muteColor,opacity:0.4,flexShrink:0,letterSpacing:'0.3em'}}>———</span>
                    )}
                    <span style={{
                      fontSize:9,fontWeight:500,letterSpacing:'0.20em',
                      color:WB.accent,flexShrink:0,
                    }}>{actionLabel}</span>
                  </div>

                  {/* L2：ROI 52px（橘=正、灰=負，加方向箭頭） */}
                  <div style={{display:'flex',alignItems:'baseline',gap:10,marginTop:8,marginBottom:8}}>
                    <span className="wb-roi" style={{
                      fontSize:'clamp(36px, 4.5vw + 10px, 52px)',fontWeight:pnlWeight,color:pnlColor,
                      letterSpacing:'-0.035em',lineHeight:1,
                      fontVariantNumeric:'tabular-nums',
                      display:'inline-flex',alignItems:'baseline',gap:5,
                    }}>
                      {pnlArrow && <span style={{fontSize:'0.40em',opacity:0.7,fontWeight:400}}>{pnlArrow}</span>}
                      <span>{pctVal>=0?'+':''}{pctVal.toFixed(2)}<span style={{fontSize:'0.55em',marginLeft:3,opacity:0.6,fontWeight:500,verticalAlign:'baseline'}}>%</span></span>
                    </span>
                  </div>

                  {/* L3：分類 tags（filled chip） */}
                  {(meta?.industry || meta?.strategy) && (
                    <div className="wb-tags" style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                      {meta?.industry && (
                        <span style={{fontSize:10,color:isInk?'rgba(244,241,236,0.78)':WB.inkSub,letterSpacing:'0.08em',padding:'4px 8px',background:isInk?'rgba(255,255,255,0.08)':'#F4F2EE',border:'none',borderRadius:0}}>{meta.industry}</span>
                      )}
                      {meta?.strategy && (
                        <span style={{fontSize:10,color:isInk?'rgba(244,241,236,0.78)':WB.inkSub,letterSpacing:'0.08em',padding:'4px 8px',background:isInk?'rgba(255,255,255,0.08)':'#F4F2EE',border:'none',borderRadius:0}}>{meta.strategy}</span>
                      )}
                    </div>
                  )}

                  {/* L4：說明 */}
                  <div style={{flex:1,display:'flex',alignItems:'flex-end',gap:14,minHeight:40,paddingTop:4}}>
                    <div style={{flex:1,fontSize:11,color:subColor,lineHeight:1.65}}>
                      {dec?.actionText
                        ? (dec.actionText.length > 60 ? dec.actionText.slice(0,58) + '…' : dec.actionText)
                        : (meta?.strategy ? meta.strategy.slice(0,40) : '')}
                    </div>
                  </div>

                  {/* L5：底部雙區塊 TODAY / VALUE — 固定 grid 對齊 baseline */}
                  <div className="wb-bottom" style={{
                    paddingTop:10,marginTop:8,
                    borderTop:`1px solid ${hairColor}`,
                    display:'grid',
                    gridTemplateColumns:'minmax(0,1fr) 1px minmax(0,1fr)',
                    gridTemplateRows:'auto auto',
                    columnGap:12,rowGap:2,
                    alignItems:'baseline',
                    fontSize:10,color:muteColor,fontWeight:400,
                    fontVariantNumeric:'tabular-nums',letterSpacing:'0.06em',
                  }}>
                    <span style={{gridColumn:'1',gridRow:'1',fontSize:9,color:muteColor,letterSpacing:'0.16em',opacity:0.7,lineHeight:1}}>TODAY</span>
                    <span style={{gridColumn:'3',gridRow:'1',display:'flex',alignItems:'center',gap:6,fontSize:9,color:muteColor,letterSpacing:'0.16em',opacity:0.7,lineHeight:1}}>
                      <span>VALUE</span>
                      {srcLabel && (
                        <span title={srcTitle} style={{
                          fontSize:8,letterSpacing:'0.06em',padding:'1px 5px',borderRadius:2,
                          background: h.priceSource==='live' ? alpha(WB.accent,'22') : h.priceSource==='screenshot' ? alpha(muteColor,'18') : alpha(lossColor,'22'),
                          color: h.priceSource==='live' ? WB.accent : subColor,
                          opacity:0.85,fontWeight:500,
                        }}>{srcLabel}</span>
                      )}
                      {h.priceError && !srcLabel && (
                        <span title={h.priceError} style={{fontSize:8,padding:'1px 5px',borderRadius:2,background:alpha(lossColor,'22'),color:lossColor}}>失敗</span>
                      )}
                    </span>
                    <div style={{gridColumn:'2',gridRow:'1 / span 2',background:hairColor,width:1,height:'100%'}} />
                    <span className="wb-bottom-val" style={{gridColumn:'1',gridRow:'2',fontSize:'clamp(10.5px, 0.9vw + 8px, 12px)',color:subColor,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>
                      {h.pnl>=0?'+':''}{Math.round(h.pnl||0).toLocaleString()}
                      <span style={{marginLeft:6,color:muteColor}}>{pctVal>=0?'+':''}{pctVal.toFixed(2)}%</span>
                    </span>
                    <span className="wb-bottom-val" style={{gridColumn:'3',gridRow:'2',fontSize:'clamp(10.5px, 0.9vw + 8px, 12px)',color:subColor,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>
                      {h.value?.toLocaleString() || '—'}
                    </span>
                  </div>
                </button>
              );
            };

            const renderDetailPanel = () => {
              if (!selected) return null;
              const h = selected;
              const dec = decisionsMap[h.code];
              const meta = STOCK_META[h.code] || null;
              const T = targets?.[h.code];
              const tp = T ? avgTarget(h.code) : null;
              const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
              const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';
              const pctVal = h.pct ?? 0;
              const pnlColor = WB.accent;
              // URGENCY 五點：now=4, soon=3, monitor=2, hold/none=1
              const urgencyLevel = dec?.urgency === 'now' ? 4 : dec?.urgency === 'soon' ? 3 : dec?.urgency === 'monitor' ? 2 : 1;
              const relatedEvents = normalizedEvents
                .filter(e => (e.relatedCodes || []).includes(h.code) && e.source !== 'demo')
                .slice(0, 5);

              const visibleList = orderedDisplayed;
              const curIdx = visibleList.findIndex(x => x.code === h.code);
              const prev = curIdx > 0 ? visibleList[curIdx - 1] : null;
              const next = curIdx < visibleList.length - 1 ? visibleList[curIdx + 1] : null;
              const tomorrowEv = relatedEvents[0];

              return (
                <div>
                  {/* 頂部 nav: < > × */}
                  <div style={{
                    display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'12px 16px',borderBottom:`1px solid ${WB.hair}`,
                  }}>
                    <div style={{display:'flex',gap:4}}>
                      <button
                        onClick={() => prev && setExpandedDecision(prev.code)}
                        disabled={!prev}
                        style={{
                          width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
                          cursor: prev?'pointer':'not-allowed',color: prev?WB.ink:WB.inkLight,
                          fontSize:12,borderRadius:2,fontFamily:'inherit',
                        }}
                      >‹</button>
                      <button
                        onClick={() => next && setExpandedDecision(next.code)}
                        disabled={!next}
                        style={{
                          width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
                          cursor: next?'pointer':'not-allowed',color: next?WB.ink:WB.inkLight,
                          fontSize:12,borderRadius:2,fontFamily:'inherit',
                        }}
                      >›</button>
                    </div>
                    <span style={{fontSize:10,color:WB.inkMute,letterSpacing:'0.16em',fontWeight:500}}>
                      {String(curIdx+1).padStart(2,'0')} / {String(visibleList.length).padStart(2,'0')}
                    </span>
                    <button
                      onClick={() => setExpandedDecision(null)}
                      style={{
                        width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
                        cursor:'pointer',color:WB.ink,fontSize:14,borderRadius:2,fontFamily:'inherit',
                      }}
                    >×</button>
                  </div>

                  <div style={{padding:'18px 22px 24px'}}>
                    {/* Header */}
                    <div style={{marginBottom:18}}>
                      <div style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',marginBottom:6,fontWeight:500}}>持倉細節</div>
                      <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}>
                        <span style={{fontSize:11,color:WB.inkMute,fontVariantNumeric:'tabular-nums',letterSpacing:'0.04em'}}>{h.code}</span>
                        <span style={{fontSize:18,fontWeight:500,color:WB.ink,letterSpacing:'-0.005em'}}>{h.name}</span>
                      </div>
                      {(meta?.industry || meta?.strategy) && (
                        <div style={{fontSize:11,color:WB.inkMute,letterSpacing:'0.02em'}}>
                          {meta?.industry || ''}{meta?.industry && meta?.strategy ? ' · ' : ''}{meta?.strategy || ''}
                        </div>
                      )}
                    </div>

                    {/* PnL */}
                    <div style={{marginBottom:20,paddingBottom:16,borderBottom:`1px solid ${WB.hair}`}}>
                      <div className="wb-card-pnl-num" style={{
                        fontSize:48,fontWeight:500,color:WB.ink,
                        letterSpacing:'-0.03em',lineHeight:1,
                        fontVariantNumeric:'tabular-nums',
                      }}>
                        {pctVal>=0?'+':''}{pctVal.toFixed(2)}<span className="wb-card-pnl-pct" style={{fontSize:18,opacity:0.55,marginLeft:2}}>%</span>
                      </div>
                      <div style={{marginTop:8,fontSize:12,color:WB.inkMute,fontVariantNumeric:'tabular-nums',letterSpacing:'0.02em'}}>
                        {h.pnl>=0?'+':''}{Math.round(h.pnl||0).toLocaleString()} ・ VALUE {h.value?.toLocaleString() || '—'}
                      </div>
                    </div>

                    {/* DECISION 黑底盒 */}
                    <div style={{
                      background:WB.ink,color:'#F4F1EC',
                      padding:'18px 18px 20px',marginBottom:18,borderRadius:3,
                    }}>
                      <div style={{fontSize:9,color:'rgba(244,241,236,0.55)',letterSpacing:'0.20em',marginBottom:8,fontWeight:500}}>DECISION</div>
                      <div style={{
                        fontSize:22,fontWeight:500,color:WB.accent,letterSpacing:'0.04em',
                        marginBottom:14,
                      }}>{actionLabel}</div>
                      <div style={{fontSize:12,color:'#E8E4DD',lineHeight:1.7,marginBottom:6}}>
                        {dec?.actionText || (
                          actionLabel==='EXIT' ? '建議出場：論點已破裂或重大事件衝擊。' :
                          actionLabel==='REVIEW' ? '需要檢查：論點弱化或有未決事件。' :
                          '繼續持有：論點完整,無近期催化事件。'
                        )}
                      </div>
                      {dec && (
                        <div style={{fontSize:11,color:'rgba(244,241,236,0.65)',lineHeight:1.7,letterSpacing:'0.02em'}}>
                          論點 {dec.thesisState==='broken'?'破裂':dec.thesisState==='weakening'?'弱化':'完整'}
                          {' · 信心 '}{dec.confidence==='high'?'高':dec.confidence==='medium'?'中':'低'}
                          {' · 事件 '}{dec.openEventCount || 0}
                        </div>
                      )}
                    </div>

                    {/* URGENCY 五點 */}
                    <div style={{marginBottom:18,display:'flex',alignItems:'center',gap:14}}>
                      <span style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',fontWeight:500}}>急迫程度</span>
                      <div style={{display:'flex',gap:6,flex:1}}>
                        {[1,2,3,4,5].map(i => (
                          <span key={i} style={{
                            width:7,height:7,borderRadius:'50%',
                            background: i <= urgencyLevel ? WB.accent : 'transparent',
                            border: i <= urgencyLevel ? 'none' : `1px solid ${WB.hairStrong}`,
                          }} />
                        ))}
                      </div>
                      <span style={{fontSize:10,color:WB.inkMute,letterSpacing:'0.10em'}}>
                        {dec?.urgency==='now'?'NOW':dec?.urgency==='soon'?'SOON':dec?.urgency==='monitor'?'MONITOR':'LOW'}
                      </span>
                    </div>

                    {/* Targets */}
                    {tp && (
                      <div style={{marginBottom:18}}>
                        <div style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.20em',marginBottom:8,fontWeight:500}}>TARGET</div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                          <span style={{fontSize:12,color:WB.inkSub,fontVariantNumeric:'tabular-nums'}}>{tp.toLocaleString()}</span>
                          <span style={{fontSize:12,color:WB.accent,fontVariantNumeric:'tabular-nums'}}>
                            {upside>=0?'+':''}{upside?.toFixed(1)}%
                          </span>
                        </div>
                        <div style={{background:WB.hair,height:2,width:'100%',overflow:'hidden'}}>
                          <div style={{
                            width:`${Math.min(Math.max((h.price/tp)*100,0),100)}%`,
                            height:'100%',background:WB.accent,opacity:0.8,
                          }}/>
                        </div>
                      </div>
                    )}

                    {/* EVENT TIMELINE */}
                    {relatedEvents.length > 0 && (
                      <div style={{marginBottom:18}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                          <span style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',fontWeight:500}}>事件時程</span>
                          {tomorrowEv && (
                            <span style={{
                              fontSize:9,color:WB.surface,background:WB.accent,
                              padding:'2px 7px',letterSpacing:'0.16em',fontWeight:500,borderRadius:2,
                            }}>TOMORROW</span>
                          )}
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:10}}>
                          {relatedEvents.map((e, idx) => (
                            <div key={e.id || idx} style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                              <span style={{
                                marginTop:6,width:5,height:5,borderRadius:'50%',
                                background: idx===0 ? WB.accent : WB.hairStrong,flexShrink:0,
                              }} />
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,color:WB.inkSub,fontWeight:400,lineHeight:1.5}}>
                                  {e.summary || e.title || '(無摘要)'}
                                </div>
                                <div style={{fontSize:10,color:WB.inkLight,marginTop:2,letterSpacing:'0.04em'}}>
                                  {e.source==='user'?'手動':e.source==='ai'?'AI':e.source==='calendar'?'日曆':'其他'}
                                  {e.date ? ` · ${e.date}` : ''}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* OVERRIDE */}
                    <div style={{
                      paddingTop:14,marginTop:6,borderTop:`1px solid ${WB.hair}`,
                      display:'flex',alignItems:'center',gap:8,
                    }}>
                      {dec && !userOverrides[h.code] && dec.actionType !== 'hold' ? (
                        <button
                          onClick={() => {
                            setUserOverrides(prev => ({...prev, [h.code]: {
                              actionType: 'hold',
                              actionText: '手動覆寫:維持持有',
                              expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                              appliesToEventIds: normalizedEvents.filter(e => (e.relatedCodes||[]).includes(h.code) && isEventOpen(e)).map(e => e.id),
                              basedOnDerivedAt: new Date().toISOString(),
                              decisionFingerprint: dec.fingerprint,
                            }}));
                          }}
                          style={{
                            flex:1,padding:'10px 14px',background:'transparent',
                            border:`1px solid ${WB.ink}`,borderRadius:2,
                            color:WB.ink,fontSize:11,fontWeight:500,cursor:'pointer',
                            letterSpacing:'0.08em',fontFamily:'inherit',
                          }}
                        >標記為持有</button>
                      ) : (
                        <span style={{flex:1,fontSize:10,color:WB.inkLight,letterSpacing:'0.10em'}}>
                          {userOverrides[h.code] ? '已覆寫為持有' : '無需覆寫'}
                        </span>
                      )}
                      <button
                        onClick={() => openHoldingDrawer(h.code)}
                        title="編輯 / 完整研究"
                        style={{
                          width:36,height:36,background:'transparent',
                          border:`1px solid ${WB.hair}`,borderRadius:2,cursor:'pointer',
                          color:WB.inkMute,fontSize:13,fontFamily:'inherit',
                        }}
                      >✎</button>
                    </div>
                  </div>
                </div>
              );
            };

            // ── grid layout：selected 時才顯示 detail panel；否則卡片牆滿版 ──
            const showPanel = !!selected;
            return (
              <div style={{
                display:'grid',
                gridTemplateColumns: showPanel ? 'minmax(0, 1fr) minmax(0, 420px)' : 'minmax(0, 1fr)',
                gap: showPanel ? 20 : 0,
                alignItems:'flex-start',
              }} className="holdings-workbench">
                {/* 左：卡片牆 */}
                <div style={{
                  display:'grid',
                  gridTemplateColumns: cardGridCols,
                  columnGap: 16,
                  rowGap: 20,
                }} className={`holdings-card-grid${viewMode === 'list' ? ' holdings-card-grid--list' : ''}`}>
                  {orderedDisplayed.map(h => renderCard(h))}
                  {/* + Add Watchlist 虛線卡 */}
                  <button
                    onClick={() => setTab && setTab('watchlist')}
                    className="wb-span-1"
                    style={{
                      minHeight: 320,
                      background:'transparent',
                      border:`1px dashed ${WB.hairStrong}`,
                      borderRadius:4,
                      color:WB.inkLight,
                      cursor:'pointer',
                      fontFamily:'inherit',
                      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                      gap:10,
                      letterSpacing:'0.18em',
                      transition:'border-color 160ms ease, color 160ms ease',
                    }}
                    onMouseEnter={(e)=>{e.currentTarget.style.borderColor=WB.ink;e.currentTarget.style.color=WB.ink;}}
                    onMouseLeave={(e)=>{e.currentTarget.style.borderColor=WB.hairStrong;e.currentTarget.style.color=WB.inkLight;}}
                  >
                    <span style={{fontSize:24,fontWeight:300,lineHeight:1}}>+</span>
                    <span style={{fontSize:10,fontWeight:500}}>加入觀察</span>
                  </button>
                  {!showAll && sorted.length > 12 && (
                    <button
                      onClick={() => setShowAll(true)}
                      className="wb-span-full"
                      style={{
                        padding:'12px',
                        background:'transparent',
                        border:`1px dashed ${WB.hair}`,
                        borderRadius:4,
                        color:WB.inkMute, fontSize:11, cursor:'pointer', fontWeight:500,
                        letterSpacing:'0.16em',
                        fontFamily:'inherit',
                      }}
                    >
                      VIEW ALL {sorted.length}
                    </button>
                  )}
                </div>

                {/* 右：Detail Panel — 只在 selected 時顯示 */}
                {showPanel && (
                  <aside
                    className="holdings-detail-panel"
                    style={{
                      position:'sticky', top:12,
                      background: WB.surface,
                      border:`1px solid ${WB.hairStrong}`,
                      borderRadius:4,
                      maxHeight:'calc(100vh - 24px)',
                      overflowY:'auto',
                    }}
                  >
                    {renderDetailPanel()}
                  </aside>
                )}
              </div>
            );
          })()}

          {/* Step 7：底部狀態列 */}
          <div style={{
            marginTop:24,paddingTop:14,
            borderTop:`1px solid ${WB.hair}`,
            display:'flex',justifyContent:'space-between',alignItems:'center',
            fontSize:10,color:WB.inkMute,letterSpacing:'0.16em',fontWeight:500,
          }}>
            <span>{sorted.length} HOLDINGS</span>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              {/* SORT BY 下拉選單 */}
              <div style={{position:'relative'}}>
                <button
                  type="button"
                  onClick={() => setSortMenuOpen(v => !v)}
                  style={{
                    background:'transparent', border:'none', padding:0, margin:0,
                    fontSize:10, color:WB.inkMute, letterSpacing:'0.16em', fontWeight:500,
                    cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6,
                    fontFamily:'inherit',
                  }}
                >
                  SORT BY <span style={{color:WB.ink}}>
                    {(() => {
                      const map = {decision:'PRIORITY', value:'VALUE', pnl:'P&L', pct:'RETURN', urgency:'URGENCY', confidence:'CONFIDENCE', updated:'UPDATED'};
                      return map[sortBy] || 'PRIORITY';
                    })()} {sortMenuOpen ? '▴' : '▾'}
                  </span>
                </button>
                {sortMenuOpen && (
                  <>
                    <div
                      onClick={() => setSortMenuOpen(false)}
                      style={{position:'fixed', inset:0, zIndex:40}}
                    />
                    <div style={{
                      position:'absolute', bottom:'calc(100% + 6px)', right:0, zIndex:50,
                      background:WB.surface, border:`1px solid ${WB.hairStrong}`, borderRadius:4,
                      minWidth:140, padding:'6px 0',
                      boxShadow:'0 2px 12px rgba(0,0,0,0.04)',
                    }}>
                      {[['decision','PRIORITY'],['value','VALUE'],['pnl','P&L'],['pct','RETURN'],['urgency','URGENCY'],['confidence','CONFIDENCE'],['updated','UPDATED']].map(([k,l]) => {
                        const active = sortBy === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                              else { setSortBy(k); setSortDir('desc'); }
                              setSortMenuOpen(false);
                            }}
                            style={{
                              display:'flex', alignItems:'center', justifyContent:'space-between',
                              width:'100%', padding:'7px 14px', background:'transparent',
                              border:'none', cursor:'pointer', fontFamily:'inherit',
                              fontSize:10, letterSpacing:'0.14em', fontWeight:active?500:400,
                              color: active ? WB.ink : WB.inkMute, textAlign:'left',
                            }}
                          >
                            <span>{l}</span>
                            {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <span style={{width:1,height:12,background:WB.hair}}/>
              {/* 檢視模式切換 */}
              <span style={{display:'flex',gap:4}}>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="格狀檢視"
                  aria-pressed={viewMode === 'grid'}
                  style={{
                    display:'inline-flex',alignItems:'center',justifyContent:'center',
                    width:22,height:22,
                    border:`1px solid ${viewMode === 'grid' ? WB.ink : WB.hair}`,
                    color: viewMode === 'grid' ? WB.ink : WB.inkLight,
                    background:'transparent', padding:0, cursor:'pointer',
                    fontSize:10, borderRadius:2, fontFamily:'inherit',
                    transition:'all 0.15s',
                  }}
                >▦</button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="清單檢視"
                  aria-pressed={viewMode === 'list'}
                  style={{
                    display:'inline-flex',alignItems:'center',justifyContent:'center',
                    width:22,height:22,
                    border:`1px solid ${viewMode === 'list' ? WB.ink : WB.hair}`,
                    color: viewMode === 'list' ? WB.ink : WB.inkLight,
                    background:'transparent', padding:0, cursor:'pointer',
                    fontSize:10, borderRadius:2, fontFamily:'inherit',
                    transition:'all 0.15s',
                  }}
                >≡</button>
              </span>
            </div>
          </div>

          {/* RWD：mid 折成 2 欄、行動端 1 欄並隱藏 detail panel */}
          <style>{`
            /* Desktop 預設：3 欄。改用 class 而非 inline style，讓下方 media query 能在行動端生效 */
            .holdings-card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            /* 清單檢視：強制單欄並讓 feature 卡片佔滿一列 */
            .holdings-card-grid--list { grid-template-columns: 1fr !important; }
            .holdings-card-grid--list .wb-span-feature,
            .holdings-card-grid--list .wb-card-feature { grid-column: 1 / -1 !important; }
            .holdings-card-grid--list .wb-card { min-height: 0 !important; }
            /* 卡片 span 工具類：以 CSS 控制，避免 inline style 在 RWD 切換時 race */
            .wb-span-1 { grid-column: span 1; }
            .wb-span-feature { grid-column: span 2; }
            .wb-span-full { grid-column: 1 / -1; }
            @media (max-width: 1279px) {
              .holdings-workbench { grid-template-columns: minmax(0, 1fr) minmax(0, 320px) !important; }
              .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
            }
            @media (max-width: 1023px) {
              .holdings-workbench { grid-template-columns: 1fr !important; }
              .holdings-detail-panel { display: none !important; }
              .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
            }
            /* 卡片內元素 baseline 對齊強化（所有尺寸通用） */
            .wb-card .wb-roi {
              font-feature-settings: "tnum" 1;
              vertical-align: baseline;
              white-space: nowrap;
              max-width: 100%;
              overflow: hidden;
              text-overflow: clip;
            }
            .wb-card .wb-roi > * { white-space: nowrap; }
            .wb-card .wb-bottom { align-items: baseline !important; min-width: 0; }
            .wb-card .wb-bottom > span { min-width: 0; overflow: hidden; }
            .wb-card .wb-bottom-val {
              display: inline-block;
              vertical-align: baseline;
              white-space: nowrap;
              max-width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            @media (max-width: 768px) {
              .wb-card-feature { padding: 20px 18px 16px !important; }
              .wb-card { padding: 18px 16px 14px !important; }
              .wb-card .wb-bottom { gap: 10px !important; }
              .wb-card .wb-tags { row-gap: 6px !important; }
            }
            @media (max-width: 640px) {
              .holdings-card-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
              .wb-card-feature, .wb-span-feature { grid-column: span 1 !important; }
              .wb-card { min-height: 0 !important; }
              .wb-card .wb-spark { width: 52px !important; }
              .wb-card .wb-bottom { gap: 8px !important; }
              .wb-card .wb-bottom-val { font-size: clamp(10px, 2.6vw, 12px) !important; }
            }
            @media (max-width: 380px) {
              .wb-card .wb-spark { display: none !important; }
              .wb-card .wb-bottom .wb-bottom-val { letter-spacing: 0 !important; }
              .wb-card .wb-bottom-val { font-size: clamp(9.5px, 2.4vw, 11px) !important; }
            }
            /* 極窄寬度安全溢出策略：縮放 ROI 數字避免擠壓換行 */
            @media (max-width: 340px) {
              .wb-card .wb-roi { font-size: clamp(28px, 11vw, 36px) !important; }
              .wb-card-feature .wb-roi { font-size: clamp(32px, 13vw, 44px) !important; }
              /* TODAY/VALUE 雙區塊在極窄螢幕的安全溢出策略 */
              .wb-card .wb-bottom {
                grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr) !important;
                column-gap: 6px !important;
                row-gap: 1px !important;
                max-width: 100% !important;
                overflow: hidden !important;
              }
              .wb-card .wb-bottom > span {
                min-width: 0 !important;
                max-width: 100% !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
              }
              .wb-card .wb-bottom-lbl,
              .wb-card .wb-bottom > span:not(.wb-bottom-val) {
                font-size: clamp(8.5px, 2.6vw, 10px) !important;
                letter-spacing: 0 !important;
              }
              .wb-card .wb-bottom-val {
                font-size: clamp(9px, 3vw, 11px) !important;
                letter-spacing: -0.2px !important;
                font-variant-numeric: tabular-nums !important;
              }
            }
            /* 超極窄保險（≤320px iPhone SE 1st） */
            @media (max-width: 320px) {
              .wb-card .wb-bottom { column-gap: 4px !important; }
              .wb-card .wb-bottom-val { font-size: clamp(8.5px, 2.8vw, 10.5px) !important; }
            }
          `}</style>
        </>}

        {/* ══════════ WATCHLIST ══════════ */}
        {tab==="watchlist" && <>
          {H.length === 0 ? (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400}}>尚無觀察股</div>
              <div style={{fontSize:12,color:C.textMute,marginTop:6,lineHeight:1.7}}>
                上傳成交截圖後，持倉股票會自動出現在觀察清單
              </div>
            </div>
          ) : (
            H.map((h,wi)=>{
              const tgt = targets && targets[h.code] ? avgTarget(h.code) : null;
              const upside = tgt ? (((tgt - h.price) / h.price) * 100).toFixed(1) : null;
              const prog = tgt ? Math.min(h.price / tgt * 100, 100) : 0;
              return <div key={h.code} style={{padding:"10px 0",
                borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:400,color:C.text}}>{h.name}</span>
                    <span style={{fontSize:10,color:C.textMute,fontWeight:400,marginLeft:6}}>{h.code}</span>
                    <span style={{fontSize:11,color:C.textMute,marginLeft:8}}>持有 {h.qty} {h.unit || "股"}</span>
                  </div>
                  <span style={{fontSize:12,fontWeight:400,
                    color: h.pnl >= 0 ? C.up : C.down}}>
                    {h.pnl >= 0 ? "獲利中" : "虧損中"}
                  </span>
                </div>
                <div style={{display:"flex",gap:16,marginTop:6,flexWrap:"wrap"}}>
                  {[["市價", h.price?.toLocaleString() || "—", C.textSec],
                    ["成本", h.cost != null ? String(h.cost) : "—", C.textMute],
                    ...(tgt ? [["目標價", tgt.toLocaleString(), C.textSec], ["潛在漲幅", (upside > 0 ? "+" : "") + upside + "%", C.textSec]] : []),
                    ["損益", (h.pnl >= 0 ? "+" : "") + h.pct?.toFixed(2) + "%", h.pnl >= 0 ? C.up : C.down],
                  ].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:10,color:C.textMute,marginBottom:2,letterSpacing:"0.05em"}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:400,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                {tgt && <div style={{marginTop:8}}>
                  <div style={{background:alpha(C.textMute,'06'),borderRadius:1,height:2}}>
                    <div style={{width:`${prog}%`,height:"100%",
                      background:alpha(C.textMute,'20'),borderRadius:1}}/>
                  </div>
                </div>}
              </div>;
            })
          )}
        </>}

        {/* ══════════ EVENTS ══════════ */}
        {tab==="events" && <>
          {/* 手動更新 + 自動更新狀態徽章（行事曆 + 預測） */}
          {(() => {
            const STATUS_LABEL = {
              fetching: { txt: '⟳ 擷取中…', color: C.amber },
              throttled: { txt: '⏱ 已節流（30 秒內已更新）', color: C.textMute },
              'skipped-idempotent': { txt: '⊘ 已跳過（同批次進行中）', color: C.textMute },
              aborted: { txt: '✕ 已中斷舊請求', color: C.textMute },
              success: { txt: '✓ 完成', color: C.up },
              error: { txt: '⚠ 失敗', color: C.amber },
            };
            const cal = STATUS_LABEL[calendarAutoStatus.status];
            const pre = STATUS_LABEL[predictAutoStatus.status];
            const calBusy = calendarAutoStatus.status === 'fetching' || calendarLoading;
            const preBusy = predictAutoStatus.status === 'fetching' || predictingEvents;
            const nowMs = Date.now();
            const calCool = Math.max(0, calendarRetry.cooldownUntil - nowMs);
            const preCool = Math.max(0, predictRetry.cooldownUntil - nowMs);
            const calRetryDisabled = calBusy || calCool > 0;
            const preRetryDisabled = preBusy || preCool > 0;
            const calCoolSec = Math.ceil(calCool / 1000);
            const preCoolSec = Math.ceil(preCool / 1000);
            const REASON_LABEL = { network: '網路', data: '資料', server: '伺服器', unknown: '未知' };
            const retryBtnStyle = (disabled) => ({
              padding:"2px 8px",fontSize:10,fontWeight:500,
              border:`1px solid ${alpha(C.amber, disabled?'33':'66')}`,borderRadius:4,
              background:alpha(C.amber, disabled?'08':'14'),
              color:disabled?C.textMute:C.amber,
              cursor:disabled?"not-allowed":"pointer",
              letterSpacing:"0.02em",
              opacity:disabled?0.6:1,
            });
            return (
              <div style={{marginBottom:10}}>
                {/* 手動按鈕列 */}
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                  <button
                    onClick={manualRefreshCalendar}
                    disabled={calBusy || !holdings || holdings.length === 0 || calCool > 0}
                    style={{
                      padding:"5px 10px",fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                      border:`1px solid ${alpha(C.textMute,'33')}`,borderRadius:6,
                      background:"transparent",color:(calBusy||calCool>0)?C.textMute:C.text,
                      cursor:calBusy||!holdings?.length||calCool>0?"not-allowed":"pointer",
                      opacity:calBusy||!holdings?.length||calCool>0?0.5:1,
                    }}
                  >{calBusy ? '⟳ 更新中…' : (calCool>0 ? `↻ 冷卻中 ${calCoolSec}s` : '↻ 立刻更新行事曆')}</button>
                  <button
                    onClick={() => runPredictEvents(true)}
                    disabled={preBusy || !newsEvents || newsEvents.length === 0 || preCool > 0}
                    style={{
                      padding:"5px 10px",fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                      border:`1px solid ${alpha(C.textMute,'33')}`,borderRadius:6,
                      background:"transparent",color:(preBusy||preCool>0)?C.textMute:C.text,
                      cursor:preBusy||!newsEvents?.length||preCool>0?"not-allowed":"pointer",
                      opacity:preBusy||!newsEvents?.length||preCool>0?0.5:1,
                    }}
                  >{preBusy ? '⟳ 預測中…' : (preCool>0 ? `↻ 冷卻中 ${preCoolSec}s` : '↻ 立刻預測事件')}</button>
                </div>
                {/* 狀態徽章 */}
                {(cal || pre) && (
                  <div style={{
                    display:"flex",gap:8,flexWrap:"wrap",
                    padding:"6px 10px",background:alpha(C.textMute,'04'),
                    borderRadius:6,fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                  }}>
                    {cal && (
                      <span style={{color:cal.color,display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>行事曆</span>
                        <span>{cal.txt}{calendarAutoStatus.msg ? `・${calendarAutoStatus.msg}` : ''}</span>
                        {calendarAutoStatus.status === 'error' && (
                          <button
                            onClick={manualRefreshCalendar}
                            disabled={calRetryDisabled}
                            title={calBusy ? '正在更新中，請稍候' : (calCool>0 ? `冷卻中，${calCoolSec} 秒後可重試` : '重新嘗試擷取行事曆')}
                            style={retryBtnStyle(calRetryDisabled)}
                          >{calBusy ? '⟳ 正在更新…' : (calCool>0 ? `↻ ${calCoolSec}s` : `↻ 重試 (${calendarRetry.count}/${RETRY_MAX})`)}</button>
                        )}
                      </span>
                    )}
                    {cal && pre && <span style={{color:C.textMute,opacity:0.3}}>·</span>}
                    {pre && (
                      <span style={{color:pre.color,display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>事件預測</span>
                        <span>{pre.txt}{predictAutoStatus.msg ? `・${predictAutoStatus.msg}` : ''}</span>
                        {predictAutoStatus.status === 'error' && (
                          <button
                            onClick={() => runPredictEvents(true)}
                            disabled={preRetryDisabled}
                            title={preBusy ? '正在更新中，請稍候' : (preCool>0 ? `冷卻中，${preCoolSec} 秒後可重試` : '重新嘗試預測事件')}
                            style={retryBtnStyle(preRetryDisabled)}
                          >{preBusy ? '⟳ 正在更新…' : (preCool>0 ? `↻ ${preCoolSec}s` : `↻ 重試 (${predictRetry.count}/${RETRY_MAX})`)}</button>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {/* 失敗錯誤明細卡片 */}
                {(calendarLastError && calendarAutoStatus.status === 'error') && (
                  <div style={{
                    marginTop:6,padding:"8px 10px",
                    background:alpha(C.amber,'08'),
                    border:`1px solid ${alpha(C.amber,'33')}`,
                    borderRadius:6,fontSize:11,lineHeight:1.6,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3}}>
                      <span style={{color:C.amber,fontWeight:500}}>
                        行事曆 · {REASON_LABEL[calendarLastError.reason] || '未知'}類錯誤
                      </span>
                      <span style={{color:C.textMute,fontSize:10,opacity:0.7}}>
                        {new Date(calendarLastError.at).toLocaleTimeString('zh-TW',{hour12:false})}
                      </span>
                    </div>
                    <div style={{color:C.textMute,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:10,wordBreak:"break-word"}}>
                      {calendarLastError.message}
                    </div>
                    {calendarRetry.count >= RETRY_MAX && (
                      <div style={{marginTop:4,color:C.amber,fontSize:10,opacity:0.8}}>
                        已連續失敗 {calendarRetry.count} 次，{calCool>0 ? `將於 ${calCoolSec}s 後解除冷卻` : '可再次重試'}
                      </div>
                    )}
                  </div>
                )}
                {(predictLastError && predictAutoStatus.status === 'error') && (
                  <div style={{
                    marginTop:6,padding:"8px 10px",
                    background:alpha(C.amber,'08'),
                    border:`1px solid ${alpha(C.amber,'33')}`,
                    borderRadius:6,fontSize:11,lineHeight:1.6,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3}}>
                      <span style={{color:C.amber,fontWeight:500}}>
                        事件預測 · {REASON_LABEL[predictLastError.reason] || '未知'}類錯誤
                      </span>
                      <span style={{color:C.textMute,fontSize:10,opacity:0.7}}>
                        {new Date(predictLastError.at).toLocaleTimeString('zh-TW',{hour12:false})}
                      </span>
                    </div>
                    <div style={{color:C.textMute,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:10,wordBreak:"break-word"}}>
                      {predictLastError.message}
                    </div>
                    {predictRetry.count >= RETRY_MAX && (
                      <div style={{marginTop:4,color:C.amber,fontSize:10,opacity:0.8}}>
                        已連續失敗 {predictRetry.count} 次，{preCool>0 ? `將於 ${preCoolSec}s 後解除冷卻` : '可再次重試'}
                      </div>
                    )}
                  </div>
                )}
                {/* AI 模型嘗試明細（debug）：顯示 Gateway vs 直連 Gemini 各模型的 HTTP 狀態與錯誤節錄 */}
                {(predictLastDebug || calendarLastDebug) && (
                  <div style={{
                    marginTop:6,
                    border:`1px solid ${alpha(C.textMute,'1a')}`,
                    borderRadius:6,
                    background:alpha(C.textMute,'04'),
                    fontSize:11,
                  }}>
                    <button
                      onClick={() => setDebugPanelOpen(o => !o)}
                      style={{
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        width:"100%",padding:"6px 10px",
                        background:"transparent",border:"none",
                        cursor:"pointer",color:C.textMute,fontSize:11,
                      }}
                    >
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>AI 模型嘗試明細</span>
                        <span style={{opacity:0.5}}>
                          ({(predictLastDebug?.attempts?.length || 0) + (calendarLastDebug?.attempts?.length || 0)})
                        </span>
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setPredictLastDebug(null); setCalendarLastDebug(null); }}
                          style={{fontSize:10,color:C.textMute,opacity:0.6,cursor:"pointer"}}
                        >清除</span>
                        <span style={{opacity:0.5}}>{debugPanelOpen ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {debugPanelOpen && (
                      <div style={{padding:"4px 10px 10px",borderTop:`1px solid ${alpha(C.textMute,'14')}`}}>
                        {[
                          { label: '事件預測', dbg: predictLastDebug, source: 'predict' },
                          { label: '行事曆', dbg: calendarLastDebug, source: 'calendar' },
                        ].filter(x => x.dbg).map(({ label, dbg, source }) => {
                          const suggestion = deriveSuggestion(dbg.attempts || [], source);
                          // 統計各分類數量
                          const buckets = {};
                          (dbg.attempts || []).forEach(a => {
                            const k = classifyAttempt(a);
                            if (k.kind === 'ok') return;
                            buckets[k.label] = (buckets[k.label] || 0) + 1;
                          });
                          const bucketEntries = Object.entries(buckets);
                          return (
                          <div key={label} style={{marginTop:8}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMute,marginBottom:4}}>
                              <span style={{fontWeight:500,color:C.text}}>{label}</span>
                              <span style={{opacity:0.7}}>
                                HTTP {dbg.httpStatus} · {new Date(dbg.at).toLocaleTimeString('zh-TW',{hour12:false})}
                              </span>
                            </div>
                            {dbg.succeededWith && (
                              <div style={{fontSize:10,color:C.up,marginBottom:4,opacity:0.85}}>
                                ✓ 成功：{dbg.succeededWith.path} / {dbg.succeededWith.model}
                              </div>
                            )}
                            {/* 分類 chips */}
                            {bucketEntries.length > 0 && (
                              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                                {bucketEntries.map(([lbl, cnt]) => (
                                  <span key={lbl} style={{
                                    fontSize:10,padding:"2px 6px",borderRadius:10,
                                    background:alpha(C.textMute,'10'),color:C.textMute,
                                  }}>{lbl} ×{cnt}</span>
                                ))}
                              </div>
                            )}
                            {/* 建議 + 重試規則 + cURL */}
                            {suggestion && (
                              <div style={{
                                marginBottom:6,padding:"6px 8px",borderRadius:4,
                                background:alpha(suggestion.tone === 'amber' ? C.amber : C.down, '10'),
                                color: suggestion.tone === 'amber' ? C.amber : C.down,
                              }}>
                                <div style={{fontSize:10,lineHeight:1.5}}>{suggestion.text}</div>
                                {/* 規則表 */}
                                <div style={{
                                  marginTop:6,display:"grid",
                                  gridTemplateColumns:"auto 1fr",columnGap:8,rowGap:2,
                                  fontSize:10,color:C.textMute,
                                }}>
                                  <span style={{opacity:0.7}}>最多重試</span>
                                  <span>{suggestion.policy.maxRetries} 次</span>
                                  <span style={{opacity:0.7}}>建議等待</span>
                                  <span>{suggestion.policy.waitSec > 0 ? `${suggestion.policy.waitSec}s` : '不需等待'}</span>
                                  <span style={{opacity:0.7}}>切換直連</span>
                                  <span>{suggestion.policy.switchPath === 'yes' ? '✅ 立即切換' : suggestion.policy.switchPath === 'optional' ? '⚪ 可選' : '❌ 無助於修復'}</span>
                                  <span style={{opacity:0.7}}>策略</span>
                                  <span>{suggestion.policy.desc}</span>
                                </div>
                                {/* cURL 範例 */}
                                <div style={{marginTop:6}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                                    <span style={{fontSize:10,opacity:0.7,color:C.textMute}}>可複製的請求範例</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        const btn = e.currentTarget;
                                        try {
                                          navigator.clipboard?.writeText(suggestion.curl);
                                          const orig = btn.textContent;
                                          btn.textContent = '已複製 ✓';
                                          setTimeout(() => { btn.textContent = orig; }, 1500);
                                        } catch { /* noop */ }
                                      }}
                                      style={{
                                        fontSize:10,padding:"2px 8px",borderRadius:3,
                                        border:`1px solid ${alpha(C.textMute,'30')}`,
                                        background:"transparent",color:C.textMute,cursor:"pointer",
                                      }}
                                    >複製</button>
                                  </div>
                                  <pre style={{
                                    margin:0,padding:6,borderRadius:3,
                                    background:alpha(C.textMute,'10'),color:C.text,
                                    fontSize:10,lineHeight:1.4,
                                    fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                    whiteSpace:"pre-wrap",wordBreak:"break-all",
                                    maxHeight:120,overflow:"auto",
                                  }}>{suggestion.curl}</pre>
                                </div>
                              </div>
                            )}
                            <div style={{display:"flex",flexDirection:"column",gap:3}}>
                              {(dbg.attempts || []).map((a, i) => {
                                const cls = classifyAttempt(a);
                                const statusColor = cls.tone === 'up' ? C.up : (cls.tone === 'amber' ? C.amber : C.down);
                                return (
                                  <div key={i} style={{
                                    display:"grid",
                                    gridTemplateColumns:"auto auto auto 1fr",
                                    gap:6,alignItems:"start",
                                    padding:"4px 6px",
                                    borderRadius:4,
                                    background:alpha(statusColor,'08'),
                                    fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                    fontSize:10,
                                  }}>
                                    <span style={{color:statusColor,fontWeight:600}}>
                                      {a.ok ? '✓' : '✕'} {a.status ?? '—'}
                                    </span>
                                    <span style={{color:statusColor,opacity:0.85,whiteSpace:"nowrap"}}>
                                      {cls.label}
                                    </span>
                                    <span style={{color:C.textMute}}>
                                      {a.path === 'gateway' ? 'Gateway' : '直連'} · {a.model}
                                    </span>
                                    <span style={{color:C.textMute,opacity:0.85,wordBreak:"break-word"}}>
                                      {a.errorBody || a.errorMessage || (a.ok ? '' : '—')}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {/* 更新日誌（除錯用）：可摺疊 */}
                {updateLog.length > 0 && (
                  <div style={{
                    marginTop:6,
                    border:`1px solid ${alpha(C.textMute,'1a')}`,
                    borderRadius:6,
                    background:alpha(C.textMute,'04'),
                    fontSize:11,
                  }}>
                    <button
                      onClick={() => setUpdateLogOpen(o => !o)}
                      style={{
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        width:"100%",padding:"6px 10px",
                        background:"transparent",border:"none",
                        cursor:"pointer",color:C.textMute,fontSize:11,
                      }}
                    >
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>更新日誌</span>
                        <span style={{opacity:0.5}}>({updateLog.length})</span>
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        {updateLog.length > 0 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setUpdateLog([]); }}
                            style={{fontSize:10,color:C.textMute,opacity:0.6,cursor:"pointer"}}
                          >清除</span>
                        )}
                        <span style={{opacity:0.5}}>{updateLogOpen ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {updateLogOpen && (
                      <div style={{
                        maxHeight:240,overflowY:"auto",
                        borderTop:`1px solid ${alpha(C.textMute,'14')}`,
                        padding:"4px 0",
                      }}>
                        {updateLog.map(entry => {
                          const STATUS_COLOR = {
                            fetching: C.amber,
                            success: C.up,
                            error: C.amber,
                            throttled: C.textMute,
                            'skipped-idempotent': C.textMute,
                            skipped: C.textMute,
                            cooldown: C.amber,
                            aborted: C.textMute,
                          };
                          const sc = STATUS_COLOR[entry.status] || C.text;
                          const ts = new Date(entry.ts).toLocaleTimeString('zh-TW',{hour12:false});
                          return (
                            <div
                              key={entry.id}
                              style={{
                                display:"grid",
                                gridTemplateColumns:"60px 56px 56px 1fr",
                                gap:6,padding:"3px 10px",
                                fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                fontSize:10,lineHeight:1.5,
                                borderBottom:`1px dotted ${alpha(C.textMute,'10')}`,
                              }}
                              title={`key: ${entry.key}`}
                            >
                              <span style={{color:C.textMute,opacity:0.7}}>{ts}</span>
                              <span style={{color:C.textMute}}>
                                {entry.source === 'calendar' ? '行事曆' : '事件預測'}
                              </span>
                              <span style={{color:entry.trigger==='manual'?C.text:C.textMute,opacity:entry.trigger==='manual'?0.9:0.6}}>
                                {entry.trigger === 'manual' ? '手動' : '自動'}
                              </span>
                              <span style={{display:"flex",gap:6,minWidth:0}}>
                                <span style={{color:sc,fontWeight:500,whiteSpace:"nowrap"}}>{entry.status}</span>
                                <span style={{color:C.textMute,opacity:0.7,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                  {entry.msg}
                                </span>
                                <span style={{color:C.textMute,opacity:0.4,marginLeft:"auto",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:140}}>
                                  {entry.key && entry.key !== '(n/a)' ? `key:${String(entry.key).slice(0,18)}${String(entry.key).length>18?'…':''}` : ''}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {calendarLoading ? (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400}}>
                正在根據持倉產生行事曆...
              </div>
            </div>
          ) : H.length === 0 && CE.length === 0 ? (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:20,marginBottom:10,opacity:0.2}}>◌</div>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400}}>尚無行事曆事件</div>
              <div style={{fontSize:12,color:C.textMute,marginTop:6,lineHeight:1.7,opacity:0.6}}>
                上傳成交截圖後，相關股票的財報、法說、催化事件會自動列出
              </div>
            </div>
          ) : <>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
              {["全部",...Object.keys(TYPE_COLOR)].map(t=>(
                <button key={t} onClick={()=>{setFilterType(t);setCalendarExpanded(false);}} style={{
                  background: filterType===t ? (alpha(TYPE_COLOR[t]||C.subtle,'33')) : "transparent",
                  color: filterType===t ? (TYPE_COLOR[t]||C.text) : C.textMute,
                  border:`1px solid ${filterType===t?alpha(TYPE_COLOR[t]||C.border,'66'):C.border}`,
                  borderRadius:20,padding:"3px 11px",fontSize:12,fontWeight:500,cursor:"pointer",
                }}>{t}</button>
              ))}
              {/* 重新產生按鈕已移除，行事曆只抓一次 */}
            </div>

            {filteredEvents.length === 0 ? (
              <div style={{textAlign:"center",padding:"24px 16px"}}>
                <div style={{fontSize:12,color:C.textMute,fontWeight:400}}>此分類暫無事件</div>
              </div>
            ) : (() => {
              const COLLAPSE_LIMIT = 10;
              const shouldCollapse = filteredEvents.length > COLLAPSE_LIMIT && !calendarExpanded;
              const visibleEvents = shouldCollapse ? filteredEvents.slice(0, COLLAPSE_LIMIT) : filteredEvents;
              return <>
                {visibleEvents.map((e,i)=>{
                  const tc = TYPE_COLOR[e.type]||C.textMute;
                  const globalIdx = CE.indexOf(e);
                  return <div key={i} style={{marginBottom:0,padding:"10px 0",
                    borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{minWidth:48}}>
                        <div style={{
                          color: e.urgent ? C.up : C.textMute,
                          fontSize:11,fontWeight:400,
                          textAlign:"center",marginBottom:3}}>{e.type}</div>
                        <div style={{fontSize:11,color:C.textMute,textAlign:"center",lineHeight:1.4,opacity:0.6}}>{e.date}</div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:500,color:e.urgent?C.up:C.text}}>{e.label}</div>
                        <div style={{fontSize:12,color:C.textMute,marginTop:3,lineHeight:1.6}}>{e.sub}</div>
                      </div>
                      {(() => {
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const evDate = e.date ? new Date(e.date.replace(/\//g, "-")) : null;
                        if (evDate) evDate.setHours(0,0,0,0);
                        const isPast = evDate && evDate < today;
                        if (isPast) {
                          return <span style={{fontSize:12,fontWeight:500,color:C.olive,whiteSpace:"nowrap",alignSelf:"center"}}>已發生 · 復盤</span>;
                        } else {
                          return <span style={{fontSize:12,fontWeight:500,color:C.textMute,whiteSpace:"nowrap",alignSelf:"center"}}>待驗證</span>;
                        }
                      })()}
                    </div>
                  </div>;
                })}
                {filteredEvents.length > COLLAPSE_LIMIT && (
                  <button onClick={()=>setCalendarExpanded(!calendarExpanded)} style={{
                    width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
                    background:"transparent",color:C.blue,fontSize:13,fontWeight:500,cursor:"pointer",
                    marginTop:4,
                  }}>
                    {calendarExpanded ? "▲ 收合" : `▼ 展開其餘 ${filteredEvents.length - COLLAPSE_LIMIT} 則事件`}
                  </button>
                )}
              </>;
            })()}
          </>}
        </>}

        {/* ══════════ DAILY ANALYSIS ══════════ */}
        {tab==="daily" && <>
          {/* 手動觸發按鈕 */}
           {!dailyReport && !analyzing && (
             <div style={{textAlign:"center",padding:"36px 16px",marginBottom:14}}>
               <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>每 日 收 盤 分 析</div>
               <div style={{fontSize:13,color:C.textMute,marginBottom:20,lineHeight:1.8,fontWeight:400}}>
                 分析今日股價變動與事件連動性<br/>自動比對持倉漲跌、異常波動、策略建議
               </div>
               <button onClick={runDailyAnalysis} disabled={hasReachedDailyLimit} style={{
                 padding:"10px 24px",borderRadius:8,
                 border:`1px solid ${alpha(C.teal,'30')}`,
                 background:alpha(C.teal,'06'),
                 color:hasReachedDailyLimit ? C.textMute : C.teal,fontSize:13,fontWeight:400,
                 cursor:hasReachedDailyLimit ? "not-allowed" : "pointer",
                 opacity:hasReachedDailyLimit ? 0.5 : 1,
                 letterSpacing:"0.04em"}}>
                 {hasReachedDailyLimit ? "🔒 今日配額已用完" : "開始今日收盤分析"}
               </button>
               <div style={{fontSize:11,color:C.textMute,marginTop:10,opacity:0.6}}>
                 {hasReachedDailyLimit ? "明日 00:00 重置（含截圖解析共用配額）" : "收盤後按下即可開始分析"}
               </div>
             </div>
            )}

          {analyzing && (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.textSec,fontWeight:400,marginBottom:10,letterSpacing:"0.04em"}}>
                {analyzeStep || "正在分析今日收盤數據..."}
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:8,display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
                {["取得股價","比對事件","AI策略分析","大腦進化"].map((s,i)=>(
                  <span key={i} style={{fontSize:10,color:C.textMute,fontWeight:400,opacity:0.6}}>{s}</span>
                ))}
              </div>
              <div style={{width:"100%",height:2,background:alpha(C.textMute,'08'),borderRadius:1,marginTop:16,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:1,
                  background:C.teal,
                  width:"70%",
                  transition:"width 0.5s ease"}} />
              </div>
            </div>
          )}

          {dailyReport && !analyzing && <>
            {/* 今日損益摘要 */}
            <div id="daily-report-top" style={{
              background:alpha(dailyReport.totalTodayPnl>=0?C.up:C.down,'06'),
              borderRadius:12,padding:"18px 18px 16px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <button onClick={()=>setDailyReport(null)} style={{fontSize:11,padding:"3px 8px",borderRadius:6,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>← 返回</button>
                    <span style={{fontSize:12,fontWeight:400,color:C.textSec}}>{dailyReport.date}</span>
                  </div>
                  <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>{dailyReport.time} 更新</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",marginBottom:4,fontWeight:400}}>TODAY P&L</div>
                  <div style={{fontSize:28,fontWeight:500,color:pc(dailyReport.totalTodayPnl),lineHeight:1}}>
                    {dailyReport.totalTodayPnl>=0?"+":""}{dailyReport.totalTodayPnl.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>


            {/* AI 策略分析 — Markdown 渲染 */}
            {dailyReport.aiInsight && (
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>AI 策 略 分 析</span>
                </div>
                <Md text={dailyReport.aiInsight} color={C.textSec} />
              </div>
            )}

            {!dailyReport.aiInsight && (
              <div style={{marginBottom:14,padding:"8px 0"}}>
                <div style={{fontSize:12,color:C.textMute,textAlign:"center",fontWeight:400}}>
                  AI 分析未產生
                </div>
              </div>
            )}

            {/* 自動驗證事件結果 */}
            {(dailyReport.autoVerified||[]).length>0 && (
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>
                  自 動 驗 證 · {dailyReport.autoVerified.length}件
                </div>
                {dailyReport.autoVerified.map((v,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"6px 0",borderBottom:i<dailyReport.autoVerified.length-1?`1px solid ${alpha(C.textMute,'04')}`:"none"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:400,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.title}</div>
                      <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>
                        預測{v.pred==="up"?"看漲":"看跌"} → 實際{v.actual==="up"?"漲":v.actual==="down"?"跌":"中性"}
                      </div>
                    </div>
                    <span style={{fontSize:11,fontWeight:400,flexShrink:0,
                      color:v.correct?C.teal:C.up}}>
                      {v.correct?"命中":"失誤"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 需要復盤的事件 */}
            {(dailyReport.needsReview||[]).length>0 && (
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>
                  需 要 復 盤 · {dailyReport.needsReview.length}件
                </div>
                {dailyReport.needsReview.map(e=>(
                  <div key={e.id} style={{marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:400,color:C.text}}>{e.title}</div>
                    <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>{e.date} — 預測{e.pred==="up"?"看漲":"看跌"}</div>
                    <button onClick={()=>{setTab("news");setExpandedNews(new Set([e.id]))}}
                      style={{marginTop:4,padding:"4px 10px",borderRadius:4,border:"none",
                        background:"transparent",color:C.textSec,fontSize:11,cursor:"pointer",fontWeight:400}}>
                      前往復盤 →
                    </button>
                  </div>
                ))}
              </div>
      )}

      {/* ══════════ 持倉覆蓋率報表 ══════════ */}
      {coverageOpen && (() => {
        const rows = (H || []).map(h => {
          const ok = !!h.priceSource && !h.priceError;
          let sourceLabel = '—';
          if (h.priceSource === 'live') sourceLabel = '即時成交';
          else if (h.priceSource === 'high') sourceLabel = '當日最高';
          else if (h.priceSource === 'ask') sourceLabel = '委賣價';
          else if (h.priceSource === 'yclose') sourceLabel = '昨收價';
          else if (h.priceSource === 'screenshot') sourceLabel = '截圖市場價';
          return {
            code: h.code,
            name: h.name,
            type: h.type,
            ok,
            source: sourceLabel,
            updatedAt: h.priceUpdatedAt ? new Date(h.priceUpdatedAt).toLocaleString('zh-TW') : '—',
            error: h.priceError || (ok ? '' : '尚未同步報價'),
          };
        });
        const okCount = rows.filter(r => r.ok).length;
        const total = rows.length;
        const coverage = total ? Math.round((okCount / total) * 1000) / 10 : 0;
        const missing = rows.filter(r => !r.ok);

        const exportCsv = () => {
          const header = '代碼,名稱,類型,狀態,價格來源,更新時間,失敗原因';
          const lines = rows.map(r => [
            r.code, r.name, r.type, r.ok?'OK':'MISS', r.source, r.updatedAt, r.error
          ].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));
          const csv = '\uFEFF' + [header, ...lines].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `freecheckup-coverage-${new Date().toISOString().slice(0,10)}.csv`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        return (
          <div
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:120,
              display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
            onClick={() => setCoverageOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background:C.card, borderRadius:10, width:'min(720px, 100%)',
                maxHeight:'min(86vh, 760px)', display:'flex', flexDirection:'column',
                border:`1px solid ${C.border}`,
              }}
            >
              <div style={{padding:'18px 22px 12px',borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:15,fontWeight:500,color:C.text,letterSpacing:'0.02em'}}>持倉覆蓋率報表</div>
                  <button onClick={() => setCoverageOpen(false)} style={{
                    background:'transparent',border:'none',color:C.textMute,cursor:'pointer',fontSize:18,padding:0,lineHeight:1}}>✕</button>
                </div>
                <div style={{display:'flex',gap:18,alignItems:'baseline',flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontSize:10,color:C.textMute,letterSpacing:'0.08em'}}>覆蓋率</div>
                    <div style={{fontSize:22,fontWeight:500,color:coverage>=80?C.olive:coverage>=50?C.amber:C.down,letterSpacing:'-0.02em'}}>
                      {coverage.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.textMute,letterSpacing:'0.08em'}}>已同步</div>
                    <div style={{fontSize:16,fontWeight:500,color:C.text}}>{okCount} / {total}</div>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.textMute,letterSpacing:'0.08em'}}>缺失</div>
                    <div style={{fontSize:16,fontWeight:500,color:missing.length?C.down:C.textMute}}>{missing.length}</div>
                  </div>
                  <div style={{marginLeft:'auto',display:'flex',gap:8}}>
                    <button onClick={triggerServerSync} disabled={serverSyncing} style={{
                      background:serverSyncing?alpha(C.subtle,'aa'):C.text,color:serverSyncing?C.textMute:C.bg,
                      border:'none',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:500,
                      cursor:serverSyncing?'wait':'pointer',letterSpacing:'0.04em'}}>
                      {serverSyncing?'同步中…':'立即重跑同步'}
                    </button>
                    <button onClick={exportCsv} style={{
                      background:'transparent',color:C.textSec,border:`1px solid ${C.border}`,
                      borderRadius:6,padding:'5px 10px',fontSize:11,fontWeight:400,cursor:'pointer'}}>
                      ↓ 匯出 CSV
                    </button>
                  </div>
                </div>
              </div>

              <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:alpha(C.subtle,'66'),color:C.textMute,letterSpacing:'0.05em'}}>
                      <th style={{textAlign:'left',padding:'8px 14px',fontWeight:400,fontSize:11}}>代碼</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>名稱</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>類型</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>狀態</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>來源</th>
                      <th style={{textAlign:'left',padding:'8px 14px',fontWeight:400,fontSize:11}}>失敗原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.code} style={{borderBottom:`1px solid ${alpha(C.border,'88')}`}}>
                        <td style={{padding:'8px 14px',fontFamily:'ui-monospace,monospace',color:C.text}}>{r.code}</td>
                        <td style={{padding:'8px 8px',color:C.text}}>{r.name}</td>
                        <td style={{padding:'8px 8px',color:C.textMute}}>{r.type || '—'}</td>
                        <td style={{padding:'8px 8px'}}>
                          <span style={{
                            display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:500,letterSpacing:'0.05em',
                            background: r.ok ? alpha(C.olive,'22') : alpha(C.down,'22'),
                            color: r.ok ? C.olive : C.down,
                          }}>{r.ok?'OK':'缺失'}</span>
                        </td>
                        <td style={{padding:'8px 8px',color:C.textSec}}>{r.source}</td>
                        <td style={{padding:'8px 14px',color:r.ok?C.textMute:C.down,fontSize:11}}>{r.error || '—'}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={6} style={{padding:'24px',textAlign:'center',color:C.textMute}}>尚無持倉資料</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{padding:'10px 22px',borderTop:`1px solid ${C.border}`,fontSize:11,color:C.textMute,lineHeight:1.6}}>
                提示：覆蓋率反映目前前端 holdings 中已成功取得最新報價的比例。後端排程「stock-price-sync」每 30 分鐘執行一次，亦會同步寫入 current_prices 資料表。
              </div>
            </div>
          </div>
        );
      })()}


            {/* 重新分析 */}
            <button onClick={runDailyAnalysis} disabled={analyzing} style={{
              width:"100%",padding:"11px",borderRadius:8,border:`1px solid ${C.border}`,
              background:"transparent",color:C.textMute,fontSize:13,cursor:"pointer",
              marginBottom:16}}>
              重新分析
            </button>
          </>}

          {/* 策略大腦 */}
          {strategyBrain && (
            <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>策 略 大 腦</span>
                <span style={{fontSize:11,color:C.textMute,fontWeight:400}}>
                  更新：{strategyBrain.lastUpdate||"—"} | 分析：{strategyBrain.stats?.totalAnalyses||0}次
                </span>
              </div>

              {(strategyBrain.rules||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>核心策略規則</div>
                  {strategyBrain.rules.map((r,i)=>(
                    <div key={i} style={{fontSize:12,color:C.textSec,lineHeight:1.8,fontWeight:400,
                      padding:"3px 0",borderBottom:`1px solid ${alpha(C.textMute,'04')}`}}>
                      {i+1}. {r}
                    </div>
                  ))}
                </div>
              )}

              {(strategyBrain.commonMistakes||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>常犯錯誤</div>
                  {strategyBrain.commonMistakes.map((m,i)=>(
                    <div key={i} style={{fontSize:12,color:C.textSec,lineHeight:1.8,fontWeight:400}}>{m}</div>
                  ))}
                </div>
              )}

              {(strategyBrain.lessons||[]).length>0 && (
                <div>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>
                    最近教訓（共 {strategyBrain.lessons.length} 條）
                  </div>
                  {strategyBrain.lessons.slice(-5).reverse().map((l,i)=>(
                    <div key={i} style={{fontSize:11,color:C.textMute,lineHeight:1.7,fontWeight:400,
                      padding:"4px 0",borderBottom:`1px solid ${alpha(C.textMute,'04')}`}}>
                      <span style={{color:C.textSec}}>[{l.date}]</span> {l.text}
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                <div style={{fontSize:11,color:C.textMute,fontWeight:400}}>
                  命中率：{strategyBrain.stats?.hitRate||"計算中"}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{
                    const json = JSON.stringify(strategyBrain, null, 2);
                    const blob = new Blob([json], {type:"application/json"});
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `strategy-brain-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                  }} style={{fontSize:11,padding:"3px 8px",borderRadius:4,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>
                    匯出
                  </button>
                  <button onClick={()=>{
                    if (confirm("確定要重置策略大腦？所有累積的規則和教訓將被清除。")) {
                      setStrategyBrain(null);
                      save("pf-brain-v1", null);
                    }
                  }} style={{fontSize:11,padding:"3px 8px",borderRadius:4,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>
                    重置
                  </button>
                </div>
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:6,fontWeight:400,opacity:0.6}}>
                {cloudSync ? "雲端同步" : "本機模式"}
              </div>
            </div>
          )}

          {!strategyBrain && (
            <div style={{marginBottom:14,textAlign:"center",padding:"16px 0"}}>
              <div style={{fontSize:12,color:C.textMute,fontWeight:400}}>
                執行第一次收盤分析後，策略大腦將自動建立並持續進化
              </div>
            </div>
          )}

          {/* 歷史分析 */}
          {(analysisHistory||[]).length>0 && (()=>{
            // Filter out entries without real data (hardcoded/empty)
            const validHistory = (analysisHistory||[]).filter(r => r.changes && r.changes.length > 0);
            if (validHistory.length === 0) return null;
            return (
              <div style={{marginTop:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>歷 史 記 錄</span>
                  <span style={{fontSize:11,color:C.textMute,fontWeight:400}}>共 {validHistory.length} 筆</span>
                </div>
                {validHistory.slice(0,15).map(r=>{
                  const isExpanded = dailyReport?.id === r.id;
                  return (
                  <div key={r.id}>
                    <div onClick={()=>{
                        if (isExpanded) { setDailyReport(null); } else { setDailyReport(r); }
                      }}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"8px 0",cursor:"pointer",
                        borderBottom:`1px solid ${alpha(C.textMute,'06')}`,
                        transition:"background 0.15s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.textMute,transition:"transform 0.15s",
                          display:"inline-block",transform:isExpanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                        <span style={{fontSize:12,color:C.text,fontWeight:400}}>{r.date}</span>
                        <span style={{fontSize:10,color:C.textMute,fontWeight:400}}>{r.time}</span>
                      </div>
                      <span style={{fontSize:12,fontWeight:500,
                        color:pc(r.totalTodayPnl)}}>
                        {r.totalTodayPnl>=0?"+":""}{r.totalTodayPnl.toLocaleString()}
                      </span>
                    </div>
                    {isExpanded && (
                      <div style={{padding:"10px 0",borderBottom:`1px solid ${alpha(C.textMute,'06')}`,marginBottom:4}}>
                        {r.aiInsight && (
                          <div style={{marginBottom:6}}>
                            <Md text={r.aiInsight} color={C.textSec} />
                          </div>
                        )}
                        <button onClick={(ev)=>{ev.stopPropagation();setDailyReport(r);
                          setTimeout(()=>document.getElementById("daily-report-top")?.scrollIntoView({behavior:"smooth"}),50);
                        }} style={{marginTop:4,padding:"4px 10px",borderRadius:4,border:"none",
                          background:"transparent",color:C.textSec,fontSize:11,cursor:"pointer",width:"100%",fontWeight:400}}>
                          查看完整報告 ↑
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            );
          })()}
        </>}

        {/* ══════════ UPLOAD ══════════ */}
        {tab==="trade" && <>
          {/* Demo 模式提示 */}
          {isDemo && (
            <div style={{marginBottom:16, padding:"20px 16px", background:alpha(C.amber,'06'), borderRadius:10, textAlign:"center"}}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
                上傳成交需要先登入
              </div>
              <div style={{fontSize:12,color:C.textMute,marginBottom:14,lineHeight:1.6}}>
                透過 LINE 快速登入，即可免費使用 AI 健檢功能（每日一次）
              </div>
              <button onClick={startLineLogin} style={{
                background:"#06C755", color:"#fff", border:"none",
                borderRadius:8, padding:"10px 24px", fontSize:13, fontWeight:500,
                cursor:"pointer", letterSpacing:"0.02em",
              }}>
                使用 LINE 快速登入
              </button>
            </div>
          )}
          {/* 每日限制提示 */}
          {hasReachedDailyLimit && !isDemo && (
            <div style={{marginBottom:16, padding:"20px 16px", background:alpha(C.blue,'06'), borderRadius:10, textAlign:"center"}}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
                今日免費健檢次數已用完
              </div>
              <div style={{fontSize:12,color:C.textMute,lineHeight:1.6}}>
                每日可免費上傳一次成交截圖進行 AI 分析，明天再來
              </div>
            </div>
          )}
          {!parsed && !isDemo && !hasReachedDailyLimit && (
            <>
              <div
                onDragOver={e=>{e.preventDefault();setDragOver(true)}}
                onDragLeave={()=>setDragOver(false)}
                onDrop={e=>{e.preventDefault();setDragOver(false);processFile(e.dataTransfer.files[0])}}
                onClick={()=>document.getElementById("fi").click()}
                style={{border:`1px dashed ${dragOver?C.blue:C.border}`,
                  borderRadius:12,padding:"28px 16px",textAlign:"center",cursor:"pointer",
                  background:dragOver?C.subtle:C.card,marginBottom:12,transition:"all 0.2s"}}>
                <input id="fi" type="file" accept="image/*"
                  onChange={e=>processFile(e.target.files[0])} style={{display:"none"}}/>
                {img ? (
                  <><img src={img} alt="" style={{maxHeight:200,maxWidth:"100%",
                    borderRadius:8,objectFit:"contain",marginBottom:8}}/>
                  <div style={{fontSize:13,color:C.textMute}}>點擊更換截圖</div></>
                ) : (
                  <><div style={{fontSize:32,marginBottom:10,opacity:0.5}}>↑</div> {/* rwd-allow:純裝飾箭頭非數字 */}
                  <div style={{fontSize:15,fontWeight:500,color:C.textSec}}>上傳已成交截圖</div>
                  <div style={{fontSize:13,color:C.textMute,marginTop:4}}>截圖需要包含代碼、名稱、股數、市價、成本、成本價、手續費</div>
                  <div style={{fontSize:11,color:C.textMute,marginTop:6,letterSpacing:'0.04em'}}>持倉上限 {MAX_HOLDINGS} 檔（目前 {(holdings || []).length} 檔）</div></>
                )}
              </div>
              {img && (
                <button onClick={parseShot} disabled={parsing} style={{
                  width:"100%",padding:"13px",borderRadius:10,
                  background: parsing ? C.subtle : C.cardHover,
                  color: parsing ? C.textMute : C.text,
                  border: `1px solid ${parsing ? C.border : alpha(C.amber,'66')}`,
                  fontSize:15, fontWeight:500, cursor:parsing?"not-allowed":"pointer",
                  letterSpacing:"0.02em"}}>
                  {parsing ? "解析中..." : "解析這筆交易"}
                </button>
              )}
              {parseStep && (
                <div style={{
                  marginTop:10, background:C.subtle,
                  border:`1px solid ${parseStep.stage==='error'?alpha(C.down,'55'):parseStep.stage==='done'?alpha(C.olive,'55'):C.border}`,
                  borderRadius:10, padding:'10px 12px',
                }}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:500,letterSpacing:'0.04em',color:parseStep.stage==='error'?C.down:parseStep.stage==='done'?C.olive:C.text}}>
                      {parseStep.stage==='upload' && '① '}
                      {parseStep.stage==='ai' && '② '}
                      {parseStep.stage==='retry' && '② '}
                      {parseStep.stage==='persist' && '③ '}
                      {parseStep.stage==='refresh' && '④ '}
                      {parseStep.stage==='done' && '✓ '}
                      {parseStep.stage==='error' && '✕ '}
                      {parseStep.label}
                    </span>
                    <span style={{fontSize:11,color:C.textMute,fontVariantNumeric:'tabular-nums'}}>{parseStep.progress}%</span>
                  </div>
                  <div style={{height:3,background:alpha(C.textMute,'22'),borderRadius:2,overflow:'hidden'}}>
                    <div style={{
                      height:'100%',width:`${parseStep.progress}%`,
                      background: parseStep.stage==='error'?C.down:parseStep.stage==='done'?C.olive:C.amber,
                      transition:'width 360ms ease',
                    }}/>
                  </div>
                  {parseStep.detail && (
                    <div style={{marginTop:6,fontSize:11,color:C.textMute,letterSpacing:'0.02em'}}>{parseStep.detail}</div>
                  )}
                </div>
              )}
              {parseErr && <div style={{marginTop:10, background:C.upBg,
                border:`1px solid ${alpha(C.up,'44')}`, borderRadius:10,
                padding:12, fontSize:14, color:C.up}}>
                {parseErr}
              </div>}
            </>
          )}

          {parsed?.trades?.length>0 && (
            <div>
                <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.textMute,fontWeight:400,letterSpacing:"0.1em",marginBottom:8}}>解析結果</div>
                {parsed.trades.map((t,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",
                    alignItems:"center",padding:"10px 0",
                    borderBottom:i<parsed.trades.length-1?`1px solid ${alpha(C.textMute,'06')}`:"none"}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{
                          color: t.action==="買進" ? C.up : C.down,
                          fontSize:11, fontWeight:400}}>
                          {t.action}
                        </span>
                        <span style={{fontSize:13,fontWeight:500,color:C.text}}>{t.name}</span>
                        <span style={{fontSize:10,color:C.textMute}}>{t.code}</span>
                      </div>
                      <div style={{fontSize:13,color:C.textMute,marginTop:3}}>
                        {t.qty}股 @ {t.price?.toLocaleString()}元
                      </div>
                    </div>
                  </div>
                ))}
                {parsed.targetPriceUpdates?.length>0 && (
                  <div style={{marginTop:10,background:C.tealBg,border:`1px solid ${alpha(C.teal,'44')}`,
                    borderRadius:7,padding:"8px 10px"}}>
                    <div style={{fontSize:11,color:C.teal,fontWeight:400,marginBottom:4,letterSpacing:"0.04em"}}>
                      偵測到目標價更新
                    </div>
                    {parsed.targetPriceUpdates.map((u,i)=>(
                      <div key={i} style={{fontSize:13,color:C.textSec}}>
                        {u.code} · {u.firm} → {u.target?.toLocaleString()}元
                      </div>
                    ))}
                  </div>
                )}
                
              </div>

              <div style={{...card,borderLeft:`2px solid ${alpha(C.blue,'88')}`}}>
                <div style={lbl}>交易備忘錄</div>
                {memoAns.map((a,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>Q{i+1}. {qs[i]}</div>
                    <div style={{fontSize:14,color:C.textSec,background:C.subtle,
                      borderRadius:6,padding:"8px 10px",lineHeight:1.6}}>{a}</div>
                  </div>
                ))}
                <div style={{fontSize:14,fontWeight:500,color:C.blue,marginBottom:8}}>
                  Q{memoStep+1}/{qs.length}. {qs[memoStep]}
                </div>
                <textarea value={memoIn} onChange={e=>setMemoIn(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&memoIn.trim()){e.preventDefault();submitMemo();}}}
                  placeholder="輸入你的想法... (Enter送出)"
                  style={{width:"100%", background:C.subtle, border:`1px solid ${C.border}`,
                    borderRadius:8, padding:"10px", color:C.text, fontSize:14,
                    resize:"none", minHeight:70, outline:"none",
                    fontFamily:"inherit", marginBottom:10, lineHeight:1.7}}/>
                <button onClick={submitMemo} disabled={!memoIn.trim()} style={{
                  width:"100%", padding:"12px", border:"none", borderRadius:8,
                  background: memoIn.trim()
                    ? (memoStep===qs.length-1 ? alpha(C.olive,'cc') : alpha(C.blue,'cc'))
                    : C.subtle,
                  color: memoIn.trim() ? "#fff" : C.textMute,
                  fontSize:15, fontWeight:500, cursor:memoIn.trim()?"pointer":"not-allowed",
                  letterSpacing:"0.02em"}}>
                  {memoStep===qs.length-1 ? "完成備忘 · 更新持倉" : `下一題 (${memoStep+1}/${qs.length})`}
                </button>
              </div>
            </div>
          )}

          {/* 手動更新目標價 */}
          {!parsed && !img && (()=>{
            const handleAddTarget = () => {
              if (!tpCode.trim()||!tpVal) return;
              const code = tpCode.trim();
              const target = parseFloat(tpVal);
              if (isNaN(target)) return;
              setTargets(prev=>{
                const existing = (prev||{})[code] || {reports:[]};
                const firm = tpFirm.trim()||"手動輸入";
                const already = existing.reports.find(r=>r.firm===firm);
                const newR = {firm, target, date:new Date().toLocaleDateString("zh-TW")};
                return {
                  ...(prev||{}),
                  [code]: {
                    reports: already
                      ? existing.reports.map(r=>r.firm===firm?newR:r)
                      : [...existing.reports, newR],
                    updatedAt: new Date().toLocaleDateString("zh-TW"),
                    isNew: true,
                  }
                };
              });
              setSaved("✅ 目標價已更新");
              setTimeout(()=>setSaved(""),2000);
              setTpCode(""); setTpFirm(""); setTpVal("");
            };
            return (
              <div style={{...card,marginTop:14,borderLeft:`2px solid ${alpha(C.teal,'66')}`}}>
                <div style={lbl}>手動更新目標價</div>
                <div style={{fontSize:13,color:C.textMute,marginBottom:10,lineHeight:1.6}}>
                  收到新研究報告時，直接在這裡更新。系統會自動計算多家均值。
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
                  <div>
                    <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>股票代碼</div>
                    <input value={tpCode} onChange={e=>setTpCode(e.target.value)}
                      placeholder="如 3006"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>目標價（元）</div>
                    <input value={tpVal} onChange={e=>setTpVal(e.target.value)}
                      placeholder="如 205"
                      type="number"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>券商 / 來源</div>
                  <input value={tpFirm} onChange={e=>setTpFirm(e.target.value)}
                    placeholder="如 元大投顧、FactSet共識"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                </div>
                <button onClick={handleAddTarget}
                  disabled={!tpCode.trim()||!tpVal}
                  style={{
                    width:"100%",padding:"10px",border:"none",borderRadius:8,
                    background: tpCode.trim()&&tpVal ? alpha(C.teal,'cc') : C.subtle,
                    color: tpCode.trim()&&tpVal ? "#fff" : C.textMute,
                    fontSize:14,fontWeight:500,cursor:tpCode.trim()&&tpVal?"pointer":"not-allowed",
                  }}>
                  新增 / 更新目標價
                </button>
              </div>
            );
          })()}
        </>}

        {/* ══════════ LOG ══════════ */}
        {tab==="log" && <>
          {(!tradeLog||tradeLog.length===0) ? (
            <div style={{...card,textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:20,marginBottom:10,opacity:0.2}}>◌</div>
              <div style={{fontSize:15,color:C.textMute,fontWeight:400}}>
                還沒有交易記錄<br/>
                <span style={{fontSize:13}}>上傳成交截圖後自動記錄在這裡</span>
              </div>
            </div>
          ) : (
            (() => {
              // 保持上傳順序（不再按 id 排序）
              const sorted = [...(tradeLog||[])];
              // Group by date
              const dateGroups = [];
              let currentGroup = null;
              sorted.forEach(log => {
                const d = log.date || "未知日期";
                if (!currentGroup || currentGroup.date !== d) {
                  currentGroup = { date: d, logs: [] };
                  dateGroups.push(currentGroup);
                }
                currentGroup.logs.push(log);
              });
              return dateGroups.map((group, gi) => (
                <div key={"grp-"+gi}>
                  <div style={{fontSize:12,fontWeight:400,color:C.textMute,letterSpacing:"0.08em",marginBottom:8,marginTop:gi===0?0:6}}>
                    {group.date}
                  </div>
                  {(() => {
                    // 按時間分組，同一批上傳的交易歸在一起
                    const timeGroups = [];
                    let curTime = null;
                    group.logs.forEach(log => {
                      if (!curTime || log.time !== curTime.time) {
                        curTime = { time: log.time, items: [] };
                        timeGroups.push(curTime);
                      }
                      curTime.items.push(log);
                    });
                    return timeGroups.map((tg, ti) => (
                      <div key={"tg-"+ti}>
                        {tg.items.map((log, li) => (
                          <div key={log.id} style={{marginBottom:0,padding:"10px 0",
                            borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                              <div style={{display:"flex",alignItems:"center",gap:7}}>
                                <span style={{
                                  color: log.action==="買進" ? C.up : C.down,
                                  fontSize:11, fontWeight:400}}>
                                  {log.action}
                                </span>
                                <span style={{fontSize:13,fontWeight:500,color:C.text}}>{log.name}</span>
                                <span style={{fontSize:10,color:C.textMute}}>{log.code}</span>
                              </div>
                              {li === 0 && <div style={{fontSize:12,color:C.textMute}}>{log.time}</div>}
                            </div>
                            <div style={{fontSize:13,color:C.textMute,marginBottom: log.qa.length > 0 ? 10 : 0}}>
                              {log.qty}股 @ {log.price?.toLocaleString()}元
                            </div>
                            {log.qa.map((qi,i)=>(
                              <div key={i} style={{marginBottom:8}}>
                                <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>{qi.q}</div>
                                <div style={{fontSize:13,color:C.textSec,background:C.subtle,
                                  borderRadius:6,padding:"7px 10px",lineHeight:1.7}}>
                                  {qi.a||"（未填）"}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        {ti < timeGroups.length - 1 && (
                          <div style={{height:1,background:C.border,margin:"10px 0"}}/>
                        )}
                      </div>
                    ));
                  })()}
                  {gi < dateGroups.length - 1 && (
                    <div style={{height:1,background:C.border,margin:"10px 0 14px"}}/>
                  )}
                </div>
              ));
            })()
          )}
        </>}

        {/* ══════════ NEWS ANALYSIS ══════════ */}
        {tab==="news" && (()=>{
          const NE = newsEvents || [];
          const past      = NE.filter(e=>e.status==="past").sort((a,b)=>(b.date||"").localeCompare(a.date||""));
          const verifying = NE.filter(e=>e.status==="verifying").sort((a,b)=>(a.date||"").localeCompare(b.date||""));
          const pending   = NE.filter(e=>e.status==="pending").sort((a,b)=>(a.date||"").localeCompare(b.date||""));
          const hits    = NE.filter(e=>e.correct===true).length;
          const misses  = NE.filter(e=>e.correct===false).length;

          const predIcon = (p) => p==="up"?"↑":p==="down"?"↓":"—";
          const predLabel= (p) => p==="up"?"看漲":p==="down"?"看跌":"中性";
          const predC    = (p) => p==="up"?C.up:p==="down"?C.down:C.textMute;

          // 每隔一個卡片用不同底色，保持莫蘭迪跳色感
          const tints = [C.card, C.cardBlue, C.cardAmber, C.cardOlive, C.cardRose];
          const tint  = (i) => tints[i % tints.length];

          const EventRow = ({e, idx}) => {
            const open   = expandedNews.has(e.id);
            const isCorrect = e.correct;
            const borderC = e.status==="past"
              ? (isCorrect===true ? alpha(C.olive,'99') : isCorrect===false ? alpha(C.up,'99') : C.border)
              : alpha(predC(e.pred),'55');

            return (
              <div
                onClick={()=>toggleNews(e.id)}
                style={{
                  background: tint(idx),
                  border:`1px solid ${C.border}`,
                  borderLeft:`2px solid ${borderC}`,
                  borderRadius:10, marginBottom:6,
                  cursor:"pointer", overflow:"hidden",
                  transition:"all 0.15s",
                }}
              >
                {/* ── 縮列行 ── */}
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px"}}>
                  {/* 預測/結果標籤 */}
                  <div style={{
                    minWidth:26, textAlign:"center",
                    fontSize:13, fontWeight:400,
                    color: predC(e.pred), opacity: 0.7,
                  }}>{predIcon(e.pred)}</div>

                  {/* 標題區 */}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{
                      fontSize:14, fontWeight:500, color:C.text,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    }}>{e.title}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:12,color:C.textMute}}>{e.date}</span>
                      {(Array.isArray(e.stocks) ? e.stocks : (typeof e.stocks === "string" ? e.stocks.split(/[,、\s]+/).filter(Boolean) : [])).slice(0,2).map((s,si)=>{
                        const label = typeof s === "string" ? s.split(" ")[0] : (s.code || s.name || "");
                        return <span key={si} style={{fontSize:12,padding:"1px 6px",borderRadius:3,
                          background:C.subtle,color:C.textSec}}>{label}</span>;
                      })}
                      {e.stocks.length>2 && <span style={{fontSize:12,color:C.textMute}}>+{e.stocks.length-2}</span>}
                    </div>
                  </div>

                  {/* 右側狀態 */}
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
                    {e.status==="past" && isCorrect!==null && (
                      <span style={{
                        fontSize:11, fontWeight:500,
                        color: isCorrect ? C.olive : C.amber,
                      }}>{isCorrect ? "✓ 正確" : "⚠ 有誤"}</span>
                    )}
                    {e.status==="verifying" && (
                      <span style={{fontSize:11,color:C.amber,fontWeight:400}}>待驗證</span>
                    )}
                    {e.status==="pending" && (
                      <span style={{fontSize:12,color:C.textMute,fontWeight:500}}>待觀察</span>
                    )}
                    <span style={{fontSize:12,color:C.textMute}}>{open?"▲":"▼"}</span>
                  </div>
                </div>

                {/* ── 展開內容 ── */}
                {open && (
                  <div style={{
                    padding:"0 12px 12px",
                    borderTop:`1px solid ${C.borderSub}`,
                    paddingTop:10,
                  }}>
                    {/* 全部個股 */}
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                      {e.stocks.map((s,si)=>{
                        const label = typeof s === "string" ? s : `${s.code || ""} ${s.name || ""}`.trim();
                        return <span key={si} style={{fontSize:12,padding:"2px 8px",borderRadius:3,
                          background:C.blueBg,color:C.blue,fontWeight:500}}>{label}</span>;
                      })}
                    </div>

                    <div style={{fontSize:13,color:C.textSec,lineHeight:1.8,marginBottom:8}}>{e.detail}</div>

                    {/* 預測邏輯 */}
                    <div style={{background:C.subtle,borderRadius:7,padding:"9px 11px",marginBottom: e.actualNote?8:0}}>
                      <div style={{fontSize:11,color:predC(e.pred),fontWeight:400,marginBottom:3,letterSpacing:"0.06em"}}>
                        {predIcon(e.pred)} 預測{predLabel(e.pred)} — 邏輯
                      </div>
                      <div style={{fontSize:13,color:C.textSec,lineHeight:1.7}}>{e.predReason}</div>
                    </div>

                    {/* 實際結果（已發生） */}
                    {e.actualNote && (
                      <div style={{
                        background: isCorrect ? alpha(C.olive,'08') : alpha(C.up,'08'),
                        border:`1px solid ${isCorrect ? alpha(C.olive,'44'):alpha(C.up,'44')}`,
                        borderRadius:7, padding:"9px 11px", marginTop:8,
                      }}>
                        <div style={{fontSize:11,color: isCorrect?C.olive:C.up,fontWeight:400,marginBottom:3,letterSpacing:"0.06em"}}>
                          {predIcon(e.actual)} 實際{predLabel(e.actual)} — {isCorrect?"預測正確":"預測有誤"}
                        </div>
                        <div style={{fontSize:13,color:C.textSec,lineHeight:1.7}}>{e.actualNote}</div>
                      </div>
                    )}

                    {/* 復盤教訓（若有） */}
                    {e.lessons && (
                      <div style={{background:C.blueBg,border:`1px solid ${alpha(C.blue,'33')}`,
                        borderRadius:7,padding:"9px 11px",marginTop:8}}>
                        <div style={{fontSize:12,color:C.textSec,fontWeight:400,marginBottom:3}}>策略覆盤教訓</div>
                        <div style={{fontSize:13,color:C.textSec,lineHeight:1.7}}>{e.lessons}</div>
                      </div>
                    )}

                    {/* 復盤按鈕（待驗證或待觀察事件） */}
                    {(e.status==="pending" || e.status==="verifying") && (
                      <button onClick={(ev)=>{ev.stopPropagation();setReviewingEvent(e.id);setReviewForm({actual:"up",actualNote:"",lessons:""})}}
                        style={{marginTop:10,width:"100%",padding:"9px",
                          background:alpha(C.olive,'22'),border:`1px solid ${alpha(C.olive,'55')}`,
                          borderRadius:8,color:C.olive,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                        標記結果 · 撰寫復盤
                      </button>
                    )}

                    {/* 復盤表單 */}
                    {reviewingEvent===e.id && (
                      <div onClick={ev=>ev.stopPropagation()}
                        style={{marginTop:10,background:C.subtle,borderRadius:8,padding:12,
                          border:`1px solid ${alpha(C.blue,'44')}`}}>
                        <div style={{fontSize:12,color:C.textSec,fontWeight:400,marginBottom:10}}>撰寫完整復盤</div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>實際走勢</div>
                          <div style={{display:"flex",gap:6}}>
                            {["up","down","neutral"].map(v=>(
                              <button key={v} onClick={()=>setReviewForm(p=>({...p,actual:v}))}
                                style={{flex:1,padding:"6px",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer",
                                  background:reviewForm.actual===v?(v==="up"?C.upBg:v==="down"?C.downBg:C.subtle):"transparent",
                                  color:reviewForm.actual===v?(v==="up"?C.up:v==="down"?C.down:C.textSec):C.textMute,
                                  border:`1px solid ${reviewForm.actual===v?(v==="up"?alpha(C.up,'55'):v==="down"?alpha(C.down,'55'):C.border):C.border}`}}>
                                {v==="up"?"↑ 漲":v==="down"?"↓ 跌":"— 中性"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>發生了什麼？股價怎麼走？</div>
                          <textarea value={reviewForm.actualNote} onChange={ev=>setReviewForm(p=>({...p,actualNote:ev.target.value}))}
                            placeholder="描述事件結果和股價反應..."
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                              minHeight:60,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                        </div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>策略覆盤：問題出在哪？學到什麼？下次怎麼改？</div>
                          <textarea value={reviewForm.lessons} onChange={ev=>setReviewForm(p=>({...p,lessons:ev.target.value}))}
                            placeholder="進場理由回顧、策略偏差、改進方向..."
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                              minHeight:60,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                        </div>

                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setReviewingEvent(null)}
                            style={{flex:1,padding:"9px",background:"transparent",border:`1px solid ${C.border}`,
                              borderRadius:7,color:C.textMute,fontSize:13,cursor:"pointer"}}>取消</button>
                          <button onClick={()=>submitReview(e.id)}
                            disabled={!reviewForm.actualNote.trim()}
                            style={{flex:2,padding:"9px",borderRadius:7,border:"none",fontSize:13,fontWeight:500,cursor:"pointer",
                              background:reviewForm.actualNote.trim()?alpha(C.olive,'cc'):C.subtle,
                              color:reviewForm.actualNote.trim()?"#fff":C.textMute}}>
                            確認送出復盤
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          };

          return <>
            {/* 準確率摘要 */}
            <div style={{
              display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14,
            }}>
              {[
                ["已驗證", `${hits+misses}`, C.textSec, C.card],
                ["預測正確", `${hits}`, C.up, C.cardRose],
                ["命中率", hits+misses>0?`${Math.round(hits/(hits+misses)*100)}%`:"—", C.amber, C.cardAmber],
              ].map(([l,v,c,bg])=>(
                <div key={l} style={{background:bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 11px"}}>
                  <div style={{fontSize:12,color:C.textMute,letterSpacing:"0.06em"}}>{l}</div>
                  <div style={{fontSize:18,fontWeight:500,color:c,marginTop:4}}>{v}</div>
                </div>
              ))}
            </div>

            {/* 新增事件按鈕 */}
            <button onClick={()=>setShowAddEvent(!showAddEvent)} style={{
              width:"100%",padding:"10px",marginBottom:10,borderRadius:8,
              background:showAddEvent?C.subtle:alpha(C.blue,'22'),
              border:`1px solid ${showAddEvent?C.border:alpha(C.blue,'55')}`,
              color:showAddEvent?C.textMute:C.blue,fontSize:13,fontWeight:500,cursor:"pointer"}}>
              {showAddEvent?"取消":"＋ 新增事件（法說會、財報、營收、催化劑）"}
            </button>

            {showAddEvent && (
              <div style={{...card,marginBottom:12,borderLeft:`2px solid ${alpha(C.blue,'88')}`}}>
                <div style={{...lbl,color:C.blue}}>新增事件</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
                  <div>
                    <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>日期</div>
                    <input value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))}
                      placeholder="如 2026/04/01"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>相關個股（逗號分隔）</div>
                    <input value={newEvent.stocks} onChange={e=>setNewEvent(p=>({...p,stocks:e.target.value}))}
                      placeholder="如 台燿 6274, 晶豪科 3006"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>事件標題</div>
                  <input value={newEvent.title} onChange={e=>setNewEvent(p=>({...p,title:e.target.value}))}
                    placeholder="如：台燿 Q1 財報法說會"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>事件細節</div>
                  <textarea value={newEvent.detail} onChange={e=>setNewEvent(p=>({...p,detail:e.target.value}))}
                    placeholder="關鍵觀察重點..."
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                      minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>預測方向</div>
                  <div style={{display:"flex",gap:6}}>
                    {["up","down","neutral"].map(v=>(
                      <button key={v} onClick={()=>setNewEvent(p=>({...p,pred:v}))}
                        style={{flex:1,padding:"6px",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer",
                          background:newEvent.pred===v?(v==="up"?C.upBg:v==="down"?C.downBg:C.subtle):"transparent",
                          color:newEvent.pred===v?(v==="up"?C.up:v==="down"?C.down:C.textSec):C.textMute,
                          border:`1px solid ${newEvent.pred===v?(v==="up"?alpha(C.up,'55'):v==="down"?alpha(C.down,'55'):C.border):C.border}`}}>
                        {v==="up"?"↑ 看漲":v==="down"?"↓ 看跌":"— 中性"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>預測邏輯</div>
                  <textarea value={newEvent.predReason} onChange={e=>setNewEvent(p=>({...p,predReason:e.target.value}))}
                    placeholder="為什麼這樣預測？依據是什麼？"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                      minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                </div>
                <button onClick={addEvent}
                  disabled={!newEvent.title.trim()||!newEvent.date.trim()}
                  style={{width:"100%",padding:"10px",borderRadius:8,border:"none",fontSize:14,
                    fontWeight:500,cursor:newEvent.title.trim()&&newEvent.date.trim()?"pointer":"not-allowed",
                    background:newEvent.title.trim()&&newEvent.date.trim()?alpha(C.blue,'cc'):C.subtle,
                    color:newEvent.title.trim()&&newEvent.date.trim()?"#fff":C.textMute}}>
                  新增事件
                </button>
              </div>
            )}

            {/* 待驗證（7天內，AI已預測） */}
            {verifying.length > 0 && (<>
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                marginBottom:8,
              }}>
                <div style={{...lbl, marginBottom:0, color:C.amber}}>⏳ 待驗證 · {verifying.length} 件</div>
                <span style={{fontSize:12,color:C.textMute}}>7天內事件・AI已預測</span>
              </div>
              {predictingEvents && (
                <div style={{fontSize:13,color:C.amber,marginBottom:8,textAlign:"center"}}>⏳ AI 正在預測中...</div>
              )}
              {(()=>{
                const LIMIT = 10;
                const show = newsVerifyingExpanded ? verifying : verifying.slice(0, LIMIT);
                return <>
                  {show.map((e,i)=><EventRow key={e.id} e={e} idx={i}/>)}
                  {verifying.length > LIMIT && (
                    <button onClick={()=>setNewsVerifyingExpanded(!newsVerifyingExpanded)} style={{
                      width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
                      background:"transparent",color:C.amber,fontSize:13,fontWeight:500,cursor:"pointer",
                      marginTop:4,marginBottom:4,
                    }}>{newsVerifyingExpanded ? "▲ 收合" : `▼ 展開其餘 ${verifying.length - LIMIT} 則`}</button>
                  )}
                </>;
              })()}
            </>)}

            {/* 待觀察（>7天） */}
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              marginBottom:8, marginTop: verifying.length > 0 ? 16 : 0,
            }}>
              <div style={{...lbl, marginBottom:0}}>待觀察 · {pending.length} 件</div>
              <span style={{fontSize:12,color:C.textMute}}>7天以上</span>
            </div>
            {(()=>{
              const LIMIT = 10;
              const show = newsPendingExpanded ? pending : pending.slice(0, LIMIT);
              return <>
                {show.map((e,i)=><EventRow key={e.id} e={e} idx={i}/>)}
                {pending.length > LIMIT && (
                  <button onClick={()=>setNewsPendingExpanded(!newsPendingExpanded)} style={{
                    width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
                    background:"transparent",color:C.blue,fontSize:13,fontWeight:500,cursor:"pointer",
                    marginTop:4,marginBottom:4,
                  }}>{newsPendingExpanded ? "▲ 收合" : `▼ 展開其餘 ${pending.length - LIMIT} 則`}</button>
                )}
              </>;
            })()}

            {/* 已發生 */}
            <div style={{...lbl, marginBottom:8, marginTop:16}}>已發生 · 驗證 {hits+misses}/{past.length} 件</div>
            {(()=>{
              const LIMIT = 10;
              const show = newsPastExpanded ? past : past.slice(0, LIMIT);
              return <>
                {show.map((e,i)=><EventRow key={e.id} e={e} idx={i}/>)}
                {past.length > LIMIT && (
                  <button onClick={()=>setNewsPastExpanded(!newsPastExpanded)} style={{
                    width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
                    background:"transparent",color:C.blue,fontSize:13,fontWeight:500,cursor:"pointer",
                    marginTop:4,
                  }}>{newsPastExpanded ? "▲ 收合" : `▼ 展開其餘 ${past.length - LIMIT} 則`}</button>
                )}
              </>;
            })()}
          </>;
        })()}

      </div>
      {/* Decision Debug toggle */}
      <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:8}}>
        <label style={{fontSize:10,color:C.textMute,fontWeight:400,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <input type="checkbox" checked={debugMode} onChange={e => {
            setDebugMode(e.target.checked);
            if (typeof window !== 'undefined') window.__DECISION_DEBUG = e.target.checked;
          }} style={{width:12,height:12}} />
          Decision Debug
        </label>
      </div>
      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={() => setShowResetConfirm(false)}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:C.card, borderRadius:12, padding:"28px 24px", maxWidth:360, width:"100%",
            border:`1px solid ${alpha(C.textMute,'08')}`}}>
            <div style={{fontSize:14,fontWeight:500,color:C.up,marginBottom:10,textAlign:"center",letterSpacing:"0.02em"}}>
              確認清除全部資料？
            </div>
            <div style={{fontSize:12,color:C.textMute,marginBottom:6,lineHeight:1.7,textAlign:"center"}}>
              此操作<span style={{color:C.up,fontWeight:500}}>無法復原</span>，將永久刪除以下所有資料：
            </div>
            <div style={{background:C.subtle,borderRadius:8,padding:"10px 14px",marginBottom:16,
              fontSize:12,color:C.textMute,lineHeight:2}}>
              持倉資料（所有股票部位）<br/>
              交易日誌（所有買賣紀錄）<br/>
              觀察股清單<br/>
              行事曆事件（法說、財報等）<br/>
              事件分析（預測與復盤紀錄）<br/>
              收盤分析（歷史分析報告）<br/>
              策略大腦（AI 學習紀錄）<br/>
              目標價資料<br/>
              歷史分析紀錄<br/>
              最近教訓
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={() => setShowResetConfirm(false)} style={{
                flex:1, background:C.subtle, color:C.text, border:`1px solid ${alpha(C.textMute,'08')}`,
                borderRadius:8, padding:"10px 0", fontSize:13, fontWeight:400, cursor:"pointer",
              }}>取消</button>
              <button onClick={resetAll} style={{
                flex:1, background:C.up, color:"#fff", border:"none",
                borderRadius:8, padding:"10px 0", fontSize:13, fontWeight:500, cursor:"pointer",
              }}>確認全部清除</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 持倉資料庫 Detail Drawer ══════════ */}
      <Sheet open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
        <SheetContent
          side="right"
          className="overflow-y-auto"
          style={{
            background: C.bg, color: C.text, width: "min(480px, 100vw)",
            maxWidth: "100vw", padding: 0, border: "none",
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {activeHolding ? (() => {
            const h = activeHolding;
            const dec = decisionsMap[h.code];
            const meta = STOCK_META[h.code] || null;
            const T = targets?.[h.code];
            const tp = T ? avgTarget(h.code) : null;
            const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
            const total = sourceList.length;
            const evtsAll = normalizedEvents
              .filter(e => (e.relatedCodes || []).includes(h.code) && e.source !== 'demo');
            const openEvts = evtsAll.filter(isEventOpen)
              .sort((a,b) => new Date(b.occurredAt||0) - new Date(a.occurredAt||0));
            const resolvedEvts = evtsAll.filter(e => !isEventOpen(e))
              .sort((a,b) => new Date(b.occurredAt||0) - new Date(a.occurredAt||0)).slice(0, 5);
            const timeline = [...openEvts, ...resolvedEvts];

            const srcLabel = drawerSource?.label || '📋 持倉列表';
            const backText = drawerSource?.type === 'priority-global'
              ? '返回今日優先'
              : drawerSource?.type === 'category'
                ? `返回${drawerSource.label?.replace(/^[^\s]+\s/, '') || '分類'}`
                : '返回列表';

            return (
              <div style={{padding:"18px 20px 32px"}}>
                {/* Phase 2.5 Drawer Header (3 layers) */}
                <div style={{marginBottom:14, paddingRight:32}}>
                  {/* 第一行：返回 [來源] */}
                  <button
                    onClick={() => handleDrawerOpenChange(false)}
                    style={{
                      background:"transparent",border:"none",
                      color:C.textMute,fontSize:11,fontWeight:400,
                      cursor:"pointer",padding:"2px 0",
                      display:"inline-flex",alignItems:"center",gap:4,
                      letterSpacing:"0.04em",
                    }}
                  >‹ {backText}</button>
                  {/* 第二行：來源 label */}
                  <div style={{
                    fontSize:10,color:C.textMute,marginTop:4,marginBottom:8,
                    letterSpacing:"0.06em",fontWeight:400,
                  }}>來自：{srcLabel}</div>
                  {/* 第三行：上一檔 / 名稱 (i/N) / 下一檔 */}
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button
                      onClick={goPrev}
                      disabled={total < 2}
                      aria-label="上一檔"
                      style={{
                        background:"transparent",border:`1px solid ${C.border}`,
                        borderRadius:6,padding:"4px 10px",fontSize:13,
                        color: total < 2 ? alpha(C.textMute,'40') : C.textSec,
                        cursor: total < 2 ? "not-allowed" : "pointer",fontWeight:400,
                      }}
                    >‹</button>
                    <div style={{flex:1,textAlign:"center"}}>
                      <div style={{fontSize:14,fontWeight:500,color:C.text,letterSpacing:"0.02em"}}>
                        {h.name} <span style={{fontSize:11,color:C.textMute,fontWeight:400,marginLeft:4}}>{h.code}</span>
                      </div>
                      <div style={{fontSize:10,color:C.textMute,marginTop:2,letterSpacing:"0.05em"}}>
                        {activeIndex + 1} / {total}
                      </div>
                    </div>
                    <button
                      onClick={goNext}
                      disabled={total < 2}
                      aria-label="下一檔"
                      style={{
                        background:"transparent",border:`1px solid ${C.border}`,
                        borderRadius:6,padding:"4px 10px",fontSize:13,
                        color: total < 2 ? alpha(C.textMute,'40') : C.textSec,
                        cursor: total < 2 ? "not-allowed" : "pointer",fontWeight:400,
                      }}
                    >›</button>
                  </div>
                </div>

                {/* 數量·成本·市價·市值·損益·% */}
                <div style={{
                  background:alpha(C.textMute,'04'),borderRadius:8,padding:"10px 12px",marginBottom:14,
                  display:"flex",flexDirection:"column",gap:4,
                }}>
                  <div style={{fontSize:11,color:C.textMute,fontWeight:400}}>
                    {h.qty}{h.unit || "股"} · 成本 {h.cost} · 市價 {h.price?.toLocaleString()}
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"baseline"}}>
                    <span style={{fontSize:11,color:C.textMute}}>市值 {h.value?.toLocaleString()}</span>
                    <span style={{fontSize:13,fontWeight:500,color:pc(h.pnl)}}>{h.pnl>=0?"+":""}{h.pnl?.toLocaleString()}</span>
                    <span style={{fontSize:11,color:pc(h.pct)}}>{h.pct>=0?"+":""}{h.pct?.toFixed(2)}%</span>
                  </div>
                  {meta && (
                    <div style={{fontSize:10,color:C.textMute,marginTop:2}}>
                      {meta.industry}{meta.strategy && ` · ${meta.strategy}`}{meta.position && ` · ${meta.position}`}
                    </div>
                  )}
                </div>

                {/* Decision Box */}
                {dec && (
                  <section style={{marginBottom:16}}>
                    <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",marginBottom:6}}>DECISION</div>
                    <div style={{padding:"10px 12px",border:`1px solid ${alpha(C.textMute,'12')}`,borderRadius:8}}>
                      <div style={{fontSize:13,color:dec.actionType==='exit'?C.down:dec.actionType==='review'?C.amber:C.text,fontWeight:500,marginBottom:6}}>
                        {dec.actionText || (dec.actionType==='exit'?'建議出場':dec.actionType==='review'?'需要檢查':'維持持有')}
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:8,fontSize:11,color:C.textMute}}>
                        <span>論點：{dec.thesisState==='broken'?'破裂':dec.thesisState==='weakening'?'弱化':'完整'}</span>
                        <span>可信度：{dec.confidence==='high'?'高':dec.confidence==='medium'?'中':'低'}</span>
                        <span>緊急：{dec.urgency==='now'?'立即':dec.urgency==='soon'?'近期':'觀察'}</span>
                        <span>事件：{dec.openEventCount || 0}</span>
                        {dec.hasConflict && <span style={{color:C.down}}>⚠ 存在衝突</span>}
                      </div>
                    </div>
                  </section>
                )}

                {/* Thesis */}
                <section style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",marginBottom:6}}>THESIS · 進場理由</div>
                  <div style={{fontSize:12,color:C.textSec,lineHeight:1.7,padding:"8px 12px",background:alpha(C.textMute,'04'),borderRadius:6}}>
                    {(userOverrides[h.code]?.note) || (meta?.thesis) || meta?.strategy || "尚未填寫進場理由。"}
                  </div>
                </section>

                {/* Events Timeline */}
                <section style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",marginBottom:6}}>
                    EVENTS · 事件時序（{openEvts.length} open / {resolvedEvts.length} 近期已結）
                  </div>
                  {timeline.length === 0 ? (
                    <div style={{fontSize:12,color:C.textMute,padding:"8px 12px"}}>無事件紀錄</div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {timeline.map((e, idx) => {
                        const open = isEventOpen(e);
                        const impact = e.decisionImpact || e.impact;
                        const impactColor = impact==='break' ? C.down : impact==='weaken' ? C.amber : C.textMute;
                        return (
                          <div key={e.id || idx} style={{
                            padding:"8px 10px",borderLeft:`2px solid ${open?C.amber:alpha(C.textMute,'25')}`,
                            background: open ? alpha(C.amber,'05') : "transparent",
                            borderRadius:"0 4px 4px 0",
                          }}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                              <span style={{fontSize:9,color:e.source==='user'?C.blue:e.source==='ai'?C.teal:C.textMute,border:`1px solid ${alpha(e.source==='user'?C.blue:e.source==='ai'?C.teal:C.textMute,'25')}`,borderRadius:3,padding:"0 4px"}}>
                                {e.source==='user'?'手動':e.source==='ai'?'AI':e.source==='calendar'?'日曆':'其他'}
                              </span>
                              <span style={{fontSize:9,color:C.textMute}}>{e.occurredAt ? new Date(e.occurredAt).toLocaleDateString("zh-TW") : ''}</span>
                              {impact && <span style={{fontSize:9,color:impactColor,marginLeft:"auto"}}>{impact}</span>}
                            </div>
                            <div style={{fontSize:12,color:C.textSec,lineHeight:1.5}}>
                              {e.summary || e.title || '(無摘要)'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* 筆記 / Exit Cue */}
                <section style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",marginBottom:6}}>NOTES · 筆記與出場條件</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div>
                      <div style={{fontSize:10,color:C.textMute,marginBottom:3}}>筆記</div>
                      <Textarea
                        value={draftNote}
                        onChange={(e)=>{ setDraftNote(e.target.value); draftDirtyRef.current = true; }}
                        placeholder="進場理由、研究心得、後續觀察重點..."
                        style={{minHeight:60,fontSize:12,background:C.card,color:C.text,borderColor:C.border}}
                      />
                    </div>
                    <div>
                      <div style={{fontSize:10,color:C.textMute,marginBottom:3}}>Exit Cue · 出場條件</div>
                      <Textarea
                        value={draftExitCue}
                        onChange={(e)=>{ setDraftExitCue(e.target.value); draftDirtyRef.current = true; }}
                        placeholder="達標出場、停損觸發、論點破裂訊號..."
                        style={{minHeight:50,fontSize:12,background:C.card,color:C.text,borderColor:C.border}}
                      />
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button onClick={persistDraftIfDirty} style={{
                        background:C.text,color:C.bg,border:"none",borderRadius:6,
                        padding:"6px 14px",fontSize:12,fontWeight:500,cursor:"pointer",
                      }}>儲存</button>
                      {userOverrides[h.code]?.actionType && (
                        <span style={{fontSize:10,color:C.blue}}>已覆寫決策：{userOverrides[h.code].actionType}</span>
                      )}
                    </div>
                  </div>
                </section>

                {/* 目標價清單 */}
                {T?.reports?.length > 0 && (
                  <section style={{marginBottom:8}}>
                    <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",marginBottom:6}}>
                      TARGETS · 分析師目標價
                      {tp && (
                        <span style={{marginLeft:8,color:upside>=0?C.up:C.down,fontWeight:500}}>
                          均 {tp.toLocaleString()}（{upside>=0?"+":""}{upside?.toFixed(1)}%）
                        </span>
                      )}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {T.reports.map((r, idx) => (
                        <div key={idx} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.textSec,padding:"4px 10px",background:alpha(C.textMute,'04'),borderRadius:4}}>
                          <span>{r.firm}</span>
                          <span>{r.target?.toLocaleString()} <span style={{color:C.textMute,marginLeft:4}}>{r.date}</span></span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            );
          })() : (
            <div style={{padding:32,textAlign:"center",color:C.textMute,fontSize:13}}>無資料</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
