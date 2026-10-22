import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { classifyVisitors, identityMap } from '@/lib/analytics/trafficQuality';
import { reconcileGa4, type Ga4Input } from '@/lib/analytics/ga4Reconcile';
import { useTrafficRaw } from '@/pages/_companyTraffic/TrafficQuality';

const slash = (s: string) => s.replace(/-/g, '/');
const pct = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`);
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;
/** 台北日 YYYY-MM-DD 00:00 的 UTC 時刻 */
const taipeiMidnight = (day: string) => new Date(`${day}T00:00:00+08:00`);

export default function Ga4ReconcileCard({ ga4, startDate, endDate }: { ga4: Ga4Input; startDate: string; endDate: string }) {
  // 對齊 GA 的整日口徑：台北 startDate 00:00 至 endDate 隔天 00:00
  const from = useMemo(() => taipeiMidnight(startDate), [startDate]);
  const to = useMemo(() => new Date(taipeiMidnight(endDate).getTime() + 86400000), [endDate]);
  const { data, isLoading, error, refetch, isFetching } = useTrafficRaw(from, to);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  const r = useMemo(() => {
    if (!data) return null;
    const cls = classifyVisitors(data.visits, data.events, data.staff);
    const events = data.events.filter(e => (cls.get(e.visitor_id)?.tier ?? 'human') === 'human');
    const out = reconcileGa4(ga4, events, identityMap(data.visits, data.events), from, to);
    // GA 當日資料仍在處理（延遲數小時），今日不判定差距
    out.daily = out.daily.map(d => (d.day === today ? { ...d, flagged: false } : d));
    return out;
  }, [data, ga4, from, to, today]);

  return (
    <section data-testid="ga4-reconcile" aria-label="GA4 與網站資料對比" className="space-y-4">
      <header>
        <h2 className="text-base font-bold">GA4 與網站資料對比</h2>
        <p className="text-xs text-muted-foreground mt-1">
          期間 {slash(startDate)} – {slash(endDate)} 台北整日；本站只算「真人」具名看頁（排除疑似機器／測試／自家人）。差距＝GA4 − 網站；差距比例以兩者較大值為分母，超過 20% 且量 ≥ 10 標示「有差距」。
          人數定義不同（GA 使用者 vs 本站跨裝置合併人數），只並列不判定；今日 GA 尚在處理不判定。每日 GA4 數字含後台頁，本站不收集後台，管理員常用時 GA4 會偏高；熱門頁面已排除後台頁。
        </p>
      </header>
      <div className="space-y-4">
        {isLoading && <p role="status" className="text-sm text-muted-foreground">讀取本站紀錄中…</p>}
        {error && <div role="alert" className="text-sm text-destructive">本站紀錄讀取失敗，無法對帳。<Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>重試</Button></div>}
        {r && !error && <>
          <div className="grid grid-cols-2 gap-4 border-y py-4 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">GA4 瀏覽</p><p className="text-xl font-bold">{r.totals.ga4.toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">網站看頁</p><p className="text-xl font-bold">{r.totals.site.toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">差距次數</p><p className="text-xl font-bold">{signed(r.totals.ga4 - r.totals.site)}</p></div>
            <div><p className="text-xs text-muted-foreground">差距比例</p><p className="text-xl font-bold">{pct(Math.max(r.totals.ga4, r.totals.site) ? (r.totals.ga4 - r.totals.site) / Math.max(r.totals.ga4, r.totals.site) : null)}</p></div>
          </div>
          {r.totals.ga4 === 0 && <p role="status" className="border-l-2 border-primary pl-3 text-sm">GA4 在此期間沒有瀏覽資料；下列差距不代表網站漏記，也不能據此確認追蹤碼是否正常。</p>}
          <p className="text-sm font-bold">有差距：每日 {r.daily.filter(d => d.flagged).length} 天、頁面 {r.pages.filter(p => p.flagged).length} 個</p>
          <div aria-label="GA4 與網站每日看頁折線圖" className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={r.daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tickFormatter={d => slash(d).slice(5)} fontSize={11} minTickGap={24} />
                <YAxis allowDecimals={false} fontSize={11} width={48} />
                <Tooltip labelFormatter={d => slash(String(d))} />
                <Legend />
                <Line type="linear" dataKey="ga4" name="GA4 瀏覽" stroke="hsl(var(--mentor))" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="site" name="網站看頁" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-1 text-sm font-bold">每日趨勢對帳</p>
            <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead className="text-right">GA4</TableHead><TableHead className="text-right">網站</TableHead><TableHead className="text-right">差距</TableHead><TableHead className="text-right">比例</TableHead><TableHead>判定</TableHead></TableRow></TableHeader>
              <TableBody>{r.daily.map(d => <TableRow key={d.day} data-flagged={d.flagged} className={d.flagged ? 'text-destructive font-bold' : ''}>
                <TableCell>{slash(d.day)}{d.day === today ? '（今日）' : ''}</TableCell><TableCell className="text-right">{d.ga4}</TableCell><TableCell className="text-right">{d.site}</TableCell>
                <TableCell className="text-right">{signed(d.diff)}</TableCell><TableCell className="text-right">{pct(d.pct)}</TableCell><TableCell className="whitespace-nowrap">{d.day === today ? '今日尚未完整' : d.flagged ? '有差距' : Math.max(d.ga4, d.site) < 10 ? '樣本不足' : '容許範圍內'}</TableCell></TableRow>)}</TableBody></Table></div>
          </div>
          <div>
            <p className="mb-1 text-sm font-bold">熱門頁面對帳（雙方前 15 聯集）</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>路徑</TableHead><TableHead className="text-right">GA4 瀏覽</TableHead><TableHead className="text-right">網站看頁</TableHead><TableHead className="text-right">差距</TableHead><TableHead className="text-right">GA4 使用者</TableHead><TableHead className="text-right">網站人數</TableHead><TableHead>判定</TableHead></TableRow></TableHeader>
              <TableBody>{r.pages.map(p => <TableRow key={p.path} data-flagged={p.flagged} className={p.flagged ? 'text-destructive font-bold' : ''}>
                <TableCell className="font-mono text-xs break-all">{p.path}{!p.comparable ? <span className="ml-1 font-sans text-muted-foreground">{p.inGa4Top ? '（GA4 前 15 只含部分網址，無法比較）' : '（GA4 前 15 外，無法比較）'}</span> : ''}</TableCell>
                <TableCell className="text-right">{p.ga4PageViews ?? '—'}</TableCell><TableCell className="text-right">{p.sitePageViews}</TableCell>
                <TableCell className="text-right">{p.diff == null ? '—' : `${p.diff > 0 ? '+' : ''}${p.diff}（${pct(p.pct)}）`}</TableCell>
                <TableCell className="text-right">{p.ga4Users ?? '—'}</TableCell><TableCell className="text-right">{p.siteViewers}</TableCell><TableCell className="whitespace-nowrap">{!p.comparable ? '資料不完整' : p.flagged ? '有差距' : Math.max(p.ga4PageViews ?? 0, p.sitePageViews) < 10 ? '樣本不足' : '容許範圍內'}</TableCell></TableRow>)}
                {r.pages.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">雙方期間內都沒有看頁</TableCell></TableRow>}</TableBody></Table></div>
          </div>
        </>}
      </div>
    </section>
  );
}
