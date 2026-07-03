import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, UserCheck, Stethoscope, ArrowRight, MessageCircle, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatTaipeiYMD } from '@/checkup/utils/formatTaipeiDate';

interface MemberStats {
  totalUsers: number;
  newToday: number;
  activeSubscribers: number;
  activeCheckups: number;
  lineLinked: number;
  recentSignups: Array<{ user_id: string; email: string | null; display_name: string | null; created_at: string }>;
  expiringSoon: Array<{ user_id: string; plan_name: string; expires_at: string; kind: 'expert' | 'checkup' }>;
}

export default function CompanyMembers() {
  const { data, isLoading } = useQuery<MemberStats>({
    queryKey: ['company', 'members-overview'],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [usersRes, subsRes, checkupRes] = await Promise.all([
        supabase.functions.invoke('admin-manage-users', { body: { action: 'list', limit: 500 } }),
        supabase.from('member_subscriptions').select('user_id, status, expires_at, expert_plans(name)').eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${nowIso}`),
        supabase.from('checkup_subscriptions').select('user_id, status, expires_at, checkup_plans(name)').eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      ]);
      const users: any[] = usersRes.data?.users || [];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const newToday = users.filter(u => new Date(u.created_at) >= todayStart).length;
      const lineLinked = users.filter(u => u.is_line).length;
      const recentSignups = [...users]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
        .map(u => ({ user_id: u.user_id, email: u.email, display_name: u.display_name, created_at: u.created_at }));

      const subs = (subsRes.data || []).map((s: any) => ({
        user_id: s.user_id, plan_name: s.expert_plans?.name || '-', expires_at: s.expires_at, kind: 'expert' as const,
      }));
      const checkups = (checkupRes.data || []).map((s: any) => ({
        user_id: s.user_id, plan_name: s.checkup_plans?.name || '健檢', expires_at: s.expires_at, kind: 'checkup' as const,
      }));
      const all = [...subs, ...checkups].filter(s => s.expires_at);
      const sevenDays = Date.now() + 7 * 86400_000;
      const expiringSoon = all
        .filter(s => new Date(s.expires_at!).getTime() < sevenDays)
        .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())
        .slice(0, 10);

      return {
        totalUsers: users.length,
        newToday,
        activeSubscribers: subs.length,
        activeCheckups: checkups.length,
        lineLinked,
        recentSignups,
        expiringSoon,
      };
    },
    staleTime: 60_000,
  });

  const linePct = data && data.totalUsers > 0 ? Math.round((data.lineLinked / data.totalUsers) * 100) : 0;

  return (
    <CompanyLayout>
      <SEO title="會員總覽 | legendflow" description="平台會員總覽。" path="/company/members" noindex />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">會員總覽</h1>
          <p className="text-sm text-muted-foreground mt-1">所有註冊帳號、付費訂閱與 Line 綁定的快速指標</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat icon={<Users className="h-5 w-5 text-muted-foreground" />} label="總註冊" value={data?.totalUsers ?? '-'} />
          <Stat icon={<Activity className="h-5 w-5 text-primary" />} label="今日新增" value={data?.newToday ?? '-'} />
          <Stat icon={<UserCheck className="h-5 w-5 text-green-500" />} label="活躍訂閱" value={data?.activeSubscribers ?? '-'} />
          <Stat icon={<Stethoscope className="h-5 w-5 text-primary" />} label="活躍健檢" value={data?.activeCheckups ?? '-'} />
          <Stat icon={<MessageCircle className="h-5 w-5 text-[#06C755]" />} label="Line 綁定率" value={`${linePct}%`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">最近註冊</h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/company/users">全部帳號 <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
                </Button>
              </div>
              {isLoading ? <Skeleton /> : (
                <ul className="divide-y">
                  {(data?.recentSignups || []).map(u => (
                    <li key={u.user_id} className="py-2 flex items-center justify-between text-sm gap-3">
                      <div className="min-w-0">
                        <div className="truncate">{u.display_name || '—'}</div>
                        <div className="text-xs text-muted-foreground truncate font-mono">{u.email || u.user_id.slice(0, 8)}</div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{formatTaipeiYMD(u.created_at)}</span>
                    </li>
                  ))}
                  {!data?.recentSignups?.length && <li className="text-sm text-muted-foreground py-4">尚無資料</li>}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">7 日內即將到期</h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/company/subscribers">訂閱會員 <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
                </Button>
              </div>
              {isLoading ? <Skeleton /> : (
                <ul className="divide-y">
                  {(data?.expiringSoon || []).map((s, i) => (
                    <li key={`${s.user_id}-${i}`} className="py-2 flex items-center justify-between text-sm gap-3">
                      <div className="min-w-0">
                        <div className="truncate">{s.plan_name}</div>
                        <div className="text-xs text-muted-foreground truncate font-mono">{s.user_id.slice(0, 8)} · {s.kind === 'checkup' ? '健檢' : '訂閱'}</div>
                      </div>
                      <span className="text-xs text-destructive shrink-0">{formatTaipeiYMD(s.expires_at)}</span>
                    </li>
                  ))}
                  {!data?.expiringSoon?.length && <li className="text-sm text-muted-foreground py-4">7 日內無到期</li>}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-3">
          <Button asChild><Link to="/company/users">管理所有帳號</Link></Button>
          <Button asChild variant="outline"><Link to="/company/subscribers">管理訂閱會員</Link></Button>
        </div>
      </div>
    </CompanyLayout>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      {icon}
      <div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </CardContent></Card>
  );
}

function Skeleton() {
  return <div className="py-8 text-center text-sm text-muted-foreground">載入中...</div>;
}
