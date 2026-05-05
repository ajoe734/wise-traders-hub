import { useEffect, useState } from 'react';
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

type Pref = {
  user_id: string;
  target_price_new: boolean;
  target_price_updated: boolean;
  target_price_weekly: boolean;
  meta_override_changed: boolean;
};

const PREF_DEFAULTS: Omit<Pref, 'user_id'> = {
  target_price_new: true,
  target_price_updated: true,
  target_price_weekly: true,
  meta_override_changed: true,
};

const PREF_LABELS: Record<keyof typeof PREF_DEFAULTS, { title: string; desc: string }> = {
  target_price_new: { title: '新增目標價', desc: '券商首次發布目標價時通知' },
  target_price_updated: { title: '修改目標價', desc: '券商上修或下修目標價時通知' },
  target_price_weekly: { title: '每週自動刷新', desc: '系統每週一自動掃描目標價變化的彙總' },
  meta_override_changed: { title: '產業/策略覆蓋變更', desc: 'AI 研究覆蓋持倉的產業、策略、領頭欄位時通知' },
};

export default function AccountNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Pref | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      const [{ data: pData }, { data: nData }] = await Promise.all([
        supabase.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(80),
      ]);
      setPrefs((pData as Pref) || { user_id: user.id, ...PREF_DEFAULTS });
      setItems(nData || []);
      setLoading(false);
    })();
  }, [user?.id]);

  const update = async (k: keyof typeof PREF_DEFAULTS, v: boolean) => {
    if (!prefs || !user?.id) return;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    setSaving(true);
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: user.id,
      target_price_new: next.target_price_new,
      target_price_updated: next.target_price_updated,
      target_price_weekly: next.target_price_weekly,
      meta_override_changed: next.meta_override_changed,
    }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) toast.error('儲存失敗：' + error.message);
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const handleClick = async (n: any) => {
    if (!n.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    if (n.link) navigate(n.link);
  };

  const unread = items.filter((i) => !i.is_read).length;

  return (
    <div className="container mx-auto max-w-3xl py-8 px-4">
      <div className="mb-6 flex items-center gap-3">
        <Bell className="h-6 w-6" />
        <h1 className="text-2xl font-medium">提醒中心</h1>
        {unread > 0 && <Badge variant="destructive">{unread} 未讀</Badge>}
        <Link to="/account/profile" className="ml-auto text-sm text-muted-foreground hover:underline">返回帳號</Link>
      </div>

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
              <Switch checked={prefs[k]} onCheckedChange={(v) => update(k, v)} disabled={saving} />
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
          {unread > 0 && <Button variant="outline" size="sm" onClick={markAllRead}>全部已讀</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[60vh]">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">暫無通知</p>
            ) : (
              <ul className="divide-y">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleClick(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${!n.is_read ? 'bg-primary/5' : ''}`}
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
