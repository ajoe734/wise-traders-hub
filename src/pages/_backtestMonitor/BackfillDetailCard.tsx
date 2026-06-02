import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BackfillSnapshot } from './types';

export function BackfillDetailCard({ backfill }: { backfill: BackfillSnapshot | null }) {
  if (!backfill) return null;
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">TWSE 日 K 回填細節</div>
          <Badge variant="outline" className="text-xs">自動續跑 every 5 min</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">目前處理中</div>
            <div className="font-mono mt-0.5">
              {backfill.current_symbol
                ? `${backfill.current_symbol} / ${backfill.current_yyyymm}`
                : '— 已清空'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">最新完成月份</div>
            <div className="font-mono mt-0.5">{backfill.latest_month ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">最新交易日</div>
            <div className="font-mono mt-0.5">{backfill.latest_date ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">速率（近 5 分鐘）</div>
            <div className="font-mono mt-0.5">{backfill.recent_done_5min} 批 / 5min</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2 border-t">
          <div>
            <div className="text-muted-foreground">待跑</div>
            <div className="font-semibold mt-0.5 text-amber-600">{backfill.pending.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">完成</div>
            <div className="font-semibold mt-0.5 text-emerald-600">{backfill.done.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">無資料 / 失敗</div>
            <div className="font-semibold mt-0.5">
              {backfill.empty.toLocaleString()} / <span className={backfill.failed ? 'text-red-600' : ''}>{backfill.failed.toLocaleString()}</span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">預估完成</div>
            <div className="font-semibold mt-0.5">
              {backfill.pending === 0 ? (
                <span className="text-emerald-600">已完成 ✅</span>
              ) : backfill.eta_minutes != null ? (
                backfill.eta_minutes < 60
                  ? `~${backfill.eta_minutes} 分鐘`
                  : `~${(backfill.eta_minutes / 60).toFixed(1)} 小時`
              ) : '計算中…'}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          💡 回填全部清空後會<b>自動觸發 knowledge-backtest 完整重算</b>，並寫入下方紀錄。
        </div>
      </CardContent>
    </Card>
  );
}
