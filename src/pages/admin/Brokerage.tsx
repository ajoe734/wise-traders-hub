import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlaidLink } from 'react-plaid-link';
import { SEO } from '@/components/SEO';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { brokerageCall, plaidRedirectUri, PLAID_LINK_TOKEN_KEY, PLAID_EXPERT_KEY } from '@/lib/plaid/brokerageApi';

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10).replace(/-/g, '/')} ${d.slice(11, 16)}`;
};
const num = (n: any, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));

const STATUS_LABEL: Record<string, string> = {
  active: '已連結', disconnect_requested: '解除中（撤銷授權重試中）', purged: '已解除並清除', revoked: '已撤銷',
};

export default function AdminBrokerage() {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const { data: expert } = useQuery({
    queryKey: ['brokerage-expert', expertSlug], enabled: !!expertSlug,
    queryFn: async () => (await supabase.from('experts').select('id, name').eq('slug', expertSlug!).maybeSingle()).data,
  });
  const expertId = expert?.id as string | undefined;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['brokerage', expertId], enabled: !!expertId,
    queryFn: async () => {
      const db = supabase as any;
      const [conns, drafts, runs] = await Promise.all([
        db.from('plaid_connections').select('id, status, institution_name, environment, last_sync_at, last_sync_status, last_error, revoke_deadline_at, purged_at, created_at').eq('expert_id', expertId).order('created_at', { ascending: false }).limit(5),
        db.from('plaid_holding_drafts').select('id, symbol, name, security_type, quantity, cost_basis, close_price, currency, as_of, review_status').eq('expert_id', expertId).order('symbol'),
        db.from('plaid_sync_runs').select('id, trigger, status, error_code, holdings_count, started_at').eq('expert_id', expertId).order('started_at', { ascending: false }).limit(5),
      ]);
      return { conns: conns.data || [], drafts: drafts.data || [], runs: runs.data || [] };
    },
  });
  const active = data?.conns.find((c: any) => c.status === 'active');
  const pending = data?.conns.find((c: any) => c.status === 'disconnect_requested');

  const run = useCallback(async (label: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(label);
    try { const r = await fn(); if (ok) toast.success(ok(r)); }
    catch (e: any) { toast.error(`${label}失敗：${e.message}`); }
    finally { setBusy(null); qc.invalidateQueries({ queryKey: ['brokerage', expertId] }); refetch(); }
  }, [expertId, qc, refetch]);

  const onSuccess = useCallback((public_token: string, metadata: any) => {
    if (!expertId) return;
    sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
    run('連結', () => brokerageCall('exchange', expertId, { public_token, institution: metadata?.institution }),
      (r) => r?.sync?.status === 'ok' ? `已連結並同步 ${r.sync.holdings_count} 筆持倉草稿` : '已連結，首次同步未完成');
  }, [expertId, run]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit: () => setLinkToken(null) });
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const startLink = () => expertId && run('開啟連結', async () => {
    const r = await brokerageCall<{ link_token: string }>('create_link_token', expertId, { redirect_uri: plaidRedirectUri() });
    sessionStorage.setItem(PLAID_LINK_TOKEN_KEY, r.link_token);
    sessionStorage.setItem(PLAID_EXPERT_KEY, expertSlug || '');
    setLinkToken(r.link_token);
  });

  const drafts = data?.drafts || [];
  const unconfirmed = drafts.filter((d: any) => d.review_status === 'draft').length;

  return (
    <AdminLayout>
      <SEO title="券商持倉 | legendflow" description="Firstrade 唯讀持倉同步" path={`/admin/${expertSlug || ''}/brokerage`} noindex />
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">券商持倉（Firstrade）</h1>
          <p className="text-sm text-muted-foreground mt-1">
            透過 Plaid 唯讀同步持倉，只有您與管理員看得到草稿；確認後再到「週記管理」發布，訂閱者才看得到。平台不取得券商密碼，也無法下單或轉帳。
          </p>
          <Badge variant="outline" className="mt-2">目前為沙盒測試環境，不會連到真實帳戶</Badge>
        </div>

        {isLoading && <div className="flex items-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />載入中...</div>}

        <Card><CardContent className="p-4 space-y-3">
          {active ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{active.institution_name || '券商帳戶'}</span>
                <Badge>{STATUS_LABEL.active}</Badge>
                {active.last_sync_status === 'failed' && <Badge variant="destructive">上次同步失敗：{active.last_error}</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">上次同步 {fmtTime(active.last_sync_at)}；美股交易日收盤後自動同步一次</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => run('同步', () => brokerageCall('sync', expertId!), (r) => r.status === 'ok' ? `已同步 ${r.holdings_count} 筆` : `同步未完成：${r.error_code || r.status}`)}>立即同步</Button>
                {active.last_sync_status === 'failed' && <Button size="sm" variant="outline" disabled={!!busy} onClick={startLink}>重新驗證</Button>}
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => {
                  if (!confirm('解除後會立即停止同步，並刪除平台保存的連線金鑰與持倉草稿。確定解除？')) return;
                  run('解除連結', () => brokerageCall('disconnect', expertId!), (r) => r.results?.every((x: any) => x.status === 'purged') ? '已解除，連線授權已撤銷並清除' : '已停止同步，撤銷授權將自動重試');
                }}>解除連結</Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {pending && <div className="text-sm">解除中：已停止同步，撤銷授權重試中（期限 {fmtTime(pending.revoke_deadline_at)}）</div>}
              <Button disabled={!!busy || !expertId || !!pending} onClick={startLink}>
                {busy === '開啟連結' || busy === '連結' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}連結 Firstrade
              </Button>
            </div>
          )}
        </CardContent></Card>

        {active && (
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">持倉草稿（{drafts.length} 筆，未確認 {unconfirmed}）</h2>
              <Button size="sm" disabled={!!busy || unconfirmed === 0} onClick={() => run('確認', () => brokerageCall('confirm_drafts', expertId!), (r) => `已確認 ${r.confirmed} 筆`)}>確認草稿</Button>
            </div>
            <p className="text-xs text-muted-foreground">確認僅代表您已核對券商數字；發布仍須到「週記管理」照既有流程送出。</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">代號</th><th className="pr-3">名稱</th><th className="pr-3 text-right">數量</th><th className="pr-3 text-right">成本</th><th className="pr-3 text-right">價格</th><th className="pr-3">日期</th><th>狀態</th></tr></thead>
                <tbody>
                  {drafts.map((d: any) => (
                    <tr key={d.id} className="border-t">
                      <td className="py-1 pr-3 font-bold">{d.symbol || '—'}</td>
                      <td className="pr-3">{d.name}</td>
                      <td className="pr-3 text-right">{num(d.quantity, 4)}</td>
                      <td className="pr-3 text-right">{num(d.cost_basis)}</td>
                      <td className="pr-3 text-right">{num(d.close_price)} {d.currency || ''}</td>
                      <td className="pr-3">{d.as_of ? String(d.as_of).replace(/-/g, '/') : '—'}</td>
                      <td>{d.review_status === 'confirmed' ? '已確認' : '草稿'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        )}

        {!!data?.runs.length && (
          <Card><CardContent className="p-4 space-y-1">
            <h2 className="font-bold">最近同步</h2>
            {data.runs.map((r: any) => (
              <div key={r.id} className="text-sm flex gap-3">
                <span>{fmtTime(r.started_at)}</span>
                <span>{r.status === 'ok' ? `成功 ${r.holdings_count} 筆` : r.status === 'blocked' ? '已停止（解除中）' : `失敗 ${r.error_code || ''}`}</span>
              </div>
            ))}
          </CardContent></Card>
        )}
      </div>
    </AdminLayout>
  );
}
