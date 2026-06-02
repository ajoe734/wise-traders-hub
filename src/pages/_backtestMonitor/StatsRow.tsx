import { Card, CardContent } from '@/components/ui/card';
import type { BackfillSnapshot } from './types';
import { fmtDateTime } from './format';

interface Props {
  lastCron: string | null;
  success24: number;
  failed24: number;
  backfill: BackfillSnapshot | null;
}

export function StatsRow({ lastCron, success24, failed24, backfill }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><CardContent className="p-4">
        <div className="text-xs text-muted-foreground">最近 cron 執行</div>
        <div className="text-sm font-semibold mt-1">{fmtDateTime(lastCron)}</div>
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <div className="text-xs text-muted-foreground">24h 成功</div>
        <div className="text-2xl font-semibold mt-1 text-green-600">{success24}</div>
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <div className="text-xs text-muted-foreground">24h 失敗</div>
        <div className={`text-2xl font-semibold mt-1 ${failed24 ? 'text-red-600' : ''}`}>{failed24}</div>
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <div className="text-xs text-muted-foreground">回填完成 / 總批次</div>
        <div className="text-sm font-semibold mt-1">
          {backfill ? `${backfill.done.toLocaleString()} / ${backfill.total.toLocaleString()}` : '—'}
        </div>
        {backfill && backfill.total > 0 && (
          <div className="w-full h-1.5 bg-muted rounded mt-2 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all"
              style={{ width: `${((backfill.done + backfill.empty) / backfill.total) * 100}%` }} />
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
