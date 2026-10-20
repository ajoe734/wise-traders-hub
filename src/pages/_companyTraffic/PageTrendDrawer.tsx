import { lazy, Suspense, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { pageDailyTrend, type EventRow, type PageStat } from '@/lib/analytics/trafficQuality';

const PageTrendLine = lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.PageTrendLine })));
const fmtDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).replace(/-/g, '/');

export default function PageTrendDrawer({ path, stat, events, ids, from, to, onClose }: {
  path: string | null; stat?: PageStat; events: EventRow[]; ids: Map<string, string>; from: Date; to: Date; onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [showLoggedIn, setShowLoggedIn] = useState(true);
  const trend = useMemo(() => (path ? pageDailyTrend(events, ids, path, from, to) : null), [path, events, ids, from, to]);
  const mismatch = trend && stat && (trend.totals.viewers !== stat.viewers || trend.totals.pageViews !== stat.pageViews);

  return (
    <Sheet open={!!path} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="w-full overflow-y-auto sm:max-w-2xl max-h-[100dvh]" aria-label="頁面每日趨勢">
        <SheetHeader>
          <SheetTitle className="break-all font-mono text-base">{path}</SheetTitle>
          <SheetDescription>{fmtDay(from)} – {fmtDay(new Date(to.getTime() - 1))}（台北日）</SheetDescription>
        </SheetHeader>
        {trend && <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {([['期間瀏覽', trend.totals.pageViews], ['不重複訪客', trend.totals.viewers], ['登入訪客', trend.totals.loggedIn]] as const).map(([k, v]) =>
              <div key={k} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-bold tabular-nums" data-testid={`trend-${k}`}>{v.toLocaleString()}</p></div>)}
          </div>
          <div className="flex items-center gap-2"><Switch id="trend-logged" checked={showLoggedIn} onCheckedChange={setShowLoggedIn} /><Label htmlFor="trend-logged" className="text-xs">顯示登入訪客線</Label></div>
          <Suspense fallback={<div className="h-[280px]" />}><PageTrendLine data={trend.days} showLoggedIn={showLoggedIn} /></Suspense>
          <p className={`text-xs ${mismatch ? 'text-destructive' : 'text-muted-foreground'}`} role={mismatch ? 'alert' : undefined}>
            {mismatch
              ? `對帳不一致：排行 ${stat!.viewers} 人／${stat!.pageViews} 次，趨勢 ${trend.totals.viewers} 人／${trend.totals.pageViews} 次`
              : `與排行對帳一致：${trend.totals.viewers} 人、${trend.totals.pageViews} 次（每日人數不可直接相加，期間已去重）`}
          </p>
        </div>}
      </SheetContent>
    </Sheet>
  );
}
