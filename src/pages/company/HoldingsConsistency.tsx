import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import SEO from '@/components/SEO';
import { AlertTriangle, RefreshCw, Download, Search } from 'lucide-react';
import { FixProposalsPanel } from './_holdingsConsistency/FixProposalsPanel';

type Row = {
  category: string;
  expert_slug: string;
  expert_name: string;
  symbol: string;
  severity: 'high' | 'medium' | 'low';
  details: Record<string, any>;
};

const CATEGORY_META: Record<string, { label: string; desc: string; tone: string }> = {
  ORPHAN_PENDING: {
    label: 'Pending 積壓',
    desc: '訊號超過 7 天仍為 pending，未進入帳本，週記與看板都算不到。',
    tone: 'bg-orange-50 border-orange-200 text-orange-900',
  },
  UNIT_MIX: {
    label: '單位混用',
    desc: '同一 (老師, 標的) 在訊號與帳本中出現多種 unit（張/股），下游計算會全部錯。',
    tone: 'bg-red-50 border-red-200 text-red-900',
  },
  UNIT_A_NE_B: {
    label: '單位錯登',
    desc: 'trade_records 與 published signal 的 unit 不同（例：帳本記股、訊號記張）。',
    tone: 'bg-red-50 border-red-200 text-red-900',
  },
  DRIFT_A_VS_B: {
    label: '帳本 ≠ 訊號淨額',
    desc: '帳本 open 股數與已發布訊號 buy/add-sell/trim/exit 淨額不一致。',
    tone: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  HIDDEN_ACTIONS: {
    label: '週記隱藏動作',
    desc: '訊號中的 add/trim/exit 未計入週記「本週總計」而導致差額。',
    tone: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  },
  ORPHAN_TRADE: {
    label: '帳本有、訊號缺',
    desc: '帳本有 open 部位，但該 (老師, 標的) 沒有對應 buy/add 訊號。',
    tone: 'bg-slate-50 border-slate-200 text-slate-900',
  },
  ORPHAN_SIGNAL: {
    label: '訊號有、帳本缺',
    desc: '訊號有 buy/add，但帳本中該 (老師, 標的) 完全不存在。',
    tone: 'bg-slate-50 border-slate-200 text-slate-900',
  },
};

const CATEGORY_ORDER = [
  'UNIT_MIX', 'UNIT_A_NE_B', 'DRIFT_A_VS_B', 'HIDDEN_ACTIONS',
  'ORPHAN_PENDING', 'ORPHAN_TRADE', 'ORPHAN_SIGNAL',
];

function formatValue(k: string, v: any): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (/shares|net/.test(k)) return v.toLocaleString('en-US');
    return String(v);
  }
  if (typeof v === 'string' && /_at$/.test(k)) {
    try {
      return new Date(v).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    } catch { return v; }
  }
  return String(v);
}

export default function HoldingsConsistency() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('admin_holdings_consistency_audit' as any);
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
      setFetchedAt(new Date());
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const byCat = new Map<string, { count: number; experts: Set<string>; high: number }>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, { count: 0, experts: new Set(), high: 0 });
      const s = byCat.get(r.category)!;
      s.count++;
      s.experts.add(r.expert_slug);
      if (r.severity === 'high') s.high++;
    }
    const totalExperts = new Set(rows.map(r => r.expert_slug)).size;
    return { byCat, totalExperts };
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter(r =>
      (activeCategory === 'ALL' || r.category === activeCategory) &&
      (!kw || r.expert_slug.toLowerCase().includes(kw) ||
              r.expert_name.toLowerCase().includes(kw) ||
              (r.symbol || '').toLowerCase().includes(kw))
    );
  }, [rows, activeCategory, q]);

  function exportCsv() {
    const header = ['category', 'expert_slug', 'expert_name', 'symbol', 'severity', 'details'];
    const lines = [header.join(',')];
    for (const r of filtered) {
      const details = JSON.stringify(r.details).replace(/"/g, '""');
      lines.push([r.category, r.expert_slug, r.expert_name, r.symbol,
                  r.severity, `"${details}"`].join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holdings-consistency-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <SEO title="持倉一致性儀表板 | Legendflow" description="Holdings consistency drift audit" />

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">持倉一致性儀表板</h1>
          <p className="text-sm text-slate-500 mt-1">
            比對 trade_records（帳本）、expert_signals（訊號流水）與週記匯出口徑；
            {fetchedAt && ` 更新於 ${fetchedAt.toLocaleTimeString('zh-TW', { hour12: false })}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            重新掃描
          </button>
          <button
            onClick={exportCsv}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            匯出 CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-900 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>掃描失敗：{error}</div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="總 drift 筆數" value={rows.length} />
        <KPI label="受影響老師" value={stats.totalExperts} />
        <KPI
          label="高嚴重度 (high)"
          value={rows.filter(r => r.severity === 'high').length}
          tone={rows.some(r => r.severity === 'high') ? 'text-red-600' : ''}
        />
        <KPI label="類別" value={stats.byCat.size} />
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap border-b border-slate-200">
        <CategoryTab
          label="全部"
          count={rows.length}
          active={activeCategory === 'ALL'}
          onClick={() => setActiveCategory('ALL')}
        />
        {CATEGORY_ORDER.map(cat => {
          const s = stats.byCat.get(cat);
          if (!s) return null;
          return (
            <CategoryTab
              key={cat}
              label={CATEGORY_META[cat]?.label ?? cat}
              count={s.count}
              highCount={s.high}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          );
        })}
      </div>

      {activeCategory !== 'ALL' && CATEGORY_META[activeCategory] && (
        <div className={`text-sm border rounded-md px-4 py-3 ${CATEGORY_META[activeCategory].tone}`}>
          {CATEGORY_META[activeCategory].desc}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜尋老師 slug / 姓名 / 標的"
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 w-40">類別</th>
              <th className="text-left px-3 py-2">老師</th>
              <th className="text-left px-3 py-2 w-32">標的</th>
              <th className="text-left px-3 py-2 w-24">嚴重度</th>
              <th className="text-left px-3 py-2">明細</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">掃描中…</td></tr>
            )}
            {!loading && !filtered.length && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                {rows.length ? '此篩選條件下沒有 drift' : '所有口徑一致 🎉'}
              </td></tr>
            )}
            {filtered.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 align-top">
                  <span className="text-xs font-mono text-slate-700">{r.category}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-slate-900">{r.expert_name || '—'}</div>
                  <div className="text-xs text-slate-500 font-mono">{r.expert_slug}</div>
                </td>
                <td className="px-3 py-2 align-top font-mono text-slate-800">{r.symbol || '—'}</td>
                <td className="px-3 py-2 align-top">
                  <SeverityBadge severity={r.severity} />
                </td>
                <td className="px-3 py-2 align-top">
                  {r.details && Object.keys(r.details).length ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {Object.entries(r.details).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-slate-500">{k}:</span>{' '}
                          <span className="text-slate-800 font-mono">{formatValue(k, v)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <span className="text-slate-400 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-400">
        說明：TW 1 張 = 1000 股。所有數據皆為即時 read-only 掃描，不會變更任何資料。
      </div>
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border rounded-md bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tone || 'text-slate-900'}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function CategoryTab({
  label, count, highCount, active, onClick,
}: { label: string; count: number; highCount?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 transition-colors -mb-px ${
        active
          ? 'border-primary text-primary font-medium'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
      <span className="ml-1.5 text-xs text-slate-400">({count})</span>
      {!!highCount && (
        <span className="ml-1 text-xs text-red-600 font-medium">·{highCount} high</span>
      )}
    </button>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex text-xs px-2 py-0.5 rounded border ${map[severity] || map.low}`}>
      {severity}
    </span>
  );
}
