import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { fetchAnalystSubscribers } from '@/lib/analystDataAccess';
import { Users, TrendingUp, UserPlus, UserMinus, Search, RefreshCw, Info, XCircle } from 'lucide-react';

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

    const { subscriptions } = await fetchAnalystSubscribers(supabase, exp.id);
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
          <p className="text-muted-foreground text-sm mt-1">查看您的訂閱者名單與續訂狀態</p>
        </div>

        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              為保障訂閱者權益，僅訂閱者本人可主動取消訂閱。如需協助處理特殊情況，請聯絡公司管理員。
            </p>
          </CardContent>
        </Card>

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
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground text-sm">尚無訂閱者</td></tr>
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
                            <Badge variant={sub.status === 'active' ? 'secondary' : 'outline'} className="text-xs">
                              {sub.status === 'active' ? '有效' : sub.status === 'expired' ? '已到期' : '已取消'}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0} className="inline-block">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled
                                      className="h-7 text-xs gap-1 text-muted-foreground"
                                    >
                                      <XCircle className="h-3 w-3" /> 取消訂閱
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-[260px] text-xs">
                                  為保障訂閱者權益，僅訂閱者本人可主動取消；如需協助請聯絡公司管理員。
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
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
