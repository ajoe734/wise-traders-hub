import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/trafficTracker';

export const OFFICIAL_LINE = {
  basicId: '@621opcej',
  name: '智富股市實戰學院',
  addUrl: 'https://line.me/R/ti/p/@621opcej',
  qrUrl: 'https://qr-official.line.me/sid/L/621opcej.png',
};

const ACK_KEY = 'official_line_acked_at';
const SKIP_KEY = 'official_line_gate_skipped';

/** 結帳前引導加入官方 LINE。不擋付款：可「稍後再加」。 */
export function JoinOfficialLineGate() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const meta = (data.user?.user_metadata || {}) as Record<string, unknown>;
      if (meta[ACK_KEY]) return;
      try { if (sessionStorage.getItem(SKIP_KEY)) return; } catch { /* ignore */ }
      if (user?.lineUserId) {
        try {
          const { data: st } = await supabase.functions.invoke('line-friend-status');
          if ((st as any)?.isFriend) {
            await supabase.auth.updateUser({ data: { [ACK_KEY]: new Date().toISOString() } });
            return;
          }
        } catch { /* fall through to show */ }
      }
      if (!cancelled) {
        setOpen(true);
        trackEvent('line_gate_shown' as any, {} as any);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.lineUserId]);

  const confirm = async () => {
    trackEvent('line_gate_confirm' as any, {} as any);
    setOpen(false);
    await supabase.auth.updateUser({ data: { [ACK_KEY]: new Date().toISOString() } });
  };
  const skip = () => {
    trackEvent('line_gate_skip' as any, {} as any);
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) skip(); }}>
      <DialogContent className="max-w-sm text-center">
        <DialogTitle className="text-xl font-bold text-center">訂閱前，先加入官方 LINE</DialogTitle>
        <DialogDescription className="text-center">
          開通通知、到期提醒都會從這裡送出，避免漏接
        </DialogDescription>
        <img
          src={OFFICIAL_LINE.qrUrl}
          alt="官方 LINE QR Code"
          width={180}
          height={180}
          className="mx-auto hidden sm:block"
        />
        <p className="text-sm text-muted-foreground">{OFFICIAL_LINE.basicId} {OFFICIAL_LINE.name}</p>
        <div className="space-y-2">
          <Button
            asChild
            className="w-full bg-[#06C755] hover:bg-[#06C755]/90 text-primary-foreground"
            onClick={() => trackEvent('line_gate_join_click' as any, {} as any)}
          >
            <a href={OFFICIAL_LINE.addUrl} target="_blank" rel="noopener noreferrer">加入官方 LINE 好友</a>
          </Button>
          <Button className="w-full" onClick={confirm}>我已加入，繼續結帳</Button>
          <button type="button" onClick={skip} className="text-sm text-muted-foreground hover:underline">
            稍後再加
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
