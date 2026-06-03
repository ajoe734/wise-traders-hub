import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatTaipeiYMD, formatTaipeiYMDHM } from '@/checkup/utils/formatTaipeiDate';
import SEO from '@/components/SEO';

interface QuotaSnapshot {
  tier: string;
  period: string;
  limit: number;
  used: number;
  remaining: number;
  resets_at: string | null;
  last_used_at: string | null;
}

interface UsageRow {
  id: string;
  kind: string;
  used_at: string;
}

interface SubRow {
  id: string;
  plan_id: string;
  status: string;
  billing_cycle: string | null;
  started_at: string;
  expires_at: string | null;
  auto_renew: boolean;
  canceled_at: string | null;
}

interface AuditResp {
  target_user_id: string;
  profile: { user_id: string; display_name: string | null; is_tester: boolean; line_user_id: string | null } | null;
  quota: QuotaSnapshot | null;
  reason: string;
  usage: UsageRow[];
  subscriptions: SubRow[];
  fetched_at: string;
}

export default function CheckupQuotaAudit() {
  const [userIdInput, setUserIdInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [data, setData] = useState<AuditResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams();
      if (userIdInput.trim()) params.set('user_id', userIdInput.trim());
      else if (emailInput.trim()) params.set('email', emailInput.trim());
      else {
        setError('請輸入 user_id 或 email');
        setLoading(false);
        return;
      }
      params.set('limit', '200');
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkup-quota-audit?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.message || json?.error || `HTTP ${res.status}`);
      } else {
        setData(json);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <SEO title="健檢配額稽核" description="查詢用戶配額、扣次紀錄與訂閱來源" />
      <h1 className="text-2xl font-medium mb-2">健檢配額稽核</h1>
      <p className="text-sm text-muted-foreground mb-6">
        追蹤每位用戶的 tier、last_used_at、used 次數與扣費原因（line_free_gift / subscription / tester）。
      </p>

      <div className="flex flex-wrap gap-3 items-end mb-6 p-4 border rounded-lg bg-card">
        <div className="flex-1 min-w-[260px]">
          <label className="text-xs text-muted-foreground block mb-1">User ID (UUID)</label>
          <input
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full px-3 py-2 border rounded text-sm font-mono"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground block mb-1">或 Email</label>
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="user@example.com"
            className="w-full px-3 py-2 border rounded text-sm"
          />
        </div>
        <button
          onClick={lookup}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
        >
          {loading ? '查詢中…' : '查詢'}
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Profile + Quota 快照 */}
          <section className="border rounded-lg p-4">
            <h2 className="text-sm font-medium mb-3 text-muted-foreground tracking-wider">配額快照</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Field label="User ID" value={<span className="font-mono text-xs">{data.target_user_id}</span>} />
              <Field label="顯示名稱" value={data.profile?.display_name || '—'} />
              <Field label="Tester" value={data.profile?.is_tester ? '是' : '否'} />
              <Field label="LINE ID" value={data.profile?.line_user_id || '—'} />
              <Field label="Tier" value={<strong>{data.quota?.tier || 'n/a'}</strong>} />
              <Field label="Period" value={data.quota?.period || 'n/a'} />
              <Field label="Used / Limit" value={`${data.quota?.used ?? '?'} / ${data.quota?.limit ?? '?'}`} />
              <Field label="Remaining" value={String(data.quota?.remaining ?? '?')} />
              <Field label="Last Used At" value={formatTaipeiYMDHM(data.quota?.last_used_at) || '尚未使用'} />
              <Field label="Resets At" value={
                data.quota?.resets_at === 'infinity' || !data.quota?.resets_at
                  ? '—'
                  : formatTaipeiYMDHM(data.quota.resets_at)
              } />
              <Field label="扣費原因" value={<code className="text-xs">{data.reason}</code>} />
              <Field label="抓取時間" value={formatTaipeiYMDHM(data.fetched_at)} />
            </div>
          </section>

          {/* 訂閱 */}
          <section className="border rounded-lg p-4">
            <h2 className="text-sm font-medium mb-3 text-muted-foreground tracking-wider">
              訂閱來源（最近 {data.subscriptions.length} 筆）
            </h2>
            {data.subscriptions.length === 0 ? (
              <div className="text-sm text-muted-foreground">無訂閱紀錄</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Plan</th>
                    <th className="text-left">狀態</th>
                    <th className="text-left">週期</th>
                    <th className="text-left">起算</th>
                    <th className="text-left">到期</th>
                    <th className="text-left">取消</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">{s.plan_id.slice(0, 8)}…</td>
                      <td>{s.status}</td>
                      <td>{s.billing_cycle || '—'}</td>
                      <td>{formatTaipeiYMD(s.started_at)}</td>
                      <td>{formatTaipeiYMD(s.expires_at) || '—'}</td>
                      <td>{formatTaipeiYMD(s.canceled_at) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 扣次紀錄 */}
          <section className="border rounded-lg p-4">
            <h2 className="text-sm font-medium mb-3 text-muted-foreground tracking-wider">
              扣次紀錄（最近 {data.usage.length} 筆）
            </h2>
            {data.usage.length === 0 ? (
              <div className="text-sm text-muted-foreground">尚未使用</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">#</th>
                    <th className="text-left">Kind</th>
                    <th className="text-left">使用時間（Asia/Taipei）</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usage.map((u, i) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td><code className="text-xs">{u.kind}</code></td>
                      <td className="font-mono text-xs">{formatTaipeiYMDHM(u.used_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div>{value}</div>
    </div>
  );
}
