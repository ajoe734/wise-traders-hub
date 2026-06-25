import { Eye, X } from 'lucide-react';
import { useViewAs } from '@/contexts/ViewAsContext';

/**
 * Sticky red banner shown at top of any page while an admin view-as session is
 * active. Display-only; the actual data scoping happens via useEffectiveUserId
 * inside member-scoped hooks.
 */
export function ViewAsBanner() {
  const { session, isActive, exit, msRemaining } = useViewAs();
  if (!isActive || !session) return null;
  const mins = Math.max(0, Math.floor(msRemaining / 60000));
  const secs = Math.max(0, Math.floor((msRemaining % 60000) / 1000));
  const label = session.targetDisplayName || session.targetEmail || session.targetUserId.slice(0, 8);
  return (
    <div className="sticky top-0 z-[100] bg-destructive text-destructive-foreground text-xs sm:text-sm">
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center gap-3">
        <Eye className="h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 truncate">
          <strong className="font-semibold">會員視角預覽中</strong>
          <span className="opacity-90 ml-2">{label}</span>
          <span className="opacity-75 ml-2 hidden sm:inline">·</span>
          <span className="opacity-75 ml-2 hidden sm:inline">
            剩 {mins} 分 {String(secs).padStart(2, '0')} 秒
          </span>
          <span className="opacity-75 ml-2 hidden md:inline">
            · 任何操作會以你自己的管理員身分執行
          </span>
        </div>
        <button
          onClick={exit}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background/15 hover:bg-background/25 transition-colors"
        >
          <X className="h-3.5 w-3.5" /> 退出
        </button>
      </div>
    </div>
  );
}
