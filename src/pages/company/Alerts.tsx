import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, CheckCircle2, RefreshCw, Bell, Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AlertRow {
  id: string;
  kind: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  message: string | null;
  metric_value: number | null;
  threshold: number | null;
  detail: Record<string, unknown> | null;
  fired_at: string;
  resolved_at: string | null;
}

const KIND_LABEL: Record<string, string> = {
  checkout_failure_rate: '結帳失敗率',
  paywall_drop: 'Paywall 觸發驟降',
  function_failure_spike: '邊緣函式錯誤',
};

const LEVEL_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  warning: 'bg-amber-100 text-amber-900 border-amber-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
};

export default function CompanyAlerts() {
  const [showResolved, setShowResolved] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ['system-alerts', showResolved],
    queryFn: async () => {
      let q = supabase
        .from('system_alerts' as never)
        .select('*')
        .order('fired_at', { ascending: false })
        .limit(200);
      if (!showResolved) q = q.is('resolved_at', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AlertRow[];
    },
    refetchInterval: 60_000,
  });

  const resolve = async (id: string) => {
    await supabase
      .from('system_alerts' as never)
      .update({ resolved_at: new Date().toISOString() } as never)
      .eq('id', id);
    qc.invalidateQueries({ queryKey: ['system-alerts'] });
  };

  const runNow = async () => {
    toast({ title: '觸發守門員…' });
    const { data, error } = await supabase.functions.invoke('alerts-watchdog', { body: {} });
    if (error) toast({ title: '失敗', description: error.message, variant: 'destructive' });
    else toast({ title: '已執行', description: JSON.stringify(data).slice(0, 100) });
    refetch();
  };

  const openCount = rows.filter((r) => !r.resolved_at).length;
  const critical = rows.filter((r) => !r.resolved_at && r.level === 'critical').length;

  return (
    <CompanyLayout>
      <SEO title="即時告警｜後台監控" description="守門員每 5 分鐘自動掃描結帳失敗、Paywall 驟降、邊緣函式錯誤激增。" />
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Bell className="w-5 h-5" /> 即時告警
              {openCount > 0 && (
                <Badge className={critical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}>
                  {openCount} 待處理{critical ? `（${critical} 急）` : ''}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-foreground/60 mt-1">每 5 分鐘掃描；同類 60 分鐘內去重。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? '只看待處理' : '含已解除'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> 刷新
            </Button>
            <Button size="sm" onClick={runNow}>
              <Play className="w-4 h-4 mr-1" /> 立即執行守門員
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">最近 200 筆告警</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="text-sm text-foreground/60 py-12 text-center flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                目前無告警，系統運作正常。
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={`border rounded-lg p-3 flex items-start gap-3 ${r.resolved_at ? 'opacity-50' : ''}`}
                  >
                    <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${r.level === 'critical' ? 'text-red-600' : 'text-amber-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${LEVEL_STYLE[r.level] ?? ''}`}>
                          {r.level.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-foreground/60 font-mono">
                          {KIND_LABEL[r.kind] ?? r.kind}
                        </span>
                        <span className="text-[10px] text-foreground/50">
                          {new Date(r.fired_at).toLocaleString('zh-TW', { hour12: false })}
                        </span>
                      </div>
                      <div className="text-sm font-semibold mt-1">{r.title}</div>
                      {r.message && <div className="text-xs text-foreground/70 mt-0.5">{r.message}</div>}
                      {r.detail && Object.keys(r.detail).length > 0 && (
                        <pre className="text-[10px] text-foreground/50 mt-1 font-mono whitespace-pre-wrap">
                          {JSON.stringify(r.detail, null, 0)}
                        </pre>
                      )}
                    </div>
                    {!r.resolved_at && (
                      <Button size="sm" variant="outline" onClick={() => resolve(r.id)}>
                        標記解除
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
