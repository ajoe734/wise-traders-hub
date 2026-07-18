import { SEO } from '@/components/SEO';
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackRaw } from '@/lib/analytics/events';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { openNotificationLink } from '@/lib/openNotificationLink';

type Pref = {
  user_id: string;
  target_price_new: boolean;
  target_price_updated: boolean;
  target_price_weekly: boolean;
  meta_override_changed: boolean;
  checkup_complete_line: boolean;
  checkup_complete_email: boolean;
};

const PREF_DEFAULTS: Omit<Pref, 'user_id'> = {
  target_price_new: true,
  target_price_updated: true,
  target_price_weekly: true,
  meta_override_changed: true,
  checkup_complete_line: true,
  checkup_complete_email: true,
};

const PREF_LABELS: Record<keyof typeof PREF_DEFAULTS, { title: string; desc: string }> = {
  target_price_new: { title: '新增目標價', desc: '券商首次發布目標價時通知' },
  target_price_updated: { title: '修改目標價', desc: '券商上修或下修目標價時通知' },
  target_price_weekly: { title: '每週自動刷新', desc: '系統每週一自動掃描目標價變化的彙總' },
  meta_override_changed: { title: '產業/策略覆蓋變更', desc: 'AI 研究覆蓋持倉的產業、策略、領頭欄位時通知' },
  checkup_complete_line: { title: '收盤分析完成（LINE）', desc: '背景跑完收盤分析時推播到 LINE（須已綁定 LINE）' },
  checkup_complete_email: { title: '收盤分析完成（Email）', desc: '背景跑完收盤分析時寄送摘要到信箱' },
};

export default function AccountNotifications() {
  useEffect(() => { trackRaw('notifications_open'); }, []);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const userId = user?.id;

  const notifKey = ['account', 'notifications', userId ?? null] as const;
  const prefKey = ['account', 'notification-prefs', userId ?? null] as const;

  const { data, isLoading: loading } = useQuery({
    queryKey: ['account', 'notifications-page', userId ?? null],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const [{ data: pData }, { data: nData }, { data: profileData }] = await Promise.all([
        supabase.from('notification_preferences').select('*').eq('user_id', userId!).maybeSingle(),
        supabase.from('notifications').select('*').eq('user_id', userId!).order('created_at', { ascending: false }).limit(80),
        supabase.from('profiles').select('line_user_id').eq('user_id', userId!).maybeSingle(),
      ]);
      return {
        prefs: (pData as Pref) || { user_id: userId!, ...PREF_DEFAULTS },
        items: nData || [] as any[],
        hasLineBinding: !!profileData?.line_user_id,
      };
    },
  });

  const prefs = data?.prefs ?? null;
  const items = data?.items ?? [];

  const updatePref = useMutation({
    mutationFn: async ({ k, v }: { k: keyof typeof PREF_DEFAULTS; v: boolean }) => {
      if (!prefs || !userId) throw new Error('no user');
      const next = { ...prefs, [k]: v };
      const { error } = await supabase.from('notification_preferences').upsert({
        user_id: userId,
        target_price_new: next.target_price_new,
        target_price_updated: next.target_price_updated,
        target_price_weekly: next.target_price_weekly,
        meta_override_changed: next.meta_override_changed,
        checkup_complete_line: next.checkup_complete_line,
        checkup_complete_email: next.checkup_complete_email,
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return next;
    },
    onMutate: async ({ k, v }) => {
      await qc.cancelQueries({ queryKey: ['account', 'notifications-page', userId] });
      const prev = qc.getQueryData<any>(['account', 'notifications-page', userId]);
      if (prev?.prefs) {
        qc.setQueryData(['account', 'notifications-page', userId], { ...prev, prefs: { ...prev.prefs, [k]: v } });
      }
      return { prev };
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['account', 'notifications-page', userId], ctx.prev);
      toast.error('儲存失敗：' + err.message);
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
    },
    onSuccess: () => {
      const prev = qc.getQueryData<any>(['account', 'notifications-page', userId]);
      if (prev?.items) {
        qc.setQueryData(['account', 'notifications-page', userId], {
          ...prev,
          items: prev.items.map((n: any) => ({ ...n, is_read: true })),
        });
      }
      qc.invalidateQueries({ queryKey: ['account', 'unread-count', userId] });
    },
  });

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    },
    onSuccess: (_d, id) => {
      const prev = qc.getQueryData<any>(['account', 'notifications-page', userId]);
      if (prev?.items) {
        qc.setQueryData(['account', 'notifications-page', userId], {
          ...prev,
          items: prev.items.map((x: any) => (x.id === id ? { ...x, is_read: true } : x)),
        });
      }
      qc.invalidateQueries({ queryKey: ['account', 'unread-count', userId] });
    },
  });

  const handleClick = async (n: any) => {
    if (!n.is_read) await markOneRead.mutateAsync(n.id);
    if (n.link) {
      openNotificationLink(n.link, {
        navigate,
        onError: (_e, msg) => toast.error(msg),
      });
    }
  };

  const handleDownload = (n: any) => {
    if (!n.download_url) return;
    openNotificationLink(n.download_url, {
      navigate,
      onError: (_e, msg) => toast.error(msg),
    });
  };

  const unread = items.filter((i: any) => !i.is_read).length;

  return (
    <div className="container mx-auto max-w-3xl py-8 px-4">
      <SEO title="提醒中心 | legendflow" description="檢視 legendflow 訂閱、訊號與系統提醒訊息。" path="/account/notifications" noindex />
      <div className="mb-6 flex items-center gap-3">
        <Bell className="h-6 w-6" />
        <h1 className="text-2xl font-medium">提醒中心</h1>
        {unread > 0 && <Badge variant="destructive">{unread} 未讀</Badge>}
        <Link to="/account/profile" className="ml-auto text-sm text-muted-foreground hover:underline">返回帳號</Link>
      </div>

      {!loading && data && !data.hasLineBinding && (
        <Card className="mb-6 border-amber-300 bg-amber-50/40">
          <CardContent className="py-4 flex items-start gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium mb-1">尚未綁定 LINE，將收不到 LINE 推播</div>
              <div className="text-xs text-muted-foreground">
                收盤分析完成時，會優先推播到綁定的 LINE。目前你的帳號未綁定，僅會收到 Email + 站內通知。下次用「LINE 登入」即可同時收到推播。
              </div>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/auth/login?redirect=/account/notifications">使用 LINE 登入</Link>
            </Button>
          </CardContent>
        </Card>
      )}


      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">通知偏好</CardTitle>
          <CardDescription>關閉後，將不再寫入該類型的站內通知。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {!loading && prefs && (Object.keys(PREF_LABELS) as Array<keyof typeof PREF_DEFAULTS>).map((k) => (
            <div key={k} className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-sm font-medium">{PREF_LABELS[k].title}</div>
                <div className="text-xs text-muted-foreground">{PREF_LABELS[k].desc}</div>
              </div>
              <Switch checked={prefs[k]} onCheckedChange={(v) => updatePref.mutate({ k, v })} disabled={updatePref.isPending} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">最近通知</CardTitle>
            <CardDescription>最多顯示最近 80 筆</CardDescription>
          </div>
          {unread > 0 && <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>全部已讀</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[60vh]">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">暫無通知</p>
            ) : (
              <ul className="divide-y">
                {items.map((n: any) => (
                  <li key={n.id} className={!n.is_read ? 'bg-primary/5' : ''}>
                    <button
                      onClick={() => handleClick(n)}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${!n.is_read ? 'font-medium' : ''}`}>{n.title}</span>
                            {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                          </div>
                          {n.body && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{n.body}</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(n.created_at).toLocaleString('zh-TW')}
                          </p>
                        </div>
                      </div>
                    </button>
                    {n.download_url && (
                      <div className="px-4 pb-3 -mt-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleDownload(n)}>
                          下載檔案
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
