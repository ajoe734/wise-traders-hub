import { SEO } from '@/components/SEO';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { Search, Users, UserCheck, UserX, RefreshCw, Download, Stethoscope, MessageCircle, History, Eye, Link2, Bell } from 'lucide-react';
import { useUserIdentities, formatIdentitySecondary } from '@/hooks/useUserIdentities';
import { formatTaipeiYMD } from '@/checkup/utils/formatTaipeiDate';
import { LinePushDialog } from '@/components/company/LinePushDialog';
import { PlatformNotifyDialog } from '@/components/company/PlatformNotifyDialog';
import { AdminForceMergeDialog } from '@/components/company/AdminForceMergeDialog';
import { launchViewAs } from '@/lib/viewAsLauncher';

type Row = {
  id: string;
  user_id: string;
  kind: 'expert' | 'checkup';
  plan_name: string;
  expert_name?: string | null;
  status: string;
  auto_renew: boolean;
  started_at: string;
  expires_at: string | null;
};

const CompanySubscribers = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'expert' | 'checkup'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [pushOpen, setPushOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState<{ user_id: string; display_name?: string } | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{ userId: string; label: string } | null>(null);


  const { data, isFetching } = useQuery({
    queryKey: ['company', 'subscribers'],
    queryFn: async () => {
      const [eRes, cRes] = await Promise.all([
        supabase.from('member_subscriptions')
          .select('*, expert_plans(name, experts(name))')
          .order('created_at', { ascending: false }),
        supabase.from('checkup_subscriptions')
          .select('*, checkup_plans(name)')
          .order('created_at', { ascending: false }),
      ]);
      const expertRows: Row[] = (eRes.data || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        kind: 'expert',
        plan_name: s.expert_plans?.name || '-',
        expert_name: s.expert_plans?.experts?.name || null,
        status: s.status,
        auto_renew: !!s.auto_renew,
        started_at: s.started_at,
        expires_at: s.expires_at,
      }));
      const checkupRows: Row[] = (cRes.data || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        kind: 'checkup',
        plan_name: s.checkup_plans?.name || '健檢方案',
        status: s.status,
        auto_renew: !!s.auto_renew,
        started_at: s.started_at,
        expires_at: s.expires_at,
      }));
      const merged = [...expertRows, ...checkupRows].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      );
      return { rows: merged };
    },
    staleTime: 30_000,
  });
  const rows = data?.rows ?? [];
  const userIds = useMemo(() => [...new Set(rows.map((r) => r.user_id).filter(Boolean))], [rows]);
  const { identities } = useUserIdentities(userIds);
  const loading = isFetching && !data;

  const nowMs = Date.now();
  const isLive = (s: Row) => s.status === 'active' && (!s.expires_at || new Date(s.expires_at).getTime() > nowMs);
  const activeCount = rows.filter(isLive).length;
  const totalCount = rows.filter(s => s.status !== 'canceled').length;
  const expiredCount = rows.filter(s => s.status === 'expired').length;
  const canceledCount = rows.filter(s => s.status === 'canceled').length;

  const getRemainingDays = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const filtered = rows.filter(s => {
    if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    if (!search) return matchStatus;
    const q = search.toLowerCase();
    const id = identities[s.user_id];
    const displayName = (id?.display_name || '').toLowerCase();
    const email = (id?.email || '').toLowerCase();
    const lineId = (id?.line_user_id || '').toLowerCase();
    const planName = s.plan_name.toLowerCase();
    const startDate = formatTaipeiYMD(s.started_at);
    const endDate = formatTaipeiYMD(s.expires_at);
    const remaining = getRemainingDays(s.expires_at);
    const remainingStr = remaining != null ? (remaining > 0 ? `${remaining} 天` : '已到期') : '';
    const renewStr = s.auto_renew ? '自動' : '手動';
    const kindStr = s.kind === 'checkup' ? '健檢' : '訂閱';
    const loginStr = id?.login_method === 'line' ? 'line' : 'email';
    const matchSearch = displayName.includes(q) || email.includes(q) || lineId.includes(q)
      || s.user_id.toLowerCase().includes(q)
      || planName.includes(q) || (s.expert_name || '').toLowerCase().includes(q) || startDate.includes(q)
      || endDate.includes(q) || remainingStr.includes(q) || renewStr.includes(q)
      || kindStr.includes(q) || loginStr.includes(q);
    return matchStatus && matchSearch;
  });

  // B-26：手動續訂模型下，auto_renew 已停用；改以「仍有效（active 且未過期未取消）」當分母分子。
  const nowTs = Date.now();
  const activeNotExpired = rows.filter(s => s.status === 'active' && (!s.expires_at || new Date(s.expires_at).getTime() > nowTs));
  const renewalRate = totalCount > 0
    ? Math.round((activeNotExpired.length / totalCount) * 100)
    : 0;

  const checkupCount = rows.filter(s => s.kind === 'checkup' && s.status === 'active').length;

  const handleExport = () => {
    const headers = ['類型', '訂閱者', '登入方式', 'Email', 'Line ID 末段', 'User ID', '老師', '方案', '開始日', '到期日', '狀態', '續訂'];
    const rowsCsv = filtered.map(s => {
      const id = identities[s.user_id];
      return [
        s.kind === 'checkup' ? '健檢' : '訂閱方案',
        id?.display_name || s.user_id?.slice(0, 8),
        id?.login_method === 'line' ? 'Line' : 'Email',
        id?.email || '',
        id?.line_user_id ? id.line_user_id.slice(-6) : '',
        s.user_id,
        s.expert_name || '',
        s.plan_name,
        formatTaipeiYMD(s.started_at) || '-',
        formatTaipeiYMD(s.expires_at) || '-',
        s.status === 'active' ? '活躍' : s.status === 'expired' ? '已到期' : '已取消',
        s.auto_renew ? '自動' : '手動',
      ];
    });
    const csv = [headers, ...rowsCsv].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 唯一收件人清單（按勾選的 user_id，去重）
  const recipientRecords = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ user_id: string; display_name?: string; has_line: boolean }> = [];
    for (const uid of selectedUserIds) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const id = identities[uid];
      list.push({
        user_id: uid,
        display_name: id?.display_name,
        has_line: !!id?.line_user_id,
      });
    }
    return list;
  }, [selectedUserIds, identities]);

  const filteredUserIds = useMemo(() => [...new Set(filtered.map((s) => s.user_id))], [filtered]);
  const allFilteredSelected = filteredUserIds.length > 0 && filteredUserIds.every((u) => selectedUserIds.has(u));
  const toggleAllFiltered = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredUserIds.forEach((u) => next.delete(u));
      else filteredUserIds.forEach((u) => next.add(u));
      return next;
    });
  };
  const toggleOne = (uid: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  return (
    <CompanyLayout>
      <SEO title={'訂閱者管理 | legendflow'} description={'平台訂閱者總覽。'} path={'/company/subscribers'} noindex />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">訂閱者管理</h1>
            <p className="text-muted-foreground text-sm mt-1">查看與管理所有平台訂閱者（含分析師訂閱與健檢方案）</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/company/line-push-history"><History className="h-4 w-4 mr-2" />推播紀錄</Link>
            </Button>
            <Button
              variant="secondary" size="sm"
              disabled={selectedUserIds.size === 0}
              onClick={() => setNotifyOpen(true)}
            >
              <Bell className="h-4 w-4 mr-2" />站內通知 ({selectedUserIds.size})
            </Button>
            <Button
              variant="default" size="sm"
              disabled={selectedUserIds.size === 0}
              onClick={() => setPushOpen(true)}
            >
              <MessageCircle className="h-4 w-4 mr-2" />Line 推播 ({selectedUserIds.size})
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />匯出對帳報表
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-5 w-5 text-muted-foreground" /><div><div className="text-2xl font-bold">{totalCount}</div><div className="text-xs text-muted-foreground">總訂閱</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserCheck className="h-5 w-5 text-green-500" /><div><div className="text-2xl font-bold">{activeCount}</div><div className="text-xs text-muted-foreground">活躍中</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><Stethoscope className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{checkupCount}</div><div className="text-xs text-muted-foreground">健檢活躍</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserX className="h-5 w-5 text-muted-foreground" /><div><div className="text-2xl font-bold">{expiredCount}</div><div className="text-xs text-muted-foreground">已到期</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserX className="h-5 w-5 text-destructive" /><div><div className="text-2xl font-bold">{canceledCount}</div><div className="text-xs text-muted-foreground">已取消</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><RefreshCw className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{renewalRate}%</div><div className="text-xs text-muted-foreground">續訂率</div></div></CardContent></Card>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋名稱、方案、日期、類型..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            {[{ key: 'all', label: '全部類型' }, { key: 'expert', label: '訂閱方案' }, { key: 'checkup', label: '健檢方案' }].map(f => (
              <button key={f.key} onClick={() => setKindFilter(f.key as any)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${kindFilter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            {[{ key: 'all', label: '全部' }, { key: 'active', label: '活躍' }, { key: 'expired', label: '到期' }, { key: 'canceled', label: '取消' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${statusFilter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 w-10">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} />
                  </th>
                  <th className="p-4">類型</th>
                  <th className="p-4">訂閱者</th>
                  <th className="p-4">老師</th>
                  <th className="p-4">方案</th>
                  <th className="p-4">開始日</th>
                  <th className="p-4">到期日</th>
                  <th className="p-4">剩餘天數</th>
                  <th className="p-4">續訂</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">無訂閱紀錄</td></tr>
                ) : (
                  filtered.map(sub => {
                    const remaining = getRemainingDays(sub.expires_at);
                    const id = identities[sub.user_id];
                    const isLine = id?.login_method === 'line';
                    const checked = selectedUserIds.has(sub.user_id);
                    return (
                      <tr key={`${sub.kind}-${sub.id}`} className="border-b last:border-0">
                        <td className="p-4">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleOne(sub.user_id)}
                            disabled={!id?.line_user_id}
                            title={!id?.line_user_id ? '未綁定 Line，無法推播' : ''}
                          />
                        </td>
                        <td className="p-4">
                          <Badge variant={sub.kind === 'checkup' ? 'default' : 'outline'} className="text-xs">
                            {sub.kind === 'checkup' ? '健檢' : '訂閱方案'}
                          </Badge>
                        </td>
                        <td className="p-4 text-sm">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${isLine ? 'bg-[#06C755]/10 text-[#06C755] border-[#06C755]/30' : ''}`}
                            >
                              {isLine ? 'Line' : 'Email'}
                            </Badge>
                            <span className="font-medium">{id?.display_name || sub.user_id?.slice(0, 8)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatIdentitySecondary(id, sub.user_id)}
                          </div>
                        </td>
                        <td className="p-4 text-sm">
                          {sub.kind === 'expert'
                            ? (sub.expert_name || <span className="text-muted-foreground">-</span>)
                            : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-4 text-sm">{sub.plan_name}</td>
                        <td className="p-4 text-sm text-muted-foreground">{formatTaipeiYMD(sub.started_at) || '-'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{formatTaipeiYMD(sub.expires_at) || '-'}</td>
                        <td className="p-4">
                          {remaining != null ? (
                            <span className={`text-sm font-medium ${remaining <= 7 ? 'text-destructive' : remaining <= 30 ? 'text-yellow-600' : 'text-foreground'}`}>
                              {remaining > 0 ? `${remaining} 天` : '已到期'}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="text-xs">手動續訂</Badge>
                        </td>
                        <td className="p-4">
                          <Badge variant={sub.status === 'active' ? 'default' : sub.status === 'expired' ? 'outline' : 'destructive'} className="text-xs">
                            {sub.status === 'active' ? '活躍' : sub.status === 'expired' ? '已到期' : '已取消'}
                          </Badge>
                        </td>
                        <td className="p-4 text-right">
                          <div className="inline-flex flex-col items-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => launchViewAs(sub.user_id)}
                              title="以此會員身分模擬登入（新分頁、唯讀視角）"
                            >
                              <Eye className="h-3 w-3" />視角檢視
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => setNotifyTarget({ user_id: sub.user_id, display_name: id?.display_name })}
                              title="對此會員發送站內通知（鈴鐺提醒）"
                            >
                              <Bell className="h-3 w-3" />站內通知
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => setMergeTarget({ userId: sub.user_id, label: `${id?.display_name ?? ''} ${id?.email ?? ''}`.trim() })}
                              title="把另一個帳號合併到這個會員（代客綁定）"
                            >
                              <Link2 className="h-3 w-3" />代客綁定
                            </Button>
                          </div>
                        </td>
                      </tr>

                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <LinePushDialog
        open={pushOpen}
        onOpenChange={setPushOpen}
        recipients={recipientRecords}
        onSent={() => setSelectedUserIds(new Set())}
      />
      <PlatformNotifyDialog
        open={notifyOpen}
        onOpenChange={setNotifyOpen}
        recipients={recipientRecords.map((r) => ({ user_id: r.user_id, display_name: r.display_name }))}
        onSent={() => setSelectedUserIds(new Set())}
      />
      <PlatformNotifyDialog
        open={!!notifyTarget}
        onOpenChange={(v) => { if (!v) setNotifyTarget(null); }}
        recipients={notifyTarget ? [notifyTarget] : []}
        onSent={() => setNotifyTarget(null)}
      />
      {mergeTarget && (
        <AdminForceMergeDialog
          open={!!mergeTarget}
          onOpenChange={(v) => { if (!v) setMergeTarget(null); }}
          primaryUserId={mergeTarget.userId}
          primaryLabel={mergeTarget.label}
        />
      )}
    </CompanyLayout>

  );
};

export default CompanySubscribers;
