import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { fetchMemberNotifications } from '@/lib/memberDataAccess';

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { notifications: items } = await fetchMemberNotifications(supabase, user.id, 20);
      return items;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const unreadCount = useMemo(() => notifications.filter((n: any) => !n.is_read).length, [notifications]);

  const setLocal = (mapper: (n: any) => any) => {
    queryClient.setQueryData(['notifications', user?.id], (prev: any[] | undefined) =>
      (prev || []).map(mapper),
    );
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    setLocal((n) => ({ ...n, is_read: true }));
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
  };

  const handleClick = async (notif: any) => {
    if (!notif.is_read) {
      setLocal((n) => (n.id === notif.id ? { ...n, is_read: true } : n));
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
    }
    if (notif.link) {
      setOpen(false);
      navigate(notif.link);
    }
  };

  const typeIcons: Record<string, string> = {
    info: '📢',
    signal: '📡',
    subscription: '🎫',
    warning: '⚠️',
    recall: '🔄',
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="font-medium text-sm">通知</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={markAllRead}>
                全部已讀
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setOpen(false); navigate('/account/notifications'); }}>
              提醒中心
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">暫無通知</p>
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors",
                  !n.is_read && "bg-primary/5"
                )}
              >
                <div className="flex gap-2">
                  <span className="text-sm shrink-0">{typeIcons[n.type] || '📢'}</span>
                  <div className="min-w-0">
                    <p className={cn("text-sm truncate", !n.is_read && "font-medium")}>{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground truncate">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(n.created_at).toLocaleString('zh-TW')}
                    </p>
                  </div>
                  {!n.is_read && <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
