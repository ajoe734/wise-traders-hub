import { useState } from 'react';
import { Eye, X, Copy, Check, LogOut } from 'lucide-react';
import { useViewAs } from '@/contexts/ViewAsContext';
import { toast } from '@/hooks/use-toast';

/**
 * Sticky red banner shown at top of any page while an admin view-as session is
 * active. Display-only; the actual data scoping happens via useEffectiveUserId
 * inside member-scoped hooks.
 */
export function ViewAsBanner() {
  const { session, isActive, exit, msRemaining } = useViewAs();
  const [copied, setCopied] = useState(false);
  if (!isActive || !session) return null;

  const mins = Math.max(0, Math.floor(msRemaining / 60000));
  const secs = Math.max(0, Math.floor((msRemaining % 60000) / 1000));
  const name = session.targetDisplayName || session.targetEmail || session.targetUserId.slice(0, 8);
  const roles = (session.targetRoles && session.targetRoles.length > 0)
    ? session.targetRoles.join(' / ')
    : 'member';
  const subs = (session.targetActiveExpertSubs ?? 0) + (session.targetActiveCheckupSubs ?? 0);
  const subLabel = subs > 0
    ? `訂閱 ${session.targetActiveExpertSubs ?? 0} · 健檢 ${session.targetActiveCheckupSubs ?? 0}`
    : '無有效訂閱';

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(session.targetUserId);
      setCopied(true);
      toast({ title: '已複製會員 ID', description: session.targetUserId });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: '複製失敗', description: '請手動選取 ID', variant: 'destructive' });
    }
  };

  return (
    <div className="sticky top-0 z-[100] bg-destructive text-destructive-foreground text-xs sm:text-sm shadow-md">
      <div className="max-w-7xl mx-auto px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <strong className="font-semibold shrink-0">會員視角預覽中</strong>
          <span className="truncate font-medium">{name}</span>
          {session.targetEmail && session.targetDisplayName && (
            <span className="opacity-80 truncate hidden md:inline">· {session.targetEmail}</span>
          )}
          <span className="opacity-90 hidden sm:inline">· {roles}</span>
          <span className="opacity-90 hidden sm:inline">· {subLabel}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <code
            className="hidden lg:inline-block text-[11px] font-mono px-1.5 py-0.5 rounded bg-background/15"
            title={session.targetUserId}
          >
            {session.targetUserId.slice(0, 8)}…
          </code>
          <button
            onClick={copyId}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background/15 hover:bg-background/25 transition-colors"
            title="複製完整會員 ID"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? '已複製' : '複製 ID'}</span>
          </button>
          <span className="opacity-75 tabular-nums text-[11px] sm:text-sm">
            剩 {mins}:{String(secs).padStart(2, '0')}
          </span>
          <button
            onClick={exit}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background/20 hover:bg-background/30 transition-colors font-medium"
            title="退出視角，回到管理員身分"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>退出視角</span>
          </button>
        </div>
      </div>
    </div>
  );
}
