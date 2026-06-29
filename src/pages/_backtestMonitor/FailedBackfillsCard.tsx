import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { XCircle } from 'lucide-react';
import type { FailedBackfillRow, FailedReason } from './types';
import { fmtDateTime } from './format';

interface Props {
  reasons: FailedReason[];
  failedBackfills: FailedBackfillRow[];
}

export function FailedBackfillsCard({ reasons, failedBackfills }: Props) {
  if (reasons.length === 0) return null;
  return (
    <Card className="border-red-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium mb-2">
          <XCircle className="h-4 w-4 text-red-600" />
          回填失敗原因（Top 5）
        </div>
        <div className="space-y-1.5">
          {reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Badge variant="destructive" className="shrink-0">{r.count}</Badge>
              <code className="text-red-700 bg-red-50 px-1.5 py-0.5 rounded break-all">{r.reason}</code>
            </div>
          ))}
        </div>
        {failedBackfills.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
              展開最近 20 筆失敗批次
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto border rounded">
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">時間</th>
                    <th className="text-left p-2">Symbol / 月份</th>
                    <th className="text-left p-2">錯誤</th>
                  </tr>
                </thead>
                <tbody>
                  {failedBackfills.map((f, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtDateTime(f.attempted_at)}</td>
                      <td className="p-2 font-mono">{f.symbol} / {f.yyyymm}</td>
                      <td className="p-2 text-red-600 break-all">{f.error_message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
