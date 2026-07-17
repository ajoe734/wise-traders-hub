// @ts-nocheck
/**
 * Preview-only E2E harness · HoldingsDetailPanel 多資料量 RWD 守門
 *
 * URL: /e2e/holdings-detail-panel-volume
 *   ?count=1|10|50|100
 *   &width=mobile|desktop
 *   &stress=none|long-title|multiline|mega-list （可用逗號組合，例：stress=long-title,multiline）
 *
 * stress presets：
 *   - none        : 標準 mock（既有行為）
 *   - long-title  : 個股名稱 60 字、決策 note 200 字單行、事件標題 120 字
 *   - multiline   : 決策 note 20 行、thesis 描述含強制換行、多行說明段落
 *   - mega-list   : events=500、targetPriceHistory=500、thesisTracking=500
 *                  （count 仍以 URL 參數為主，但列表長度 override）
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { Suspense, lazy, useMemo } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';

const HoldingsDetailPanel = lazy(
  () => import('@/checkup/components/freecheckup/HoldingsDetailPanel'),
);

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const NAME_POOL = [
  '台積電', '聯發科', '鴻海', '國泰金', '中華電', '台達電', '富邦金', '玉山金',
  '兆豐金', '第一金', '合庫金', '中信金', '元大金', '開發金', '永豐金', '新光金',
  '國巨', '穩懋', '欣興', '南亞科', '華邦電', '旺宏', '瑞儀', '大立光', '玉晶光',
  '可成', '和碩', '仁寶', '廣達', '緯創', '英業達', '技嘉', '華碩', '微星',
  '長榮', '陽明', '萬海', '中鋼', '中鴻', '南亞', '台塑', '台化', '台泥', '亞泥',
  '統一', '味全', '大成', '卜蜂', '南僑', '中華食',
];

// 加壓工具 —— 用 repeat 造出精確長度的中英文
const CJK = '極長標題壓力測試中文字元不換行不斷字持續拉長';
const ASCII = 'LOREMIPSUMDOLORSITAMETCONSECTETURADIPISCINGELIT';
function chars(len: number, seed: string): string {
  let out = '';
  while (out.length < len) out += seed;
  return out.slice(0, len);
}

type StressFlags = {
  longTitle: boolean;
  multiline: boolean;
  megaList: boolean;
};

function parseStress(raw: string | null): StressFlags {
  const set = new Set((raw || 'none').split(',').map((s) => s.trim().toLowerCase()));
  return {
    longTitle: set.has('long-title') || set.has('all'),
    multiline: set.has('multiline') || set.has('all'),
    megaList: set.has('mega-list') || set.has('all'),
  };
}

function makeHoldings(count: number, s: StressFlags) {
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    const code = String(2000 + i);
    const baseName = NAME_POOL[i % NAME_POOL.length];
    // long-title：拉到 60 字中文，強調 title 節點在窄寬度下也不撐爆
    const name = s.longTitle ? chars(60, `${baseName}${CJK}`) : baseName;
    const pct = ((count - i) / count) * (12 + (i % 5));
    const price = 100 + (i * 7) % 900;
    const qty = 100 * (1 + (i % 8));
    arr.push({
      code, name, qty, cost: price * 0.85, price, targetPrice: price * 1.1,
      pnl: qty * (price - price * 0.85), pct,
      changePct: ((i % 7) - 3) * 0.5, todayPnl: qty * ((i % 7) - 3) * 0.5,
    });
  }
  return arr;
}

function makeDecisionsMap(codes: string[], s: StressFlags) {
  const map: Record<string, any> = {};
  const actions = ['hold', 'add', 'trim', 'watch'];
  const longSingleLine = chars(200, `決策長註 ${CJK}`);
  const multilineNote = Array.from({ length: 20 }, (_, k) =>
    `第 ${k + 1} 行 · ${CJK.slice(0, 20)}`).join('\n');
  codes.forEach((code, i) => {
    let note = `決策備註 · ${code} · 長註解確認在長清單下也不會撐爆容器邊界，這是刻意加長的中文文字節點。`;
    if (s.longTitle) note = longSingleLine;
    if (s.multiline) note = multilineNote;
    if (s.longTitle && s.multiline) note = `${longSingleLine}\n\n${multilineNote}`;
    map[code] = {
      action: actions[i % actions.length],
      timestamp: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      note,
    };
  });
  return map;
}

function makeStockMeta(codes: string[]) {
  const map: Record<string, any> = {};
  const sectors = ['半導體', '金融', '電子', '塑膠', '航運'];
  codes.forEach((code, i) => {
    map[code] = { sector: sectors[i % sectors.length], industry: `子產業 ${i % 6}` };
  });
  return map;
}

function makeTargetPriceHistory(code: string, count: number) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      target: 100 + (i * 3),
    });
  }
  return { [code]: rows };
}

function makeThesisTracking(code: string, count: number, s: StressFlags) {
  const rows = [];
  const suggestions = ['hold', 'add', 'trim', 'exit'];
  const longNote = s.multiline
    ? `${chars(120, `多行論述 ${CJK} `)}\n第二段：${chars(80, ASCII)}\n第三段：${chars(80, CJK)}`
    : undefined;
  for (let i = 0; i < count; i += 1) {
    rows.push({
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      suggestion: suggestions[i % 4],
      myAction: suggestions[(i + 1) % 4],
      afterPct: ((i % 11) - 5) * 1.2,
      ...(longNote ? { note: longNote, description: longNote } : {}),
    });
  }
  return { [code]: rows };
}

function makeEvents(count: number, s: StressFlags) {
  const arr = [];
  const longTitle = chars(120, `事件超長標題 ${CJK} `);
  for (let i = 0; i < count; i += 1) {
    arr.push({
      code: String(2000 + i),
      date: `2026-08-${String(1 + (i % 28)).padStart(2, '0')}`,
      title: s.longTitle
        ? longTitle
        : `事件 ${i} · 這是刻意加長的事件標題，避免長清單下換行/溢出退化`,
      kind: i % 2 === 0 ? 'earnings' : 'dividend',
    });
  }
  return arr;
}

export default function HoldingsDetailPanelVolumeHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const countRaw = Number.parseInt(params.get('count') || '10', 10);
  const count = Math.max(1, Math.min(200, Number.isFinite(countRaw) ? countRaw : 10));
  const widthMode = params.get('width') === 'desktop' ? 'desktop' : 'mobile';

  const {
    holdings, selected, decisionsMap, stockMeta, orderedDisplayed,
    normalizedEvents, targetPriceHistory, thesisTracking, sparkData30D,
  } = useMemo(() => {
    const hs = makeHoldings(count);
    const codes = hs.map((h) => h.code);
    const sel = hs[0];
    return {
      holdings: hs,
      selected: sel,
      decisionsMap: makeDecisionsMap(codes),
      stockMeta: makeStockMeta(codes),
      orderedDisplayed: hs,
      normalizedEvents: makeEvents(count),
      targetPriceHistory: makeTargetPriceHistory(sel.code, count),
      thesisTracking: makeThesisTracking(sel.code, count),
      sparkData30D: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`,
        v: 100 + Math.sin(i / 3) * 8,
      })),
    };
  }, [count]);

  const totalPortfolioValue = holdings.reduce((s, h) => s + h.price * h.qty, 0);
  const targets = () => selected.targetPrice;
  const avgTarget = () => selected.targetPrice;

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: widthMode === 'desktop' ? 512 : '100%',
    minHeight: '100vh',
    background: (WB as any).surface || '#F5F3EF',
    padding: 0,
    overflowX: 'hidden',
  };

  return (
    <div
      id="drawer-volume-harness-root"
      data-testid="holdings-detail-panel"
      data-volume-count={String(count)}
      data-volume-width={widthMode}
      style={containerStyle}
    >
      <Suspense fallback={<div style={{ padding: 24 }}>loading…</div>}>
        <HoldingsDetailPanel
          selected={selected}
          decisionsMap={decisionsMap}
          stockMeta={stockMeta}
          targets={targets}
          avgTarget={avgTarget}
          normalizedEvents={normalizedEvents}
          orderedDisplayed={orderedDisplayed}
          WB={WB}
          setExpandedDecision={() => {}}
          openHoldingDrawer={() => {}}
          totalPortfolioValue={totalPortfolioValue}
          sparkData30D={sparkData30D}
          sortBy="pct"
          sortDir="desc"
          setSortBy={() => {}}
          setSortDir={() => {}}
          tradeLog={[]}
          targetPriceHistory={targetPriceHistory}
          thesisTracking={thesisTracking}
          onReportMeta={() => {}}
        />
      </Suspense>
    </div>
  );
}
