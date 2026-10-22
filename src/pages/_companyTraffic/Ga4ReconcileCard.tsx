import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { classifyVisitors, identityMap } from '@/lib/analytics/trafficQuality';
import { reconcileGa4, type Ga4Input } from '@/lib/analytics/ga4Reconcile';
import { useTrafficRaw } from '@/pages/_companyTraffic/TrafficQuality';

const slash = (s: string) => s.replace(/-/g, '/');
const pct = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`);
/** 台北日 YYYY-MM-DD 00:00 的 UTC 時刻 */
const taipeiMidnight = (day: string) => new Date(`${day}T00:00:00+08:00`);

export default function Ga4ReconcileCard({ ga4, startDate, endDate }: { ga4: Ga4Input; startDate: string; endDate: string }) {
  // 對齊 GA 的整日口徑：台北 startDate 00:00 至 endDate 隔天 00:00
  const from = useMemo(() => taipeiMidnight(startDate), [startDate]);
  const to = useMemo(() => new Date(taipeiMidnight(endDate).getTime() + 86400000), [endDate]);
  const { data, isLoading, error } = useTrafficRaw(from, to);
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
    <Card data-testid="ga4-reconcile">
      <CardHeader>
        <CardTitle className="text-base">GA4 與本站流量對帳（看頁次數）</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          期間 {slash(startDate)} – {slash(endDate)} 台北整日；本站只算「真人」具名看頁（排除疑似機器／測試／自家人）。差距＝GA4 − 本站，超過 20% 且量 ≥ 10 標紅。
          人數定義不同（GA 使用者 vs 本站跨裝置合併人數），只並列不判定；今日 GA 尚在處理不判定。每日 GA4 數字含後台頁，本站不收集後台，管理員常用時 GA4 會偏高；熱門頁面已排除後台頁。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p role="status" className="text-sm text-muted-foreground">讀取本站紀錄中…</p>}
        {error && <p role="alert" className="text-sm text-destructive">本站紀錄讀取失敗，無法對帳。</p>}
        {r && <>
          <p className="text-sm">期間合計：GA4 <b>{r.totals.ga4.toLocaleString()}</b>・本站 <b>{r.totals.site.toLocaleString()}</b>・差距 <b>{pct(Math.max(r.totals.ga4, r.totals.site) ? (r.totals.ga4 - r.totals.site) / Math.max(r.totals.ga4, r.totals.site) : null)}</b>；
            標紅：每日 {r.daily.filter(d => d.flagged).length} 天、頁面 {r.pages.filter(p => p.flagged).length} 個</p>
          <div>
            <p className="mb-1 text-sm font-bold">每日趨勢對帳</p>
            <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead className="text-right">GA4</TableHead><TableHead className="text-right">本站</TableHead><TableHead className="text-right">差距</TableHead><TableHead className="text-right">比例</TableHead></TableRow></TableHeader>
              <TableBody>{r.daily.map(d => <TableRow key={d.day} data-flagged={d.flagged} className={d.flagged ? 'text-destructive font-bold' : ''}>
                <TableCell>{slash(d.day)}{d.day === today ? '（今日）' : ''}</TableCell><TableCell className="text-right">{d.ga4}</TableCell><TableCell className="text-right">{d.site}</TableCell>
                <TableCell className="text-right">{d.diff > 0 ? '+' : ''}{d.diff}</TableCell><TableCell className="text-right">{pct(d.pct)}</TableCell></TableRow>)}</TableBody></Table></div>
          </div>
          <div>
            <p className="mb-1 text-sm font-bold">熱門頁面對帳（雙方前 15 聯集）</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>路徑</TableHead><TableHead className="text-right">GA4 瀏覽</TableHead><TableHead className="text-right">本站看頁</TableHead><TableHead className="text-right">差距</TableHead><TableHead className="text-right">GA4 使用者</TableHead><TableHead className="text-right">本站人數</TableHead></TableRow></TableHeader>
              <TableBody>{r.pages.map(p => <TableRow key={p.path} data-flagged={p.flagged} className={p.flagged ? 'text-destructive font-bold' : ''}>
                <TableCell className="font-mono text-xs break-all">{p.path}{!p.comparable ? <span className="ml-1 font-sans text-muted-foreground">{p.inGa4Top ? '（GA4 前 15 只含部分網址，無法比較）' : '（GA4 前 15 外，無法比較）'}</span> : ''}</TableCell>
                <TableCell className="text-right">{p.ga4PageViews ?? '—'}</TableCell><TableCell className="text-right">{p.sitePageViews}</TableCell>
                <TableCell className="text-right">{p.diff == null ? '—' : `${p.diff > 0 ? '+' : ''}${p.diff}（${pct(p.pct)}）`}</TableCell>
                <TableCell className="text-right">{p.ga4Users ?? '—'}</TableCell><TableCell className="text-right">{p.siteViewers}</TableCell></TableRow>)}
                {r.pages.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">雙方期間內都沒有看頁</TableCell></TableRow>}</TableBody></Table></div>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
