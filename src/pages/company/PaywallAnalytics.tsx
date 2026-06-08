import { SEO } from '@/components/SEO';
import { useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, ArrowRight, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';

// 哪些 fn 視為「金流 / webhook」相關
const WEBHOOK_FN_PATTERNS = ['webhook', 'callback', 'notify-payment', 'verify-payment', 'ecpay', 'linepay', 'acpay', 'remittance'];
// 哪些 payment_intents.status 視為失敗
const CHECKOUT_FAIL_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'abandoned', 'expired', 'error']);

// W4-4 Paywall analytics — 完整漏斗 + 步驟級下滑告警

interface PaywallRow {
  user_id: string | null;
  visitor_id: string | null;
  surface: string;
  variant: string | null;
  event_kind: string;
  created_at: string;
}

const SINCE_DAYS = 30;
const RECENT_DAYS = 7;            // 近窗：最近 7 天
const BASELINE_DAYS = SINCE_DAYS - RECENT_DAYS; // 基準：前 23 天
const REL_DROP_THRESHOLD = 0.2;   // 相對下滑 ≥ 20%
const ABS_DROP_THRESHOLD = 0.02;  // 絕對下滑 ≥ 2pp
const MIN_SAMPLE = 30;            // 近窗該步驟前一階段樣本 ≥ 30 才告警，避免雜訊

// 各步驟對應的可能原因提示
const STEP_REASONS: Record<string, string[]> = {
  hit_limit: [
    '配額門檻被調整或免費額度放寬，使用者更難「觸限」',
    'HoldingsQuotaMeter 的 hit_limit 埋點失效（檢查 remaining===0 條件）',
    '前台快取/SSR 導致 quota 顯示落後，未及時觸發',
  ],
  click_upgrade: [
    'CTA 文案/位置改動，吸引力下降（B 變體可能不如 A）',
    '升級連結 onClick 未掛 trackPaywall(\'click_upgrade\')',
    '訂閱頁路徑改變導致 CTA 跳轉錯誤、使用者跳出',
    'Banner 被其他 UI 遮蔽（mobile RWD 回歸）',
  ],
  checkout: [
    'Checkout 頁面載入錯誤或路由失效（檢查 /checkout/:slug/:planId）',
    '方案無可用 payment_providers，無法進入結帳',
    'method 預選參數帶錯導致空白頁',
    '訂閱頁→結帳的連結被改動',
  ],
  subscribed: [
    '金流（ECPay / LINE Pay / ACPay）回呼或 webhook 失敗',
    'create-payment-intent / verify-payment edge function 錯誤',
    '價格或方案調整導致使用者放棄',
    'member_subscriptions 寫入條件被改動（active/expired 篩選）',
  ],
};

export default function PaywallAnalytics() {
  const now = Date.now();
  const sinceIso = useMemo(() => new Date(now - SINCE_DAYS * 86400_000).toISOString(), [now]);
  const recentSinceMs = now - RECENT_DAYS * 86400_000;
  const recentSinceIso = new Date(recentSinceMs).toISOString();

  const { data: events, isFetching: loadingEvents, refetch: refetchEvents } = useQuery({
    queryKey: ['paywall-events', SINCE_DAYS],
    queryFn: async (): Promise<PaywallRow[]> => {
      const { data, error } = await supabase
        .from('paywall_events')
        .select('user_id, visitor_id, surface, variant, event_kind, created_at')
        .gte('created_at', sinceIso)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as PaywallRow[];
    },
    staleTime: 60_000,
  });

  // 拆兩個窗：近 7 天 vs 前 23 天
  const stageActors = useMemo(() => {
    const make = () => ({ view: new Set<string>(), hit_limit: new Set<string>(), click_upgrade: new Set<string>() });
    const recent = make();
    const baseline = make();
    const userIds = new Set<string>();
    for (const r of events ?? []) {
      const key = r.user_id || (r.visitor_id ? `v:${r.visitor_id}` : null);
      if (!key) continue;
      if (r.user_id) userIds.add(r.user_id);
      const isRecent = new Date(r.created_at).getTime() >= recentSinceMs;
      const bucket = isRecent ? recent : baseline;
      if (r.event_kind === 'view') bucket.view.add(key);
      else if (r.event_kind === 'hit_limit') bucket.hit_limit.add(key);
      else if (r.event_kind === 'click_upgrade') bucket.click_upgrade.add(key);
    }
    // 全期合併（給原本的漏斗顯示用）
    const all = make();
    (['view', 'hit_limit', 'click_upgrade'] as const).forEach((k) => {
      recent[k].forEach((v) => all[k].add(v));
      baseline[k].forEach((v) => all[k].add(v));
    });
    return { recent, baseline, all, userIds: Array.from(userIds) };
  }, [events, recentSinceMs]);

  const { data: downstream, isFetching: loadingDown, refetch: refetchDown } = useQuery({
    queryKey: ['paywall-downstream', stageActors.userIds.length, sinceIso],
    enabled: stageActors.userIds.length > 0,
    queryFn: async () => {
      const ids = stageActors.userIds;
      const [{ data: intents, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
        supabase
          .from('payment_intents')
          .select('user_id, status, created_at')
          .gte('created_at', sinceIso)
          .in('user_id', ids),
        supabase
          .from('member_subscriptions')
          .select('user_id, status, started_at')
          .gte('started_at', sinceIso)
          .in('user_id', ids),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const checkoutAll = new Set<string>();
      const checkoutRecent = new Set<string>();
      for (const row of intents ?? []) {
        if (!row.user_id) continue;
        checkoutAll.add(row.user_id);
        if (new Date(row.created_at).getTime() >= recentSinceMs) checkoutRecent.add(row.user_id);
      }
      const subAll = new Set<string>();
      const subRecent = new Set<string>();
      for (const row of subs ?? []) {
        if (!row.user_id) continue;
        if (!(row.status === 'active' || row.status === 'expired')) continue;
        subAll.add(row.user_id);
        if (row.started_at && new Date(row.started_at).getTime() >= recentSinceMs) subRecent.add(row.user_id);
      }
      return {
        checkoutAll, subAll,
        checkoutRecent, subRecent,
        checkoutBaseline: new Set([...checkoutAll].filter((x) => !checkoutRecent.has(x))),
        subBaseline: new Set([...subAll].filter((x) => !subRecent.has(x))),
      };
    },
    staleTime: 60_000,
  });

  // 全期漏斗
  const funnel = useMemo(() => {
    const view = stageActors.all.view.size;
    const hit = stageActors.all.hit_limit.size;
    const click = stageActors.all.click_upgrade.size;
    const checkout = downstream?.checkoutAll.size ?? 0;
    const subscribed = downstream?.subAll.size ?? 0;
    return [
      { key: 'view', label: 'View 曝光', count: view, prev: null as number | null },
      { key: 'hit_limit', label: 'Hit Limit 觸及上限', count: hit, prev: view },
      { key: 'click_upgrade', label: 'Click Upgrade 點擊升級', count: click, prev: hit },
      { key: 'checkout', label: 'Checkout 進入結帳', count: checkout, prev: click },
      { key: 'subscribed', label: '成功訂閱', count: subscribed, prev: checkout },
    ];
  }, [stageActors, downstream]);

  // 告警：比較 recent 與 baseline 各步驟轉換率
  const alerts = useMemo(() => {
    const r = stageActors.recent;
    const b = stageActors.baseline;
    const dcR = downstream?.checkoutRecent.size ?? 0;
    const dcB = downstream?.checkoutBaseline.size ?? 0;
    const dsR = downstream?.subRecent.size ?? 0;
    const dsB = downstream?.subBaseline.size ?? 0;

    const steps = [
      { key: 'hit_limit', label: 'View → Hit Limit', recentNum: r.hit_limit.size, recentDen: r.view.size, baseNum: b.hit_limit.size, baseDen: b.view.size },
      { key: 'click_upgrade', label: 'Hit Limit → Click', recentNum: r.click_upgrade.size, recentDen: r.hit_limit.size, baseNum: b.click_upgrade.size, baseDen: b.hit_limit.size },
      { key: 'checkout', label: 'Click → Checkout', recentNum: dcR, recentDen: r.click_upgrade.size, baseNum: dcB, baseDen: b.click_upgrade.size },
      { key: 'subscribed', label: 'Checkout → 訂閱', recentNum: dsR, recentDen: dcR, baseNum: dsB, baseDen: dcB },
    ];

    return steps.map((s) => {
      const recentRate = s.recentDen > 0 ? s.recentNum / s.recentDen : null;
      const baseRate = s.baseDen > 0 ? s.baseNum / s.baseDen : null;
      let status: 'ok' | 'warn' | 'insufficient' = 'ok';
      let absDrop = 0;
      let relDrop = 0;
      if (recentRate === null || baseRate === null || s.recentDen < MIN_SAMPLE) {
        status = 'insufficient';
      } else {
        absDrop = baseRate - recentRate;
        relDrop = baseRate > 0 ? absDrop / baseRate : 0;
        if (absDrop >= ABS_DROP_THRESHOLD && relDrop >= REL_DROP_THRESHOLD) status = 'warn';
      }
      return { ...s, recentRate, baseRate, absDrop, relDrop, status };
    });
  }, [stageActors, downstream]);

  const summary = useMemo(() => {
    const map = new Map<string, { surface: string; variant: string; view: number; hit_limit: number; click_upgrade: number }>();
    for (const r of events ?? []) {
      const variant = r.variant || '?';
      const key = `${r.surface}|${variant}`;
      if (!map.has(key)) map.set(key, { surface: r.surface, variant, view: 0, hit_limit: 0, click_upgrade: 0 });
      const cur = map.get(key)!;
      if (r.event_kind === 'view') cur.view++;
      else if (r.event_kind === 'hit_limit') cur.hit_limit++;
      else if (r.event_kind === 'click_upgrade') cur.click_upgrade++;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.surface === b.surface ? a.variant.localeCompare(b.variant) : a.surface.localeCompare(b.surface),
    );
  }, [events]);

  const fmtPct = (n: number, d: number | null) => (d && d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
  const fmtRate = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);
  const overallRate = funnel[0].count > 0 ? funnel[funnel.length - 1].count / funnel[0].count : 0;
  const loading = loadingEvents || loadingDown;
  const warnCount = alerts.filter((a) => a.status === 'warn').length;

  return (
    <>
      <SEO title="Paywall 轉換分析 | legendflow 後台" description="Paywall 漏斗：曝光、觸限、點擊、結帳、訂閱成功，含步驟下滑告警" />
      <CompanyLayout>
        <div className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-medium tracking-tight">Paywall 轉換分析</h1>
              <p className="text-sm text-muted-foreground mt-1">最近 {SINCE_DAYS} 天｜以唯一使用者計算｜近窗 {RECENT_DAYS} 天 vs 基準 {BASELINE_DAYS} 天</p>
            </div>
            <button
              onClick={() => { refetchEvents(); refetchDown(); }}
              className="text-xs text-muted-foreground underline"
            >
              重新整理
            </button>
          </div>

          {/* 告警區 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {warnCount > 0 ? <AlertTriangle className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                步驟轉換告警
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  條件：近 {RECENT_DAYS} 天相對下滑 ≥ {(REL_DROP_THRESHOLD * 100).toFixed(0)}% 且絕對下滑 ≥ {(ABS_DROP_THRESHOLD * 100).toFixed(0)}pp（前一階段樣本 ≥ {MIN_SAMPLE}）
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!loading && warnCount === 0 && (
                <div className="text-sm text-muted-foreground">目前所有步驟轉換率穩定，未偵測到顯著下滑。</div>
              )}
              {!loading && alerts.map((a) => {
                if (a.status !== 'warn') return null;
                const reasons = STEP_REASONS[a.key] ?? [];
                return (
                  <Alert key={a.key} variant="destructive">
                    <TrendingDown className="h-4 w-4" />
                    <AlertTitle className="flex items-center gap-2 flex-wrap">
                      <span>{a.label}</span>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {fmtRate(a.baseRate)} → {fmtRate(a.recentRate)}
                      </Badge>
                      <span className="text-xs font-normal">
                        相對下滑 {(a.relDrop * 100).toFixed(1)}%（絕對 {(a.absDrop * 100).toFixed(1)}pp）
                      </span>
                    </AlertTitle>
                    <AlertDescription className="mt-2">
                      <div className="text-xs mb-1 opacity-80">可能原因（請依序排查）：</div>
                      <ul className="list-disc pl-5 space-y-0.5 text-xs">
                        {reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                );
              })}

              {/* 完整步驟比較表 */}
              {!loading && (
                <div className="overflow-x-auto pt-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-xs text-muted-foreground">
                        <th className="py-2 pr-4">步驟</th>
                        <th className="py-2 pr-4 text-right">基準 {BASELINE_DAYS}d</th>
                        <th className="py-2 pr-4 text-right">近 {RECENT_DAYS}d</th>
                        <th className="py-2 pr-4 text-right">變化</th>
                        <th className="py-2 text-right">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((a) => {
                        const delta = a.recentRate !== null && a.baseRate !== null ? (a.recentRate - a.baseRate) * 100 : null;
                        return (
                          <tr key={a.key} className="border-b last:border-0">
                            <td className="py-2 pr-4">{a.label}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{fmtRate(a.baseRate)}<span className="text-[10px] text-muted-foreground ml-1">({a.baseNum}/{a.baseDen})</span></td>
                            <td className="py-2 pr-4 text-right tabular-nums">{fmtRate(a.recentRate)}<span className="text-[10px] text-muted-foreground ml-1">({a.recentNum}/{a.recentDen})</span></td>
                            <td className={`py-2 pr-4 text-right tabular-nums ${delta !== null && delta < 0 ? 'text-destructive' : delta !== null && delta > 0 ? 'text-emerald-600' : ''}`}>
                              {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`}
                            </td>
                            <td className="py-2 text-right">
                              {a.status === 'warn' && <Badge variant="destructive" className="text-[10px]">下滑</Badge>}
                              {a.status === 'ok' && <Badge variant="secondary" className="text-[10px]">穩定</Badge>}
                              {a.status === 'insufficient' && <Badge variant="outline" className="text-[10px]">樣本不足</Badge>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 漏斗 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="w-4 h-4" />
                轉換漏斗（全期 {SINCE_DAYS} 天）
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  整體轉換率（view → 訂閱）：<span className="text-foreground font-medium tabular-nums">{(overallRate * 100).toFixed(2)}%</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!loading && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  {funnel.map((s, i) => {
                    const stepRate = s.prev === null ? null : fmtPct(s.count, s.prev);
                    const overall = funnel[0].count > 0 ? (s.count / funnel[0].count) * 100 : 0;
                    return (
                      <div key={s.key} className="relative">
                        <div className="border rounded-md p-3 h-full">
                          <div className="text-xs text-muted-foreground">{i + 1}. {s.label}</div>
                          <div className="text-2xl font-medium tabular-nums mt-1">{s.count}</div>
                          <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
                            <span>上一步轉換</span>
                            <span className="text-foreground tabular-nums">{stepRate ?? '—'}</span>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center justify-between">
                            <span>佔曝光</span>
                            <span className="text-foreground tabular-nums">{funnel[0].count > 0 ? `${overall.toFixed(1)}%` : '—'}</span>
                          </div>
                          <div className="mt-2 h-1 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(overall, 100)}%` }} />
                          </div>
                        </div>
                        {i < funnel.length - 1 && (
                          <ArrowRight className="hidden md:block w-4 h-4 text-muted-foreground absolute -right-3 top-1/2 -translate-y-1/2 z-10" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                註：Checkout 與成功訂閱以「曾出現於 paywall 事件中的 user_id」為母體。匿名訪客（僅 visitor_id）只計入前三步。
              </p>
            </CardContent>
          </Card>

          {/* Surface × Variant 拆分 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Surface × Variant 拆分（事件總數）</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEvents && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!loadingEvents && summary.length === 0 && <div className="text-sm text-muted-foreground">最近 {SINCE_DAYS} 天尚無資料</div>}
              {!loadingEvents && summary.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-xs text-muted-foreground">
                        <th className="py-2 pr-4">Surface</th>
                        <th className="py-2 pr-4">Variant</th>
                        <th className="py-2 pr-4 text-right">View</th>
                        <th className="py-2 pr-4 text-right">Hit Limit</th>
                        <th className="py-2 pr-4 text-right">Click</th>
                        <th className="py-2 pr-4 text-right">CTR (click/view)</th>
                        <th className="py-2 text-right">click/hit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r) => (
                        <tr key={`${r.surface}-${r.variant}`} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{r.surface}</td>
                          <td className="py-2 pr-4"><Badge variant={r.variant === 'A' ? 'secondary' : 'default'}>{r.variant}</Badge></td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.view}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.hit_limit}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.click_upgrade}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(r.click_upgrade, r.view)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtPct(r.click_upgrade, r.hit_limit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CompanyLayout>
    </>
  );
}
