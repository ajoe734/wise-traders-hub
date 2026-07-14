import { useMemo } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { avatarUrl } from '@/lib/imageTransform';
import { cn } from '@/lib/utils';

export interface TimelineSegment {
  id: string;
  plan_name: string | null;
  started_at: string;
  expires_at: string | null;
  status: string;
  canceled_at: string | null;
  is_currently_active: boolean;
}

export interface SubscriptionTimelineProps {
  segments: TimelineSegment[];
  expertName?: string;
  expertAvatarUrl?: string | null;
  /** 修煉派老師才畫 7 天延伸（週記可視期）。預設 true。 */
  showMentorLookback?: boolean;
  /** 詳情頁：本篇 published_at，會在條上畫 ▲ 指標。 */
  highlightAt?: Date | null;
  className?: string;
}

const MENTOR_LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function fmtYMD(d: Date | string | null): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return format(dt, 'yyyy/MM/dd');
}

/**
 * 使用者訂閱歷史時間軸（橫向條）。純展示元件。
 *
 * - `is_currently_active`：主色 mentor 藍
 * - `status = expired` 或已過期：灰
 * - `canceled_at != null`：加對角紋
 * - segment 間空窗：條上顯示斷開 + 空窗天數
 * - `showMentorLookback = true`：段前後各畫 7 天淺色延伸（週記回溯規則）
 * - `highlightAt`：在條上對應日期畫 ▲
 *
 * 響應式：<640px 用直向堆疊模式（每段獨立小條）避免過細擠壓；>=640px 用橫向條。
 */
export function SubscriptionTimeline({
  segments,
  expertName,
  expertAvatarUrl,
  showMentorLookback = true,
  highlightAt = null,
  className,
}: SubscriptionTimelineProps) {
  const now = useMemo(() => new Date(), []);

  const sorted = useMemo(
    () => [...(segments || [])].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    ),
    [segments],
  );

  const { rangeStart, rangeEnd, totalMs } = useMemo(() => {
    if (sorted.length === 0) {
      return { rangeStart: now, rangeEnd: now, totalMs: 1 };
    }
    const lookbackMs = showMentorLookback ? MENTOR_LOOKBACK_DAYS * DAY_MS : 0;
    const starts = sorted.map(s => new Date(s.started_at).getTime() - lookbackMs);
    const ends = sorted.map(s => {
      const exp = s.expires_at ? new Date(s.expires_at).getTime() : now.getTime();
      return exp + lookbackMs;
    });
    const nowMs = now.getTime();
    const minS = Math.min(...starts);
    const maxE = Math.max(...ends, nowMs);
    return {
      rangeStart: new Date(minS),
      rangeEnd: new Date(maxE),
      totalMs: Math.max(maxE - minS, 1),
    };
  }, [sorted, showMentorLookback, now]);

  const pct = (d: Date) => {
    const p = ((d.getTime() - rangeStart.getTime()) / totalMs) * 100;
    return Math.max(0, Math.min(100, p));
  };

  // a11y label：把每段拼成一句
  const ariaLabel = useMemo(() => {
    const parts = sorted.map(seg => {
      const start = fmtYMD(seg.started_at);
      const end = seg.expires_at ? fmtYMD(seg.expires_at) : '無到期';
      const state = seg.is_currently_active ? '進行中' : (seg.canceled_at ? '已取消' : '已過期');
      return `${seg.plan_name || '訂閱'} ${start}–${end}（${state}）`;
    });
    const prefix = expertName ? `${expertName} 訂閱時間軸：` : '訂閱時間軸：';
    return prefix + parts.join('；');
  }, [sorted, expertName]);

  if (sorted.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <section
        className={cn(
          'rounded-lg border border-border/60 bg-card/50 p-3 sm:p-4 space-y-3',
          className,
        )}
        aria-label={ariaLabel}
      >
        {/* 標題列 */}
        <header className="flex items-center gap-2 flex-wrap">
          {expertAvatarUrl !== undefined && (
            <img
              src={avatarUrl(expertAvatarUrl ?? null, 48)}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-6 w-6 rounded-full object-cover object-[center_15%] shrink-0"
              aria-hidden="true"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-medium text-foreground">
              {expertName ? `${expertName}｜訂閱有效期間` : '訂閱有效期間'}
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {fmtYMD(rangeStart)} — {fmtYMD(rangeEnd)}
              {showMentorLookback && (
                <span className="ml-1">（含週記 7 天回溯）</span>
              )}
            </p>
          </div>
        </header>

        {/* 橫向時間軸條 (>=640px) */}
        <div className="hidden sm:block">
          <div
            className="relative h-8 rounded-md bg-muted/40 overflow-hidden"
            role="presentation"
          >
            {/* segments */}
            {sorted.map((seg) => {
              const s = new Date(seg.started_at);
              const e = seg.expires_at ? new Date(seg.expires_at) : now;
              const left = pct(s);
              const width = Math.max(pct(e) - left, 0.5);
              const isActive = seg.is_currently_active;
              const isCanceled = !!seg.canceled_at;
              const label = isActive ? '進行中' : (isCanceled ? '已取消' : '已過期');
              return (
                <Tooltip key={seg.id}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'absolute top-1 bottom-1 rounded-sm border transition-opacity hover:opacity-90 cursor-help',
                        isActive
                          ? 'bg-mentor border-mentor-dark'
                          : 'bg-muted-foreground/30 border-muted-foreground/40',
                        isCanceled && 'bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(0,0,0,0.15)_4px_8px)]',
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      aria-label={`${seg.plan_name || '訂閱'} ${fmtYMD(s)}–${seg.expires_at ? fmtYMD(seg.expires_at) : '無到期'}（${label}）`}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <div className="font-medium">{seg.plan_name || '訂閱'}</div>
                    <div>{fmtYMD(s)} → {seg.expires_at ? fmtYMD(seg.expires_at) : '無到期日'}</div>
                    <div className="text-muted-foreground">{label}</div>
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {/* mentor 7 天延伸（淺色條紋） */}
            {showMentorLookback && sorted.map((seg) => {
              const s = new Date(seg.started_at);
              const e = seg.expires_at ? new Date(seg.expires_at) : now;
              const preLeft = pct(new Date(s.getTime() - MENTOR_LOOKBACK_DAYS * DAY_MS));
              const preWidth = pct(s) - preLeft;
              const postLeft = pct(e);
              const postWidth = pct(new Date(e.getTime() + MENTOR_LOOKBACK_DAYS * DAY_MS)) - postLeft;
              return (
                <div key={`lb-${seg.id}`} aria-hidden="true">
                  {preWidth > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="absolute top-1 bottom-1 rounded-sm bg-mentor/15 border border-dashed border-mentor/40 pointer-events-auto cursor-help"
                          style={{ left: `${preLeft}%`, width: `${preWidth}%` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        導師週記可視期回溯 7 天
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {postWidth > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="absolute top-1 bottom-1 rounded-sm bg-mentor/15 border border-dashed border-mentor/40 pointer-events-auto cursor-help"
                          style={{ left: `${postLeft}%`, width: `${postWidth}%` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        導師週記可視期延伸 7 天
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })}

            {/* 今日刻線 */}
            {now.getTime() >= rangeStart.getTime() && now.getTime() <= rangeEnd.getTime() && (
              <div
                className="absolute top-0 bottom-0 w-px bg-foreground/60"
                style={{ left: `${pct(now)}%` }}
                aria-hidden="true"
              >
                <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-foreground/60 whitespace-nowrap">今日</span>
              </div>
            )}

            {/* highlight (本篇週記) */}
            {highlightAt && highlightAt.getTime() >= rangeStart.getTime() && highlightAt.getTime() <= rangeEnd.getTime() && (
              <div
                className="absolute -bottom-1 -translate-x-1/2 text-mentor"
                style={{ left: `${pct(highlightAt)}%` }}
                aria-label={`本篇週記發布於 ${fmtYMD(highlightAt)}`}
              >
                <div className="text-[10px]">▲</div>
              </div>
            )}
          </div>

          {/* 兩端日期 */}
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{fmtYMD(rangeStart)}</span>
            <span>{fmtYMD(rangeEnd)}</span>
          </div>

          {/* 空窗提示 */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {sorted.map((seg, i) => {
              if (i === 0) return null;
              const prev = sorted[i - 1];
              const prevEnd = prev.expires_at ? new Date(prev.expires_at) : now;
              const currStart = new Date(seg.started_at);
              const gapDays = Math.floor((currStart.getTime() - prevEnd.getTime()) / DAY_MS);
              if (gapDays <= 0) return null;
              return (
                <span key={`gap-${seg.id}`}>
                  {fmtYMD(prevEnd)} — {fmtYMD(currStart)}：空窗 {gapDays} 天
                </span>
              );
            })}
          </div>
        </div>

        {/* 手機版：直向段落列表 */}
        <ul className="sm:hidden space-y-2">
          {sorted.map((seg, i) => {
            const isActive = seg.is_currently_active;
            const isCanceled = !!seg.canceled_at;
            const label = isActive ? '進行中' : (isCanceled ? '已取消' : '已過期');
            const prev = i > 0 ? sorted[i - 1] : null;
            const gapDays = prev
              ? Math.floor(
                  (new Date(seg.started_at).getTime() -
                    (prev.expires_at ? new Date(prev.expires_at).getTime() : now.getTime())) / DAY_MS,
                )
              : 0;
            const isHighlighted = highlightAt
              && highlightAt >= new Date(seg.started_at)
              && (!seg.expires_at || highlightAt <= new Date(seg.expires_at));
            return (
              <li key={seg.id}>
                {gapDays > 0 && (
                  <div className="text-[11px] text-muted-foreground py-1 pl-2 border-l-2 border-dashed border-muted-foreground/40">
                    空窗 {gapDays} 天
                  </div>
                )}
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2',
                    isActive ? 'bg-mentor/10 border-mentor/40' : 'bg-muted/40 border-border',
                    isHighlighted && 'ring-2 ring-mentor',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{seg.plan_name || '訂閱'}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtYMD(seg.started_at)} → {seg.expires_at ? fmtYMD(seg.expires_at) : '無到期'}
                    </div>
                  </div>
                  <Badge
                    variant={isActive ? 'default' : 'secondary'}
                    className={cn(
                      'text-[10px] shrink-0',
                      isActive && 'bg-mentor hover:bg-mentor',
                      isCanceled && !isActive && 'bg-amber-500/20 text-amber-700 border-amber-500/40',
                    )}
                  >
                    {label}
                  </Badge>
                </div>
                {isHighlighted && (
                  <div className="text-[10px] text-mentor pl-2 mt-0.5">
                    ▲ 本篇週記發布於 {fmtYMD(highlightAt!)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* 圖例 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-mentor" /> 進行中
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-muted-foreground/30" /> 已過期
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-[repeating-linear-gradient(45deg,transparent_0_2px,rgba(0,0,0,0.25)_2px_4px)]" /> 已取消
          </span>
          {showMentorLookback && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm bg-mentor/15 border border-dashed border-mentor/40" /> 週記 ±7 天
            </span>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
