import { useState, useEffect } from "react";

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

// ── 初始持倉 ────────────────────────────────────────────────────
const INIT_HOLDINGS = [
  { code:"00637L", name:"滬深300正2",    qty:141,  price:19.96, cost:18.99, value:2814,  pnl:134,   pct:5.01,   type:"ETF"  },
  { code:"039108", name:"禾伸堂元富57購", qty:8000, price:0.79,  cost:0.9925,value:6320,  pnl:-824,  pct:-10.35, type:"權證", expire:"2026/07", targetPrice:1.98 },
  { code:"053848", name:"亞翔凱基5B購",  qty:8000, price:2.23,  cost:1.81,  value:17840, pnl:3234,  pct:22.32,  type:"權證" },
  { code:"702157", name:"華星光元大58購",qty:4000, price:3.35,  cost:1.29,  value:13400, pnl:8167,  pct:157.66, type:"權證" },
  { code:"1503",   name:"士電",          qty:9,    price:205,   cost:229.5,  value:1845,  pnl:-227,  pct:-10.99, type:"股票" },
  { code:"1717",   name:"長興",          qty:43,   price:63.7,  cost:66.1,   value:2737,  pnl:-118,  pct:-4.15,  type:"股票" },
  { code:"2308",   name:"台達電",        qty:2,    price:1440,  cost:1287.5, value:2880,  pnl:293,   pct:11.37,  type:"股票" },
  { code:"2313",   name:"華通",          qty:40,   price:236.5, cost:187.5,  value:9457,  pnl:1920,  pct:25.58,  type:"股票" },
  { code:"2543",   name:"皇昌",          qty:6,    price:71.6,  cost:78.3,   value:429,   pnl:-43,   pct:-9.15,  type:"股票" },
  { code:"3006",   name:"晶豪科",        qty:12,   price:194.5, cost:164,    value:2334,  pnl:357,   pct:18.13,  type:"股票", alert:"⚡出場區間到" },
  { code:"3013",   name:"晟銘電",        qty:29,   price:99,    cost:125.91, value:2871,  pnl:-791,  pct:-21.65, type:"股票" },
  { code:"3017",   name:"奇鋐",          qty:2,    price:1905,  cost:1400,   value:3810,  pnl:997,   pct:35.59,  type:"股票" },
  { code:"3231",   name:"緯創",          qty:11,   price:134,   cost:134.55, value:1474,  pnl:-14,   pct:-0.94,  type:"股票" },
  { code:"3443",   name:"創意",          qty:3,    price:2290,  cost:2566.67,value:6870,  pnl:-854,  pct:-11.09, type:"股票" },
  { code:"3491",   name:"昇達科",        qty:3,    price:1445,  cost:1276.67,value:4335,  pnl:487,   pct:12.71,  type:"股票" },
  { code:"4583",   name:"台灣精銳",      qty:5,    price:629,   cost:734,    value:3145,  pnl:-536,  pct:-14.6,  type:"股票" },
  { code:"6274",   name:"台燿",          qty:3,    price:505,   cost:507,    value:1515,  pnl:-12,   pct:-0.79,  type:"股票", alert:"今日法說" },
  { code:"6770",   name:"力積電",        qty:20,   price:71.7,  cost:68.05,  value:1433,  pnl:63,    pct:4.62,   type:"股票" },
  { code:"6862",   name:"三集瑞-KY",     qty:17,   price:209.5, cost:197.82, value:3560,  pnl:182,   pct:5.41,   type:"股票" },
  { code:"8227",   name:"巨有科技",      qty:21,   price:128,   cost:146.57, value:2688,  pnl:-403,  pct:-13.08, type:"股票" },
];

const INIT_WATCHLIST = [
  { code:"1513", name:"中興電",  price:158.5, target:193,  status:"等Q4財報",  catalyst:"3–4月財報",      sc:"#f59e0b", note:"積極163–165元；保守155–160元；催化：台電GIS+台積電" },
  { code:"4588", name:"玖鼎電力",price:69.1,  target:154,  status:"持有中",    catalyst:"台電電表訂單",    sc:"#22c55e", note:"訂單排到2028；現價已偏高不追；持有者繼續抱" },
  { code:"6274", name:"台燿",    price:505,   target:710,  status:"⚡今日法說", catalyst:"3/18法說+財報",  sc:"#ef4444", note:"成本507；毛利率回沖→補足2/3；展望差→停損430" },
];

const EVENTS = [
  { date:"今日",    label:"台燿 6274 — Q4財報法說會",     sub:"毛利率+展望樂觀→補齊2/3；差→停損430",          urgent:true,  type:"法說" },
  { date:"今日",    label:"晶豪科 194.5元 — 超出場區間",  sub:"目標175–185元已超過，考慮今日分批賣出",         urgent:true,  type:"操作" },
  { date:"每月10日",label:"月營收公布",                   sub:"晶豪科最關鍵——確認DDR3高檔維持",               urgent:false, type:"營收" },
  { date:"3/15前",  label:"大型股全年財報",                sub:"台達電、奇鋐、創意、緯創",                      urgent:false, type:"財報" },
  { date:"4/1前",   label:"中小型股全年財報",              sub:"長興、華通、晟銘電、昇達科、台灣精銳、力積電",   urgent:false, type:"財報" },
  { date:"3–4月",   label:"中興電 Q4財報 + 法說",         sub:"催化劑：台電GIS發包 + 台積電訂單",              urgent:false, type:"催化" },
  { date:"Q2前",    label:"晶豪科 全數出場",               sub:"Q1財報前最遲出清；資金轉台燿/力積電",           urgent:false, type:"操作" },
  { date:"2026/07", label:"禾伸堂元富57購 到期",          sub:"目標獲利100%（約1.98元）；留意時間價值遞減",     urgent:false, type:"權證" },
  { date:"Q2",      label:"台燿 泰國二期產能確認",         sub:"月產能是否達260萬張（目標710元關鍵假設）",       urgent:false, type:"催化" },
  { date:"6–7月",   label:"力積電 加碼評估",               sub:"月營收年增>30%才加碼",                         urgent:false, type:"操作" },
  { date:"Q3起",    label:"緯創 VR爬坡",                  sub:"3Q26帶來4–5個月完整營收貢獻",                   urgent:false, type:"催化" },
  { date:"持續",    label:"美國關稅談判進度",              sub:"15%協議已達成；後續執行細節影響科技出口股",      urgent:false, type:"總經" },
  { date:"持續",    label:"Fed 利率政策",                  sub:"降息預期影響外資流向台股",                       urgent:false, type:"總經" },
];

// ── 事件分析資料庫 ────────────────────────────────────────────────
// status: "past"=已發生 / "pending"=未發生
// pred: "up"=預測漲 / "down"=預測跌 / "neutral"=中性
// actual: "up"/"down"/"neutral"/null（null=尚未驗證）
// correct: true/false/null
const NEWS_EVENTS = [
  // ── 已發生 ──
  {
    id:1, date:"2026/03/13", status:"past",
    title:"三星記憶體工人罷工威脅，DDR3 供給缺口擴大",
    detail:"三星韓國工廠工會威脅全面罷工，市場預期DRAM供給將進一步吃緊，利基型記憶體（DDR3）受矚目。",
    stocks:["晶豪科 3006"],
    pred:"up", predReason:"DDR3供給端收縮，晶豪科作為利基型記憶體IC設計受直接利多。",
    actual:"up", actualNote:"晶豪科連續兩日漲停，從161元急拉至177元，驗證預測正確。",
    correct:true,
  },
  {
    id:2, date:"2026/03/16", status:"past",
    title:"晶豪科 4Q25 EPS 3.68元，遠超市場預期 0.18元",
    detail:"華南投顧發出研究報告，揭露4Q25每股盈餘3.68元，市場預估僅0.18元，超預期約20倍。目標價200元。",
    stocks:["晶豪科 3006"],
    pred:"up", predReason:"財報大幅超預期是最強催化劑，法人勢必上調目標價，資金將快速湧入。",
    actual:"up", actualNote:"報告發出後三日股價從145元漲至194.5元，漲幅約34%。",
    correct:true,
  },
  {
    id:3, date:"2026/03/13", status:"past",
    title:"台燿 財報前外資連續賣超，股價從530跌至450",
    detail:"台燿3月初從高點583元修正，三大法人籌碼持續綠色，財報前賣壓明顯。",
    stocks:["台燿 6274"],
    pred:"down", predReason:"財報前獲利了結賣壓是常見型態，加上毛利率疑慮，短期壓力大。",
    actual:"down", actualNote:"股價從583跌至約450元，修正約25%，符合預測方向。",
    correct:true,
  },
  {
    id:4, date:"2026/03/16", status:"past",
    title:"台燿連兩日籌碼綠色但股價逆勢漲近10%",
    detail:"外資+自營商合計賣超，但散戶財報前卡位情緒推動股價接近漲停。",
    stocks:["台燿 6274"],
    pred:"up", predReason:"財報日前6天，散戶預期法說樂觀，提前卡位效應。",
    actual:"up", actualNote:"單日漲9.94%，收497.5元，驗證財報前卡位邏輯。",
    correct:true,
  },
  {
    id:5, date:"2026/03/16", status:"past",
    title:"緯創 4Q25 法說：毛利率受GB機櫃出貨組合壓縮",
    detail:"4Q25毛利率5.62%，QoQ降177bps，主因GB系列機櫃佔比提升。目標價從217元下調至195元。",
    stocks:["緯創 3231"],
    pred:"down", predReason:"目標價下調，毛利率不如預期，短期壓力。",
    actual:"down", actualNote:"法說後股價維持在134元附近偏弱，中信下調目標價至195元印證。",
    correct:true,
  },

  // ── 未發生 / 進行中 ──
  {
    id:6, date:"2026/03/18", status:"pending",
    title:"台燿 Q4財報法說會",
    detail:"關鍵觀察：毛利率是否確認回沖、AI CCL產品展望、泰國二期產能時程。",
    stocks:["台燿 6274"],
    pred:"up", predReason:"中信預估2026F EPS逐季加速（4.21→5.49→7.37→8.72），若法說確認此路徑，市場將重新定價。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:7, date:"2026/03–04月", status:"pending",
    title:"中興電 Q4全年財報公布",
    detail:"FactSet共識EPS 10.43元，7位分析師全數強力買進，目標價193.4元。台電GIS招標動向是關鍵。",
    stocks:["中興電 1513"],
    pred:"up", predReason:"財報若符合共識，加上台電基礎建設招標持續，股價有望從158.5元向193元靠攏。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:8, date:"2026/Q2", status:"pending",
    title:"晶豪科 Q2 EPS高峰季，毛利率55.7%預估",
    detail:"2026 Q2 EPS預估11.51元，為全年最高峰。力積電代工費2H26漲100%，毛利率將在Q3後回落至32–34%。",
    stocks:["晶豪科 3006"],
    pred:"up", predReason:"市場將在Q1財報後開始定價Q2高峰，股價有望提前反映。出場窗口在財報前1–2週。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:9, date:"2026/Q2", status:"pending",
    title:"台燿 泰國二期產能是否達260萬張月產",
    detail:"台燿目前月產能約178萬張，二期完工後目標260萬張，是2026年EPS加速的核心假設。",
    stocks:["台燿 6274"],
    pred:"up", predReason:"若如期達產，800G交換器與AI伺服器CCL訂單能見度大增，目標價710元更有說服力。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:10, date:"持續", status:"pending",
    title:"美國對台半導體關稅談判（15%協議後續執行）",
    detail:"台美已達成15%關稅協議，但執行細節與豁免清單仍在協商，科技出口股受牽連。",
    stocks:["奇鋐 3017","台達電 2308","緯創 3231","創意 3443"],
    pred:"neutral", predReason:"協議已達成降低最壞情境，但執行不確定性讓外資偏謹慎，短期偏中性到略偏空。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:11, date:"2026/07", status:"pending",
    title:"禾伸堂元富57購 到期",
    detail:"目前持倉8,000股，均成本0.9925元，目標翻倍（約1.98元）。權證無停損設定，時間價值越近到期遞減越快。",
    stocks:["禾伸堂 2481（標的）"],
    pred:"up", predReason:"被動元件族群動能上來，禾伸堂本股動能啟動。但須在Q2前確認趨勢，否則時間成本侵蝕獲利空間。",
    actual:null, actualNote:"",
    correct:null,
  },
  {
    id:12, date:"2026/Q3", status:"pending",
    title:"緯創 VR 系列爬坡（NV Vera Rubin）",
    detail:"VR系列減少線材組裝、組裝性更佳，預計3Q26開始帶來4–5個月完整營收貢獻，ASP將上揚。",
    stocks:["緯創 3231"],
    pred:"up", predReason:"若爬坡如期，3Q26起營收加速，毛利率組合改善，現價134元相對目標195元仍有空間。",
    actual:null, actualNote:"",
    correct:null,
  },
];


// 背景層
const C = {
  bg:        "#16140f",   // 更深的底色，讓卡片跳出
  card:      "#2a2318",   // 主卡片，明顯比背景亮
  cardHover: "#332b1e",
  subtle:    "#3d3426",   // 輸入框/次層
  border:    "#4a4030",   // 邊框明顯一些
  borderSub: "#342c1e",

  // 跳色卡片（莫蘭迪，明顯有色調差異）
  cardBlue:  "#1e2530",   // 石板藍底 — 明顯冷色
  cardAmber: "#30240f",   // 琥珀棕底 — 明顯暖色
  cardOlive: "#1e2a1e",   // 橄欖綠底 — 明顯綠調
  cardRose:  "#301818",   // 塵玫瑰底 — 明顯暖紅

  // 文字
  text:      "#f0ebe4",
  textSec:   "#c4b09a",
  textMute:  "#8a7a6e",

  // 台股慣例（莫蘭迪版）
  up:        "#c47b72",
  upBg:      "#c47b7218",
  down:      "#7a9e8a",
  downBg:    "#7a9e8a18",

  // 功能色（莫蘭迪版）
  blue:      "#7a90a8",
  blueBg:    "#7a90a818",
  amber:     "#b8926a",
  amberBg:   "#b8926a18",
  teal:      "#6a9098",
  tealBg:    "#6a909818",
  olive:     "#8a9e7a",
  oliveBg:   "#8a9e7a18",
  lavender:  "#9b8fb0",
  lavBg:     "#9b8fb018",
  stone:     "#a09080",
  urgent:    "#c47b72",
};

const TYPE_COLOR = {
  法說:"#c47b72",
  財報:"#7a90a8",
  營收:"#6a9098",
  催化:"#8a9e7a",
  操作:"#b8926a",
  總經:"#a09080",
  權證:"#b8926a",
};

const MEMO_Q = {
  "買進": ["為什麼選這檔？核心邏輯是什麼？", "進場的技術或籌碼依據？", "出場計畫：目標價？停損價？"],
  "賣出": ["為什麼在這個價位賣？", "達成原本預期了嗎？", "這筆資金的下一步？"],
};

const PARSE_PROMPT = `你是台股券商成交回報截圖的解析器。解析截圖中的交易，以JSON格式輸出，不輸出其他文字：
{"trades":[{"action":"買進或賣出","code":"代碼","name":"名稱","qty":股數,"price":成交價,"amount":金額或null}],"targetPriceUpdates":[{"code":"代碼","firm":"券商名稱","target":目標價數字,"date":"日期"}],"note":"有疑問時說明"}
targetPriceUpdates：如果截圖中有提到分析師目標價或研究報告目標價，請一併擷取。否則為空陣列。`;

// ── helpers ─────────────────────────────────────────────────────
// 台股慣例：紅=漲/獲利，綠=跌/虧損（莫蘭迪版）
const pc    = (p) => p==null ? C.textMute : p>=0 ? C.up : C.down;
const pcBg  = (p) => p==null ? "transparent" : p>=0 ? C.upBg : C.downBg;
const fmtN  = (n) => n==null?"—":Math.abs(n)>=10000?(n/10000).toFixed(1)+"萬":n.toLocaleString();
const card  = { background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px" };
const lbl   = { fontSize:9, color:C.textMute, letterSpacing:"0.13em", textTransform:"uppercase", fontWeight:700, marginBottom:7 };

async function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
async function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ── Main ─────────────────────────────────────────────────────────
export default function App() {
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
  const [dragOver,setDragOver]  = useState(false);
  const [memoStep,setMemoStep]  = useState(0);
  const [memoAns, setMemoAns]   = useState([]);
  const [memoIn,  setMemoIn]    = useState("");
  const [saved,   setSaved]     = useState("");

  // dashboard UI
  const [sortBy,      setSortBy]      = useState("value");
  const [filterType,  setFilterType]  = useState("全部");
  const [showAll,     setShowAll]     = useState(false);
  const [expandedNews, setExpandedNews] = useState(new Set());
  const toggleNews = (id) => setExpandedNews(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const [tpCode, setTpCode] = useState("");
  const [tpFirm, setTpFirm] = useState("");
  const [tpVal,  setTpVal]  = useState("");

  // refresh prices
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // daily analysis
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeStep, setAnalyzeStep]   = useState("");
  const [dailyReport, setDailyReport]   = useState(null);
  const [analysisHistory, setAnalysisHistory] = useState(null);
  const [newsEvents, setNewsEvents]     = useState(null);
  const [reviewingEvent, setReviewingEvent] = useState(null);
  const [reviewForm, setReviewForm]     = useState({actual:"up",actualNote:"",lessons:""});
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent]         = useState({date:"",title:"",detail:"",stocks:"",pred:"up",predReason:""});
  const [reversalConditions, setReversalConditions] = useState(null);
  const [strategyBrain, setStrategyBrain] = useState(null);
  const [cloudSync, setCloudSync]         = useState(false);

  // boot
  useEffect(() => {
    (async () => {
      const h = await load("pf-holdings-v2", INIT_HOLDINGS);
      const l = await load("pf-log-v2", []);
      const t = await load("pf-targets-v1", INIT_TARGETS);
      const ne = await load("pf-news-events-v1", NEWS_EVENTS);
      const ah = await load("pf-analysis-history-v1", []);
      const rc = await load("pf-reversal-v1", {});
      const sb = await load("pf-brain-v1", null);
      setHoldings(h); setTradeLog(l); setTargets(t);
      setNewsEvents(ne); setAnalysisHistory(ah); setReversalConditions(rc);
      setStrategyBrain(sb);
      setReady(true);
      // 嘗試從雲端同步（策略大腦 + 歷史分析 + 事件資料）
      try {
        const [cloudBrain, cloudHist, cloudEvents] = await Promise.all([
          fetch("/api/brain?action=brain").then(r=>r.json()).catch(()=>({brain:null})),
          fetch("/api/brain?action=history").then(r=>r.json()).catch(()=>({history:[]})),
          fetch("/api/brain", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"load-events"})}).then(r=>r.json()).catch(()=>({events:null})),
        ]);
        if (cloudBrain.brain) { setStrategyBrain(cloudBrain.brain); save("pf-brain-v1", cloudBrain.brain); }
        if (cloudHist.history?.length > 0) { setAnalysisHistory(cloudHist.history); save("pf-analysis-history-v1", cloudHist.history); }
        if (cloudEvents.events) { setNewsEvents(cloudEvents.events); save("pf-news-events-v1", cloudEvents.events); }
        setCloudSync(true);
      } catch(e) { /* 離線也能用 localStorage 版本 */ }
    })();
  }, []);

  // auto-save
  useEffect(() => { if (ready && holdings) save("pf-holdings-v2", holdings); }, [holdings, ready]);
  useEffect(() => { if (ready && tradeLog) save("pf-log-v2",      tradeLog); }, [tradeLog,  ready]);
  useEffect(() => { if (ready && targets)  save("pf-targets-v1",  targets);  }, [targets,   ready]);
  useEffect(() => {
    if (ready && newsEvents) {
      save("pf-news-events-v1", newsEvents);
      // 同步事件到雲端
      fetch("/api/brain", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save-events",data:newsEvents})}).catch(()=>{});
    }
  }, [newsEvents, ready]);
  useEffect(() => { if (ready && analysisHistory) save("pf-analysis-history-v1", analysisHistory); }, [analysisHistory, ready]);
  useEffect(() => { if (ready && reversalConditions) save("pf-reversal-v1", reversalConditions); }, [reversalConditions, ready]);
  useEffect(() => { if (ready && strategyBrain) save("pf-brain-v1", strategyBrain); }, [strategyBrain, ready]);

  // derived
  const H = holdings || [];
  const totalVal  = H.reduce((s,h)=>s+h.value,0);
  const totalCost = H.reduce((s,h)=>s+h.cost*h.qty,0);
  const totalPnl  = H.reduce((s,h)=>s+h.pnl,0);
  const retPct    = totalCost>0 ? totalPnl/totalCost*100 : 0;
  const urgentCount = EVENTS.filter(e=>e.urgent).length;

  const sorted = [...H].sort((a,b)=>{
    if(sortBy==="value") return b.value-a.value;
    if(sortBy==="pnl")   return b.pnl-a.pnl;
    if(sortBy==="pct")   return b.pct-a.pct;
    return 0;
  });
  const displayed = showAll ? sorted : sorted.slice(0,12);
  const top5 = [...H].sort((a,b)=>b.value-a.value).slice(0,5);
  const topColors = [C.blue, C.amber, C.lavender, C.olive, C.teal];
  const winners = H.filter(h=>h.pnl>0).sort((a,b)=>b.pct-a.pct);
  const losers  = H.filter(h=>h.pnl<0).sort((a,b)=>a.pct-b.pct);

  const filteredEvents = filterType==="全部" ? EVENTS : EVENTS.filter(e=>e.type===filterType);

  // ── 刷新即時股價（TWSE MIS API）───────────────────────────────
  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const codes = H.map(h => h.code);
      // 同時嘗試上市(tse)和上櫃(otc)，API 只會回傳有效的
      const queries = codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]);
      const exCh = queries.join('|');
      const url = import.meta.env.DEV
        ? `/api/twse/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`
        : `/api/twse?ex_ch=${encodeURIComponent(exCh)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.msgArray && data.msgArray.length > 0) {
        const priceMap = {};
        data.msgArray.forEach(item => {
          // z = 最新成交價（盤中），y = 昨收價（盤前/收盤後）
          const latest = parseFloat(item.z);
          const yClose = parseFloat(item.y);
          const price = (!isNaN(latest) && latest > 0) ? latest
                      : (!isNaN(yClose) && yClose > 0) ? yClose : null;
          if (price && !priceMap[item.c]) {
            priceMap[item.c] = price;
          }
        });

        setHoldings(prev => (prev || []).map(h => {
          const newPrice = priceMap[h.code];
          if (newPrice == null) return h;
          const newValue = Math.round(newPrice * h.qty);
          const newPnl = Math.round((newPrice - h.cost) * h.qty);
          const newPct = Math.round((newPrice / h.cost - 1) * 10000) / 100;
          return { ...h, price: newPrice, value: newValue, pnl: newPnl, pct: newPct };
        }));

        const updated = Object.keys(priceMap).length;
        const total = codes.length;
        const missed = codes.filter(c => !priceMap[c]);
        setLastUpdate(new Date());
        if (missed.length > 0 && missed.length < total) {
          const missedNames = missed.map(c => { const h = H.find(x=>x.code===c); return h ? h.name : c; }).join("、");
          setSaved(`✅ ${updated}/${total} 檔已更新（${missedNames} 無即時報價）`);
        } else {
          setSaved(`✅ ${updated} 檔股價已更新`);
        }
        setTimeout(() => setSaved(""), 4000);
      } else {
        setSaved("⚠️ 無法取得報價（可能非交易時間）");
        setTimeout(() => setSaved(""), 3000);
      }
    } catch (err) {
      console.error('刷新股價失敗:', err);
      setSaved("❌ 刷新失敗，請稍後再試");
      setTimeout(() => setSaved(""), 3000);
    }
    setRefreshing(false);
  };

  // ── 每日收盤分析 ─────────────────────────────────────────────────
  const runDailyAnalysis = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeStep("取得即時股價...");
    try {
      // 1. 取得最新股價
      const codes = H.map(h => h.code);
      const queries = codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]);
      const exCh = queries.join('|');
      const url = import.meta.env.DEV
        ? `/api/twse/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`
        : `/api/twse?ex_ch=${encodeURIComponent(exCh)}`;
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
      const NE = newsEvents || NEWS_EVENTS;
      const today = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/");
      const pendingEvents = NE.filter(e => e.status === "pending");
      const eventCorrelations = pendingEvents.map(e => {
        const relatedStocks = e.stocks.map(s => {
          const code = s.match(/\d+/)?.[0];
          const ch = changes.find(c => c.code === code);
          return ch ? { name: ch.name, code: ch.code, changePct: ch.changePct, change: ch.change } : null;
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

        const aiRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

請分析今日收盤表現，事件連動，並給出策略建議。特別注意策略大腦中的歷史教訓。`
          })
        });
        const aiData = await aiRes.json();
        aiInsight = aiData.content?.[0]?.text || null;
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
        needsReview,
        aiInsight,
      };

      setDailyReport(report);
      setAnalysisHistory(prev => [report, ...(prev || []).filter(r => r.date !== today)].slice(0, 30));

      // 8. 策略大腦進化 — 讓 AI 更新策略知識庫
      setAnalyzeStep("策略大腦進化中...");
      if (aiInsight) {
        try {
          const NE = newsEvents || NEWS_EVENTS;
          const pastEvents = NE.filter(e => e.status === "past");
          const hits = pastEvents.filter(e => e.correct === true).length;
          const total = pastEvents.filter(e => e.correct !== null).length;

          const brainRes = await fetch("/api/analyze", {
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
          // 同步到雲端
          fetch("/api/brain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save-brain", data: newBrain })
          }).catch(() => {});
          // 同步分析報告到雲端
          fetch("/api/brain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save-analysis", data: report })
          }).catch(() => {});
        } catch (e) {
          console.error("策略大腦更新失敗:", e);
        }
      }

      // 同步更新持倉價格
      setHoldings(prev => (prev || []).map(h => {
        const pm = priceMap[h.code];
        if (!pm) return h;
        const newValue = Math.round(pm.price * h.qty);
        const newPnl = Math.round((pm.price - h.cost) * h.qty);
        const newPct = Math.round((pm.price / h.cost - 1) * 10000) / 100;
        return { ...h, price: pm.price, value: newValue, pnl: newPnl, pct: newPct };
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
      const arr = [...(prev || NEWS_EVENTS)];
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
    setNewsEvents(prev => [...(prev || NEWS_EVENTS), evt]);
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

  const parseShot = async () => {
    if (!b64) return;
    setParsing(true); setParseErr(null);
    try {
      const res = await fetch("/api/parse", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          systemPrompt: PARSE_PROMPT,
          base64: b64,
          mediaType: "image/jpeg",
        })
      });
      const data = await res.json();
      const clean = (data.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
      setParsed(JSON.parse(clean));
    } catch { setParseErr("解析失敗，請確認截圖清晰"); }
    finally  { setParsing(false); }
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

    setHoldings(prev=>{
      const arr=[...(prev||[])];
      const idx=arr.findIndex(h=>h.code===t.code);
      if (t.action==="買進") {
        if (idx>=0) {
          const h=arr[idx];
          const nq=h.qty+t.qty;
          const nc=(h.cost*h.qty+t.price*t.qty)/nq;
          arr[idx]={...h, qty:nq, price:t.price, cost:Math.round(nc*100)/100,
            value:t.price*nq, pnl:Math.round((t.price-nc)*nq),
            pct:Math.round((t.price/nc-1)*10000)/100};
        } else {
          arr.push({code:t.code,name:t.name,qty:t.qty,price:t.price,cost:t.price,
            value:t.price*t.qty,pnl:0,pct:0,type:"股票"});
        }
      } else {
        if (idx>=0) {
          const h=arr[idx]; const nq=Math.max(0,h.qty-t.qty);
          if(nq===0){arr.splice(idx,1);}
          else{arr[idx]={...h,qty:nq,price:t.price,value:t.price*nq,
            pnl:Math.round((t.price-h.cost)*nq),pct:Math.round((t.price/h.cost-1)*10000)/100};}
        }
      }
      return arr;
    });

    setSaved("✅ 已儲存");
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

  const qs = parsed?.trades?.[0] ? (MEMO_Q[parsed.trades[0].action]||MEMO_Q["買進"]) : [];

  if (!ready) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",
      alignItems:"center",justifyContent:"center",color:C.textMute,
      fontFamily:"sans-serif",fontSize:13}}>載入中...</div>
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
      fontFamily:"'DM Sans','Noto Sans TC',sans-serif",paddingBottom:40}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        html{-webkit-text-size-adjust:100%}
        body{-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
        textarea::placeholder,input::placeholder{color:${C.textMute}}
        input,textarea,button{font-family:inherit;-webkit-appearance:none}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
          @keyframes progress{0%{width:5%}50%{width:70%}100%{width:95%}}
        @media(max-width:480px){
          body{font-size:14px}
        }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"16px 16px 0",position:"sticky",top:0,zIndex:10}}>

        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <div>
            <div style={{fontSize:9,color:C.textMute,letterSpacing:"0.15em",textTransform:"uppercase",fontWeight:500}}>
              <span style={{color:cloudSync?C.olive:C.textMute}}>{cloudSync?"☁":"⚡"}</span>
              {saved && <span style={{color:C.olive,marginLeft:8,fontWeight:600}}>{saved}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:21,fontWeight:600,color:C.text,marginTop:2,letterSpacing:"-0.01em"}}>持倉看板</span>
              <button onClick={refreshPrices} disabled={refreshing} style={{
                background: refreshing ? C.subtle : C.blue+"22",
                color: refreshing ? C.textMute : C.blue,
                border:`1px solid ${refreshing ? C.border : C.blue+"55"}`,
                borderRadius:20, padding:"4px 12px", fontSize:10, fontWeight:500,
                cursor: refreshing ? "not-allowed" : "pointer",
                transition:"all 0.2s", whiteSpace:"nowrap",
              }}>
                {refreshing ? "更新中..." : "⟳ 刷新股價"}
              </button>
              {lastUpdate && !refreshing && (
                <span style={{fontSize:9,color:C.textMute}}>
                  {lastUpdate.toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}
                </span>
              )}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:C.textMute,marginBottom:2}}>未實現損益</div>
            <div style={{fontSize:22,fontWeight:700,color:pc(totalPnl),letterSpacing:"-0.02em"}}>
              {totalPnl>=0?"+":""}{totalPnl.toLocaleString()}
            </div>
            <div style={{fontSize:11,fontWeight:600,color:pc(retPct)}}>
              {retPct>=0?"+":""}{retPct.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* today alert */}
        {urgentCount>0 && (
          <div style={{background:C.upBg,border:`1px solid ${C.up}44`,
            borderLeft:`3px solid ${C.up}`,
            borderRadius:8,padding:"8px 11px",marginBottom:12,
            fontSize:11,color:C.up,lineHeight:1.7,fontWeight:500}}>
            今日 · 台燿法說決定加碼或停損 · 晶豪科已到出場區間
          </div>
        )}

        <div style={{display:"flex",gap:0,overflowX:"auto",paddingBottom:0,marginTop:4}}>
          {TABS.map(t=>(
            <button key={t.k} onClick={()=>{setTab(t.k);window.scrollTo({top:0,behavior:"smooth"})}} style={{
              background:"transparent",
              color: tab===t.k ? C.text : C.textMute,
              border:"none",
              borderBottom: tab===t.k ? `2px solid ${C.amber}` : "2px solid transparent",
              padding:"8px 12px",
              fontSize:11, fontWeight: tab===t.k ? 600 : 400,
              cursor:"pointer", whiteSpace:"nowrap",
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{padding:"14px 14px"}}>

        {/* ══════════ HOLDINGS ══════════ */}
        {tab==="holdings" && <>
          {/* 摘要 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {[["總成本",totalCost.toLocaleString(),C.textSec],
              ["總市值",totalVal.toLocaleString(),C.blue],
              ["持股數",H.length+"檔",C.lavender]].map(([l,v,c])=>(
              <div key={l} style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 11px"}}>
                <div style={{fontSize:9,color:C.textMute,letterSpacing:"0.08em"}}>{l}</div>
                <div style={{fontSize:15,fontWeight:600,color:c,marginTop:3}}>{v}</div>
              </div>
            ))}
          </div>

          {/* top5 */}
          <div style={{...card,marginBottom:10}}>
            <div style={lbl}>市值佔比 Top 5</div>
            {top5.map((h,i)=>{
              const pct=h.value/totalVal*100;
              return <div key={h.code} style={{marginTop:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,color:C.textSec,fontWeight:500}}>{h.name}</span>
                  <span style={{fontSize:12,fontWeight:600,color:topColors[i]}}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{background:C.subtle,borderRadius:4,height:4}}>
                  <div style={{width:`${pct}%`,height:"100%",background:topColors[i]+"88",borderRadius:4}}/>
                </div>
              </div>;
            })}
          </div>

          {/* 勝負摘要 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <div style={{...card,borderLeft:`3px solid ${C.up}88`}}>
              <div style={{...lbl,color:C.up}}>獲利 {winners.length}檔</div>
              {winners.slice(0,3).map(h=>(
                <div key={h.code} style={{display:"flex",justifyContent:"space-between",marginTop:7}}>
                  <span style={{fontSize:11,color:C.textSec}}>{h.name}</span>
                  <span style={{fontSize:11,fontWeight:600,color:C.up}}>+{h.pct}%</span>
                </div>
              ))}
            </div>
            <div style={{...card,borderLeft:`3px solid ${C.down}88`}}>
              <div style={{...lbl,color:C.down}}>虧損 {losers.length}檔</div>
              {losers.slice(0,3).map(h=>(
                <div key={h.code} style={{display:"flex",justifyContent:"space-between",marginTop:7}}>
                  <span style={{fontSize:11,color:C.textSec}}>{h.name}</span>
                  <span style={{fontSize:11,fontWeight:600,color:C.down}}>{h.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* 反轉追蹤（虧損持股） */}
          {losers.length>0 && (
            <div style={{...card,marginBottom:10,borderLeft:`3px solid ${C.amber}88`}}>
              <div style={{...lbl,color:C.amber}}>反轉追蹤 · {losers.length}檔等待中</div>
              {losers.map(h=>{
                const rc = (reversalConditions||{})[h.code];
                const [editing, setEditing] = [
                  reviewingEvent===`rev-${h.code}`,
                  (v)=>setReviewingEvent(v?`rev-${h.code}`:null)
                ];
                return <div key={h.code} style={{marginTop:8,padding:"8px 0",
                  borderBottom:`1px solid ${C.borderSub}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <span style={{fontSize:12,fontWeight:500,color:C.text}}>{h.name}</span>
                      <span style={{fontSize:10,color:C.down,marginLeft:6}}>{h.pct}%</span>
                    </div>
                    <button onClick={()=>setEditing(!editing)} style={{
                      padding:"3px 9px",borderRadius:5,fontSize:9,cursor:"pointer",
                      background:rc?C.olive+"22":"transparent",
                      border:`1px solid ${rc?C.olive+"55":C.border}`,
                      color:rc?C.olive:C.textMute}}>
                      {rc?"查看條件":"設定反轉條件"}
                    </button>
                  </div>
                  {rc && !editing && (
                    <div style={{fontSize:10,color:C.textSec,marginTop:4,lineHeight:1.7}}>
                      反轉訊號：{rc.signal} | 目標：{rc.target} | 停損：{rc.stopLoss}
                    </div>
                  )}
                  {editing && (()=>{
                    const draft = rc || {signal:"",target:"",stopLoss:"",note:""};
                    return <div style={{marginTop:8,background:C.subtle,borderRadius:7,padding:10}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                        <div>
                          <div style={{fontSize:9,color:C.textMute,marginBottom:2}}>反轉目標價</div>
                          <input defaultValue={draft.target} id={`rv-t-${h.code}`}
                            placeholder="如 130"
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:6,padding:"6px 8px",color:C.text,fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:9,color:C.textMute,marginBottom:2}}>停損價</div>
                          <input defaultValue={draft.stopLoss} id={`rv-s-${h.code}`}
                            placeholder="如 85"
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:6,padding:"6px 8px",color:C.text,fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                        </div>
                      </div>
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:9,color:C.textMute,marginBottom:2}}>反轉訊號（什麼條件出現代表反轉？）</div>
                        <input defaultValue={draft.signal} id={`rv-g-${h.code}`}
                          placeholder="如：月營收連續兩月成長、法人轉買超"
                          style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                            borderRadius:6,padding:"6px 8px",color:C.text,fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                      </div>
                      <div style={{marginBottom:8}}>
                        <div style={{fontSize:9,color:C.textMute,marginBottom:2}}>備註</div>
                        <input defaultValue={draft.note} id={`rv-n-${h.code}`}
                          placeholder="其他觀察..."
                          style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                            borderRadius:6,padding:"6px 8px",color:C.text,fontSize:11,outline:"none",fontFamily:"inherit"}}/>
                      </div>
                      <button onClick={()=>{
                        updateReversal(h.code, {
                          signal: document.getElementById(`rv-g-${h.code}`).value,
                          target: document.getElementById(`rv-t-${h.code}`).value,
                          stopLoss: document.getElementById(`rv-s-${h.code}`).value,
                          note: document.getElementById(`rv-n-${h.code}`).value,
                        });
                        setEditing(false);
                      }} style={{width:"100%",padding:"8px",borderRadius:6,border:"none",
                        background:C.olive+"cc",color:"#fff",fontSize:11,fontWeight:500,cursor:"pointer"}}>
                        儲存反轉條件
                      </button>
                    </div>;
                  })()}
                </div>;
              })}
            </div>
          )}

          {/* 排序 + 列表 */}
          <div style={{display:"flex",gap:5,marginBottom:10,alignItems:"center"}}>
            <span style={{fontSize:10,color:C.textMute}}>排序：</span>
            {[["value","市值"],["pnl","損益"],["pct","報酬%"]].map(([k,l])=>(
              <button key={k} onClick={()=>setSortBy(k)} style={{
                background: sortBy===k ? C.subtle : "transparent",
                color: sortBy===k ? C.amber : C.textMute,
                border:`1px solid ${sortBy===k ? C.amber+"66" : C.border}`,
                borderRadius:20, padding:"3px 11px", fontSize:10, fontWeight:500, cursor:"pointer",
              }}>{l}</button>
            ))}
          </div>

          <div style={card}>
            {displayed.map((h,i)=>{
              const T      = targets?.[h.code];
              const tp     = T ? avgTarget(h.code) : null;
              const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
              const isNew  = T?.isNew;
              return (
              <div key={h.code} style={{
                display:"flex", alignItems:"flex-start", justifyContent:"space-between",
                padding:"10px 0",
                borderBottom: i<displayed.length-1 ? `1px solid ${C.borderSub}` : "none"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.text}}>{h.name}</span>
                    <span style={{fontSize:9,color:C.textMute}}>{h.code}</span>
                    {h.type!=="股票"&&(
                      <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,
                        background: h.type==="權證" ? C.amberBg : C.blueBg,
                        color: h.type==="權證" ? C.amber : C.blue,
                        fontWeight:500}}>{h.type}</span>
                    )}
                    {h.expire&&<span style={{fontSize:9,color:C.amber,fontWeight:500}}>到期{h.expire}</span>}
                    {h.alert&&<span style={{fontSize:9,color:C.up,fontWeight:600}}>{h.alert}</span>}
                    {isNew&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:3,
                      background:C.tealBg,color:C.teal,fontWeight:600,
                      animation:"pulse 1.5s ease-in-out infinite"}}>目標價更新</span>}
                  </div>
                  <div style={{fontSize:10,color:C.textMute,marginTop:2}}>
                    {h.qty}股 · 成本{h.cost?.toLocaleString()} · 現{h.price?.toLocaleString()}
                  </div>
                  {/* 目標價進度條 */}
                  {tp && (
                    <div style={{marginTop:5}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span style={{fontSize:9,color:C.textMute}}>
                          目標 {tp.toLocaleString()}
                          {T?.reports?.length>1 && <span style={{color:C.textMute}}> ({T.reports.length}家均)</span>}
                        </span>
                        <span style={{fontSize:9,fontWeight:600,
                          color: upside>=0 ? C.up : C.down}}>
                          {upside>=0?"+":""}{upside?.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{background:C.subtle,borderRadius:3,height:3,width:"100%",overflow:"hidden"}}>
                        <div style={{
                          width:`${Math.min(Math.max((h.price/tp)*100,0),100)}%`,
                          height:"100%",
                          background: upside>=15 ? C.up+"99"
                            : upside>=0  ? C.amber+"99"
                            : C.down+"99",
                          borderRadius:3,
                        }}/>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{textAlign:"right",minWidth:70,paddingLeft:8}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.textSec}}>{h.value?.toLocaleString()}</div>
                  <div style={{fontSize:11,fontWeight:600,color:pc(h.pnl)}}>{h.pnl>=0?"+":""}{h.pnl?.toLocaleString()}</div>
                  <div style={{fontSize:10,color:pc(h.pct)}}>{h.pct>=0?"+":""}{h.pct?.toFixed(1)}%</div>
                </div>
              </div>
              );
            })}
            {!showAll && sorted.length>12 && (
              <button onClick={()=>setShowAll(true)} style={{
                width:"100%",marginTop:10,padding:"9px",
                background:"transparent",border:`1px solid ${C.border}`,
                borderRadius:8,color:C.textMute,fontSize:11,cursor:"pointer",fontWeight:400,
              }}>顯示全部 {sorted.length} 檔</button>
            )}
          </div>
        </>}

        {/* ══════════ WATCHLIST ══════════ */}
        {tab==="watchlist" && <>
          <div style={{...card,borderLeft:`3px solid ${C.up}`,marginBottom:12}}>
            <div style={{fontSize:9,color:C.up,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase"}}>今日</div>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginTop:5}}>
              台燿 6274 — 今日法說會
            </div>
            <div style={{fontSize:11,color:C.textSec,marginTop:5,lineHeight:1.8}}>
              毛利率回沖 + 展望樂觀 → 補齊剩餘 2/3 部位<br/>
              展望保守 → 停損 430 元
            </div>
          </div>

          {INIT_WATCHLIST.map((w,wi)=>{
            const upside=((w.target-w.price)/w.price*100).toFixed(1);
            const prog=Math.min(w.price/w.target*100,100);
            const sc = w.sc==="#f59e0b"?C.amber:w.sc==="#22c55e"?C.olive:C.up;
            const bgTints=[C.card,C.cardBlue,C.cardAmber];
            return <div key={w.code} style={{...card, background:bgTints[wi%3], marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:16,fontWeight:600,color:C.text}}>{w.name}
                    <span style={{fontSize:10,color:C.textMute,fontWeight:400,marginLeft:6}}>{w.code}</span>
                  </div>
                  <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{w.catalyst}</div>
                </div>
                <span style={{background:sc+"22",color:sc,fontSize:10,fontWeight:500,
                  padding:"3px 11px",borderRadius:20}}>{w.status}</span>
              </div>
              <div style={{display:"flex",gap:16,marginTop:12,flexWrap:"wrap"}}>
                {[["現價",w.price.toLocaleString(),C.textSec],
                  ["目標價",w.target.toLocaleString(),C.olive],
                  ["潛在漲幅","+"+upside+"%",C.blue]].map(([l,v,c])=>(
                  <div key={l}>
                    <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:17,fontWeight:600,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:12}}>
                <div style={{background:C.subtle,borderRadius:3,height:3}}>
                  <div style={{width:`${prog}%`,height:"100%",
                    background:`linear-gradient(90deg,${C.blue}88,${C.olive}88)`,borderRadius:3}}/>
                </div>
              </div>
              <div style={{fontSize:10,color:C.textMute,marginTop:9,lineHeight:1.7}}>{w.note}</div>
            </div>;
          })}
        </>}

        {/* ══════════ EVENTS ══════════ */}
        {tab==="events" && <>
          <div style={{...card,marginBottom:12}}>
            <div style={lbl}>接力計畫</div>
            <div style={{background:C.subtle,borderRadius:8,padding:"12px 10px",marginTop:6,
              fontFamily:"monospace",fontSize:11,lineHeight:2.2,color:C.textMute}}>
              <span style={{color:C.up}}>3月</span>{" ── "}<span style={{color:C.amber}}>6月</span>{" ── "}<span style={{color:C.blue}}>9月</span>{" ── 12月"}<br/>
              <span style={{color:C.up}}>晶豪科 出場中 ▶</span><br/>
              {"                "}<span style={{color:C.amber}}>力積電 加碼評估 ──────▶</span><br/>
              {"                "}<span style={{color:C.blue}}>台燿 布局中 ─────────────▶</span>
            </div>
          </div>

          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
            {["全部",...Object.keys(TYPE_COLOR)].map(t=>(
              <button key={t} onClick={()=>setFilterType(t)} style={{
                background: filterType===t ? (TYPE_COLOR[t]+"33"||C.subtle) : "transparent",
                color: filterType===t ? (TYPE_COLOR[t]||C.text) : C.textMute,
                border:`1px solid ${filterType===t?(TYPE_COLOR[t]+"66"||C.border):C.border}`,
                borderRadius:20,padding:"3px 11px",fontSize:10,fontWeight:500,cursor:"pointer",
              }}>{t}</button>
            ))}
          </div>

          {filteredEvents.map((e,i)=>{
            const tc = TYPE_COLOR[e.type]||C.textMute;
            return <div key={i} style={{...card,marginBottom:7,
              borderLeft:`2px solid ${e.urgent ? C.up : tc+"66"}`}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{minWidth:48}}>
                  <div style={{background: e.urgent ? C.upBg : tc+"18",
                    color: e.urgent ? C.up : tc,
                    fontSize:9,fontWeight:600,padding:"2px 5px",borderRadius:4,
                    textAlign:"center",marginBottom:3}}>{e.type}</div>
                  <div style={{fontSize:9,color:C.textMute,textAlign:"center",lineHeight:1.4}}>{e.date}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:e.urgent?C.up:C.text}}>{e.label}</div>
                  <div style={{fontSize:10,color:C.textMute,marginTop:3,lineHeight:1.6}}>{e.sub}</div>
                </div>
              </div>
            </div>;
          })}
        </>}

        {/* ══════════ DAILY ANALYSIS ══════════ */}
        {tab==="daily" && <>
          {/* 手動觸發按鈕 */}
          {!dailyReport && !analyzing && (
            <div style={{...card,textAlign:"center",padding:"28px 16px",marginBottom:12}}>
              <div style={{fontSize:28,marginBottom:10,opacity:0.4}}>◎</div>
              <div style={{fontSize:13,color:C.textSec,fontWeight:500,marginBottom:6}}>每日收盤分析</div>
              <div style={{fontSize:11,color:C.textMute,marginBottom:16,lineHeight:1.7}}>
                分析今日股價變動與事件連動性<br/>自動比對持倉漲跌、異常波動、策略建議
              </div>
              <button onClick={runDailyAnalysis} style={{
                padding:"12px 28px",borderRadius:10,border:"none",
                background:`linear-gradient(135deg,${C.blue}cc,${C.olive}cc)`,
                color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",
                letterSpacing:"0.03em"}}>
                開始今日收盤分析
              </button>
              <div style={{fontSize:10,color:C.textMute,marginTop:10}}>
                收盤後按下即可開始分析
              </div>
            </div>
          )}

          {analyzing && (
            <div style={{...card,textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.amber,fontWeight:500,animation:"pulse 1.5s ease-in-out infinite"}}>
                {analyzeStep || "正在分析今日收盤數據..."}
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:8}}>取得股價 → 比對事件 → AI策略分析 → 大腦進化</div>
              <div style={{width:"100%",height:3,background:C.borderSub,borderRadius:2,marginTop:12,overflow:"hidden"}}>
                <div style={{height:"100%",background:C.amber,borderRadius:2,animation:"progress 8s ease-in-out infinite",width:"70%"}} />
              </div>
            </div>
          )}

          {dailyReport && <>
            {/* 今日損益摘要 */}
            <div id="daily-report-top" style={{...card,marginBottom:10,
              borderLeft:`3px solid ${dailyReport.totalTodayPnl>=0?C.up:C.down}88`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={()=>setDailyReport(null)} style={{fontSize:10,padding:"2px 8px",borderRadius:4,border:`1px solid ${C.border}`,background:"transparent",color:C.textMute,cursor:"pointer"}}>← 返回</button>
                    <div style={lbl}>{dailyReport.date} 收盤分析</div>
                  </div>
                  <div style={{fontSize:9,color:C.textMute}}>{dailyReport.time} 更新</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:C.textMute}}>今日損益</div>
                  <div style={{fontSize:20,fontWeight:700,color:pc(dailyReport.totalTodayPnl)}}>
                    {dailyReport.totalTodayPnl>=0?"+":""}{dailyReport.totalTodayPnl.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* 持倉漲跌排行 */}
            <div style={{...card,marginBottom:10}}>
              <div style={lbl}>持倉今日漲跌</div>
              {dailyReport.changes.map((c,i)=>(
                <div key={c.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"8px 0",borderBottom:i<dailyReport.changes.length-1?`1px solid ${C.borderSub}`:"none"}}>
                  <div>
                    <span style={{fontSize:12,fontWeight:500,color:C.text}}>{c.name}</span>
                    <span style={{fontSize:9,color:C.textMute,marginLeft:5}}>{c.code}</span>
                    {c.type!=="股票"&&<span style={{fontSize:9,marginLeft:5,padding:"1px 5px",borderRadius:3,
                      background:C.amberBg,color:C.amber}}>{c.type}</span>}
                  </div>
                  <div style={{textAlign:"right",display:"flex",gap:12,alignItems:"center"}}>
                    <span style={{fontSize:11,color:C.textMute}}>{c.price?.toLocaleString()}</span>
                    <span style={{fontSize:12,fontWeight:600,color:pc(c.changePct),minWidth:55,textAlign:"right"}}>
                      {c.changePct>=0?"+":""}{c.changePct.toFixed(2)}%
                    </span>
                    <span style={{fontSize:10,color:pc(c.todayPnl),minWidth:50,textAlign:"right"}}>
                      {c.todayPnl>=0?"+":""}{c.todayPnl.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* 異常波動 */}
            {dailyReport.anomalies.length>0 && (
              <div style={{...card,marginBottom:10,borderLeft:`3px solid ${C.amber}88`}}>
                <div style={{...lbl,color:C.amber}}>異常波動 ({">"}3%)</div>
                {dailyReport.anomalies.map(a=>(
                  <div key={a.code} style={{display:"flex",justifyContent:"space-between",padding:"6px 0"}}>
                    <span style={{fontSize:12,color:C.text}}>{a.name}</span>
                    <span style={{fontSize:12,fontWeight:600,color:pc(a.changePct)}}>
                      {a.changePct>=0?"+":""}{a.changePct.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 事件連動 */}
            {dailyReport.eventCorrelations.length>0 && (
              <div style={{...card,marginBottom:10,borderLeft:`3px solid ${C.teal}88`}}>
                <div style={{...lbl,color:C.teal}}>事件連動分析</div>
                {dailyReport.eventCorrelations.map(ec=>(
                  <div key={ec.id} style={{marginBottom:10,background:C.subtle,borderRadius:7,padding:"9px 11px"}}>
                    <div style={{fontSize:11,fontWeight:500,color:C.text,marginBottom:4}}>{ec.title}</div>
                    <div style={{fontSize:10,color:C.textMute,marginBottom:6}}>{ec.date}</div>
                    {ec.relatedStocks.map(s=>(
                      <div key={s.code} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                        <span style={{fontSize:10,color:C.textSec}}>{s.name}</span>
                        <span style={{fontSize:10,fontWeight:600,color:pc(s.changePct)}}>
                          {s.changePct>=0?"+":""}{s.changePct.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* 需要復盤的事件 */}
            {dailyReport.needsReview.length>0 && (
              <div style={{...card,marginBottom:10,borderLeft:`3px solid ${C.up}88`}}>
                <div style={{...lbl,color:C.up}}>需要復盤 · {dailyReport.needsReview.length}件</div>
                {dailyReport.needsReview.map(e=>(
                  <div key={e.id} style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:500,color:C.text}}>{e.title}</div>
                    <div style={{fontSize:10,color:C.textMute}}>{e.date} — 預測{e.pred==="up"?"看漲":"看跌"}</div>
                    <button onClick={()=>{setTab("news");setExpandedNews(new Set([e.id]))}}
                      style={{marginTop:4,padding:"4px 10px",borderRadius:5,border:`1px solid ${C.olive}55`,
                        background:"transparent",color:C.olive,fontSize:10,cursor:"pointer"}}>
                      前往復盤
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* AI 策略分析 */}
            {dailyReport.aiInsight && (
              <div style={{...card,marginBottom:10,borderLeft:`3px solid ${C.lavender}88`}}>
                <div style={{...lbl,color:C.lavender}}>AI 策略分析</div>
                <div style={{fontSize:11,color:C.textSec,lineHeight:2,whiteSpace:"pre-wrap"}}>
                  {dailyReport.aiInsight}
                </div>
              </div>
            )}

            {!dailyReport.aiInsight && (
              <div style={{...card,marginBottom:10,background:C.subtle}}>
                <div style={{fontSize:11,color:C.textMute,textAlign:"center",padding:"8px 0"}}>
                  AI 分析未產生（請確認 Vercel 已設定 ANTHROPIC_API_KEY）
                </div>
              </div>
            )}

            {/* 重新分析 */}
            <button onClick={runDailyAnalysis} disabled={analyzing} style={{
              width:"100%",padding:"11px",borderRadius:8,border:`1px solid ${C.border}`,
              background:"transparent",color:C.textMute,fontSize:11,cursor:"pointer",
              marginBottom:16}}>
              重新分析
            </button>
          </>}

          {/* 策略大腦 */}
          {strategyBrain && (
            <div style={{...card,marginBottom:12,borderLeft:`3px solid ${C.lavender}88`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{...lbl,color:C.lavender,marginBottom:0}}>策略大腦</div>
                <span style={{fontSize:9,color:C.textMute}}>
                  更新：{strategyBrain.lastUpdate||"—"} | 分析次數：{strategyBrain.stats?.totalAnalyses||0}
                </span>
              </div>

              {(strategyBrain.rules||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.amber,fontWeight:600,marginBottom:5}}>核心策略規則</div>
                  {strategyBrain.rules.map((r,i)=>(
                    <div key={i} style={{fontSize:11,color:C.textSec,lineHeight:1.8,
                      padding:"3px 0",borderBottom:`1px solid ${C.borderSub}`}}>
                      {i+1}. {r}
                    </div>
                  ))}
                </div>
              )}

              {(strategyBrain.commonMistakes||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.up,fontWeight:600,marginBottom:5}}>常犯錯誤（警醒）</div>
                  {strategyBrain.commonMistakes.map((m,i)=>(
                    <div key={i} style={{fontSize:11,color:C.textSec,lineHeight:1.8}}>⚠ {m}</div>
                  ))}
                </div>
              )}

              {(strategyBrain.lessons||[]).length>0 && (
                <div>
                  <div style={{fontSize:10,color:C.olive,fontWeight:600,marginBottom:5}}>
                    最近教訓（共 {strategyBrain.lessons.length} 條）
                  </div>
                  {strategyBrain.lessons.slice(-5).reverse().map((l,i)=>(
                    <div key={i} style={{fontSize:10,color:C.textMute,lineHeight:1.7,
                      padding:"4px 0",borderBottom:`1px solid ${C.borderSub}`}}>
                      <span style={{color:C.textSec}}>[{l.date}]</span> {l.text}
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                <div style={{fontSize:10,color:C.lavender,fontWeight:500}}>
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
                  }} style={{fontSize:9,padding:"3px 8px",borderRadius:4,border:`1px solid ${C.border}`,background:"transparent",color:C.textMute,cursor:"pointer"}}>
                    匯出
                  </button>
                  <button onClick={()=>{
                    if (confirm("確定要重置策略大腦？所有累積的規則和教訓將被清除。")) {
                      setStrategyBrain(null);
                      save("pf-brain-v1", null);
                      fetch("/api/brain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save-brain",data:null})}).catch(()=>{});
                    }
                  }} style={{fontSize:9,padding:"3px 8px",borderRadius:4,border:`1px solid ${C.up}44`,background:"transparent",color:C.up,cursor:"pointer"}}>
                    重置
                  </button>
                </div>
              </div>
              <div style={{fontSize:9,color:cloudSync?C.olive:C.textMute,marginTop:6}}>
                {cloudSync ? "☁ 已雲端同步" : "⚡ 本機模式"}
              </div>
            </div>
          )}

          {!strategyBrain && (
            <div style={{...card,marginBottom:12,textAlign:"center",padding:"16px"}}>
              <div style={{fontSize:11,color:C.textMute}}>
                執行第一次收盤分析後，策略大腦將自動建立並持續進化
              </div>
            </div>
          )}

          {/* 歷史分析 */}
          {(analysisHistory||[]).length>0 && (
            <div style={{...card}}>
              <div style={lbl}>歷史分析記錄</div>
              {(analysisHistory||[]).slice(0,10).map(r=>(
                <div key={r.id} onClick={()=>{
                    setDailyReport(r);
                    setTimeout(()=>document.getElementById("daily-report-top")?.scrollIntoView({behavior:"smooth"}),50);
                  }}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"8px 0",cursor:"pointer",
                    background:dailyReport?.id===r.id?C.subtle:"transparent",
                    borderRadius:6, paddingLeft:6, paddingRight:6,
                    borderBottom:`1px solid ${C.borderSub}`}}>
                  <div>
                    <span style={{fontSize:12,color:C.text}}>{r.date}</span>
                    <span style={{fontSize:10,color:C.textMute,marginLeft:6}}>{r.time}</span>
                  </div>
                  <span style={{fontSize:12,fontWeight:600,color:pc(r.totalTodayPnl)}}>
                    {r.totalTodayPnl>=0?"+":""}{r.totalTodayPnl.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>}

        {/* ══════════ UPLOAD ══════════ */}
        {tab==="trade" && <>
          {!parsed && (
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
                  <div style={{fontSize:11,color:C.textMute}}>點擊更換截圖</div></>
                ) : (
                  <><div style={{fontSize:32,marginBottom:10,opacity:0.5}}>↑</div>
                  <div style={{fontSize:13,fontWeight:500,color:C.textSec}}>上傳已成交截圖</div>
                  <div style={{fontSize:11,color:C.textMute,marginTop:4}}>買進 · 賣出回報皆可</div></>
                )}
              </div>
              {img && (
                <button onClick={parseShot} disabled={parsing} style={{
                  width:"100%",padding:"13px",border:"none",borderRadius:10,
                  background: parsing ? C.subtle : C.cardHover,
                  color: parsing ? C.textMute : C.text,
                  border: `1px solid ${parsing ? C.border : C.amber+"66"}`,
                  fontSize:13, fontWeight:500, cursor:parsing?"not-allowed":"pointer",
                  letterSpacing:"0.02em"}}>
                  {parsing ? "解析中..." : "解析這筆交易"}
                </button>
              )}
              {parseErr && <div style={{marginTop:10, background:C.upBg,
                border:`1px solid ${C.up}44`, borderRadius:10,
                padding:12, fontSize:12, color:C.up}}>
                {parseErr}
              </div>}
            </>
          )}

          {parsed?.trades?.length>0 && (
            <div>
              <div style={{...card,marginBottom:12}}>
                <div style={lbl}>解析結果</div>
                {parsed.trades.map((t,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",
                    alignItems:"center",padding:"10px 0",
                    borderBottom:i<parsed.trades.length-1?`1px solid ${C.borderSub}`:"none"}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{
                          background: t.action==="買進" ? C.upBg : C.downBg,
                          color: t.action==="買進" ? C.up : C.down,
                          fontSize:10, fontWeight:600, padding:"2px 9px", borderRadius:4}}>
                          {t.action}
                        </span>
                        <span style={{fontSize:14,fontWeight:600,color:C.text}}>{t.name}</span>
                        <span style={{fontSize:10,color:C.textMute}}>{t.code}</span>
                      </div>
                      <div style={{fontSize:11,color:C.textMute,marginTop:3}}>
                        {t.qty}股 @ {t.price?.toLocaleString()}元
                      </div>
                    </div>
                  </div>
                ))}
                {parsed.targetPriceUpdates?.length>0 && (
                  <div style={{marginTop:10,background:C.tealBg,border:`1px solid ${C.teal}44`,
                    borderRadius:7,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:C.teal,fontWeight:600,marginBottom:4}}>
                      偵測到目標價更新
                    </div>
                    {parsed.targetPriceUpdates.map((u,i)=>(
                      <div key={i} style={{fontSize:11,color:C.textSec}}>
                        {u.code} · {u.firm} → {u.target?.toLocaleString()}元
                      </div>
                    ))}
                  </div>
                )}
                {parsed.note && <div style={{fontSize:10,color:C.textMute,marginTop:8}}>{parsed.note}</div>}
              </div>

              <div style={{...card,borderLeft:`2px solid ${C.blue}88`}}>
                <div style={lbl}>交易備忘錄</div>
                {memoAns.map((a,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:C.textMute,marginBottom:4}}>Q{i+1}. {qs[i]}</div>
                    <div style={{fontSize:12,color:C.textSec,background:C.subtle,
                      borderRadius:6,padding:"8px 10px",lineHeight:1.6}}>{a}</div>
                  </div>
                ))}
                <div style={{fontSize:12,fontWeight:500,color:C.blue,marginBottom:8}}>
                  Q{memoStep+1}/{qs.length}. {qs[memoStep]}
                </div>
                <textarea value={memoIn} onChange={e=>setMemoIn(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&memoIn.trim()){e.preventDefault();submitMemo();}}}
                  placeholder="輸入你的想法... (Enter送出)"
                  style={{width:"100%", background:C.subtle, border:`1px solid ${C.border}`,
                    borderRadius:8, padding:"10px", color:C.text, fontSize:12,
                    resize:"none", minHeight:70, outline:"none",
                    fontFamily:"inherit", marginBottom:10, lineHeight:1.7}}/>
                <button onClick={submitMemo} disabled={!memoIn.trim()} style={{
                  width:"100%", padding:"12px", border:"none", borderRadius:8,
                  background: memoIn.trim()
                    ? (memoStep===qs.length-1 ? C.olive+"cc" : C.blue+"cc")
                    : C.subtle,
                  color: memoIn.trim() ? "#fff" : C.textMute,
                  fontSize:13, fontWeight:500, cursor:memoIn.trim()?"pointer":"not-allowed",
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
              <div style={{...card,marginTop:14,borderLeft:`2px solid ${C.teal}66`}}>
                <div style={lbl}>手動更新目標價</div>
                <div style={{fontSize:11,color:C.textMute,marginBottom:10,lineHeight:1.6}}>
                  收到新研究報告時，直接在這裡更新。系統會自動計算多家均值。
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
                  <div>
                    <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>股票代碼</div>
                    <input value={tpCode} onChange={e=>setTpCode(e.target.value)}
                      placeholder="如 3006"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>目標價（元）</div>
                    <input value={tpVal} onChange={e=>setTpVal(e.target.value)}
                      placeholder="如 205"
                      type="number"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>券商 / 來源</div>
                  <input value={tpFirm} onChange={e=>setTpFirm(e.target.value)}
                    placeholder="如 元大投顧、FactSet共識"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                </div>
                <button onClick={handleAddTarget}
                  disabled={!tpCode.trim()||!tpVal}
                  style={{
                    width:"100%",padding:"10px",border:"none",borderRadius:8,
                    background: tpCode.trim()&&tpVal ? C.teal+"cc" : C.subtle,
                    color: tpCode.trim()&&tpVal ? "#fff" : C.textMute,
                    fontSize:12,fontWeight:500,cursor:tpCode.trim()&&tpVal?"pointer":"not-allowed",
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
              <div style={{fontSize:24,marginBottom:10,opacity:0.3}}>◌</div>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400}}>
                還沒有交易記錄<br/>
                <span style={{fontSize:11}}>上傳成交截圖後自動記錄在這裡</span>
              </div>
            </div>
          ) : (
            [...(tradeLog||[])].sort((a,b)=>b.id-a.id).map(log=>(
              <div key={log.id} style={{...card,marginBottom:10,
                borderLeft:`2px solid ${log.action==="買進" ? C.up+"88" : C.down+"88"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{
                      background: log.action==="買進" ? C.upBg : C.downBg,
                      color: log.action==="買進" ? C.up : C.down,
                      fontSize:9, fontWeight:600, padding:"2px 8px", borderRadius:4}}>
                      {log.action}
                    </span>
                    <span style={{fontSize:14,fontWeight:600,color:C.text}}>{log.name}</span>
                    <span style={{fontSize:10,color:C.textMute}}>{log.code}</span>
                  </div>
                  <div style={{fontSize:10,color:C.textMute}}>{log.date} {log.time}</div>
                </div>
                <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>
                  {log.qty}股 @ {log.price?.toLocaleString()}元
                </div>
                {log.qa.map((item,i)=>(
                  <div key={i} style={{marginBottom:8}}>
                    <div style={{fontSize:10,color:C.textMute,marginBottom:3}}>{item.q}</div>
                    <div style={{fontSize:11,color:C.textSec,background:C.subtle,
                      borderRadius:6,padding:"7px 10px",lineHeight:1.7}}>
                      {item.a||"（未填）"}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </>}

        {/* ══════════ NEWS ANALYSIS ══════════ */}
        {tab==="news" && (()=>{
          const NE = newsEvents || NEWS_EVENTS;
          const past    = NE.filter(e=>e.status==="past").sort((a,b)=>b.id-a.id);
          const pending = NE.filter(e=>e.status==="pending").sort((a,b)=>a.id-b.id);
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
              ? (isCorrect===true ? C.olive+"99" : isCorrect===false ? C.up+"99" : C.border)
              : predC(e.pred)+"55";

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
                    fontSize:14, fontWeight:700,
                    color: predC(e.pred), opacity: 0.85,
                  }}>{predIcon(e.pred)}</div>

                  {/* 標題區 */}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{
                      fontSize:12, fontWeight:500, color:C.text,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    }}>{e.title}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:9,color:C.textMute}}>{e.date}</span>
                      {e.stocks.slice(0,2).map(s=>(
                        <span key={s} style={{fontSize:9,padding:"1px 6px",borderRadius:3,
                          background:C.subtle,color:C.textSec}}>{s.split(" ")[0]}</span>
                      ))}
                      {e.stocks.length>2 && <span style={{fontSize:9,color:C.textMute}}>+{e.stocks.length-2}</span>}
                    </div>
                  </div>

                  {/* 右側狀態 */}
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
                    {e.status==="past" && isCorrect!==null && (
                      <span style={{
                        fontSize:9, fontWeight:600, padding:"2px 7px", borderRadius:20,
                        background: isCorrect ? C.oliveBg : C.upBg,
                        color: isCorrect ? C.olive : C.up,
                      }}>{isCorrect ? "✓ 正確" : "✗ 有誤"}</span>
                    )}
                    {e.status==="pending" && (
                      <span style={{fontSize:9,color:C.textMute,fontWeight:500}}>待驗證</span>
                    )}
                    <span style={{fontSize:10,color:C.textMute}}>{open?"▲":"▼"}</span>
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
                      {e.stocks.map(s=>(
                        <span key={s} style={{fontSize:9,padding:"2px 8px",borderRadius:3,
                          background:C.blueBg,color:C.blue,fontWeight:500}}>{s}</span>
                      ))}
                    </div>

                    <div style={{fontSize:11,color:C.textSec,lineHeight:1.8,marginBottom:8}}>{e.detail}</div>

                    {/* 預測邏輯 */}
                    <div style={{background:C.subtle,borderRadius:7,padding:"9px 11px",marginBottom: e.actualNote?8:0}}>
                      <div style={{fontSize:9,color:predC(e.pred),fontWeight:600,marginBottom:3,letterSpacing:"0.05em"}}>
                        {predIcon(e.pred)} 預測{predLabel(e.pred)} — 邏輯
                      </div>
                      <div style={{fontSize:11,color:C.textSec,lineHeight:1.7}}>{e.predReason}</div>
                    </div>

                    {/* 實際結果（已發生） */}
                    {e.actualNote && (
                      <div style={{
                        background: isCorrect ? C.oliveBg+"88" : C.upBg+"88",
                        border:`1px solid ${isCorrect ? C.olive+"44":C.up+"44"}`,
                        borderRadius:7, padding:"9px 11px", marginTop:8,
                      }}>
                        <div style={{fontSize:9,color: isCorrect?C.olive:C.up,fontWeight:600,marginBottom:3,letterSpacing:"0.05em"}}>
                          {predIcon(e.actual)} 實際{predLabel(e.actual)} — {isCorrect?"預測正確":"預測有誤"}
                        </div>
                        <div style={{fontSize:11,color:C.textSec,lineHeight:1.7}}>{e.actualNote}</div>
                      </div>
                    )}

                    {/* 復盤教訓（若有） */}
                    {e.lessons && (
                      <div style={{background:C.blueBg,border:`1px solid ${C.blue}33`,
                        borderRadius:7,padding:"9px 11px",marginTop:8}}>
                        <div style={{fontSize:9,color:C.blue,fontWeight:600,marginBottom:3}}>策略覆盤教訓</div>
                        <div style={{fontSize:11,color:C.textSec,lineHeight:1.7}}>{e.lessons}</div>
                      </div>
                    )}

                    {/* 復盤按鈕（待觀察事件） */}
                    {e.status==="pending" && (
                      <button onClick={(ev)=>{ev.stopPropagation();setReviewingEvent(e.id);setReviewForm({actual:"up",actualNote:"",lessons:""})}}
                        style={{marginTop:10,width:"100%",padding:"9px",
                          background:C.olive+"22",border:`1px solid ${C.olive}55`,
                          borderRadius:8,color:C.olive,fontSize:11,fontWeight:500,cursor:"pointer"}}>
                        標記結果 · 撰寫復盤
                      </button>
                    )}

                    {/* 復盤表單 */}
                    {reviewingEvent===e.id && (
                      <div onClick={ev=>ev.stopPropagation()}
                        style={{marginTop:10,background:C.subtle,borderRadius:8,padding:12,
                          border:`1px solid ${C.blue}44`}}>
                        <div style={{fontSize:10,color:C.blue,fontWeight:600,marginBottom:10}}>撰寫完整復盤</div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:9,color:C.textMute,marginBottom:4}}>實際走勢</div>
                          <div style={{display:"flex",gap:6}}>
                            {["up","down","neutral"].map(v=>(
                              <button key={v} onClick={()=>setReviewForm(p=>({...p,actual:v}))}
                                style={{flex:1,padding:"6px",borderRadius:6,fontSize:10,fontWeight:500,cursor:"pointer",
                                  background:reviewForm.actual===v?(v==="up"?C.upBg:v==="down"?C.downBg:C.subtle):"transparent",
                                  color:reviewForm.actual===v?(v==="up"?C.up:v==="down"?C.down:C.textSec):C.textMute,
                                  border:`1px solid ${reviewForm.actual===v?(v==="up"?C.up+"55":v==="down"?C.down+"55":C.border):C.border}`}}>
                                {v==="up"?"↑ 漲":v==="down"?"↓ 跌":"— 中性"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:9,color:C.textMute,marginBottom:4}}>發生了什麼？股價怎麼走？</div>
                          <textarea value={reviewForm.actualNote} onChange={ev=>setReviewForm(p=>({...p,actualNote:ev.target.value}))}
                            placeholder="描述事件結果和股價反應..."
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:7,padding:8,color:C.text,fontSize:11,resize:"none",
                              minHeight:60,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                        </div>

                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:9,color:C.textMute,marginBottom:4}}>策略覆盤：問題出在哪？學到什麼？下次怎麼改？</div>
                          <textarea value={reviewForm.lessons} onChange={ev=>setReviewForm(p=>({...p,lessons:ev.target.value}))}
                            placeholder="進場理由回顧、策略偏差、改進方向..."
                            style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,
                              borderRadius:7,padding:8,color:C.text,fontSize:11,resize:"none",
                              minHeight:60,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                        </div>

                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setReviewingEvent(null)}
                            style={{flex:1,padding:"9px",background:"transparent",border:`1px solid ${C.border}`,
                              borderRadius:7,color:C.textMute,fontSize:11,cursor:"pointer"}}>取消</button>
                          <button onClick={()=>submitReview(e.id)}
                            disabled={!reviewForm.actualNote.trim()}
                            style={{flex:2,padding:"9px",borderRadius:7,border:"none",fontSize:11,fontWeight:500,cursor:"pointer",
                              background:reviewForm.actualNote.trim()?C.olive+"cc":C.subtle,
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
                  <div style={{fontSize:9,color:C.textMute,letterSpacing:"0.06em"}}>{l}</div>
                  <div style={{fontSize:18,fontWeight:600,color:c,marginTop:4}}>{v}</div>
                </div>
              ))}
            </div>

            {/* 新增事件按鈕 */}
            <button onClick={()=>setShowAddEvent(!showAddEvent)} style={{
              width:"100%",padding:"10px",marginBottom:10,borderRadius:8,
              background:showAddEvent?C.subtle:C.blue+"22",
              border:`1px solid ${showAddEvent?C.border:C.blue+"55"}`,
              color:showAddEvent?C.textMute:C.blue,fontSize:11,fontWeight:500,cursor:"pointer"}}>
              {showAddEvent?"取消":"＋ 新增事件（法說會、財報、營收、催化劑）"}
            </button>

            {showAddEvent && (
              <div style={{...card,marginBottom:12,borderLeft:`2px solid ${C.blue}88`}}>
                <div style={{...lbl,color:C.blue}}>新增事件</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
                  <div>
                    <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>日期</div>
                    <input value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))}
                      placeholder="如 2026/04/01"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>相關個股（逗號分隔）</div>
                    <input value={newEvent.stocks} onChange={e=>setNewEvent(p=>({...p,stocks:e.target.value}))}
                      placeholder="如 台燿 6274, 晶豪科 3006"
                      style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  </div>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>事件標題</div>
                  <input value={newEvent.title} onChange={e=>setNewEvent(p=>({...p,title:e.target.value}))}
                    placeholder="如：台燿 Q1 財報法說會"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>事件細節</div>
                  <textarea value={newEvent.detail} onChange={e=>setNewEvent(p=>({...p,detail:e.target.value}))}
                    placeholder="關鍵觀察重點..."
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:8,color:C.text,fontSize:11,resize:"none",
                      minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                </div>
                <div style={{marginBottom:7}}>
                  <div style={{fontSize:9,color:C.textMute,marginBottom:4}}>預測方向</div>
                  <div style={{display:"flex",gap:6}}>
                    {["up","down","neutral"].map(v=>(
                      <button key={v} onClick={()=>setNewEvent(p=>({...p,pred:v}))}
                        style={{flex:1,padding:"6px",borderRadius:6,fontSize:10,fontWeight:500,cursor:"pointer",
                          background:newEvent.pred===v?(v==="up"?C.upBg:v==="down"?C.downBg:C.subtle):"transparent",
                          color:newEvent.pred===v?(v==="up"?C.up:v==="down"?C.down:C.textSec):C.textMute,
                          border:`1px solid ${newEvent.pred===v?(v==="up"?C.up+"55":v==="down"?C.down+"55":C.border):C.border}`}}>
                        {v==="up"?"↑ 看漲":v==="down"?"↓ 看跌":"— 中性"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:9,color:C.textMute,marginBottom:3}}>預測邏輯</div>
                  <textarea value={newEvent.predReason} onChange={e=>setNewEvent(p=>({...p,predReason:e.target.value}))}
                    placeholder="為什麼這樣預測？依據是什麼？"
                    style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                      borderRadius:7,padding:8,color:C.text,fontSize:11,resize:"none",
                      minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
                </div>
                <button onClick={addEvent}
                  disabled={!newEvent.title.trim()||!newEvent.date.trim()}
                  style={{width:"100%",padding:"10px",borderRadius:8,border:"none",fontSize:12,
                    fontWeight:500,cursor:newEvent.title.trim()&&newEvent.date.trim()?"pointer":"not-allowed",
                    background:newEvent.title.trim()&&newEvent.date.trim()?C.blue+"cc":C.subtle,
                    color:newEvent.title.trim()&&newEvent.date.trim()?"#fff":C.textMute}}>
                  新增事件
                </button>
              </div>
            )}

            {/* 待觀察 */}
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              marginBottom:8,
            }}>
              <div style={{...lbl, marginBottom:0}}>待觀察 · {pending.length} 件</div>
              <span style={{fontSize:9,color:C.textMute}}>點擊展開詳情</span>
            </div>
            {pending.map((e,i)=><EventRow key={e.id} e={e} idx={i}/>)}

            {/* 已發生 */}
            <div style={{...lbl, marginBottom:8, marginTop:16}}>已發生 · 驗證 {hits+misses}/{past.length} 件</div>
            {past.map((e,i)=><EventRow key={e.id} e={e} idx={i}/>)}
          </>;
        })()}

      </div>
    </div>
  );
}
