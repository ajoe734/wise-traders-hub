import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Shield, RefreshCw, Check, X } from 'lucide-react';

interface Row {
  id: string;
  user_id: string | null;
  expert_id: string | null;
  expert_slug: string | null;
  decision: 'allowed' | 'denied';
  rule: string;
  subscription_status: string | null;
  plan_id: string | null;
  plan_type: string | null;
  quota_used: number | null;
  quota_limit: number | null;
  meta: any;
  created_at: string;
}

const RULE_LABEL: Record<string, string> = {
  own_expert: '本人專家',
  company_admin: '公司管理員',
  active_subscription: '有效訂閱',
  no_active_subscription: '未訂閱',
  quota_exceeded: '配額超限',
  expert_not_found: '找不到專家',
};

const SUB_LABEL: Record<string, string> = {
  active: '有效',
  expired: '已過期',
  canceled: '已取消',
  none: '從未訂閱',
  exempt_admin: '管理員豁免',
  exempt_owner: '本人豁免',
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export default function ExpertAiAccessLogsPage() {
  const [decision, setDecision] = useState<'all' | 'allowed' | 'denied'>('all');
  const [slug, setSlug] = useState('');
  const [limit, setLimit] = useState(100);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['company', 'expert-ai-access-logs', decision, slug, limit],
    staleTime: 15_000,
    queryFn: async () => {
      let q = supabase
        .from('expert_ai_access_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (decision !== 'all') q = q.eq('decision', decision);
      if (slug.trim()) q = q.eq('expert_slug', slug.trim());
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    const allowed = rows.filter((r) => r.decision === 'allowed').length;
    const denied = rows.length - allowed;
    const ruleCounts = rows.reduce<Record<string, number>>((m, r) => {
      m[r.rule] = (m[r.rule] || 0) + 1;
      return m;
    }, {});
    return { total: rows.length, allowed, denied, ruleCounts };
  }, [data]);

  return (
    <CompanyLayout>
      <SEO title="AI 對話存取日誌 | legendflow" description="expert-ai-chat 存取決策日誌" path="/company/expert-ai-access-logs" noindex />

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5" />
          <div>
            <h1 className="text-[18px] font-medium tracking-tight">AI 對話存取日誌</h1>
            <p className="text-[12px] text-foreground/55 mt-0.5">
              expert-ai-chat 每次呼叫的存取決策與命中規則（保留 30 天）
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="總筆數" value={stats.total.toString()} />
        <SummaryCard label="允許" value={stats.allowed.toString()} tone="text-success" />
        <SummaryCard label="拒絕" value={stats.denied.toString()} tone="text-destructive" />
        <SummaryCard
          label="拒絕率"
          value={stats.total > 0 ? `${Math.round((stats.denied / stats.total) * 100)}%` : '—'}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {(['all', 'allowed', 'denied'] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={decision === d ? 'default' : 'outline'}
                onClick={() => setDecision(d)}
              >
                {d === 'all' ? '全部' : d === 'allowed' ? '允許' : '拒絕'}
              </Button>
            ))}
          </div>
          <Input
            placeholder="依 expert slug 篩選"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="max-w-[200px]"
          />
          <div className="flex items-center gap-1 ml-auto">
            {[100, 300, 1000].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={limit === n ? 'default' : 'outline'}
                onClick={() => setLimit(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">最新紀錄</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-foreground/55 border-b border-foreground/10">
                  <th className="py-2 pr-3">時間</th>
                  <th className="py-2 pr-3">決策</th>
                  <th className="py-2 pr-3">命中規則</th>
                  <th className="py-2 pr-3">Expert slug</th>
                  <th className="py-2 pr-3">訂閱狀態</th>
                  <th className="py-2 pr-3">方案</th>
                  <th className="py-2 pr-3">配額</th>
                  <th className="py-2">User ID</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="py-6 text-center text-foreground/50">載入中…</td></tr>
                )}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-foreground/50">尚無紀錄</td></tr>
                )}
                {(data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-3 tabular-nums text-[12px] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="py-2 pr-3">
                      {r.decision === 'allowed' ? (
                        <Badge className="bg-success/10 text-success gap-1 border border-success/20"><Check className="h-3 w-3" />允許</Badge>
                      ) : (
                        <Badge className="bg-destructive/10 text-destructive gap-1 border border-destructive/20"><X className="h-3 w-3" />拒絕</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-[11px]">{RULE_LABEL[r.rule] ?? r.rule}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-[12px]">{r.expert_slug ?? '—'}</td>
                    <td className="py-2 pr-3 text-[12px] text-foreground/70">{r.subscription_status ? (SUB_LABEL[r.subscription_status] ?? r.subscription_status) : '—'}</td>
                    <td className="py-2 pr-3 text-[12px] text-foreground/70">{r.plan_type ?? '—'}</td>
                    <td className="py-2 pr-3 tabular-nums text-[12px]">
                      {r.quota_limit == null ? '—' : `${r.quota_used ?? 0}/${r.quota_limit}`}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-foreground/50 truncate max-w-[220px]" title={r.user_id ?? ''}>{r.user_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.keys(stats.ruleCounts).length > 0 && (
            <div className="mt-4 pt-4 border-t border-foreground/10 flex flex-wrap gap-2">
              <span className="text-[11px] text-foreground/55 self-center">規則分布：</span>
              {Object.entries(stats.ruleCounts).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[11px]">
                  {RULE_LABEL[k] ?? k}：{v}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </CompanyLayout>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] text-foreground/55">{label}</div>
        <div className={`text-[22px] font-medium tracking-tight mt-1 tabular-nums ${tone ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
