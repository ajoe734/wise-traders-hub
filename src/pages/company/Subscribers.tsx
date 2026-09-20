import { SEO } from '@/components/SEO';
import { useState, useMemo, Fragment, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import {
  Search, Users, UserCheck, UserX, RefreshCw, Download, Stethoscope, MessageCircle,
  History, Eye, Link2, Bell, ChevronDown, ChevronRight, ArrowUpDown, Clock,
} from 'lucide-react';
import { useUserIdentities, formatIdentitySecondary } from '@/hooks/useUserIdentities';
import { useDuplicateIdentities } from '@/hooks/useDuplicateIdentities';
import { DuplicateIdentityHint } from '@/components/company/DuplicateIdentityHint';
import { formatTaipeiYMD } from '@/checkup/utils/formatTaipeiDate';
import { LinePushDialog } from '@/components/company/LinePushDialog';
import { PlatformNotifyDialog } from '@/components/company/PlatformNotifyDialog';
import { AdminForceMergeDialog } from '@/components/company/AdminForceMergeDialog';
import { launchViewAs } from '@/lib/viewAsLauncher';
import {
  groupSubscriberSpells, calcRenewalRate, calcActiveShare, parseSearch,
  RENEWAL_WINDOW_DAYS, type SpellRow, type SubscriberGroup, type GroupStatus,
} from '@/lib/subscriberAggregation';
import {
  buildReminderIndex, summaryFor, reminderBadge,
  RENEWAL_REMINDER_ACTIONS, type ReminderLogRow,
} from '@/lib/renewalReminderStatus';
import {
  buildDeliveryIndex, deliveryFor, deliveryBadge, type ExpiryReminderLedgerRow,
} from '@/lib/subscriberExpiryDelivery';

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<GroupStatus, string> = {
  live: 'ACTIVE',
  expiring: '即將到期',
  churned: '已流失',
  canceled: '已取消',
};

type SortKey = 'expires_at' | 'remaining' | 'cycles' | 'first_started_at';

const CompanySubscribers = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GroupStatus>('all');
  const [expertFilter, setExpertFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'expert' | 'checkup'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'expires_at', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      const expertRows: SpellRow[] = (eRes.data || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        kind: 'expert',
        plan_name: s.expert_plans?.name || '-',
        expert_name: s.expert_plans?.experts?.name || null,
        status: s.status,
        started_at: s.started_at,
        expires_at: s.expires_at,
      }));
      const checkupRows: SpellRow[] = (cRes.data || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        kind: 'checkup',
        plan_name: s.checkup_plans?.name || '健檢方案',
        expert_name: null,
        status: s.status,
        started_at: s.started_at,
        expires_at: s.expires_at,
      }));
      return { rows: [...expertRows, ...checkupRows] };
    },
    staleTime: 30_000,
  });
  const rows = data?.rows ?? [];
  const userIds = useMemo(() => [...new Set(rows.map((r) => r.user_id).filter(Boolean))], [rows]);
  const { identities } = useUserIdentities(userIds);
  const loading = isFetching && !data;

  // 自動續訂提醒（Email／LINE 排程）的寄送紀錄，用來在表格標記，不用人工追蹤
  const { data: reminderLogs } = useQuery({
    queryKey: ['company', 'subscribers', 'reminder-logs'],
    queryFn: async (): Promise<ReminderLogRow[]> => {
      const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
      const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('action, target_id, created_at, detail')
        .in('action', [...RENEWAL_REMINDER_ACTIONS])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (logs || []) as ReminderLogRow[];
    },
    staleTime: 60_000,
  });
  const reminderIndex = useMemo(() => buildReminderIndex(reminderLogs || []), [reminderLogs]);

  // 老師端到期通知（站內／Email／LINE）的實際送達狀態，讓管理者不用人工追蹤老師有沒有被通知到
  const { data: deliveryRows } = useQuery({
    queryKey: ['company', 'subscribers', 'expiry-delivery'],
    queryFn: async (): Promise<ExpiryReminderLedgerRow[]> => {
      const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await supabase
        .from('subscriber_expiry_reminders')
        .select('expert_id, local_date, reminder_type, payload, channels, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (rows || []) as unknown as ExpiryReminderLedgerRow[];
    },
    staleTime: 60_000,
  });
  const deliveryIndex = useMemo(() => buildDeliveryIndex(deliveryRows || []), [deliveryRows]);

  const nowMs = Date.now();
  const groups = useMemo(() => groupSubscriberSpells(rows, nowMs), [rows]);

  // 疑似同一人有兩個帳號（Email／LINE）且只有其中一個有訂閱 —— 這是
  // 「已付費卻看不到週記」客訴的唯一成因，讓客服在列表上就看得出來。
  const subscribedUserIds = useMemo(
    () => [...new Set(rows.filter((r) => r.status === 'active').map((r) => r.user_id).filter(Boolean))],
    [rows],
  );
  const { byUser: duplicateByUser } = useDuplicateIdentities(subscribedUserIds);

  // 指標：續訂率（真口徑）與有效佔比（原本被誤稱為續訂率的數字）
  const renewal = useMemo(() => calcRenewalRate(rows, nowMs), [rows]);
  const activeShare = useMemo(() => calcActiveShare(rows, nowMs), [rows]);
  const totalSubscribers = new Set(groups.map((g) => g.user_id)).size;
  const liveGroups = groups.filter((g) => g.status === 'live' || g.status === 'expiring').length;
  const expiringGroups = groups.filter((g) => g.status === 'expiring').length;
  const churnedGroups = groups.filter((g) => g.status === 'churned').length;
  const checkupLive = groups.filter((g) => g.kind === 'checkup' && (g.status === 'live' || g.status === 'expiring')).length;

  const parsed = useMemo(() => parseSearch(search), [search]);

  const matchesSearch = (g: SubscriberGroup) => {
    const id = identities[g.user_id];
    const name = (id?.display_name || '').toLowerCase();
    const email = (id?.email || '').toLowerCase();
    const lineId = (id?.line_user_id || '').toLowerCase();
    const expert = (g.expert_name || '').toLowerCase();
    const plans = g.spells.map((s) => s.plan_name.toLowerCase()).join(' ');
    const statusText = STATUS_LABEL[g.status].toLowerCase();
    const f = parsed.fields;
    if (f.email && !email.includes(f.email)) return false;
    if (f.line && !lineId.includes(f.line)) return false;
    if (f.expert && !expert.includes(f.expert)) return false;
    if (f.plan && !plans.includes(f.plan)) return false;
    if (f.status && !statusText.includes(f.status)) return false;
    if (!parsed.free) return true;
    const q = parsed.free;
    const dates = g.spells.map((s) => `${formatTaipeiYMD(s.started_at)} ${formatTaipeiYMD(s.expires_at)}`).join(' ');
    return [name, email, lineId, g.user_id.toLowerCase(), expert, plans, statusText, dates]
      .some((v) => v.includes(q));
  };
  const matchesKind = (g: SubscriberGroup) => kindFilter === 'all' || g.kind === kindFilter;
  const matchesStatus = (g: SubscriberGroup) => statusFilter === 'all' || g.status === statusFilter;
  const matchesExpert = (g: SubscriberGroup) =>
    expertFilter === 'all' || (g.kind === 'expert' && (g.expert_name || '未指派') === expertFilter);

  const filtered = useMemo(() => {
    const list = groups.filter((g) => matchesKind(g) && matchesStatus(g) && matchesExpert(g) && matchesSearch(g));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (g: SubscriberGroup) => {
      switch (sort.key) {
        case 'cycles': return g.cycles;
        case 'remaining': return g.remaining_days ?? -Infinity;
        case 'first_started_at': return new Date(g.first_started_at).getTime();
        default: return g.expires_at ? new Date(g.expires_at).getTime() : -Infinity;
      }
    };
    return [...list].sort((a, b) => (val(a) - val(b)) * dir);
  }, [groups, kindFilter, statusFilter, expertFilter, search, identities, sort]);

  useEffect(() => { setPage(0); }, [kindFilter, statusFilter, expertFilter, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const expertOptions = useMemo(() => {
    const counts = new Map<string, number>();
    groups.forEach((g) => {
      if (g.kind !== 'expert') return;
      if (!matchesStatus(g) || !matchesSearch(g)) return;
      const name = g.expert_name || '未指派';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
  }, [groups, statusFilter, search, identities]);

  const statusCounts = useMemo(() => {
    const base = groups.filter((g) => matchesKind(g) && matchesExpert(g) && matchesSearch(g));
    return {
      all: base.length,
      live: base.filter((g) => g.status === 'live').length,
      expiring: base.filter((g) => g.status === 'expiring').length,
      churned: base.filter((g) => g.status === 'churned').length,
      canceled: base.filter((g) => g.status === 'canceled').length,
    };
  }, [groups, kindFilter, expertFilter, search, identities]);

  const toSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  const downloadCsv = (name: string, table: string[][]) => {
    const csv = table.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const stamp = new Date().toISOString().slice(0, 10);

  const badgeFor = (g: SubscriberGroup) => reminderBadge({
    summary: summaryFor(reminderIndex, g.latest.id),
    status: g.status,
    remainingDays: g.remaining_days,
    formatDate: (iso) => formatTaipeiYMD(iso) || '-',
  });

  const deliveryFor_ = (g: SubscriberGroup) => deliveryBadge({
    summary: deliveryFor(deliveryIndex, g.latest.id),
    status: g.status,
    remainingDays: g.remaining_days,
    formatDate: (iso) => formatTaipeiYMD(iso) || '-',
  });

  const exportSummary = () => {
    downloadCsv(`subscribers-summary-${stamp}.csv`, [
      ['類型', '訂閱者', '登入方式', 'Email', 'Line ID 末段', 'User ID', '老師', '最新方案', '首次訂閱日', '最新到期日', '累計期數', '狀態', '到期提醒', '通知老師'],
      ...filtered.map((g) => {
        const id = identities[g.user_id];
        return [
          g.kind === 'checkup' ? '健檢' : '訂閱方案',
          id?.display_name || g.user_id?.slice(0, 8),
          id?.login_method === 'line' ? 'Line' : 'Email',
          id?.email || '',
          id?.line_user_id ? id.line_user_id.slice(-6) : '',
          g.user_id,
          g.expert_name || '',
          g.latest.plan_name,
          formatTaipeiYMD(g.first_started_at) || '-',
          formatTaipeiYMD(g.expires_at) || '-',
          String(g.cycles),
          STATUS_LABEL[g.status],
          badgeFor(g).label,
          deliveryFor_(g).label,
        ];
      }),
    ]);
  };

  const exportDetail = () => {
    downloadCsv(`subscribers-detail-${stamp}.csv`, [
      ['類型', '訂閱者', 'Email', 'User ID', '老師', '方案', '開始日', '到期日', '原始狀態'],
      ...filtered.flatMap((g) => {
        const id = identities[g.user_id];
        return g.spells.map((s) => [
          s.kind === 'checkup' ? '健檢' : '訂閱方案',
          id?.display_name || g.user_id?.slice(0, 8),
          id?.email || '',
          g.user_id,
          s.expert_name || '',
          s.plan_name,
          formatTaipeiYMD(s.started_at) || '-',
          formatTaipeiYMD(s.expires_at) || '-',
          s.status,
        ]);
      }),
    ]);
  };

  const recipientRecords = useMemo(() => {
    const list: Array<{ user_id: string; display_name?: string; has_line: boolean }> = [];
    for (const uid of selectedUserIds) {
      const id = identities[uid];
      list.push({ user_id: uid, display_name: id?.display_name, has_line: !!id?.line_user_id });
    }
    return list;
  }, [selectedUserIds, identities]);

  const filteredUserIds = useMemo(() => [...new Set(filtered.map((g) => g.user_id))], [filtered]);
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
  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="p-4">
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toSort(k)}>
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sort.key === k ? 'text-foreground' : 'opacity-40'}`} />
      </button>
    </th>
  );

  return (
    <CompanyLayout>
      <SEO title={'訂閱者管理 | legendflow'} description={'平台訂閱者總覽。'} path={'/company/subscribers'} noindex />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">訂閱者管理</h1>
            <p className="text-muted-foreground text-sm mt-1">一位訂閱者一列（同一老師的多期合併），展開可看每一期歷史</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/company/line-push-history"><History className="h-4 w-4 mr-2" />推播紀錄</Link>
            </Button>
            <Button variant="secondary" size="sm" disabled={selectedUserIds.size === 0} onClick={() => setNotifyOpen(true)}>
              <Bell className="h-4 w-4 mr-2" />站內通知 ({selectedUserIds.size})
            </Button>
            <Button variant="default" size="sm" disabled={selectedUserIds.size === 0} onClick={() => setPushOpen(true)}>
              <MessageCircle className="h-4 w-4 mr-2" />Line 推播 ({selectedUserIds.size})
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />匯出</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportSummary}>一人一列摘要</DropdownMenuItem>
                <DropdownMenuItem onClick={exportDetail}>逐期明細（對帳）</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-5 w-5 text-muted-foreground" /><div><div className="text-2xl font-bold">{totalSubscribers}</div><div className="text-xs text-muted-foreground">訂閱者人數</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserCheck className="h-5 w-5 text-green-500" /><div><div className="text-2xl font-bold">{liveGroups}</div><div className="text-xs text-muted-foreground">有效訂閱</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><Clock className="h-5 w-5 text-yellow-600" /><div><div className="text-2xl font-bold">{expiringGroups}</div><div className="text-xs text-muted-foreground">7 天內到期</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><Stethoscope className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{checkupLive}</div><div className="text-xs text-muted-foreground">健檢有效</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserX className="h-5 w-5 text-destructive" /><div><div className="text-2xl font-bold">{churnedGroups}</div><div className="text-xs text-muted-foreground">已流失</div></div></CardContent></Card>
          <Card title={`分母＝已到期且未取消的訂閱期間（${renewal.denominator}），分子＝同一人同一老師在到期後 ${RENEWAL_WINDOW_DAYS} 天內再次開通（${renewal.numerator}）`}>
            <CardContent className="p-4 flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{renewal.rate}%</div>
                <div className="text-xs text-muted-foreground">續訂率 {renewal.numerator}/{renewal.denominator}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">有效佔比 {activeShare.rate}%</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋，可用 email: 老師: 狀態: 方案:"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            {[{ key: 'all', label: '全部類型' }, { key: 'expert', label: '訂閱方案' }, { key: 'checkup', label: '健檢方案' }].map((f) => (
              <button key={f.key} onClick={() => { setKindFilter(f.key as any); if (f.key === 'checkup') setExpertFilter('all'); }} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${kindFilter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            {[
              { key: 'all', label: '全部', n: statusCounts.all },
              { key: 'live', label: 'ACTIVE', n: statusCounts.live },
              { key: 'expiring', label: '即將到期', n: statusCounts.expiring },
              { key: 'churned', label: '已流失', n: statusCounts.churned },
              { key: 'canceled', label: '已取消', n: statusCounts.canceled },
            ].map((f) => (
              <button key={f.key} onClick={() => setStatusFilter(f.key as any)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${statusFilter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f.label} <span className="opacity-60">({f.n})</span>
              </button>
            ))}
          </div>
          <Select value={expertFilter} onValueChange={(v) => { setExpertFilter(v); if (v !== 'all' && kindFilter !== 'expert') setKindFilter('expert'); }}>
            <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue placeholder="全部老師" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部老師</SelectItem>
              {expertOptions.map(([name, n]) => (
                <SelectItem key={name} value={name}>{name}（{n}）</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(statusFilter !== 'all' || expertFilter !== 'all' || kindFilter !== 'all' || search) && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setStatusFilter('all'); setExpertFilter('all'); setKindFilter('all'); setSearch(''); }}>
              清除篩選
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 w-10"><Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} /></th>
                  <th className="p-4 w-8" />
                  <th className="p-4">類型</th>
                  <th className="p-4">訂閱者</th>
                  <th className="p-4">老師</th>
                  <th className="p-4">最新方案</th>
                  <SortHead k="first_started_at">首次訂閱</SortHead>
                  <SortHead k="expires_at">到期日</SortHead>
                  <SortHead k="remaining">剩餘天數</SortHead>
                  <SortHead k="cycles">期數</SortHead>
                  <th className="p-4">狀態</th>
                  <th className="p-4" title="到期提醒由排程每日 09:10（台北）自動寄出，這裡標記最近一次寄送">到期提醒</th>
                  <th className="p-4" title="老師端到期通知（站內／Email／LINE）的實際送達狀態">通知老師</th>
                  <th className="p-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={14} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan={14} className="p-8 text-center text-muted-foreground text-sm">無訂閱紀錄</td></tr>
                ) : (
                  pageRows.map((g) => {
                    const id = identities[g.user_id];
                    const isLine = id?.login_method === 'line';
                    const checked = selectedUserIds.has(g.user_id);
                    const open = expanded.has(g.key);
                    const rd = g.remaining_days;
                    const reminder = badgeFor(g);
                    const delivery = deliveryFor_(g);
                    return (
                      <Fragment key={g.key}>
                        <tr className="border-b last:border-0">
                          <td className="p-4">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleOne(g.user_id)}
                              disabled={!id?.line_user_id}
                              title={!id?.line_user_id ? '未綁定 Line，無法推播' : ''}
                            />
                          </td>
                          <td className="p-4">
                            <button onClick={() => toggleExpand(g.key)} title="展開各期歷史" className="text-muted-foreground hover:text-foreground">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="p-4">
                            <Badge variant={g.kind === 'checkup' ? 'default' : 'outline'} className="text-xs">
                              {g.kind === 'checkup' ? '健檢' : '訂閱方案'}
                            </Badge>
                          </td>
                          <td className="p-4 text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isLine ? 'bg-[#06C755]/10 text-[#06C755] border-[#06C755]/30' : ''}`}>
                                {isLine ? 'Line' : 'Email'}
                              </Badge>
                              <span className="font-medium">{id?.display_name || g.user_id?.slice(0, 8)}</span>
                              {duplicateByUser[g.user_id] && (
                                <DuplicateIdentityHint cluster={duplicateByUser[g.user_id]} userId={g.user_id} />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{formatIdentitySecondary(id, g.user_id)}</div>
                          </td>
                          <td className="p-4 text-sm">{g.expert_name || <span className="text-muted-foreground">-</span>}</td>
                          <td className="p-4 text-sm">{g.latest.plan_name}</td>
                          <td className="p-4 text-sm text-muted-foreground">{formatTaipeiYMD(g.first_started_at) || '-'}</td>
                          <td className="p-4 text-sm text-muted-foreground">{formatTaipeiYMD(g.expires_at) || '-'}</td>
                          <td className="p-4">
                            {rd != null ? (
                              <span className={`text-sm font-medium ${rd <= 7 ? 'text-destructive' : rd <= 30 ? 'text-yellow-600' : 'text-foreground'}`}>
                                {rd > 0 ? `${rd} 天` : '已到期'}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-4 text-sm">×{g.cycles}</td>
                          <td className="p-4">
                            <Badge
                              variant={g.status === 'live' ? 'default' : g.status === 'canceled' ? 'destructive' : 'outline'}
                              className={`text-xs ${g.status === 'expiring' ? 'border-yellow-500/40 text-yellow-600' : ''}`}
                            >
                              {STATUS_LABEL[g.status]}
                            </Badge>
                          </td>
                          <td className="p-4" title={reminder.title}>
                            <span
                              data-testid="reminder-cell"
                              className={`text-xs ${reminder.tone === 'sent' ? 'text-green-600' : reminder.tone === 'failed' ? 'text-destructive font-medium' : reminder.tone === 'pending' ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}`}
                            >
                              {reminder.label}
                            </span>
                          </td>
                          <td className="p-4" title={delivery.title}>
                            <span
                              data-testid="teacher-delivery-cell"
                              className={`text-xs ${delivery.tone === 'sent' ? 'text-green-600' : delivery.tone === 'partial' ? 'text-foreground' : delivery.tone === 'failed' ? 'text-destructive font-medium' : delivery.tone === 'pending' ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}`}
                            >
                              {delivery.label}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <div className="inline-flex flex-col items-end gap-1">
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => launchViewAs(g.user_id)} title="以此會員身分模擬登入（新分頁、唯讀視角）">
                                <Eye className="h-3 w-3" />視角檢視
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setNotifyTarget({ user_id: g.user_id, display_name: id?.display_name })} title="對此會員發送站內通知（鈴鐺提醒）">
                                <Bell className="h-3 w-3" />站內通知
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => setMergeTarget({ userId: g.user_id, label: `${id?.display_name ?? ''} ${id?.email ?? ''}`.trim() })} title="把另一個帳號合併到這個會員（代客綁定）">
                                <Link2 className="h-3 w-3" />代客綁定
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b last:border-0 bg-muted/30">
                            <td colSpan={14} className="px-12 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground text-left">
                                    <th className="py-1 pr-6">期別</th>
                                    <th className="py-1 pr-6">方案</th>
                                    <th className="py-1 pr-6">開始日</th>
                                    <th className="py-1 pr-6">到期日</th>
                                    <th className="py-1 pr-6">原始狀態</th>
                                    <th className="py-1">到期提醒</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.spells.map((s, i) => {
                                    const sum = summaryFor(reminderIndex, s.id);
                                    return (
                                    <tr key={s.id}>
                                      <td className="py-1 pr-6">第 {g.spells.length - i} 期</td>
                                      <td className="py-1 pr-6">{s.plan_name}</td>
                                      <td className="py-1 pr-6">{formatTaipeiYMD(s.started_at) || '-'}</td>
                                      <td className="py-1 pr-6">{formatTaipeiYMD(s.expires_at) || '-'}</td>
                                      <td className="py-1 pr-6">{s.status}</td>
                                      <td className="py-1 text-muted-foreground">
                                        {sum.events.length
                                          ? sum.events.map((e) => `${formatTaipeiYMD(e.created_at)} ${e.channel === 'email' ? 'Email' : 'LINE'}`).join('、')
                                          : '—'}
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>共 {filtered.length} 位 · 第 {page + 1} / {pageCount} 頁</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>上一頁</Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>下一頁</Button>
            </div>
          </div>
        )}
      </div>
      <LinePushDialog open={pushOpen} onOpenChange={setPushOpen} recipients={recipientRecords} onSent={() => setSelectedUserIds(new Set())} />
      <PlatformNotifyDialog open={notifyOpen} onOpenChange={setNotifyOpen} recipients={recipientRecords.map((r) => ({ user_id: r.user_id, display_name: r.display_name }))} onSent={() => setSelectedUserIds(new Set())} />
      <PlatformNotifyDialog open={!!notifyTarget} onOpenChange={(v) => { if (!v) setNotifyTarget(null); }} recipients={notifyTarget ? [notifyTarget] : []} onSent={() => setNotifyTarget(null)} />
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
