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

// 內部漏斗看板：GTM 廣告事件對應 traffic_events / paywall_events
// ViewPricing → UpgradeClick → BeginCheckout → Purchase
//
// 對應內部事件名稱（與 src/lib/analytics/events.ts、AppCheckout.tsx 一致）：
//   ViewPricing   ← traffic_events.event_name = 'pricing_view'
//   UpgradeClick  ← traffic_events.event_name = 'checkup_upgrade_click'
//                  + paywall_events.event_kind = 'click_upgrade'
//   BeginCheckout ← traffic_events.event_name IN ('checkout_open','checkout_submit')
//   Purchase      ← traffic_events.event_name = 'checkout_success'

type Preset = { id: string; label: string; days: number };
const PRESETS: Preset[] = [
  { id: '1', label: '24 小時', days: 1 },
  { id: '7', label: '7 天', days: 7 },
  { id: '14', label: '14 天', days: 14 },
  { id: '30', label: '30 天', days: 30 },
  { id: '60', label: '60 天', days: 60 },
];

const STEP_KEYS = ['view_pricing', 'upgrade_click', 'begin_checkout', 'purchase'] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_META: Record<StepKey, { gtm: string; label: string; sources: string[] }> = {
  view_pricing:   { gtm: 'ViewPricing',   label: '瀏覽方案',     sources: ['traffic_events.event_name=pricing_view'] },
  upgrade_click:  { gtm: 'UpgradeClick',  label: '點擊升級 CTA',  sources: ['traffic_events.event_name=checkup_upgrade_click', 'paywall_events.event_kind=click_upgrade'] },
  begin_checkout: { gtm: 'BeginCheckout', label: '進入結帳',     sources: ['traffic_events.event_name IN (checkout_open, checkout_submit)'] },
  purchase:       { gtm: 'Purchase',      label: '完成購買',     sources: ['traffic_events.event_name=checkout_success'] },
};

interface TrafficRow { event_name: string | null; user_id: string | null; visitor_id: string; occurred_at: string }
interface PaywallRow { event_kind: string; user_id: string | null; visitor_id: string | null; created_at: string }

const PRICING_EVENT = 'pricing_view';
const UPGRADE_EVENT = 'checkup_upgrade_click';
const BEGIN_EVENTS = ['checkout_open', 'checkout_submit'];
const PURCHASE_EVENT = 'checkout_success';
const ALL_EVENTS = [PRICING_EVENT, UPGRADE_EVENT, ...BEGIN_EVENTS, PURCHASE_EVENT];

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

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());
  const loading = loadingT || loadingP;
  const wasLoadingRef = useRef(loading);
  useEffect(() => {
    if (wasLoadingRef.current && !loading) setLastUpdated(new Date());
    wasLoadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { refetchT(); refetchP(); }, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refetchT, refetchP]);

  // 計算各步驟的 unique actor（user_id 優先，否則 visitor_id）+ event 次數
  const steps = useMemo(() => {
    const actors: Record<StepKey, Set<string>> = {
      view_pricing: new Set(), upgrade_click: new Set(), begin_checkout: new Set(), purchase: new Set(),
    };
    const counts: Record<StepKey, number> = {
      view_pricing: 0, upgrade_click: 0, begin_checkout: 0, purchase: 0,
    };
    const actorKey = (uid: string | null, vid: string | null) => uid || (vid ? `v:${vid}` : null);

    for (const r of traffic ?? []) {
      const k = actorKey(r.user_id, r.visitor_id);
      if (!k || !r.event_name) continue;
      let step: StepKey | null = null;
      if (r.event_name === PRICING_EVENT) step = 'view_pricing';
      else if (r.event_name === UPGRADE_EVENT) step = 'upgrade_click';
      else if (BEGIN_EVENTS.includes(r.event_name)) step = 'begin_checkout';
      else if (r.event_name === PURCHASE_EVENT) step = 'purchase';
      if (step) { actors[step].add(k); counts[step]++; }
    }
    for (const r of paywall ?? []) {
      const k = actorKey(r.user_id, r.visitor_id);
      if (!k) continue;
      actors.upgrade_click.add(k);
      counts.upgrade_click++;
    }

    return STEP_KEYS.map((key, i) => {
      const prev = i > 0 ? actors[STEP_KEYS[i - 1]].size : null;
      const cur = actors[key].size;
      const rate = prev !== null && prev > 0 ? cur / prev : null;
      return { key, actors: cur, events: counts[key], prevActors: prev, rate };
    });
  }, [traffic, paywall]);

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
            <Button size="sm" variant="outline" onClick={() => { refetchT(); refetchP(); }} disabled={loading}>
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
                  <p className="text-xs text-muted-foreground">unique actor（user 或 visitor）</p>
                  <p className="text-xs text-muted-foreground">事件次數：{s.events.toLocaleString()}</p>
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
