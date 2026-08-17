import { useEffect, useMemo, useRef, useState } from 'react';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';
import { buildIdentityIndex, computeFunnel, FUNNEL_STEPS, type StageEvent, type StepKey } from '@/lib/analytics/funnel';

// 內部漏斗看板：GTM 廣告事件對應 traffic_events / paywall_events / 成交事實
// ViewPricing → UpgradeClick → BeginCheckout → Purchase
//
// 口徑（2026-08 修正）：
//   ViewPricing   ← traffic_events IN (pricing_view, expert_profile_view, app_pricing_view)
//   UpgradeClick  ← traffic_events=checkup_upgrade_click + paywall_events=click_upgrade（次數去重）
//   BeginCheckout ← traffic_events IN (checkout_open, checkout_submit)
//   Purchase      ← payment_intents.completed ∪ member_subscriptions 生效（不靠前端 checkout_success）
//   每階段皆為「上一階段 actor 的子集」；匿名 visitor 會依 traffic_visits 歸戶到 user。

type Preset = { id: string; label: string; days: number };
const PRESETS: Preset[] = [
  { id: '1', label: '24 小時', days: 1 },
  { id: '7', label: '7 天', days: 7 },
  { id: '14', label: '14 天', days: 14 },
  { id: '30', label: '30 天', days: 30 },
  { id: '60', label: '60 天', days: 60 },
];

const STEP_KEYS = FUNNEL_STEPS;

const STEP_META: Record<StepKey, { gtm: string; label: string; sources: string[] }> = {
  view_pricing:   { gtm: 'ViewPricing',   label: '瀏覽方案',     sources: ['traffic_events.event_name IN (pricing_view, expert_profile_view, app_pricing_view)'] },
  upgrade_click:  { gtm: 'UpgradeClick',  label: '點擊升級 CTA',  sources: ['traffic_events.event_name=checkup_upgrade_click', 'paywall_events.event_kind=click_upgrade'] },
  begin_checkout: { gtm: 'BeginCheckout', label: '進入結帳',     sources: ['traffic_events.event_name IN (checkout_open, checkout_submit)'] },
  purchase:       { gtm: 'Purchase',      label: '完成購買',     sources: ['payment_intents.status=completed', 'member_subscriptions 生效', '（輔助）traffic_events.checkout_success'] },
};

interface TrafficRow { event_name: string | null; user_id: string | null; visitor_id: string; occurred_at: string }
interface PaywallRow { event_kind: string; user_id: string | null; visitor_id: string | null; created_at: string }
interface VisitRow { user_id: string | null; visitor_id: string }
interface PurchaseRow { user_id: string | null; at: string; source: string }

const PRICING_EVENTS = ['pricing_view', 'expert_profile_view', 'app_pricing_view'];
const UPGRADE_EVENT = 'checkup_upgrade_click';
const BEGIN_EVENTS = ['checkout_open', 'checkout_submit'];
const PURCHASE_EVENT = 'checkout_success';
const ALL_EVENTS = [...PRICING_EVENTS, UPGRADE_EVENT, ...BEGIN_EVENTS, PURCHASE_EVENT];

export default function FunnelAnalytics() {
  const [presetId, setPresetId] = useState<string>('7');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[1];
  const sinceMs = Date.now() - preset.days * 86400_000;
  const sinceIso = useMemo(() => new Date(sinceMs).toISOString(), [sinceMs]);

  const { data: traffic, isFetching: loadingT, refetch: refetchT } = useQuery({
    queryKey: ['funnel-traffic', presetId],
    queryFn: async (): Promise<TrafficRow[]> => {
      const { data, error } = await supabase
        .from('traffic_events')
        .select('event_name, user_id, visitor_id, occurred_at')
        .in('event_name', ALL_EVENTS)
        .gte('occurred_at', sinceIso)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as TrafficRow[];
    },
    staleTime: 60_000,
  });

  const { data: paywall, isFetching: loadingP, refetch: refetchP } = useQuery({
    queryKey: ['funnel-paywall', presetId],
    queryFn: async (): Promise<PaywallRow[]> => {
      const { data, error } = await supabase
        .from('paywall_events')
        .select('event_kind, user_id, visitor_id, created_at')
        .eq('event_kind', 'click_upgrade')
        .gte('created_at', sinceIso)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as PaywallRow[];
    },
    staleTime: 60_000,
  });

  // 身分歸戶：traffic_visits 是 visitor → user 的權威對照
  const { data: visits, isFetching: loadingV, refetch: refetchV } = useQuery({
    queryKey: ['funnel-visits', presetId],
    queryFn: async (): Promise<VisitRow[]> => {
      const { data, error } = await supabase
        .from('traffic_visits')
        .select('user_id, visitor_id')
        .not('user_id', 'is', null)
        .gte('last_seen_at', sinceIso)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as VisitRow[];
    },
    staleTime: 60_000,
  });

  // Purchase 以成交事實為準（匯款審核開通不會有前端事件）
  const { data: purchases, isFetching: loadingB, refetch: refetchB } = useQuery({
    queryKey: ['funnel-purchases', presetId],
    queryFn: async (): Promise<PurchaseRow[]> => {
      const [intents, subs] = await Promise.all([
        supabase.from('payment_intents')
          .select('user_id, completed_at, created_at')
          .eq('status', 'completed')
          .gte('created_at', sinceIso)
          .limit(10000),
        supabase.from('member_subscriptions')
          .select('user_id, started_at')
          .gte('started_at', sinceIso)
          .limit(10000),
      ]);
      if (intents.error) throw intents.error;
      if (subs.error) throw subs.error;
      const rows: PurchaseRow[] = [];
      for (const r of (intents.data ?? []) as any[]) {
        rows.push({ user_id: r.user_id, at: r.completed_at ?? r.created_at, source: 'payment_intents' });
      }
      for (const r of (subs.data ?? []) as any[]) {
        rows.push({ user_id: r.user_id, at: r.started_at, source: 'member_subscriptions' });
      }
      return rows;
    },
    staleTime: 60_000,
  });

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());
  const loading = loadingT || loadingP || loadingV || loadingB;
  const refetchAll = () => { refetchT(); refetchP(); refetchV(); refetchB(); };
  const wasLoadingRef = useRef(loading);
  useEffect(() => {
    if (wasLoadingRef.current && !loading) setLastUpdated(new Date());
    wasLoadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { refetchT(); refetchP(); refetchV(); refetchB(); }, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refetchT, refetchP, refetchV, refetchB]);

  const identityIndex = useMemo(() => buildIdentityIndex([
    ...((visits ?? []).map((v) => ({ userId: v.user_id, visitorId: v.visitor_id }))),
    ...((traffic ?? []).map((r) => ({ userId: r.user_id, visitorId: r.visitor_id }))),
    ...((paywall ?? []).map((r) => ({ userId: r.user_id, visitorId: r.visitor_id }))),
  ]), [visits, traffic, paywall]);

  const stageEvents = useMemo<StageEvent[]>(() => {
    const out: StageEvent[] = [];
    for (const r of traffic ?? []) {
      if (!r.event_name) continue;
      if (PRICING_EVENTS.includes(r.event_name)) {
        out.push({ stage: 'view_pricing', userId: r.user_id, visitorId: r.visitor_id, at: r.occurred_at, source: r.event_name });
      } else if (r.event_name === UPGRADE_EVENT) {
        out.push({ stage: 'upgrade_click', userId: r.user_id, visitorId: r.visitor_id, at: r.occurred_at, source: 'traffic_events' });
      } else if (BEGIN_EVENTS.includes(r.event_name)) {
        out.push({ stage: 'begin_checkout', userId: r.user_id, visitorId: r.visitor_id, at: r.occurred_at, source: r.event_name });
      }
      // checkout_success 僅作輔助指標，不作為 Purchase 來源
    }
    for (const r of paywall ?? []) {
      out.push({ stage: 'upgrade_click', userId: r.user_id, visitorId: r.visitor_id, at: r.created_at, source: 'paywall_events' });
    }
    for (const r of purchases ?? []) {
      out.push({ stage: 'purchase', userId: r.user_id, at: r.at, source: r.source });
    }
    return out;
  }, [traffic, paywall, purchases]);

  const steps = useMemo(() => computeFunnel(stageEvents, identityIndex), [stageEvents, identityIndex]);

  // 成交事實總數（不受依序子集限制）與前端回報數，用於誠實對照
  const purchaseFactActors = useMemo(
    () => new Set((purchases ?? []).map((p) => p.user_id).filter(Boolean) as string[]).size,
    [purchases],
  );
  const frontendSuccessCount = useMemo(
    () => (traffic ?? []).filter((r) => r.event_name === PURCHASE_EVENT).length,
    [traffic],
  );

  // 缺事件告警：前一階段有量但本階段為 0 → 埋點疑似失效
  const alerts = useMemo(() => {
    const out: Array<{ key: StepKey; reason: string; severity: 'high' | 'medium' }> = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.actors === 0) {
        if (s.prevActors !== null && s.prevActors >= 5) {
          out.push({
            key: s.key,
            reason: `前一階段（${STEP_META[STEP_KEYS[i - 1]].gtm}）有 ${s.prevActors} 名 actor，但本階段 ${STEP_META[s.key].gtm} 為 0 — 埋點可能失效或事件未觸發。`,
            severity: 'high',
          });
        } else if (i === 0) {
          out.push({ key: s.key, reason: `ViewPricing 在此期間沒有任何事件，請確認 /pricing 流量與 pricing_view 觸發。`, severity: 'medium' });
        }
      } else if (s.rate !== null && s.rate < 0.001 && (s.prevActors ?? 0) >= 50) {
        out.push({ key: s.key, reason: `${STEP_META[s.key].gtm} 轉換率 < 0.1%（${s.actors}/${s.prevActors}），疑似資料異常。`, severity: 'medium' });
      }
      // 來源無資料：某來源在此窗完全沒有事件 → 明確標示而非靜默併入
      for (const src of STEP_META[s.key].sources) {
        const name = src.includes('paywall_events') ? 'paywall_events' : null;
        if (name && (s.bySource[name] ?? 0) === 0 && s.actors > 0) {
          out.push({ key: s.key, reason: `來源 ${name} 在此期間沒有任何資料，本階段僅由其他來源構成。`, severity: 'medium' });
        }
      }
      if (s.unattributed > 0) {
        out.push({
          key: s.key,
          reason: `另有 ${s.unattributed} 名 actor 在本階段有事件，但沒走過上一階段或無法歸戶（匿名 visitor），未計入依序漏斗。`,
          severity: 'medium',
        });
      }
    }
    return out;
  }, [steps]);


  const overallRate = steps[0].actors > 0 ? steps[steps.length - 1].actors / steps[0].actors : 0;
  const fmtPct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

  return (
    <CompanyLayout>
      <SEO title="漏斗分析 · 內部 | legendflow" description="ViewPricing → UpgradeClick → BeginCheckout → Purchase" />
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">漏斗分析</h1>
            <p className="text-sm text-muted-foreground">
              彙整 traffic_events 與 paywall_events，對應 GTM 廣告事件 ViewPricing → UpgradeClick → BeginCheckout → Purchase。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <Button key={p.id} size="sm" variant={presetId === p.id ? 'default' : 'outline'} onClick={() => setPresetId(p.id)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={refetchAll} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> 重新整理
            </Button>
            <Button size="sm" variant={autoRefresh ? 'default' : 'outline'} onClick={() => setAutoRefresh((v) => !v)}>
              自動刷新 {autoRefresh ? 'ON' : 'OFF'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          資料窗：近 {preset.days} 天 · 最後更新：{lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
        </p>
        <p className="text-xs text-muted-foreground">
          口徑：每階段為「上一階段 actor 的子集」；匿名 visitor 依 traffic_visits 歸戶到登入帳號後合併計算。
          Purchase 取成交事實（付款完成 ∪ 訂閱生效），匯款經人工審核開通會延後數小時才入帳，短窗數字會偏低。
        </p>

        {/* 漏斗卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {steps.map((s, i) => (
            <div key={s.key} className="relative">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{STEP_META[s.key].gtm}</span>
                    <Badge variant="outline" className="font-normal">{STEP_META[s.key].label}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-3xl font-bold">{s.actors.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">走完前序階段的 unique 身分</p>
                  <p className="text-xs text-muted-foreground">事件次數（去重）：{s.events.toLocaleString()}</p>
                  {s.unattributed > 0 && (
                    <p className="text-xs text-muted-foreground">未歸戶／未走前序：{s.unattributed.toLocaleString()}</p>
                  )}
                  {i > 0 && (
                    <p className="text-xs mt-2">
                      上一階段 → 本階段：<span className="font-medium">{fmtPct(s.rate)}</span>
                    </p>
                  )}
                </CardContent>
              </Card>
              {i < steps.length - 1 && (
                <ArrowRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground z-10 bg-background rounded-full" />
              )}
            </div>
          ))}
        </div>

        {/* 整體轉換 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" /> 整體轉換 ViewPricing → Purchase
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(overallRate * 100).toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">
              {steps[steps.length - 1].actors.toLocaleString()} 名訂閱 / {steps[0].actors.toLocaleString()} 名瀏覽
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              成交事實總數（不限是否走完前序）：{purchaseFactActors.toLocaleString()} 人 ·
              前端回報 checkout_success：{frontendSuccessCount.toLocaleString()} 次
            </p>
          </CardContent>
        </Card>


        {/* 缺事件告警 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> 缺事件 / 異常告警
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> 所有步驟均有事件流入，未偵測到埋點缺失。
              </div>
            ) : (
              alerts.map((a, i) => (
                <Alert key={i} variant={a.severity === 'high' ? 'destructive' : 'default'}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{STEP_META[a.key].gtm} 告警</AlertTitle>
                  <AlertDescription>
                    <p>{a.reason}</p>
                    <p className="text-xs mt-1 opacity-80">資料來源：{STEP_META[a.key].sources.join('；')}</p>
                  </AlertDescription>
                </Alert>
              ))
            )}
          </CardContent>
        </Card>

        {/* 資料來源對照 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">事件對應</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left py-1">GTM 事件</th><th className="text-left py-1">內部對應</th><th className="text-right py-1">unique actor</th><th className="text-right py-1">事件次數</th></tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.key} className="border-t">
                    <td className="py-2 font-medium">{STEP_META[s.key].gtm}</td>
                    <td className="py-2 text-xs text-muted-foreground">{STEP_META[s.key].sources.join(' / ')}</td>
                    <td className="py-2 text-right">{s.actors.toLocaleString()}</td>
                    <td className="py-2 text-right">{s.events.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
