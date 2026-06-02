import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import type { RunRow } from './types';
import { fmtDateTime, fmtPct } from './format';

interface Props {
  runs: RunRow[];
  items: Record<string, { title: string }>;
  loading: boolean;
  busyId: string | null;
  onRetry: (id: string | null) => void;
}

export function RunsTable({ runs, items, loading, busyId, onRetry }: Props) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                <th className="text-left p-3">時間</th>
                <th className="text-left p-3">知識條目</th>
                <th className="text-left p-3">模式</th>
                <th className="text-left p-3">狀態</th>
                <th className="text-right p-3">勝率</th>
                <th className="text-right p-3">樣本</th>
                <th className="text-left p-3">錯誤訊息</th>
                <th className="text-right p-3">動作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">載入中…</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">尚無回測紀錄</td></tr>
              ) : runs.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="p-3">{items[r.knowledge_item_id ?? '']?.title ?? <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="p-3 text-xs"><Badge variant="outline">{r.run_mode}</Badge></td>
                  <td className="p-3">
                    {r.status === 'completed' ? (
                      <Badge variant="outline" className="text-green-700 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" />成功</Badge>
                    ) : r.status === 'failed' ? (
                      <Badge variant="destructive">失敗</Badge>
                    ) : (
                      <Badge variant="secondary">{r.status}</Badge>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.win_rate)}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{r.total_hits || 0}</td>
                  <td className="p-3 text-xs text-red-600 max-w-xs truncate" title={r.error_message ?? ''}>
                    {r.error_message ?? '—'}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      variant="outline" size="sm"
                      disabled={!r.knowledge_item_id || busyId === r.knowledge_item_id}
                      onClick={() => onRetry(r.knowledge_item_id)}
                    >
                      {busyId === r.knowledge_item_id ? '…' : '重試'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
