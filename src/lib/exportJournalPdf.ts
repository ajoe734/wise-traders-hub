import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { format } from 'date-fns';
import { richHtmlToPlain } from '@/components/SafeRichHtml';
import { sanitizeAssetQuantityUnit, resolveAssetClass } from '@/lib/asset';

interface Signal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  /** 產業分類（用於「本週產業分佈」頁；未提供則歸為「未分類」） */
  sector?: string | null;
  /** 標的資產類別；缺值時由 experts.asset_class / currency 推導 */
  asset_class?: string | null;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    asset_class?: string | null;
    currency?: string | null;
  };
}

/**
 * 單一資料源：以資產類別決定 quantity_unit。
 * 憲法：us_stock → 股、us_future → 口、crypto → 顆、tw_stock → 張。
 * 上游 quantity_unit 為 null 或與 asset_class 不相容時，一律以 asset_class 覆寫，
 * 徹底杜絕 us_stock/us_future 匯出寫成「張」的回歸。
 */
export function resolvePdfQuantityUnit(s: Signal): string {
  const cls = s.asset_class ?? resolveAssetClass(s.experts);
  return sanitizeAssetQuantityUnit(s.quantity_unit, cls);
}

interface ExportArgs {
  headSignal: Signal;
  weekSignals: Signal[];
  weekStart: Date;
  weekEnd: Date;
  weekTitle: string;
  learningPoints: string[];
  avatarSrc: string;
}

// 色票對齊 legendflow 品牌與 ActionBadge 螢幕呈現：
//   brand 橘點 #EC662D、ink #292520、paper #F5F3EF
//   台股慣例：紅 = 上漲/買、綠 = 下跌/賣
const COLORS = {
  ink: '#292520',
  paper: '#F5F3EF',
  brand: '#EC662D',
  gray: '#8A857C',
  line: '#E4DFD6',
};

// PDF 專用色票（hex，用於 html2canvas 匯出）— label 一律走 @/lib/signalAction 單一真源
// 若 SIGNAL_ACTION_META 新增 action，這裡未定義色 → 用中性灰底，label 仍會顯示原文。
import { getActionMeta as _getActionMeta } from '@/lib/signalAction';
const PDF_ACTION_COLOR: Record<string, { bg: string; fg: string }> = {
  buy:      { bg: '#D94848', fg: '#FFFFFF' },
  sell:     { bg: '#2E8B57', fg: '#FFFFFF' },
  add:      { bg: '#3B82F6', fg: '#FFFFFF' },
  trim:     { bg: '#F59E0B', fg: '#FFFFFF' },
  exit:     { bg: '#64748B', fg: '#FFFFFF' },
  hold:     { bg: '#8A857C', fg: '#FFFFFF' },
  teaching: { bg: '#3B82F6', fg: '#FFFFFF' },
};
export const actionMeta = (action: string) => {
  const raw = (action || '').trim();
  const key = raw.toLowerCase();
  const label = _getActionMeta(key || null).label;
  const color = PDF_ACTION_COLOR[key] ?? { bg: COLORS.gray, fg: '#FFFFFF' };
  return { label, bg: color.bg, fg: color.fg };
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 自架 woff2 字型 — 與 App 前台一致，避免 Google Fonts 未載入導致 PDF 版面漂移
let fontsPromise: Promise<unknown> | null = null;

// PDF 內實際會用到的 (family, weight, style, sample) 組合。
// 缺任何一組就代表 html2canvas 會 fallback（Georgia / PingFang / system-ui）。
export type FontSpec = { family: string; weight: number; style?: 'normal' | 'italic'; sample: string };
export const REQUIRED_FONTS: readonly FontSpec[] = [
  // Source Serif 4：cover 標題 / 章節 h2 / 品牌 wordmark / 引言（斜體）
  { family: 'Source Serif 4', weight: 700, sample: 'legendflow' },
  { family: 'Source Serif 4', weight: 600, sample: 'legendflow' },
  { family: 'Source Serif 4', weight: 400, sample: 'legendflow' },
  { family: 'Source Serif 4', weight: 400, style: 'italic', sample: 'Aa' },
  // Noto Serif TC：個股名稱 22px/700（中文標題）
  { family: 'Noto Serif TC', weight: 700, sample: '週記回顧本' },
  // Noto Sans TC：本文段落、章節標籤、footer
  { family: 'Noto Sans TC', weight: 400, sample: '本週操作回顧摘要' },
  { family: 'Noto Sans TC', weight: 500, sample: '本週操作回顧摘要' },
  { family: 'Noto Sans TC', weight: 700, sample: '本週操作回顧摘要' },
];

export const fontSpec = (f: FontSpec) =>
  `${f.style === 'italic' ? 'italic ' : ''}${f.weight} 16px "${f.family}"`;

/**
 * 用 document.fonts.check() 掃描 REQUIRED_FONTS，若還沒 ready 就 polling。
 * 回傳仍缺席的 spec 陣列（正常情況下應為空）。
 */
export const auditFonts = (): FontSpec[] => {
  if (typeof document === 'undefined' || !document.fonts?.check) return [];
  return REQUIRED_FONTS.filter((f) => {
    try {
      return !document.fonts.check(fontSpec(f), f.sample);
    } catch {
      return false; // check() 拋錯就當它已 ready，避免無窮 loop
    }
  });
};

export const ensureJournalPdfFonts = async (): Promise<{ ok: boolean; missing: FontSpec[] }> => {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      import('@fontsource/source-serif-4/400.css'),
      import('@fontsource/source-serif-4/400-italic.css'),
      import('@fontsource/source-serif-4/600.css'),
      import('@fontsource/source-serif-4/700.css'),
      import('@fontsource/noto-sans-tc/chinese-traditional-400.css'),
      import('@fontsource/noto-sans-tc/chinese-traditional-500.css'),
      import('@fontsource/noto-sans-tc/chinese-traditional-700.css'),
      import('@fontsource/noto-serif-tc/chinese-traditional-700.css'),
    ]).catch(() => []);
  }
  await fontsPromise;

  // Step 1: 對每一組 (spec, sample) 明確 load，強制 UA 抓 woff2 進 FontFaceSet
  try {
    await Promise.all(REQUIRED_FONTS.map((f) => document.fonts.load(fontSpec(f), f.sample)));
  } catch {}
  // Step 2: 等 fonts.ready（clears pending loads）
  try {
    await document.fonts.ready;
  } catch {}

  // Step 3: polling 校驗 —— 有些 UA 在 unicode-range 拆分的字型上，load() resolve 後
  //         first-paint 仍會 miss 1-2 frame，這裡最多輪詢 ~2s。
  let missing = auditFonts();
  const deadline = Date.now() + 2000;
  while (missing.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 80));
    try { await document.fonts.ready; } catch {}
    missing = auditFonts();
  }

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[exportJournalPdf] font preflight incomplete, fallback risk:',
      missing.map((f) => `${f.family}/${f.weight}${f.style === 'italic' ? '/italic' : ''}`));
  }
  return { ok: missing.length === 0, missing };
};
const ensureFonts = ensureJournalPdfFonts;

/**
 * 針對「即將截圖的 pageEl」做最後一次守門：
 *   1. 等一個 rAF 讓 layout / 換行落定
 *   2. 若 element 內有中文字，額外對該字元 load 一次 Noto Serif/Sans TC
 *      —— 覆蓋 fontsource 用 unicode-range 拆分 subset 時的殘留 miss
 *   3. 對 REQUIRED_FONTS 再跑一次 auditFonts()，仍缺就 polling 至 ready 或超時
 */
const waitForPageFontsReady = async (pageEl: HTMLElement, timeoutMs = 1500) => {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const text = pageEl.textContent || '';
  const cjkSample = (text.match(/[\u3400-\u9fff]/g) || []).slice(0, 60).join('') || '週';
  try {
    await Promise.all([
      document.fonts.load(`700 22px "Noto Serif TC"`, cjkSample),
      document.fonts.load(`400 12px "Noto Sans TC"`, cjkSample),
      document.fonts.load(`500 13px "Noto Sans TC"`, cjkSample),
      document.fonts.load(`700 13px "Noto Sans TC"`, cjkSample),
    ]);
    await document.fonts.ready;
  } catch {}
  const deadline = Date.now() + timeoutMs;
  while (auditFonts().length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
    try { await document.fonts.ready; } catch {}
  }
};


const toDataUrl = async (src: string): Promise<string | null> => {
  try {
    const res = await fetch(src, { mode: 'cors' });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const pageShellCss = `
  box-sizing: border-box;
  width: 794px;         /* 210mm @ 96dpi */
  height: 1123px;       /* 297mm @ 96dpi */
  padding: 68px;        /* ~18mm */
  background: ${COLORS.paper};
  color: ${COLORS.ink};
  font-family: 'Noto Sans TC', 'PingFang TC', system-ui, sans-serif;
  position: relative;
  overflow: hidden;
`;

const serif = `'Source Serif 4','Noto Serif TC',Georgia,'Songti TC',serif`;

const watermarkHtml = `
  <div aria-hidden="true" style="position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:0;">
    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-28deg); font-family:${serif}; font-size:120px; font-weight:700; letter-spacing:0.04em; color:${COLORS.ink}; opacity:0.055; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
    <div style="position:absolute; top:18%; left:-6%; transform:rotate(-28deg); font-family:${serif}; font-size:60px; font-weight:600; color:${COLORS.ink}; opacity:0.04; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span> &nbsp; legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
    <div style="position:absolute; bottom:14%; right:-8%; transform:rotate(-28deg); font-family:${serif}; font-size:60px; font-weight:600; color:${COLORS.ink}; opacity:0.04; white-space:nowrap;">
      legendflow<span style="color:${COLORS.brand}">·</span> &nbsp; legendflow<span style="color:${COLORS.brand}">·</span>
    </div>
  </div>
`;

const buildCoverHtml = (a: ExportArgs, avatarDataUrl: string | null) => {
  const weekNum = (() => {
    const d = new Date(a.weekStart);
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d.getTime() - oneJan.getTime()) / 86400000);
    return Math.ceil((days + oneJan.getDay() + 1) / 7);
  })();
  const roleLabel = a.headSignal.experts.role === 'mentor' ? '實戰導師' : '分析師';
  return `
    <div style="${pageShellCss}">
      ${watermarkHtml}
      <div style="font-family:${serif}; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; position:relative; z-index:1;">
        legendflow<span style="color:${COLORS.brand}">·</span>
      </div>

      <div style="margin-top: 140px;">
        <div style="font-size: 11px; letter-spacing: 0.28em; color:${COLORS.gray}; font-weight: 500;">
          WEEK ${String(weekNum).padStart(2, '0')}
        </div>
        <div style="margin-top: 6px; font-size: 12px; letter-spacing: 0.18em; color:${COLORS.gray};">
          ${format(a.weekStart, 'MM / dd')} &mdash; ${format(a.weekEnd, 'MM / dd')}
        </div>

        <h1 style="font-family:${serif}; font-weight: 700; font-size: 80px; line-height: 1.05; margin: 44px 0 0; letter-spacing: -0.01em;">
          本週操作<br/>回顧與覆盤
        </h1>

        <div style="margin-top: 44px; width: 120px; height: 1px; background: ${COLORS.ink};"></div>

        <div style="margin-top: 32px; font-family:${serif}; font-style: italic; font-size: 22px; line-height: 1.55; color:${COLORS.ink}; max-width: 560px;">
          &ldquo;${escapeHtml(a.weekTitle)}&rdquo;
        </div>
      </div>

      <div style="position: absolute; right: 68px; bottom: 68px; display: flex; align-items: center; gap: 14px;">
        <div style="text-align: right;">
          <div style="font-size: 15px; font-weight: 700;">${escapeHtml(a.headSignal.experts.name)}</div>
          <div style="font-size: 11px; color:${COLORS.gray}; margin-top: 2px;">${roleLabel}</div>
        </div>
        ${
          avatarDataUrl
            ? `<img src="${avatarDataUrl}" style="width: 84px; height: 84px; border-radius: 50%; object-fit: cover; object-position: center 15%;" crossorigin="anonymous" />`
            : `<div style="width: 84px; height: 84px; border-radius: 50%; background: ${COLORS.line};"></div>`
        }
      </div>

      <div style="position: absolute; left: 68px; bottom: 68px; font-size: 10px; color:${COLORS.gray}; letter-spacing: 0.15em;">
        ISSUE · ${format(a.weekStart, 'yyyy.MM.dd')}
      </div>
    </div>
  `;
};

const pageHeader = (title: string, weekNum: number) => `
  <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 10px; border-bottom: 1px solid ${COLORS.line}; font-size: 10px; color:${COLORS.gray}; letter-spacing: 0.1em;">
    <span>${escapeHtml(title)}</span>
    <span>WEEK ${String(weekNum).padStart(2, '0')} · legendflow<span style="color:${COLORS.brand}">·</span></span>
  </div>
`;

const pageFooter = (pageIdx: number, total: number) => `
  <div style="position:absolute; left:0; right:0; bottom: 34px; text-align:center; font-size: 10px; color:${COLORS.gray};">
    <span style="color:${COLORS.brand}">•</span> &nbsp;${pageIdx} / ${total}&nbsp; <span style="color:${COLORS.brand}">•</span>
  </div>
`;

const sectionTitle = (t: string) => `
  <h2 style="font-family:${serif}; font-size: 26px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em;">${escapeHtml(t)}</h2>
  <div style="width: 40px; height: 2px; background: ${COLORS.brand}; margin-bottom: 18px;"></div>
`;

const signalBlockHtml = (s: Signal) => {
  const meta = actionMeta(s.action);
  // 單一資料源：由 asset_class 決定單位，避免 us_stock/us_future 匯出成「張」。
  const unit = resolvePdfQuantityUnit(s);
  const priceQty = [
    s.price_hint != null ? `價 ${s.price_hint}` : null,
    s.quantity != null ? `${s.quantity} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const detailBlock = (title: string, body: string | null, tone: 'ink' | 'warn' = 'ink') => {
    const text = richHtmlToPlain(body);
    if (!text) return '';
    return `
      <div style="margin-bottom: 10px;">
        <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: ${
          tone === 'warn' ? '#B45309' : COLORS.gray
        }; margin-bottom: 4px;">${escapeHtml(title)}</div>
        <div style="font-size: 12px; line-height: 1.7; color: ${COLORS.ink}; white-space: pre-wrap;">${escapeHtml(text)}</div>
      </div>
    `;
  };

  return `
    <div style="display:flex; gap: 24px; padding: 16px 0; border-bottom: 1px solid ${COLORS.line};">
      <div style="width: 150px; flex-shrink: 0;">
        <div style="display:inline-block; padding: 3px 10px; background: ${meta.bg}; color: ${meta.fg}; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;">${meta.label}</div>
        <div style="font-family:${serif}; font-size: 22px; font-weight: 700; margin-top: 10px; line-height: 1.15;">${escapeHtml(s.instrument)}</div>
        <div style="font-size: 10px; color:${COLORS.gray}; margin-top: 6px; letter-spacing: 0.05em;">${format(new Date(s.published_at), 'yyyy / MM / dd')}</div>
        ${priceQty ? `<div style="font-size: 11px; color:${COLORS.ink}; margin-top: 8px; font-weight: 500;">${escapeHtml(priceQty)}</div>` : ''}
      </div>
      <div style="flex: 1; min-width: 0;">
        ${detailBlock('為什麼這樣操作', s.reason_summary)}
        ${detailBlock('部位控管想法', s.reason_detail)}
        ${detailBlock('風險提醒', s.risk_notes, 'warn')}
      </div>
    </div>
  `;
};

/**
 * 本週成交明細 — 一頁 tabular 匯總，欄位：日期 / 動作 / 標的 / 價格 / 數量。
 * 與螢幕 ActionBadge 使用同一份 actionMeta 色票，避免匯出漂移。
 */
const buildTradeDetailBodyHtml = (signals: Signal[]): string => {
  if (!signals.length) {
    return `${sectionTitle('本週成交明細')}<div style="color:${COLORS.gray}; font-size:12px;">本週無成交紀錄。</div>`;
  }
  const th = (t: string, w?: string) =>
    `<th style="text-align:left; font-weight:700; font-size:10px; letter-spacing:0.1em; color:${COLORS.gray}; padding:10px 8px; border-bottom:1px solid ${COLORS.ink};${w ? ` width:${w};` : ''}">${escapeHtml(t)}</th>`;
  const rows = signals
    .map((s) => {
      const meta = actionMeta(s.action);
      const price = s.price_hint != null ? String(s.price_hint) : '—';
      const qty =
        s.quantity != null
          ? `${s.quantity} ${resolvePdfQuantityUnit(s)}`
          : '—';
      return `
        <tr>
          <td style="padding:12px 8px; border-bottom:1px solid ${COLORS.line}; font-size:11px; color:${COLORS.gray}; letter-spacing:0.05em; white-space:nowrap;">${format(new Date(s.published_at), 'yyyy / MM / dd')}</td>
          <td style="padding:12px 8px; border-bottom:1px solid ${COLORS.line};">
            <span style="display:inline-block; padding:3px 10px; background:${meta.bg}; color:${meta.fg}; font-size:11px; font-weight:700; letter-spacing:0.1em;">${escapeHtml(meta.label)}</span>
          </td>
          <td style="padding:12px 8px; border-bottom:1px solid ${COLORS.line}; font-family:${serif}; font-size:15px; font-weight:700; color:${COLORS.ink};">${escapeHtml(s.instrument)}</td>
          <td style="padding:12px 8px; border-bottom:1px solid ${COLORS.line}; font-size:12px; color:${COLORS.ink}; font-variant-numeric:tabular-nums; text-align:right;">${escapeHtml(price)}</td>
          <td style="padding:12px 8px; border-bottom:1px solid ${COLORS.line}; font-size:12px; color:${COLORS.ink}; font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap;">${escapeHtml(qty)}</td>
        </tr>
      `;
    })
    .join('');
  return `
    ${sectionTitle('本週成交明細')}
    <table data-pdf-trade-detail style="width:100%; border-collapse:collapse; table-layout:auto;">
      <thead>
        <tr>
          ${th('日期', '110px')}
          ${th('動作', '78px')}
          ${th('標的')}
          ${th('價格', '80px')}
          ${th('數量', '90px')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:14px; font-size:10px; color:${COLORS.gray}; letter-spacing:0.05em;">共 ${signals.length} 筆 · 動作色票與螢幕 ActionBadge 一致</div>
  `;
};

/**
 * 本週產業分佈 — 依 Signal.sector 分組計數，橫向 bar 呈現。
 * bar 顏色一律 brand 橘，避免與 action 色混淆。
 */
const buildSectorDistributionBodyHtml = (signals: Signal[]): string => {
  if (!signals.length) {
    return `${sectionTitle('本週產業分佈')}<div style="color:${COLORS.gray}; font-size:12px;">本週無成交紀錄。</div>`;
  }
  const counts = new Map<string, number>();
  for (const s of signals) {
    const key = (s.sector || '').trim() || '未分類';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = signals.length;
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const max = entries[0][1];
  const rows = entries
    .map(([sector, count]) => {
      const pct = Math.round((count / total) * 100);
      const barW = Math.round((count / max) * 100);
      return `
        <div style="display:flex; align-items:center; gap:16px; padding:14px 0; border-bottom:1px solid ${COLORS.line};">
          <div style="width:140px; flex-shrink:0; font-family:${serif}; font-size:14px; font-weight:700; color:${COLORS.ink};">${escapeHtml(sector)}</div>
          <div style="flex:1; min-width:0;">
            <div style="height:10px; background:${COLORS.line}; position:relative;">
              <div style="position:absolute; left:0; top:0; bottom:0; width:${barW}%; background:${COLORS.brand};"></div>
            </div>
          </div>
          <div style="width:64px; text-align:right; font-size:12px; color:${COLORS.ink}; font-variant-numeric:tabular-nums; font-weight:500;">${count} 筆</div>
          <div style="width:56px; text-align:right; font-size:12px; color:${COLORS.gray}; font-variant-numeric:tabular-nums;">${pct}%</div>
        </div>
      `;
    })
    .join('');
  return `
    ${sectionTitle('本週產業分佈')}
    <div data-pdf-sector-distribution>${rows}</div>
    <div style="margin-top:18px; font-size:10px; color:${COLORS.gray}; letter-spacing:0.05em;">依 Signal.sector 分組 · 共 ${entries.length} 類 / ${total} 筆</div>
  `;
};



const buildPage = (headerTitle: string, weekNum: number, bodyHtml: string) => `
  <div style="${pageShellCss}">
    ${watermarkHtml}
    <div style="position:relative; z-index:1;">
      ${pageHeader(headerTitle, weekNum)}
    </div>
    <div style="padding-top: 26px; height: calc(100% - 100px); overflow: hidden; position:relative; z-index:1;">
      ${bodyHtml}
    </div>
  </div>
`;

const measureAndSplit = async (
  container: HTMLElement,
  headerTitle: string,
  weekNum: number,
  blocks: string[],
  maxBodyHeightPx: number,
): Promise<string[]> => {
  // Try to greedily fit blocks per page by rendering into a hidden probe.
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute; visibility:hidden; left:-99999px; top:0; width:${794 - 136}px;`;
  container.appendChild(probe);

  const pages: string[] = [];
  let current: string[] = [];
  for (const block of blocks) {
    probe.innerHTML = current.concat(block).join('');
    if (probe.getBoundingClientRect().height > maxBodyHeightPx && current.length > 0) {
      pages.push(current.join(''));
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length) pages.push(current.join(''));
  container.removeChild(probe);
  return pages;
};

/**
 * 建構所有 PDF 頁面的 HTML 陣列（含頁碼/頁尾/免責聲明），
 * 但不觸發截圖或下載。用於視覺回歸測試 harness 直接把 HTML 掛到頁面上比對。
 *
 * @param root 用來暫存 measure probe 的 DOM 容器；呼叫端負責掛到 document 上
 */
export const renderJournalPageHtmls = async (
  args: ExportArgs,
  root: HTMLElement,
): Promise<string[]> => {
  const avatarDataUrl = args.avatarSrc ? await toDataUrl(args.avatarSrc) : null;

  const weekNum = (() => {
    const d = new Date(args.weekStart);
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d.getTime() - oneJan.getTime()) / 86400000);
    return Math.ceil((days + oneJan.getDay() + 1) / 7);
  })();

  const pageHtmls: string[] = [];
  pageHtmls.push(buildCoverHtml(args, avatarDataUrl));

  const summaryPlain = richHtmlToPlain(args.headSignal.reason_detail);
  const summaryBlock = summaryPlain
    ? `
      <div style="margin-bottom: 32px;">
        ${sectionTitle('本週整體摘要')}
        <div style="column-count: 2; column-gap: 32px; font-size: 12px; line-height: 1.85; color:${COLORS.ink}; white-space: pre-wrap;">${escapeHtml(summaryPlain)}</div>
      </div>
    `
    : '';

  const signalsIntro = `${sectionTitle('本週操作')}`;
  const signalBlocks = args.weekSignals.map((s) => signalBlockHtml(s));
  const maxBody = 1123 - 68 * 2 - 40 - 26 - 20;

  if (signalBlocks.length === 0) {
    pageHtmls.push(buildPage('本週操作回顧', weekNum, summaryBlock || '<div style="color:#8A857C">本週無交易紀錄。</div>'));
  } else {
    const firstBlocks = [summaryBlock, signalsIntro, ...signalBlocks].filter(Boolean);
    const chunked = await measureAndSplit(root, '本週操作回顧', weekNum, firstBlocks, maxBody);
    for (const html of chunked) pageHtmls.push(buildPage('本週操作回顧', weekNum, html));
  }

  // 成交明細 + 產業分佈 —— 只在有 signals 時輸出，各佔一頁；
  // 這兩頁與螢幕呈現對齊，交由 harness 做視覺回歸守門
  if (args.weekSignals.length) {
    pageHtmls.push(
      buildPage('本週成交明細', weekNum, buildTradeDetailBodyHtml(args.weekSignals)),
    );
    pageHtmls.push(
      buildPage('本週產業分佈', weekNum, buildSectorDistributionBodyHtml(args.weekSignals)),
    );
  }



  if (args.learningPoints.length) {
    const lpBlocks = args.learningPoints.map(
      (p) => `
        <li style="display:flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid ${COLORS.line}; font-size: 13px; line-height: 1.7;">
          <span style="color:${COLORS.brand}; font-weight: 700; flex-shrink: 0;">•</span>
          <span>${escapeHtml(p)}</span>
        </li>
      `,
    );
    const intro = sectionTitle('本週學習重點');
    const wrapped = [intro, `<ul style="list-style:none; padding:0; margin:0;">${lpBlocks.join('')}</ul>`];
    const chunked = await measureAndSplit(root, '本週學習重點', weekNum, wrapped, maxBody);
    for (const html of chunked) pageHtmls.push(buildPage('本週學習重點', weekNum, html));
  }

  const disclaimer = `
    <div style="position:absolute; left:68px; right:68px; bottom: 58px; padding-top: 12px; border-top: 1px solid ${COLORS.line}; font-size: 9px; color:${COLORS.gray}; line-height: 1.6;">
      本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。 &nbsp;·&nbsp; legendflow · 產出於 ${format(new Date(), 'yyyy/MM/dd')}
    </div>
  `;
  pageHtmls[pageHtmls.length - 1] = pageHtmls[pageHtmls.length - 1].replace(
    /<\/div>\s*$/,
    `${disclaimer}</div>`,
  );

  // 注入頁碼（跳過封面）
  const total = pageHtmls.length;
  return pageHtmls.map((html, i) =>
    i === 0
      ? html
      : html.replace(/<\/div>\s*$/, `${pageFooter(i + 1, total)}</div>`),
  );
};

export const exportJournalPdf = async (args: ExportArgs) => {
  await ensureFonts();

  const root = document.createElement('div');
  root.id = 'lf-pdf-root';
  root.style.cssText = 'position:fixed; left:-10000px; top:0; z-index:-1;';
  document.body.appendChild(root);

  try {
    const pageHtmls = await renderJournalPageHtmls(args, root);

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    for (let i = 0; i < pageHtmls.length; i++) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = pageHtmls[i];
      const pageEl = wrapper.firstElementChild as HTMLElement;
      root.appendChild(pageEl);

      // 截圖前守門：等 fonts.ready + polling auditFonts()，
      // 消除首張截圖 fallback 到 Georgia / PingFang 的機率。
      await waitForPageFontsReady(pageEl);

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        backgroundColor: COLORS.paper,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage('a4', 'portrait');
      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

      root.removeChild(pageEl);
    }

    const safeTitle = (args.weekTitle || '本週操作回顧')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '本週操作回顧';
    const filename = `週記-${format(args.weekStart, 'yyyy-MM-dd')}-${safeTitle}.pdf`;
    doc.save(filename);
  } finally {
    document.body.removeChild(root);
  }
};

// 給 harness 用的品牌色常數，避免 test 檔硬編
export const JOURNAL_PDF_COLORS = COLORS;

