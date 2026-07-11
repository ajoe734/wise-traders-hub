// 追蹤鏈明細頁
//
// URL：/company/stream-health/trace?id=<correlationId|requestId>
// 撈 function_run_logs 中所有滿足下列任一條件的紀錄：
//   - run_id = id
//   - payload->>correlationId = id
//   - payload->>requestId = id
// 涵蓋 stream-metrics-report、alerts-watchdog、expert-ai-chat 等所有 fn，
// 依 created_at 由舊到新排序，讓同一條追蹤鏈的告警與報表可一次看完。
import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, RefreshCw, Link2 } from 'lucide-react';

interface LogRow {
  id: string;
  created_at: string;
  fn: string;
  run_id: string;
  level: string | null;
  stage: string | null;
  msg: string | null;
  expert_id: string | null;
  signal_id: string | null;
  payload: Record<string, any> | null;
}

const levelVariant = (l?: string | null) => {
  switch ((l ?? '').toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'destructive' as const;
    case 'warn':
    case 'warning':
      return 'secondary' as const;
    default:
      return 'outline' as const;
  }
};

export default function StreamHealthTrace() {
  const [params, setParams] = useSearchParams();
  const id = (params.get('id') ?? '').trim();
  const [input, setInput] = useState(id);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ['stream-health-trace', id],
    enabled: id.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      // 三條 OR 條件：run_id / payload.correlationId / payload.requestId
      // PostgREST 需把值放進 or() 字串；避免特殊字元用單引號包起來。
      const safe = id.replace(/[",()]/g, '');
      const { data, error } = await supabase
        .from('function_run_logs')
        .select('id,created_at,fn,run_id,level,stage,msg,expert_id,signal_id,payload')
        .or(
          [
            `run_id.eq.${safe}`,
            `payload->>correlationId.eq.${safe}`,
            `payload->>requestId.eq.${safe}`,
          ].join(','),
        )
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });

  const rows = data ?? [];

  const summary = useMemo(() => {
    const fns = new Map<string, number>();
    const levels = new Map<string, number>();
    let firstAt: string | null = null;
    let lastAt: string | null = null;
    for (const r of rows) {
      fns.set(r.fn, (fns.get(r.fn) ?? 0) + 1);
      const lv = (r.level ?? 'info').toLowerCase();
      levels.set(lv, (levels.get(lv) ?? 0) + 1);
      if (!firstAt || r.created_at < firstAt) firstAt = r.created_at;
      if (!lastAt || r.created_at > lastAt) lastAt = r.created_at;
    }
    const spanMs =
      firstAt && lastAt ? new Date(lastAt).getTime() - new Date(firstAt).getTime() : 0;
    return { fns, levels, firstAt, lastAt, spanMs };
  }, [rows]);

  const applyId = () => {
    const v = input.trim();
    setParams(v ? { id: v } : {});
  };

  return (
    <CompanyLayout>
      <SEO
        title="追蹤鏈明細 | legendflow"
        description="依 correlationId / requestId 檢視同一條鏈路的所有函數紀錄"
        path="/company/stream-health/trace"
        noindex
      />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/company/stream-health">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-[18px] font-medium tracking-tight flex items-center gap-2">
              <Link2 className="h-4 w-4" /> 追蹤鏈明細
            </h1>
            <p className="text-[12px] text-foreground/55 mt-0.5">
              以 correlationId 或 requestId 串起同一次請求的所有 function_run_logs 紀錄
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching || !id}
        >
          <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">追蹤鍵</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <Label className="text-[11px]">correlationId 或 requestId</Label>
            <Input
              className="mt-1 h-8"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyId();
              }}
              placeholder="貼上 correlationId / requestId / run_id"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={applyId} disabled={!input.trim()}>
              查詢
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setInput('');
                setParams({});
              }}
            >
              清除
            </Button>
          </div>
        </CardContent>
      </Card>

      {!id && (
        <Card>
          <CardContent className="py-10 text-center text-[13px] text-foreground/55">
            輸入 correlationId / requestId 後開始查詢，或從
            <Link to="/company/stream-health" className="underline mx-1">
              串流健康度
            </Link>
            列表點入。
          </CardContent>
        </Card>
      )}

      {id && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="總筆數" value={String(rows.length)} sub="function_run_logs" />
            <SummaryCard
              label="fn 分佈"
              value={
                summary.fns.size === 0
                  ? '—'
                  : Array.from(summary.fns.entries())
                      .map(([k, v]) => `${k}×${v}`)
                      .join(' / ')
              }
              sub="每個函數出現次數"
            />
            <SummaryCard
              label="level 分佈"
              value={
                summary.levels.size === 0
                  ? '—'
                  : Array.from(summary.levels.entries())
                      .map(([k, v]) => `${k}×${v}`)
                      .join(' / ')
              }
              sub="info / warn / error"
            />
            <SummaryCard
              label="時間跨度"
              value={summary.spanMs ? `${summary.spanMs} ms` : '—'}
              sub={
                summary.firstAt && summary.lastAt
                  ? `${new Date(summary.firstAt).toLocaleTimeString('zh-TW', { hour12: false })} → ${new Date(summary.lastAt).toLocaleTimeString('zh-TW', { hour12: false })}`
                  : ''
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-[14px] font-medium">
                時間序列（最多 500 筆，由舊到新）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="text-[12px] text-destructive mb-3">
                  查詢失敗：{(error as Error).message}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-foreground/55 border-b border-foreground/10">
                      <th className="py-2 pr-3">時間</th>
                      <th className="py-2 pr-3">fn</th>
                      <th className="py-2 pr-3">level</th>
                      <th className="py-2 pr-3">stage</th>
                      <th className="py-2 pr-3">msg</th>
                      <th className="py-2 pr-3">run_id</th>
                      <th className="py-2 pr-3">payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-foreground/5 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-foreground/70">
                          {new Date(r.created_at).toLocaleString('zh-TW', { hour12: false })}
                        </td>
                        <td className="py-2 pr-3 font-mono">{r.fn}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={levelVariant(r.level)}>{r.level ?? 'info'}</Badge>
                        </td>
                        <td className="py-2 pr-3 font-mono text-[11px] text-foreground/70">
                          {r.stage ?? '—'}
                        </td>
                        <td
                          className="py-2 pr-3 truncate max-w-[260px]"
                          title={r.msg ?? ''}
                        >
                          {r.msg ?? '—'}
                        </td>
                        <td
                          className="py-2 pr-3 font-mono text-[11px] text-foreground/60 truncate max-w-[160px]"
                          title={r.run_id}
                        >
                          {r.run_id}
                        </td>
                        <td className="py-2 pr-3">
                          <details>
                            <summary className="cursor-pointer text-foreground/60 text-[11px]">
                              展開
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-foreground/70 bg-foreground/[0.03] p-2 rounded max-w-[520px]">
                              {JSON.stringify(r.payload, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && !isFetching && (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-8 text-center text-foreground/50"
                        >
                          查無紀錄。確認 id 是 correlationId / requestId / run_id，且在保留窗內。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </CompanyLayout>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] text-foreground/55">{label}</div>
        <div className="text-[15px] font-medium tracking-tight mt-1 break-all">{value}</div>
        {sub && <div className="text-[11px] text-foreground/45 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
