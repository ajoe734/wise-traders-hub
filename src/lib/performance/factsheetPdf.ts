import jsPDF from 'jspdf';
import { embedPdfFonts, PDF_FONT, FONT_LICENSE } from './factsheetFonts';
import { type Factsheet, fmtOrNA } from './factsheet';

/**
 * 彥愷（及其他專家）績效 Factsheet — A4 portrait 向量 PDF。
 * 定位：線下大額資金第一輪 due diligence 摘要，不是社群戰績圖卡。
 * 憲法：
 *  - 只印 `buildFactsheet` 算出的真實資料；null 一律印「資料尚不足」。
 *  - 無 CTA、無招攬、無代操暗示、無績效保證字眼。
 *  - 黑白列印安全：漲跌不只靠顏色，另以 +/− 與框線區分。
 */

const C = {
  paper: '#FBF8F3',
  ink: '#23201C',
  sub: '#6B655D',
  rule: '#DCD5C9',
  accent: '#A33B2A',
  soft: '#EFE9DF',
};

const PAGE = { w: 210, h: 297, ml: 16, mr: 16, top: 18, bottom: 20 };
const CW = PAGE.w - PAGE.ml - PAGE.mr;

const nf = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n: number) => `${n < 0 ? '−' : ''}NT$${nf(Math.abs(Math.round(n)))}`;
const signedMoney = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}NT$${nf(Math.abs(Math.round(n)))}`;
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
const plainPct = (n: number) => `${n.toFixed(2)}%`;
const dt = (iso: string | null) => (iso ? iso.replace(/-/g, '/') : '—');

class Doc {
  d: jsPDF;
  page = 0;
  constructor() {
    this.d = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  }
  font(style: 'normal' | 'bold' = 'normal', size = 9, color = C.ink) {
    this.d.setFont(PDF_FONT, style);
    this.d.setFontSize(size);
    this.d.setTextColor(color);
  }
  text(s: string, x: number, y: number, opts?: { align?: 'left' | 'right' | 'center' }) {
    this.d.text(s, x, y, { align: opts?.align ?? 'left', baseline: 'alphabetic' });
  }
  rule(y: number, x1 = PAGE.ml, x2 = PAGE.w - PAGE.mr, color = C.rule, w = 0.2) {
    this.d.setDrawColor(color);
    this.d.setLineWidth(w);
    this.d.line(x1, y, x2, y);
  }
  box(x: number, y: number, w: number, h: number, fill?: string, stroke = C.rule) {
    if (fill) { this.d.setFillColor(fill); }
    this.d.setDrawColor(stroke);
    this.d.setLineWidth(0.2);
    this.d.rect(x, y, w, h, fill ? 'FD' : 'S');
  }
  /** 自動換行段落，回傳結束 y */
  para(s: string, x: number, y: number, w: number, size = 8.5, lh = 4.4, color = C.sub) {
    this.font('normal', size, color);
    const lines = this.d.splitTextToSize(s, w) as string[];
    lines.forEach((ln, i) => this.text(ln, x, y + i * lh));
    return y + lines.length * lh;
  }
}

function startPage(doc: Doc, title: string, sub: string, meta: string) {
  if (doc.page > 0) doc.d.addPage();
  doc.page += 1;
  doc.d.setFillColor(C.paper);
  doc.d.rect(0, 0, PAGE.w, PAGE.h, 'F');

  doc.font('bold', 8, C.accent);
  doc.text(meta, PAGE.ml, PAGE.top - 5);
  doc.font('bold', 15, C.ink);
  doc.text(title, PAGE.ml, PAGE.top + 4);
  doc.font('normal', 8.5, C.sub);
  doc.text(sub, PAGE.ml, PAGE.top + 9.5);
  doc.rule(PAGE.top + 13);
  return PAGE.top + 21;
}

function footer(doc: Doc, fs: Factsheet, total: number) {
  const y = PAGE.h - 14;
  doc.rule(y - 4);
  doc.font('normal', 6.8, C.sub);
  doc.text(
    `${fs.expert.name}（${fs.expert.slug}） · 資料截止 ${dt(fs.asOf)} · 本文件僅供受託審閱之機構／個人內部評估使用，不對外散布`,
    PAGE.ml, y,
  );
  doc.text(
    '本文件為歷史交易紀錄之整理，不構成投資建議、要約或收益保證；過往績效不代表未來報酬。',
    PAGE.ml, y + 3.4,
  );
  doc.font('bold', 7.2, C.ink);
  doc.text(`${doc.page} / ${total}`, PAGE.w - PAGE.mr, y, { align: 'right' });
}

/** KPI 區塊：大字數值 + 標籤 + 註記 */
function kpiRow(
  doc: Doc, y: number,
  items: { label: string; value: string; note?: string; emphasis?: boolean }[],
) {
  const gap = 4;
  const w = (CW - gap * (items.length - 1)) / items.length;
  const h = 24;
  items.forEach((it, i) => {
    const x = PAGE.ml + i * (w + gap);
    doc.box(x, y, w, h, it.emphasis ? C.soft : undefined);
    doc.font('normal', 7.2, C.sub);
    doc.text(it.label, x + 3.5, y + 6.5);
    const na = it.value === '資料尚不足';
    doc.font('bold', na ? 9 : 14, na ? C.sub : it.emphasis ? C.accent : C.ink);
    doc.text(it.value, x + 3.5, y + 15.5);
    if (it.note) {
      doc.font('normal', 6.6, C.sub);
      doc.text(it.note, x + 3.5, y + 20.5);
    }
  });
  return y + h + 7;
}

function sectionTitle(doc: Doc, y: number, s: string, hint?: string) {
  doc.font('bold', 10, C.ink);
  doc.text(s, PAGE.ml, y);
  if (hint) {
    doc.font('normal', 7, C.sub);
    doc.text(hint, PAGE.w - PAGE.mr, y, { align: 'right' });
  }
  doc.rule(y + 2.2);
  return y + 8;
}

function emptyNote(doc: Doc, y: number, h: number, msg: string) {
  doc.box(PAGE.ml, y, CW, h);
  doc.font('normal', 8.5, C.sub);
  doc.text(msg, PAGE.ml + CW / 2, y + h / 2 + 1, { align: 'center' });
  return y + h + 6;
}

/** 已實現淨值曲線（折線 + 基準線） */
function equityChart(doc: Doc, fs: Factsheet, y: number, h = 46) {
  const pts = fs.equity;
  const cap = fs.metrics.startingCapital;
  if (pts.length < 2 || cap == null) {
    return emptyNote(doc, y, h, '資料尚不足：已實現交易少於兩筆，無法繪製淨值曲線。');
  }
  const x0 = PAGE.ml + 20, x1 = PAGE.w - PAGE.mr;
  const yTop = y, yBot = y + h;
  const vals = pts.map((p) => p.equity).concat([cap]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1;
  const min = lo - pad, max = hi + pad;
  const sx = (i: number) => x0 + ((x1 - x0) * i) / (pts.length - 1);
  const sy = (v: number) => yBot - ((v - min) / (max - min)) * h;

  // grid + y labels
  doc.font('normal', 6.4, C.sub);
  for (let g = 0; g <= 3; g++) {
    const v = min + ((max - min) * g) / 3;
    const gy = sy(v);
    doc.rule(gy, x0, x1, C.soft, 0.15);
    doc.text(nf(Math.round(v / 1000)) + 'k', x0 - 2, gy + 1.2, { align: 'right' });
  }
  // baseline = starting capital
  doc.d.setDrawColor(C.sub);
  doc.d.setLineWidth(0.25);
  doc.d.setLineDashPattern([1.2, 1.2], 0);
  doc.d.line(x0, sy(cap), x1, sy(cap));
  doc.d.setLineDashPattern([], 0);
  doc.font('normal', 6.4, C.sub);
  doc.text('初始資金', x1, sy(cap) - 1.4, { align: 'right' });

  doc.d.setDrawColor(C.accent);
  doc.d.setLineWidth(0.7);
  for (let i = 1; i < pts.length; i++) {
    doc.d.line(sx(i - 1), sy(pts[i - 1].equity), sx(i), sy(pts[i].equity));
  }
  doc.d.setFillColor(C.accent);
  doc.d.circle(sx(pts.length - 1), sy(pts[pts.length - 1].equity), 0.9, 'F');

  doc.font('normal', 6.4, C.sub);
  doc.text(dt(pts[0].date), x0, yBot + 4);
  doc.text(dt(pts[pts.length - 1].date), x1, yBot + 4, { align: 'right' });
  doc.font('normal', 6.4, C.sub);
  doc.text('已實現淨值（新台幣）', x0, yTop - 1.6);
  return yBot + 9;
}

/** 回撤曲線（往下的區塊圖） */
function drawdownChart(doc: Doc, fs: Factsheet, y: number, h = 34) {
  const pts = fs.drawdown;
  if (pts.length < 2 || fs.metrics.startingCapital == null) {
    return emptyNote(doc, y, h, '資料尚不足：無法繪製回撤曲線。');
  }
  const x0 = PAGE.ml + 20, x1 = PAGE.w - PAGE.mr;
  const worst = Math.min(...pts.map((p) => p.ddPct), -0.01);
  const sx = (i: number) => x0 + ((x1 - x0) * i) / (pts.length - 1);
  const sy = (v: number) => y + (v / worst) * h;

  doc.rule(y, x0, x1, C.rule, 0.2);
  doc.font('normal', 6.4, C.sub);
  doc.text('0%', x0 - 2, y + 1.2, { align: 'right' });
  doc.text(plainPct(worst), x0 - 2, y + h + 1.2, { align: 'right' });

  doc.d.setDrawColor(C.ink);
  doc.d.setLineWidth(0.5);
  for (let i = 1; i < pts.length; i++) {
    doc.d.line(sx(i - 1), sy(pts[i - 1].ddPct), sx(i), sy(pts[i].ddPct));
  }
  doc.font('normal', 6.4, C.sub);
  doc.text('已實現淨值回撤（% of 初始資金）', x0, y - 1.6);
  return y + h + 8;
}

/** 月度表格 + 條狀 */
function monthlyTable(doc: Doc, fs: Factsheet, y: number) {
  if (fs.monthly.length === 0) return emptyNote(doc, y, 20, '資料尚不足：本期間無已實現交易月份。');
  const rowH = 7;
  const colM = PAGE.ml + 2;
  const colAmt = PAGE.ml + 46;
  const colPct = PAGE.ml + 74;
  const barX = PAGE.ml + 84;
  const barW = CW - 88;
  const maxAbs = Math.max(...fs.monthly.map((m) => Math.abs(m.amount)), 1);

  doc.font('bold', 7.2, C.sub);
  doc.text('月份', colM, y);
  doc.text('已實現損益', colAmt, y, { align: 'right' });
  doc.text('報酬率', colPct, y, { align: 'right' });
  doc.text('相對規模（左負 / 右正）', barX + barW / 2, y, { align: 'center' });
  doc.rule(y + 1.8);
  let ry = y + 1.8;
  fs.monthly.forEach((m, i) => {
    const cy = ry + rowH * (i + 1) - 2;
    doc.font('normal', 8, C.ink);
    doc.text(m.month, colM, cy);
    doc.font('bold', 8, m.amount < 0 ? C.sub : C.ink);
    doc.text(signedMoney(m.amount), colAmt, cy, { align: 'right' });
    doc.text(pct(m.pct), colPct, cy, { align: 'right' });
    const mid = barX + barW / 2;
    const w = (Math.abs(m.amount) / maxAbs) * (barW / 2 - 1);
    if (m.amount >= 0) {
      doc.d.setFillColor(C.accent);
      doc.d.rect(mid, cy - 3, w, 3.2, 'F');
    } else {
      doc.d.setFillColor(C.sub);
      doc.d.rect(mid - w, cy - 3, w, 3.2, 'F');
    }
    doc.rule(mid, mid, mid, C.rule);
    doc.d.setDrawColor(C.rule);
    doc.d.line(mid, cy - 4.2, mid, cy + 0.6);
    doc.rule(ry + rowH * (i + 1), PAGE.ml, PAGE.w - PAGE.mr, C.soft, 0.15);
  });
  return ry + rowH * fs.monthly.length + 7;
}

function contributorTable(
  doc: Doc, y: number, title: string, rows: { instrument: string; amount: number; pct: number | null; trades: number }[],
) {
  doc.font('bold', 8.4, C.ink);
  doc.text(title, PAGE.ml, y);
  doc.rule(y + 1.8);
  if (rows.length === 0) {
    doc.font('normal', 8, C.sub);
    doc.text('資料尚不足', PAGE.ml, y + 7.5);
    return y + 12;
  }
  const rowH = 6.4;
  rows.forEach((r, i) => {
    const cy = y + 1.8 + rowH * (i + 1) - 1.8;
    doc.font('normal', 8, C.ink);
    doc.text(r.instrument, PAGE.ml, cy);
    doc.font('normal', 7, C.sub);
    doc.text(`${r.trades} 筆`, PAGE.ml + 52, cy, { align: 'right' });
    doc.font('bold', 8, C.ink);
    doc.text(signedMoney(r.amount), PAGE.ml + 82, cy, { align: 'right' });
    doc.font('normal', 7.4, C.sub);
    doc.text(r.pct == null ? '—' : pct(r.pct), PAGE.ml + 98, cy, { align: 'right' });
  });
  return y + 1.8 + rowH * rows.length + 6;
}

function ledgerTable(doc: Doc, fs: Factsheet, y: number) {
  if (fs.ledger.length === 0) return emptyNote(doc, y, 18, '資料尚不足：本期間無已結案交易。');
  const cols = [
    { k: '標的', x: PAGE.ml, a: 'left' as const },
    { k: '進場', x: PAGE.ml + 62, a: 'right' as const },
    { k: '出場', x: PAGE.ml + 88, a: 'right' as const },
    { k: '持有天數', x: PAGE.ml + 110, a: 'right' as const },
    { k: '報酬率', x: PAGE.ml + 134, a: 'right' as const },
    { k: '損益金額', x: PAGE.w - PAGE.mr, a: 'right' as const },
  ];
  doc.font('bold', 7, C.sub);
  cols.forEach((c) => doc.text(c.k, c.x, y, { align: c.a }));
  doc.rule(y + 1.8);
  const rowH = 6.2;
  fs.ledger.forEach((r, i) => {
    const cy = y + 1.8 + rowH * (i + 1) - 1.9;
    doc.font('normal', 7.6, C.ink);
    doc.text(r.instrument, cols[0].x, cy);
    doc.font('normal', 7.2, C.sub);
    doc.text(dt(r.entryDate), cols[1].x, cy, { align: 'right' });
    doc.text(dt(r.exitDate), cols[2].x, cy, { align: 'right' });
    doc.text(r.holdDays == null ? '—' : `${r.holdDays}`, cols[3].x, cy, { align: 'right' });
    doc.font('bold', 7.6, C.ink);
    doc.text(r.pct == null ? '—' : pct(r.pct), cols[4].x, cy, { align: 'right' });
    doc.text(signedMoney(r.amount), cols[5].x, cy, { align: 'right' });
    doc.rule(y + 1.8 + rowH * (i + 1), PAGE.ml, PAGE.w - PAGE.mr, C.soft, 0.15);
  });
  return y + 1.8 + rowH * fs.ledger.length + 6;
}

const PROCESS = [
  { t: '1. 標的篩選', d: '以市場面（趨勢與資金流向）、心理面（市場情緒位置）、技術面（型態與量價）三層交叉篩選，先排除不利環境的標的，再進入觀察名單。' },
  { t: '2. 進場與部位', d: '在趨勢確立段建立部位，依既定資金上限控管單一標的曝險；系統於發佈時檢核可用資金，超出即拒絕發佈，避免事後美化部位。' },
  { t: '3. 持有與調整', d: '以波段為主軸持有，依市場情緒調整減碼或加碼；每筆調整皆留下時間戳與理由紀錄，可回溯。' },
  { t: '4. 出場與複盤', d: '達成目標或訊號轉弱即出場，記錄成本、出場價與檢討要點；每週彙整為週記，形成可重複的操作紀律。' },
];

export interface ExportFactsheetOptions {
  fs: Factsheet;
  /** 檔名（不含副檔名）；預設 legendflow-{slug}-factsheet-{asOf} */
  filename?: string;
  /** 產生但不下載（測試用），回傳 blob */
  returnBlob?: boolean;
}

export async function exportFactsheetPdf(opts: ExportFactsheetOptions): Promise<Blob> {
  const { fs } = opts;
  const doc = new Doc();
  await embedPdfFonts(doc.d);
  const m = fs.metrics;
  const meta = `績效摘要 · ${fs.rangeLabel} · 資料截止 ${dt(fs.asOf)}`;
  const TOTAL = 4;

  // ─────────── P1 Performance Snapshot ───────────
  let y = startPage(doc, `${fs.expert.name} 操作績效摘要`, `legendflow 平台實際發佈紀錄 · ${fs.expert.role === 'mentor' ? '導師' : '分析師'} · 台股 · 新台幣計價`, meta);

  y = kpiRow(doc, y, [
    {
      label: `總報酬率（${fs.rangeLabel}）`,
      value: fmtOrNA(m.totalReturnPct, pct),
      note: '已實現＋未實現 ÷ 初始資金',
      emphasis: true,
    },
    { label: '最大回撤', value: fmtOrNA(m.maxDrawdownPct, (v) => `−${v.toFixed(2)}%`), note: '已實現淨值序列' },
    { label: '期末總資產', value: fmtOrNA(m.currentAsset, money), note: `初始 ${fmtOrNA(m.startingCapital, money)}` },
  ]);

  y = kpiRow(doc, y, [
    { label: '已實現損益', value: signedMoney(m.realizedAmount), note: `${m.closedTrades} 筆已結案` },
    { label: '未實現損益', value: fmtOrNA(m.unrealizedAmount, signedMoney), note: `${m.openTrades} 檔在倉` },
    { label: '勝率', value: fmtOrNA(m.winRate, plainPct), note: '以單筆報酬率 > 0 計' },
    { label: '獲利因子', value: fmtOrNA(m.profitFactor, (v) => v.toFixed(2)), note: '總獲利 ÷ 總虧損' },
  ]);

  y = sectionTitle(doc, y, '已實現淨值曲線', `期間 ${dt(fs.periodStart)} – ${dt(fs.periodEnd)}`);
  y = equityChart(doc, fs, y);

  y = sectionTitle(doc, y, '報告口徑');
  y = doc.para(
    `本摘要之所有數字皆取自 legendflow 平台資料庫中${fs.expert.name}實際發佈之交易紀錄，含 ${m.closedTrades} 筆已結案與 ${m.openTrades} 檔在倉部位。`
    + `單筆損益以「數量 × (出場價 − 進場價)」計算，報酬率分母為初始資金 ${fmtOrNA(m.startingCapital, money)}；`
    + '未實現部位以平台最新收盤報價評價。所有指標與平台前台公開績效同源，不另行調整。',
    PAGE.ml, y, CW,
  ) + 3;
  doc.font('bold', 8, C.ink);
  doc.text('本報告未涵蓋之項目', PAGE.ml, y + 1);
  y += 5;
  fs.missing.forEach((s) => {
    doc.font('normal', 7.6, C.sub);
    doc.text('·', PAGE.ml, y);
    y = doc.para(s, PAGE.ml + 3, y, CW - 3, 7.6, 4) + 1.2;
  });
  footer(doc, fs, TOTAL);

  // ─────────── P2 Return & Risk Quality ───────────
  y = startPage(doc, '報酬結構與風險品質', '月度分佈、回撤路徑與單筆損益分佈', meta);
  y = sectionTitle(doc, y, '月度已實現損益', `正報酬月份 ${m.positiveMonths} / ${m.totalMonths}`);
  y = monthlyTable(doc, fs, y);

  y = sectionTitle(doc, y, '回撤路徑', '以初始資金為分母');
  y = drawdownChart(doc, fs, y);

  y = sectionTitle(doc, y, '單筆損益品質');
  y = kpiRow(doc, y, [
    { label: '平均單筆報酬率', value: fmtOrNA(m.avgPnlPct, pct) },
    { label: '平均獲利／平均虧損', value: fmtOrNA(m.payoffRatio, (v) => `${v.toFixed(2)} : 1`) },
    { label: '平均持有天數', value: fmtOrNA(m.avgHoldDays, (v) => `${v.toFixed(1)} 天`), note: '含在倉部位' },
  ]);
  y = kpiRow(doc, y, [
    { label: '獲利單平均報酬率', value: fmtOrNA(m.avgWinPct, pct) },
    { label: '虧損單平均報酬率', value: fmtOrNA(m.avgLossPct, pct) },
    { label: '最佳月份', value: m.bestMonth ? pct(m.bestMonth.pct) : '資料尚不足', note: m.bestMonth?.month },
    { label: '最差月份', value: m.worstMonth ? pct(m.worstMonth.pct) : '資料尚不足', note: m.worstMonth?.month },
  ]);
  doc.para(
    '風險說明：本頁回撤以「已實現損益」序列計算，未含在倉部位的盤中評價波動，實際盤中回撤可能大於本表數字。'
    + '樣本期間較短時，勝率、獲利因子與月度分佈的統計意義有限，宜與交易明細併同檢視。',
    PAGE.ml, y, CW,
  );
  footer(doc, fs, TOTAL);

  // ─────────── P3 Attribution & Trade Evidence ───────────
  y = startPage(doc, '損益歸因與交易佐證', '個股貢獻排序與近期已結案交易明細', meta);
  y = sectionTitle(doc, y, '個股歸因', '依已實現損益金額排序');
  const halfY = y;
  y = contributorTable(doc, y, '主要正貢獻（前 5）', fs.contributors);
  const leftEnd = y;
  y = contributorTable(doc, leftEnd, '主要負貢獻（前 5）', fs.detractors);

  y = sectionTitle(doc, y, '近期已結案交易', `最多列示 12 筆，共 ${m.closedTrades} 筆`);
  y = ledgerTable(doc, fs, y);
  doc.para(
    '交易明細直接取自平台發佈紀錄，進出場時間為當時發佈時戳，未經事後編修；完整交易清單可依審閱需求另行提供。'
    + '損益金額為未扣除手續費、證交稅與滑價之毛數。',
    PAGE.ml, y, CW,
  );
  void halfY;
  footer(doc, fs, TOTAL);

  // ─────────── P4 Process & Methodology ───────────
  y = startPage(doc, '操作流程與方法論', '可重複的決策流程、資料口徑與法遵聲明', meta);
  y = sectionTitle(doc, y, '決策流程');
  PROCESS.forEach((p) => {
    doc.font('bold', 8.6, C.ink);
    doc.text(p.t, PAGE.ml, y);
    y = doc.para(p.d, PAGE.ml, y + 4.6, CW) + 4.5;
  });

  y = sectionTitle(doc, y, '策略陳述');
  y = doc.para(fs.expert.strategy_summary || '資料尚不足', PAGE.ml, y, CW, 8.5, 4.6, C.ink) + 3;
  if (fs.expert.style_tags?.length) {
    y = doc.para(`風格標籤：${fs.expert.style_tags.join('、')}`, PAGE.ml, y, CW) + 3;
  }
  if (fs.expert.markets?.length) {
    y = doc.para(`涵蓋市場：${fs.expert.markets.join('、')}（本報告僅計台股新台幣部位）`, PAGE.ml, y, CW) + 3;
  }

  y = sectionTitle(doc, y, '資料來源與計算口徑');
  y = doc.para(
    '資料來源：legendflow 平台交易紀錄資料庫（trade_records）與平台報價服務。指標計算與平台前台公開績效使用同一組公式，'
    + '不另行調整、不剔除單筆極端值、不重編歷史紀錄。所有時間以台北時間（UTC+8）表示。',
    PAGE.ml, y, CW,
  ) + 5;

  y = sectionTitle(doc, y, '重要聲明');
  const disclaimers = [
    '本文件由平台依歷史紀錄自動彙整，僅供受託審閱者內部評估使用，未經同意不得重製、轉載或對外散布。',
    '本文件不構成任何投資建議、要約、招攬、代客操作或收益保證，亦非依證券投資顧問業務所為之推介。',
    '過往績效不代表未來報酬；投資涉及風險，可能損及本金，閱讀者應自行評估並承擔投資決策後果。',
    '本文件所列損益為毛數，未扣除手續費、證券交易稅、滑價與任何服務費用。',
  ];
  disclaimers.forEach((s) => {
    doc.font('normal', 7.6, C.sub);
    doc.text('·', PAGE.ml, y);
    y = doc.para(s, PAGE.ml + 3, y, CW - 3, 7.6, 4.1) + 1.5;
  });
  doc.box(PAGE.ml, y + 2, CW, 14, C.soft);
  doc.font('normal', 6.8, C.sub);
  doc.text('簽核／備註欄（供審閱方填寫）', PAGE.ml + 3, y + 6.5);
  doc.font('normal', 6.4, C.sub);
  doc.text(`字型：${FONT_LICENSE}`, PAGE.w - PAGE.mr, y + 20, { align: 'right' });
  footer(doc, fs, TOTAL);

  const blob = doc.d.output('blob') as Blob;
  if (!opts.returnBlob) {
    const name = `${opts.filename ?? `legendflow-${fs.expert.slug}-factsheet-${fs.asOf.replace(/-/g, '')}`}.pdf`;
    doc.d.save(name);
  }
  return blob;
}
