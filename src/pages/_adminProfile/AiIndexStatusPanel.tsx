import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, Loader2, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  expertId: string;
  /** 觸發外部重建按鈕時遞增，強制立即重抓 */
  refreshKey?: number;
}

interface RunRow {
  id: string;
  status: 'running' | 'success' | 'failed';
  trigger_source: string;
  total_chunks: number | null;
  indexed_chunks: number;
  embed_failures: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(ms?: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m} 分 ${rs} 秒`;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: '手動觸發',
  signal_trigger: '週記自動同步',
  cron: '排程',
};

export default function AiIndexStatusPanel({ expertId, refreshKey }: Props) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['expert-ai-index-runs', expertId],
    enabled: !!expertId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expert_ai_index_runs' as any)
        .select('*')
        .eq('expert_id', expertId)
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as unknown as RunRow[];
    },
    // 若有進行中的 run，5 秒輪詢
    refetchInterval: (query) => {
      const rows = query.state.data as RunRow[] | undefined;
      return rows?.some((r) => r.status === 'running') ? 5000 : false;
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (refreshKey !== undefined) refetch();
  }, [refreshKey, refetch]);

  const latest = data?.[0];
  const history = data?.slice(1) || [];
  const progress = latest && latest.status === 'running' && latest.total_chunks
    ? Math.min(100, Math.round((latest.indexed_chunks / latest.total_chunks) * 100))
    : latest?.status === 'success' ? 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI 索引狀態</CardTitle>
        <CardDescription>顯示最近一次索引重建的結果、進度與失敗原因（每 5 秒自動更新進行中的任務）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 載入中…
          </div>
        )}

        {!isLoading && !latest && (
          <div className="text-sm text-muted-foreground">尚無索引紀錄，請先點擊上方「重建 AI 索引」。</div>
        )}

        {latest && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={latest.status} />
                <span className="text-xs text-muted-foreground">
                  來源：{SOURCE_LABEL[latest.trigger_source] || latest.trigger_source}
                </span>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {fmtTime(latest.started_at)}
              </span>
            </div>

            {latest.status === 'running' && (
              <div className="space-y-1">
                <Progress value={progress} />
                <div className="text-xs text-muted-foreground">
                  已處理 {latest.indexed_chunks} / {latest.total_chunks ?? '?'} 段
                  {latest.embed_failures > 0 && `（嵌入失敗 ${latest.embed_failures} 段）`}
                </div>
              </div>
            )}

            {latest.status === 'success' && (
              <div className="text-sm text-muted-foreground">
                共索引 <span className="font-medium text-foreground">{latest.indexed_chunks}</span> 段，
                耗時 {fmtDuration(latest.duration_ms)}
                {latest.embed_failures > 0 && (
                  <span className="text-destructive">（含 {latest.embed_failures} 段嵌入失敗，已略過）</span>
                )}
              </div>
            )}

            {latest.status === 'failed' && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-sm">
                <div className="flex items-center gap-2 text-destructive font-medium">
                  <AlertCircle className="h-4 w-4" /> 索引失敗
                </div>
                <div className="mt-1 text-destructive/90 break-all whitespace-pre-wrap text-xs">
                  {latest.error_message || '未提供錯誤原因'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  已處理 {latest.indexed_chunks} 段，嵌入失敗 {latest.embed_failures} 段，耗時 {fmtDuration(latest.duration_ms)}
                </div>
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">歷史紀錄</div>
            <div className="border rounded-md divide-y">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusBadge status={r.status} compact />
                    <span className="text-muted-foreground shrink-0">{fmtTime(r.started_at)}</span>
                    <span className="text-muted-foreground truncate">
                      · {SOURCE_LABEL[r.trigger_source] || r.trigger_source}
                      {r.status === 'success' && ` · ${r.indexed_chunks} 段`}
                      {r.status === 'failed' && r.error_message && ` · ${r.error_message}`}
                    </span>
                  </div>
                  <span className="text-muted-foreground shrink-0">{fmtDuration(r.duration_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, compact }: { status: RunRow['status']; compact?: boolean }) {
  if (status === 'running') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {compact ? '進行中' : '進行中'}
      </Badge>
    );
  }
  if (status === 'success') {
    return (
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        成功
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      失敗
    </Badge>
  );
}
