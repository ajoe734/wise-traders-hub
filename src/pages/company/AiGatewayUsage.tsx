import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Coins, RefreshCw } from 'lucide-react';

interface Row {
  id: string;
  created_at: string;
  user_id: string | null;
  expert_id: string | null;
  expert_slug: string | null;
  endpoint: string;
  model: string;
  run_id: string | null;
  log_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  finish_reason: string | null;
  cost_usd: number | null;
}

interface ProfileLite {
  user_id: string;
  display_name: string | null;
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function AiGatewayUsagePage() {
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [userId, setUserId] = useState('');
  const [runOrLog, setRunOrLog] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [limit, setLimit] = useState(200);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['company', 'ai-gateway-usage', from, to, userId, runOrLog, modelFilter, limit],
    staleTime: 15_000,
    queryFn: async () => {
      let q = supabase
        .from('ai_gateway_usage_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (from) q = q.gte('created_at', `${from}T00:00:00`);
      if (to) q = q.lte('created_at', `${to}T23:59:59`);
      if (userId.trim()) q = q.eq('user_id', userId.trim());
      if (modelFilter.trim()) q = q.eq('model', modelFilter.trim());
      if (runOrLog.trim()) {
        const v = runOrLog.trim();
        q = q.or(`run_id.eq.${v},log_id.eq.${v}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const userIds = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean) as string[])),
    [data],
  );

  const { data: profiles } = useQuery({
    queryKey: ['company', 'ai-gateway-usage', 'profiles', userIds.join(',')],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      if (error) throw error;
      return (data ?? []) as ProfileLite[];
    },
  });

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    (profiles ?? []).forEach((p) => {
      if (p.display_name) m.set(p.user_id, p.display_name);
    });
    return m;
  }, [profiles]);

  const stats = useMemo(() => {
    const rows = data ?? [];
    const total = rows.length;
    const pTok = rows.reduce((s, r) => s + (r.prompt_tokens || 0), 0);
    const cTok = rows.reduce((s, r) => s + (r.completion_tokens || 0), 0);
    const cost = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
    const modelBreakdown = rows.reduce<Record<string, { calls: number; cost: number; tokens: number }>>((m, r) => {
      const k = r.model || '(unknown)';
      if (!m[k]) m[k] = { calls: 0, cost: 0, tokens: 0 };
      m[k].calls += 1;
      m[k].cost += r.cost_usd || 0;
      m[k].tokens += r.total_tokens || 0;
      return m;
    }, {});
    return { total, pTok, cTok, cost, modelBreakdown };
  }, [data]);

  return (
    <CompanyLayout>
      <SEO title="AI Gateway 費用明細 | legendflow" description="AI Gateway 請求 token / 模型 / 成本明細" path="/company/ai-gateway-usage" noindex />

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Coins className="h-5 w-5" />
          <div>
            <h1 className="text-[18px] font-medium tracking-tight">AI Gateway 費用明細</h1>
            <p className="text-[12px] text-foreground/55 mt-0.5">
              每次 AI 對話請求的模型、token 用量與估算成本（USD 為粗估，實扣以 Lovable AI Gateway 為準）
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px] font-medium">篩選</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-[11px]">起始日期</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">結束日期</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">使用者 ID (UUID)</Label>
            <Input placeholder="user_id" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">run_id 或 log_id</Label>
            <Input placeholder="貼上 UUID" value={runOrLog} onChange={(e) => setRunOrLog(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">模型</Label>
            <Input placeholder="openai/gpt-5" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">筆數上限</Label>
            <Input type="number" min={10} max={2000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 200)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatBox label="請求數" value={stats.total.toLocaleString()} />
        <StatBox label="輸入 tokens" value={stats.pTok.toLocaleString()} />
        <StatBox label="輸出 tokens" value={stats.cTok.toLocaleString()} />
        <StatBox label="估算成本 (USD)" value={`$${stats.cost.toFixed(4)}`} />
      </div>

      {Object.keys(stats.modelBreakdown).length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-medium">依模型彙總</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-foreground/55">
                    <th className="py-1.5 pr-4">模型</th>
                    <th className="py-1.5 pr-4">請求數</th>
                    <th className="py-1.5 pr-4">總 tokens</th>
                    <th className="py-1.5 pr-4">估算成本 (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.modelBreakdown)
                    .sort((a, b) => b[1].cost - a[1].cost)
                    .map(([m, v]) => (
                      <tr key={m} className="border-t border-border/40">
                        <td className="py-1.5 pr-4 font-mono">{m}</td>
                        <td className="py-1.5 pr-4">{v.calls}</td>
                        <td className="py-1.5 pr-4">{v.tokens.toLocaleString()}</td>
                        <td className="py-1.5 pr-4">${v.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px] font-medium">請求明細</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-[12px] text-foreground/55 py-8 text-center">載入中…</div>
          ) : (data ?? []).length === 0 ? (
            <div className="text-[12px] text-foreground/55 py-8 text-center">此範圍尚無資料</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-foreground/55">
                    <th className="py-1.5 pr-3">時間</th>
                    <th className="py-1.5 pr-3">使用者</th>
                    <th className="py-1.5 pr-3">專家</th>
                    <th className="py-1.5 pr-3">模型</th>
                    <th className="py-1.5 pr-3">in / out</th>
                    <th className="py-1.5 pr-3">總 tok</th>
                    <th className="py-1.5 pr-3">耗時</th>
                    <th className="py-1.5 pr-3">USD</th>
                    <th className="py-1.5 pr-3">結束</th>
                    <th className="py-1.5 pr-3">run_id</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-border/40 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="py-1.5 pr-3">
                        <div className="font-mono text-[11px] break-all">{r.user_id ?? '-'}</div>
                        {r.user_id && nameMap.get(r.user_id) && (
                          <div className="text-foreground/60">{nameMap.get(r.user_id)}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{r.expert_slug ?? '-'}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.model}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {(r.prompt_tokens ?? 0).toLocaleString()} / {(r.completion_tokens ?? 0).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3">{(r.total_tokens ?? 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-3">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(2)}s` : '-'}</td>
                      <td className="py-1.5 pr-3">{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(5)}` : '-'}</td>
                      <td className="py-1.5 pr-3">
                        {r.finish_reason ? <Badge variant="secondary" className="text-[10px]">{r.finish_reason}</Badge> : '-'}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] break-all max-w-[220px]">{r.run_id ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </CompanyLayout>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <div className="text-[11px] text-foreground/55">{label}</div>
      <div className="text-[16px] font-medium mt-0.5">{value}</div>
    </div>
  );
}
