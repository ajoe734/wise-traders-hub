import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Users, TrendingUp, UserPlus, UserMinus, Search, RefreshCw } from 'lucide-react';

const AdminSubscribers = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, [expertSlug]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);

    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (!exp) { setLoading(false); return; }

    // Get expert's plan IDs
    const { data: plans } = await supabase.from('expert_plans').select('id').eq('expert_id', exp.id);
    const planIds = (plans || []).map(p => p.id);

    if (planIds.length === 0) {
      setSubs([]);
      setLoading(false);
      return;
    }

    // Get subscriptions for those plans
    const { data: subData } = await supabase
      .from('member_subscriptions')
      .select('*, expert_plans(name)')
      .in('plan_id', planIds)
      .order('created_at', { ascending: false });
    const subscriptions = subData || [];
    setSubs(subscriptions);

    // Fetch profile names
    const userIds = [...new Set(subscriptions.map(s => s.user_id).filter(Boolean))];
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

  const getRemainingDays = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const nonCanceled = subs.filter(s => s.status !== 'canceled');
  const activeCount = subs.filter(s => s.status === 'active').length;
  const renewalRate = nonCanceled.length > 0 ? Math.round((nonCanceled.filter(s => s.auto_renew).length / nonCanceled.length) * 100) : 0;

  const filtered = subs.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (profileMap[s.user_id] || '').toLowerCase();
    const plan = (s.expert_plans?.name || '').toLowerCase();
    return name.includes(q) || plan.includes(q);
  });

  const stats = [
    { label: '總訂閱人數', value: nonCanceled.length, icon: Users },
    { label: '活躍訂閱', value: activeCount, icon: UserPlus },
    { label: '已到期', value: nonCanceled.length - activeCount, icon: UserMinus },
    { label: '續訂率', value: `${renewalRate}%`, icon: RefreshCw },
  ];

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">訂閱者管理</h1>
          <p className="text-muted-foreground text-sm mt-1">查看與管理您的訂閱者</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋姓名或方案..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">姓名</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">方案</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">訂閱日</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">到期日</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">剩餘天數</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">續訂</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">尚無訂閱者</td></tr>
                  ) : (
                    filtered.map((sub) => {
                      const remaining = getRemainingDays(sub.expires_at);
                      return (
                        <tr key={sub.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 text-sm font-medium">{profileMap[sub.user_id] || sub.user_id?.slice(0, 8)}</td>
                          <td className="p-3 text-sm">{sub.expert_plans?.name || '-'}</td>
                          <td className="p-3 text-sm text-muted-foreground">{sub.started_at ? new Date(sub.started_at).toLocaleDateString('zh-TW') : '-'}</td>
                          <td className="p-3 text-sm text-muted-foreground">{sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('zh-TW') : '-'}</td>
                          <td className="p-3">
                            {remaining != null ? (
                              <span className={cn(
                                "text-sm font-medium",
                                remaining <= 7 ? 'text-destructive' : remaining <= 30 ? 'text-yellow-600' : 'text-foreground'
                              )}>
                                {remaining > 0 ? `${remaining} 天` : '已到期'}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-3">
                            <Badge variant={sub.auto_renew ? 'default' : 'outline'} className="text-xs">
                              {sub.auto_renew ? '自動' : '手動'}
                            </Badge>
                          </td>
                          <td className="p-3">
                            {sub.status === 'active' && sub.canceled_at && !sub.auto_renew ? (
                              <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                                已取消（服務至月底）
                              </Badge>
                            ) : (
                              <Badge variant={sub.status === 'active' ? 'secondary' : 'outline'} className="text-xs">
                                {sub.status === 'active' ? '有效' : sub.status === 'expired' ? '已到期' : '已取消'}
                              </Badge>
                            )}
                          </td>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSubscribers;
