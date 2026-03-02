import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Search, Users, UserCheck, UserX, RefreshCw, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const CompanySubscribers = () => {
  const [subs, setSubs] = useState<any[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchSubs(); }, []);

  const fetchSubs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('member_subscriptions')
      .select('*, expert_plans(name, experts(name))')
      .order('created_at', { ascending: false });
    const subData = data || [];
    setSubs(subData);

    // Fetch display names for subscribers
    const userIds = [...new Set(subData.map(s => s.user_id).filter(Boolean))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const map: Record<string, string> = {};
      (profiles || []).forEach(p => { map[p.user_id] = p.display_name || ''; });
      setProfileMap(map);
    }
    setLoading(false);
  };

  const activeCount = subs.filter(s => s.status === 'active').length;
  const expiredCount = subs.filter(s => s.status === 'expired').length;
  const canceledCount = subs.filter(s => s.status === 'canceled').length;

  const getRemainingDays = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const filtered = subs.filter(s => {
    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    const matchSearch = !search || s.user_id?.includes(search) || s.expert_plans?.name?.includes(search);
    return matchStatus && matchSearch;
  });

  const renewalRate = subs.length > 0 ? Math.round((subs.filter(s => s.auto_renew).length / subs.length) * 100) : 0;

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">訂閱者管理</h1>
          <p className="text-muted-foreground text-sm mt-1">查看與管理所有平台訂閱者</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-5 w-5 text-muted-foreground" /><div><div className="text-2xl font-bold">{subs.length}</div><div className="text-xs text-muted-foreground">總訂閱</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserCheck className="h-5 w-5 text-green-500" /><div><div className="text-2xl font-bold">{activeCount}</div><div className="text-xs text-muted-foreground">活躍中</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserX className="h-5 w-5 text-muted-foreground" /><div><div className="text-2xl font-bold">{expiredCount}</div><div className="text-xs text-muted-foreground">已到期</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><UserX className="h-5 w-5 text-destructive" /><div><div className="text-2xl font-bold">{canceledCount}</div><div className="text-xs text-muted-foreground">已取消</div></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><RefreshCw className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{renewalRate}%</div><div className="text-xs text-muted-foreground">續訂率</div></div></CardContent></Card>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋方案名稱..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">訂閱者</th>
                  <th className="p-4">方案</th>
                  <th className="p-4">開始日</th>
                  <th className="p-4">到期日</th>
                  <th className="p-4">剩餘天數</th>
                  <th className="p-4">續訂</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground text-sm">無訂閱紀錄</td></tr>
                ) : (
                  filtered.map(sub => {
                    const remaining = getRemainingDays(sub.expires_at);
                    return (
                      <tr key={sub.id} className="border-b last:border-0">
                        <td className="p-4 text-sm">{profileMap[sub.user_id] || sub.user_id?.slice(0, 8)}</td>
                        <td className="p-4 text-sm">{sub.expert_plans?.name || '-'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{sub.started_at ? new Date(sub.started_at).toLocaleDateString('zh-TW') : '-'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('zh-TW') : '-'}</td>
                        <td className="p-4">
                          {remaining != null ? (
                            <span className={`text-sm font-medium ${remaining <= 7 ? 'text-destructive' : remaining <= 30 ? 'text-yellow-600' : 'text-foreground'}`}>
                              {remaining > 0 ? `${remaining} 天` : '已到期'}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="p-4">
                          <Badge variant={sub.auto_renew ? 'default' : 'outline'} className="text-xs">{sub.auto_renew ? '自動' : '手動'}</Badge>
                        </td>
                        <td className="p-4">
                          <Badge variant={sub.status === 'active' ? 'default' : sub.status === 'expired' ? 'outline' : 'destructive'} className="text-xs">
                            {sub.status === 'active' ? '活躍' : sub.status === 'expired' ? '已到期' : '已取消'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to={`/company/payments`}>查看付款</Link>
                          </Button>
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
    </CompanyLayout>
  );
};

export default CompanySubscribers;
