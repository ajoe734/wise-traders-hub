import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatTaipeiYMDHM } from '@/checkup/utils/formatTaipeiDate';
import {
  evaluatePredictGate,
  isFreeTier,
  isInPredictWindow,
  nextPredictWindow,
  formatNextWindowLabel,
  toTaipei,
} from '@/checkup/lib/predictEventsGate';

interface UsageRow { id: string; used_at: string; kind: string }
interface QuotaSnapshot { tier: string }

/**
 * 事件預測（predict-events）使用紀錄與狀態
 * - 顯示：當前能否預測、原因、下次視窗時間（台灣時間）
 * - 列表：今日（台灣時區） + 過去 7 天歷史紀錄
 * - 規則與 supabase/functions/checkup-predict-events 一致（共用 predictEventsGate）
 */
export function PredictEventsCard() {
  const { user } = useAuth();
  const [tier, setTier] = useState<string>('');
  const [todayRows, setTodayRows] = useState<UsageRow[]>([]);
  const [historyRows, setHistoryRows] = useState<UsageRow[]>([]);
  const [dailyAnalysisCount, setDailyAnalysisCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState<Date>(new Date());

  // 每 30 秒重評視窗狀態
  useEffect(() => {
    const t = setInterval(() => setTickNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const tp = toTaipei();
        const dayStartUtc = new Date(`${tp.ymd}T00:00:00+08:00`).toISOString();
        const sevenAgoUtc = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [{ data: q }, { data: today }, { data: hist }, { count: dailyCount }] = await Promise.all([
          supabase.rpc('check_checkup_quota', { _user_id: user.id }),
          supabase.from('checkup_usage')
            .select('id, used_at, kind')
            .eq('user_id', user.id)
            .eq('kind', 'predict-events')
            .gte('used_at', dayStartUtc)
            .order('used_at', { ascending: false }),
          supabase.from('checkup_usage')
            .select('id, used_at, kind')
            .eq('user_id', user.id)
            .eq('kind', 'predict-events')
            .gte('used_at', sevenAgoUtc)
            .order('used_at', { ascending: false })
            .limit(30),
          supabase.from('checkup_usage')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('kind', 'daily-analysis'),
        ]);
        if (!alive) return;
        setTier(String((q as unknown as QuotaSnapshot)?.tier || ''));
        setTodayRows((today ?? []) as UsageRow[]);
        setHistoryRows((hist ?? []) as UsageRow[]);
        setDailyAnalysisCount(dailyCount ?? 0);
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const free = isFreeTier(tier);
  const decision = evaluatePredictGate({
    tier,
    hasDailyAnalysis: dailyAnalysisCount > 0,
    paidUsedToday: todayRows.length > 0,
    now: tickNow,
  });
  const nextLabel = formatNextWindowLabel(nextPredictWindow(tickNow).toISOString());
  const inWindow = isInPredictWindow(tickNow);
  void nextLabel;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">事件預測（每日 1 次）</h3>
          </div>
          <StatusPill decision={decision} />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 載入紀錄中…
          </div>
        ) : err ? (
          <div className="text-sm text-destructive">無法載入：{err}</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
              <p>
                <span className="text-foreground font-medium">目前台灣時間：</span>
                {formatTaipeiYMDHM(tickNow.toISOString()) || '—'}
              </p>
              <p>
                <span className="text-foreground font-medium">目前狀態：</span>
                {decision.allowed
                  ? '可立即執行事件預測'
                  : (decision as Extract<typeof decision, { allowed: false }>).message}
              </p>

              {/* Free tier 被永久停 */}
              {!decision.allowed && (decision as { code: string }).code === 'FREE_TIER_PREDICT_DISABLED' && (
                <p className="text-amber-700">
                  已執行過收盤分析共 {dailyAnalysisCount} 次；訂閱付費方案後可恢復每日 1 次預測。
                </p>
              )}

              {/* Paid 視窗外：顯示具體區間與倒數 */}
              {!decision.allowed && (decision as { code: string }).code === 'PAID_TIER_OUT_OF_WINDOW' && (
                <>
                  <p>允許執行區間：每日台灣時間 <span className="text-foreground font-medium">13:30 – 13:40</span>（收盤後 10 分鐘內）</p>
                  <p>目前 {inWindow ? '在視窗內' : '不在視窗內'}；距下次視窗開啟：
                    <span className="text-foreground font-medium"> {formatCountdown(tickNow, new Date((decision as { nextWindowUtc: string }).nextWindowUtc))}</span>
                  </p>
                  <p>下次可預測時間：{formatNextWindowLabel((decision as { nextWindowUtc: string }).nextWindowUtc)}</p>
                </>
              )}

              {/* Paid 今日已用：顯示已用的時間戳 */}
              {!decision.allowed && (decision as { code: string }).code === 'PAID_TIER_DAILY_USED' && (
                <>
                  {todayRows[0] && (
                    <p>今日已於 <span className="text-foreground font-medium">{formatTaipeiYMDHM(todayRows[0].used_at)}</span> 使用</p>
                  )}
                  <p>下次可預測時間：{formatNextWindowLabel((decision as { nextWindowUtc: string }).nextWindowUtc)}</p>
                </>
              )}

              {/* Paid 可使用：顯示視窗倒數結束 */}
              {decision.allowed && !free && (
                <p>視窗：台灣時間 13:30–13:40（目前 {inWindow ? '在視窗內' : '不在視窗內'}{inWindow ? `，剩餘 ${formatCountdown(tickNow, windowEndUtc(tickNow))}` : ''}）</p>
              )}

              <p>
                <span className="text-foreground font-medium">方案：</span>
                {free ? '免費（line_free / none）' : `付費（${tier}）`}
              </p>
            </div>

            <div className="border-t pt-3">
              <div className="text-xs text-foreground font-medium mb-2">今日（台灣時區） {todayRows.length}/1</div>
              {todayRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">尚未使用</p>
              ) : (
                <ul className="space-y-1">
                  {todayRows.map(r => (
                    <li key={r.id} className="text-xs flex items-center justify-between">
                      <span className="text-muted-foreground">{formatTaipeiYMDHM(r.used_at) || '—'}</span>
                      <span className="text-foreground">已使用</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t pt-3">
              <div className="text-xs text-foreground font-medium mb-2">最近 7 天歷史（最多 30 筆）</div>
              {historyRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">無歷史紀錄</p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {historyRows.map(r => (
                    <li key={r.id} className="text-xs flex items-center justify-between">
                      <span className="text-muted-foreground">{formatTaipeiYMDHM(r.used_at) || '—'}</span>
                      <span className="text-foreground">predict-events</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ decision }: { decision: ReturnType<typeof evaluatePredictGate> }) {
  if (decision.allowed) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" /> 可使用
      </span>
    );
  }
  const denied = decision as Extract<typeof decision, { allowed: false }>;
  if (denied.code === 'PAID_TIER_OUT_OF_WINDOW') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-50 text-amber-700 inline-flex items-center gap-1">
        <Clock className="h-3 w-3" /> 視窗外
      </span>
    );
  }
  if (denied.code === 'PAID_TIER_DAILY_USED') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-muted-foreground/30 bg-muted text-muted-foreground inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" /> 今日已用
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive inline-flex items-center gap-1">
      <XCircle className="h-3 w-3" /> 已停用
    </span>
  );
}
