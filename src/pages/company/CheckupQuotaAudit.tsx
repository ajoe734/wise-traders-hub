import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatTaipeiYMD, formatTaipeiYMDHM, formatTaipeiYMDHMWithFallback } from '@/checkup/utils/formatTaipeiDate';
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

interface UsageRow { id: string; kind: string; used_at: string; }
interface SubRow {
  id: string; plan_id: string; status: string; billing_cycle: string | null;
  started_at: string; expires_at: string | null; auto_renew: boolean; canceled_at: string | null;
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

interface ListRow {
  usage_id: string;
  user_id: string;
  display_name: string | null;
  is_tester: boolean;
  line_user_id: string | null;
  kind: string;
  used_at: string;
  tier: string;
  period: string | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  last_used_at: string | null;
  reason: string;
  billing_cycle: string | null;
  plan_id: string | null;
}

interface ListResp {
  rows: ListRow[];
  total: number;
  returned: number;
  page: number;
  page_size: number;
  total_pages: number;
  filters: Record<string, unknown>;
  fetched_at: string;
}

const TIER_OPTIONS = ['', 'line_free', 'none', 'basic', 'pro'];
const REASON_OPTIONS = ['', 'line_free_gift', 'subscription', 'tester', 'none'];

async function callAudit(params: URLSearchParams) {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkup-quota-audit?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json;
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename: string, header: string[], rows: (unknown[])[]) {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CheckupQuotaAudit() {
  // ---- single mode ----
  const [userIdInput, setUserIdInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [singleData, setSingleData] = useState<AuditResp | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleErr, setSingleErr] = useState<string | null>(null);

  async function lookup() {
    setSingleLoading(true); setSingleErr(null); setSingleData(null);
    try {
      const params = new URLSearchParams({ mode: 'single', limit: '200' });
      if (userIdInput.trim()) params.set('user_id', userIdInput.trim());
      else if (emailInput.trim()) params.set('email', emailInput.trim());
      else { setSingleErr('請輸入 user_id 或 email'); return; }
      setSingleData(await callAudit(params));
    } catch (e: any) { setSingleErr(e?.message || String(e)); }
    finally { setSingleLoading(false); }
  }

  function exportSingleCSV() {
    if (!singleData) return;
    const meta = singleData;
    const rows = meta.usage.map((u, i) => [
      i + 1,
      meta.target_user_id,
      meta.profile?.display_name || '',
      meta.quota?.tier || '',
      meta.reason,
      u.kind,
      formatTaipeiYMDHMWithFallback(u.used_at),
      meta.quota?.used ?? '',
      meta.quota?.limit ?? '',
      meta.quota?.remaining ?? '',
      formatTaipeiYMDHMWithFallback(meta.quota?.last_used_at),
    ]);
    downloadCSV(
      `quota-audit-${meta.target_user_id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['#', 'user_id', 'display_name', 'tier', 'reason', 'kind', 'used_at(Asia/Taipei)', 'used', 'limit', 'remaining', 'last_used_at'],
      rows,
    );
  }

  // ---- list mode ----
  const [tier, setTier] = useState('');
  const [reason, setReason] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [listData, setListData] = useState<ListResp | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  async function runList(targetPage: number = page) {
    setListLoading(true); setListErr(null);
    try {
      const params = new URLSearchParams({
        mode: 'list',
        page: String(targetPage),
        page_size: String(pageSize),
      });
      if (tier) params.set('tier', tier);
      if (reason) params.set('reason', reason);
      if (dateFrom) params.set('date_from', new Date(dateFrom).toISOString());
      if (dateTo) {
        // include the full end day (Asia/Taipei local end-of-day → UTC)
        const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
        params.set('date_to', end.toISOString());
      }
      const resp: ListResp = await callAudit(params);
      setListData(resp);
      setPage(resp.page || targetPage);
    } catch (e: any) { setListErr(e?.message || String(e)); }
    finally { setListLoading(false); }
  }

  function applyFilters() {
    setPage(1);
    void runList(1);
  }

  function exportListCSV() {
    if (!listData) return;
    const rows = listData.rows.map((r, i) => [
      (listData.page - 1) * listData.page_size + i + 1,
      r.user_id,
      r.display_name || '',
      r.is_tester ? 'Y' : '',
      r.line_user_id || '',
      r.tier,
      r.reason,
      r.billing_cycle || '',
      r.plan_id || '',
      r.kind,
      formatTaipeiYMDHMWithFallback(r.used_at),
      r.used ?? '',
      r.limit ?? '',
      r.remaining ?? '',
      formatTaipeiYMDHMWithFallback(r.last_used_at),
    ]);
    downloadCSV(
      `quota-audit-list-${new Date().toISOString().slice(0, 10)}.csv`,
      ['#', 'user_id', 'display_name', 'is_tester', 'line_user_id',
        'tier', 'reason', 'billing_cycle', 'plan_id',
        'kind', 'used_at(Asia/Taipei)', 'used', 'limit', 'remaining', 'last_used_at'],
      rows,
    );
  }

  // ---- LINE quota reset ----
  const [resetLineId, setResetLineId] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);

  async function resetLineQuota(targetLineId?: string) {
    const lid = (targetLineId ?? resetLineId).trim();
    if (!lid) { setResetErr('請輸入 LINE userId（U 開頭）'); setResetMsg(null); return; }
    if (!confirm(`確定要重置 ${lid} 的免費收盤分析額度？\n（清除非 brain-update 的 checkup_usage 紀錄）`)) return;
    setResetLoading(true); setResetErr(null); setResetMsg(null);
    try {
      const { data, error } = await supabase.rpc('admin_reset_line_free_quota', { _line_user_id: lid });
      if (error) throw error;
      const d: any = data || {};
      setResetMsg(
        `✅ 已重置 user=${(d.user_id || '').slice(0,8)}… 刪除 ${d.deleted_count} 筆 usage`
        + `（重置前 used=${d.before?.used ?? '?'} / limit=${d.before?.limit ?? '?'}，`
        + `重置後 used=${d.after?.used ?? '?'} / remaining=${d.after?.remaining ?? '?'}）`
      );
      // Refresh single-mode view if same user is loaded
      if (singleData?.profile?.line_user_id === lid) void lookup();
    } catch (e: any) {
      setResetErr(e?.message || String(e));
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SEO title="健檢配額稽核" description="查詢用戶配額、扣次紀錄與訂閱來源" />
      <h1 className="text-2xl font-medium mb-2">健檢配額稽核</h1>
      <p className="text-sm text-muted-foreground mb-6">
        單筆查詢追蹤特定用戶；批次稽核可依 tier、扣費原因、日期區間篩選並匯出 CSV。
      </p>

      {/* ===== LINE 免費額度一鍵重置 ===== */}
      <section className="border rounded-lg p-4 mb-8 bg-card">
        <h2 className="text-base font-medium mb-2">LINE 免費收盤分析重置</h2>
        <p className="text-xs text-muted-foreground mb-3">
          針對指定 LINE userId，清除 checkup_usage（保留 brain-update 類），重新給 1 次免費額度。操作會寫入 audit_logs。
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[280px]">
            <label className="text-xs text-muted-foreground block mb-1">LINE userId</label>
            <input
              value={resetLineId}
              onChange={(e) => setResetLineId(e.target.value)}
              placeholder="U0123456789abcdef..."
              className="w-full px-3 py-2 border rounded text-sm font-mono"
            />
          </div>
          <button
            onClick={() => resetLineQuota()}
            disabled={resetLoading}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded text-sm font-medium disabled:opacity-50"
          >
            {resetLoading ? '處理中…' : '一鍵重置'}
          </button>
        </div>
        {resetErr && (
          <div className="mt-3 p-2 border border-destructive/40 bg-destructive/10 text-destructive text-xs rounded">
            {resetErr}
          </div>
        )}
        {resetMsg && (
          <div className="mt-3 p-2 border border-emerald-500/40 bg-emerald-50 text-emerald-800 text-xs rounded">
            {resetMsg}
          </div>
        )}
      </section>



      {/* ===== 批次稽核 ===== */}
      <section className="border rounded-lg p-4 mb-8 bg-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-medium">批次稽核（依篩選條件）</h2>
          <button
            onClick={exportListCSV}
            disabled={!listData || listData.rows.length === 0}
            className="px-3 py-1.5 border rounded text-xs disabled:opacity-40"
            title="僅匯出目前頁，請逐頁下載或調大每頁筆數"
          >
            下載目前頁 CSV（{listData?.rows.length ?? 0} 筆）
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <Lbl label="Tier">
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm">
              {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t || '全部'}</option>)}
            </select>
          </Lbl>
          <Lbl label="扣費原因">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm">
              {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r || '全部'}</option>)}
            </select>
          </Lbl>
          <Lbl label="起始日">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm" />
          </Lbl>
          <Lbl label="結束日">
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm" />
          </Lbl>
          <Lbl label="每頁筆數">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || 50)}
              className="w-full px-2 py-1.5 border rounded text-sm"
            >
              {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Lbl>
          <button
            onClick={applyFilters}
            disabled={listLoading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
          >
            {listLoading ? '查詢中…' : '套用篩選'}
          </button>
        </div>

        {listErr && (
          <div className="mt-3 p-3 border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded">
            {listErr}
          </div>
        )}

        {listData && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs text-muted-foreground">
                共符合 {listData.total} 筆，第 {listData.page} / {listData.total_pages || 1} 頁，本頁 {listData.rows.length} 筆（tier/reason 過濾後）
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => runList(Math.max(1, listData.page - 1))}
                  disabled={listLoading || listData.page <= 1}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-40"
                  aria-label="上一頁"
                >上一頁</button>
                <button
                  onClick={() => runList(listData.page + 1)}
                  disabled={listLoading || listData.page >= (listData.total_pages || 1)}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-40"
                  aria-label="下一頁"
                >下一頁</button>
              </div>
            </div>
            {listData.rows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">無符合條件的紀錄</div>
            ) : (
              <div className="overflow-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-left px-2 py-1.5">用戶</th>
                      <th className="text-left px-2 py-1.5">Tier</th>
                      <th className="text-left px-2 py-1.5">扣費原因</th>
                      <th className="text-left px-2 py-1.5">週期/Plan</th>
                      <th className="text-left px-2 py-1.5">Kind</th>
                      <th className="text-left px-2 py-1.5">扣次時間</th>
                      <th className="text-left px-2 py-1.5">Used/Limit</th>
                      <th className="text-left px-2 py-1.5">Last Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listData.rows.map((r) => (
                      <tr key={r.usage_id} className="border-t">
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{r.display_name || '—'}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{r.user_id.slice(0, 8)}…</div>
                        </td>
                        <td className="px-2 py-1.5"><strong>{r.tier}</strong>{r.is_tester && <span className="ml-1 text-[10px] text-muted-foreground">(tester)</span>}</td>
                        <td className="px-2 py-1.5"><code className="text-[11px]">{r.reason}</code></td>
                        <td className="px-2 py-1.5">{r.billing_cycle || '—'}</td>
                        <td className="px-2 py-1.5"><code className="text-[11px]">{r.kind}</code></td>
                        <td className="px-2 py-1.5 font-mono">{formatTaipeiYMDHMWithFallback(r.used_at)}</td>
                        <td className="px-2 py-1.5">{r.used ?? '?'}/{r.limit ?? '?'}</td>
                        <td className="px-2 py-1.5 font-mono">{formatTaipeiYMDHMWithFallback(r.last_used_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== 單筆查詢 ===== */}
      <section className="border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-medium">單筆查詢</h2>
          <button
            onClick={exportSingleCSV}
            disabled={!singleData}
            className="px-3 py-1.5 border rounded text-xs disabled:opacity-40"
          >
            下載 CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="flex-1 min-w-[260px]">
            <label className="text-xs text-muted-foreground block mb-1">User ID (UUID)</label>
            <input value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)}
              placeholder="00000000-…" className="w-full px-3 py-2 border rounded text-sm font-mono" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground block mb-1">或 Email</label>
            <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
              placeholder="user@example.com" className="w-full px-3 py-2 border rounded text-sm" />
          </div>
          <button onClick={lookup} disabled={singleLoading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50">
            {singleLoading ? '查詢中…' : '查詢'}
          </button>
        </div>

        {singleErr && (
          <div className="p-3 mb-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded">
            {singleErr}
          </div>
        )}

        {singleData && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-medium mb-2 text-muted-foreground tracking-wider">配額快照</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Field label="User ID" value={<span className="font-mono text-xs">{singleData.target_user_id}</span>} />
                <Field label="顯示名稱" value={singleData.profile?.display_name || '—'} />
                <Field label="Tester" value={singleData.profile?.is_tester ? '是' : '否'} />
                <Field label="LINE ID" value={
                  singleData.profile?.line_user_id ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono text-xs">{singleData.profile.line_user_id}</span>
                      <button
                        onClick={() => resetLineQuota(singleData.profile!.line_user_id!)}
                        disabled={resetLoading}
                        className="px-2 py-0.5 text-[11px] border border-destructive/40 text-destructive rounded hover:bg-destructive/10 disabled:opacity-40"
                        title="清除 checkup_usage（非 brain-update），重新給 1 次免費額度"
                      >重置免費額度</button>
                    </span>
                  ) : '—'
                } />
                <Field label="Tier" value={<strong>{singleData.quota?.tier || 'n/a'}</strong>} />
                <Field label="Period" value={singleData.quota?.period || 'n/a'} />
                <Field label="Used / Limit" value={`${singleData.quota?.used ?? '?'} / ${singleData.quota?.limit ?? '?'}`} />
                <Field label="Remaining" value={String(singleData.quota?.remaining ?? '?')} />
                <Field label="Last Used At" value={formatTaipeiYMDHM(singleData.quota?.last_used_at) || '尚未使用'} />
                <Field label="Resets At" value={
                  singleData.quota?.resets_at === 'infinity' || !singleData.quota?.resets_at
                    ? '—' : formatTaipeiYMDHM(singleData.quota.resets_at)
                } />
                <Field label="扣費原因" value={<code className="text-xs">{singleData.reason}</code>} />
                <Field label="抓取時間" value={formatTaipeiYMDHM(singleData.fetched_at)} />
              </div>
            </div>

            <div>
              <h3 className="text-xs font-medium mb-2 text-muted-foreground tracking-wider">
                訂閱來源（最近 {singleData.subscriptions.length} 筆）
              </h3>
              {singleData.subscriptions.length === 0 ? (
                <div className="text-sm text-muted-foreground">無訂閱紀錄</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2">Plan</th><th className="text-left">狀態</th>
                      <th className="text-left">週期</th><th className="text-left">起算</th>
                      <th className="text-left">到期</th><th className="text-left">取消</th>
                    </tr>
                  </thead>
                  <tbody>
                    {singleData.subscriptions.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{s.plan_id.slice(0, 8)}…</td>
                        <td>{s.status}</td><td>{s.billing_cycle || '—'}</td>
                        <td>{formatTaipeiYMD(s.started_at)}</td>
                        <td>{formatTaipeiYMD(s.expires_at) || '—'}</td>
                        <td>{formatTaipeiYMD(s.canceled_at) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="text-xs font-medium mb-2 text-muted-foreground tracking-wider">
                扣次紀錄（最近 {singleData.usage.length} 筆）
              </h3>
              {singleData.usage.length === 0 ? (
                <div className="text-sm text-muted-foreground">尚未使用</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2">#</th><th className="text-left">Kind</th>
                      <th className="text-left">使用時間（Asia/Taipei）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {singleData.usage.map((u, i) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-2 text-muted-foreground">{i + 1}</td>
                        <td><code className="text-xs">{u.kind}</code></td>
                        <td className="font-mono text-xs">{formatTaipeiYMDHM(u.used_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </section>
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

function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
