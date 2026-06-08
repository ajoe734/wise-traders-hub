import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
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

// 預設視窗
const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_RECENT_DAYS = 7;
const REL_DROP_THRESHOLD = 0.2;   // 相對下滑 ≥ 20%
const ABS_DROP_THRESHOLD = 0.02;  // 絕對下滑 ≥ 2pp
const MIN_SAMPLE = 30;            // 近窗該步驟前一階段樣本 ≥ 30 才告警，避免雜訊

// 時間窗 preset
type Preset = { id: string; label: string; since: number; recent: number };
const WINDOW_PRESETS: Preset[] = [
  { id: '7-3', label: '7d / recent 3d', since: 7, recent: 3 },
  { id: '14-7', label: '14d / recent 7d', since: 14, recent: 7 },
  { id: '30-7', label: '30d / recent 7d', since: 30, recent: 7 },
  { id: '60-14', label: '60d / recent 14d', since: 60, recent: 14 },
  { id: '90-30', label: '90d / recent 30d', since: 90, recent: 30 },
];

// 漏斗階段 key（固定順序，匯出時據此過濾）
const FUNNEL_KEYS = ['view', 'hit_limit', 'click_upgrade', 'checkout', 'subscribed'] as const;
type FunnelKey = (typeof FUNNEL_KEYS)[number];
// 告警步驟 key
const ALERT_KEYS = ['hit_limit', 'click_upgrade', 'checkout', 'subscribed'] as const;
type AlertKey = (typeof ALERT_KEYS)[number];

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
  // 視窗 state（preset 控制）
  const [presetId, setPresetId] = useState<string>('30-7');
  const preset = WINDOW_PRESETS.find((p) => p.id === presetId) ?? WINDOW_PRESETS[2];
  const sinceDays = preset.since;
  const recentDays = Math.min(preset.recent, preset.since);
  const baselineDays = Math.max(sinceDays - recentDays, 0);

  // 步驟/告警過濾（套用於匯出）
  const [funnelFilter, setFunnelFilter] = useState<Set<FunnelKey>>(new Set(FUNNEL_KEYS));
  const [alertFilter, setAlertFilter] = useState<Set<AlertKey>>(new Set(ALERT_KEYS));
  const toggle = <T extends string>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  const now = Date.now();
  const sinceIso = useMemo(() => new Date(now - sinceDays * 86400_000).toISOString(), [now, sinceDays]);
  const recentSinceMs = now - recentDays * 86400_000;
  const recentSinceIso = new Date(recentSinceMs).toISOString();

  const { data: events, isFetching: loadingEvents, refetch: refetchEvents } = useQuery({
    queryKey: ['paywall-events', sinceDays],
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

  // 相關訊號：金流 webhook 失敗率 / Checkout 錯誤率 / 路由 404/500
  const { data: signals, isFetching: loadingSignals, refetch: refetchSignals } = useQuery({
    queryKey: ['paywall-correlation', sinceIso, recentSinceIso],
    queryFn: async () => {
      const orFn = WEBHOOK_FN_PATTERNS.map((p) => `fn.ilike.%${p}%`).join(',');
      const [{ data: logs, error: e1 }, { data: intents, error: e2 }, { data: traffic, error: e3 }] = await Promise.all([
        supabase
          .from('function_run_logs')
          .select('fn, level, created_at')
          .gte('created_at', sinceIso)
          .or(orFn)
          .limit(20000),
        supabase
          .from('payment_intents')
          .select('status, created_at')
          .gte('created_at', sinceIso)
          .limit(20000),
        supabase
          .from('traffic_events')
          .select('event_name, event_props, occurred_at')
          .gte('occurred_at', sinceIso)
          .or('event_name.ilike.%404%,event_name.ilike.%500%,event_name.ilike.%error%')
          .limit(20000),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;

      const bucket = () => ({ webhookTotal: 0, webhookError: 0, checkoutTotal: 0, checkoutFail: 0, route404: 0, route500: 0 });
      const recent = bucket();
      const baseline = bucket();
      const pick = (ts: string) => (new Date(ts).getTime() >= recentSinceMs ? recent : baseline);

      for (const r of logs ?? []) {
        const b = pick(r.created_at as string);
        b.webhookTotal++;
        if ((r.level || '').toLowerCase() === 'error') b.webhookError++;
      }
      for (const r of intents ?? []) {
        const b = pick(r.created_at as string);
        b.checkoutTotal++;
        if (CHECKOUT_FAIL_STATUSES.has(String(r.status || '').toLowerCase())) b.checkoutFail++;
      }
      for (const r of traffic ?? []) {
        const b = pick((r as any).occurred_at as string);
        const name = String((r as any).event_name || '').toLowerCase();
        const propsStatus = String(((r as any).event_props as any)?.status || ((r as any).event_props as any)?.code || '');
        if (name.includes('404') || propsStatus === '404') b.route404++;
        else if (name.includes('500') || propsStatus === '500') b.route500++;
      }
      return { recent, baseline };
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

  // 相關訊號摘要（recent vs baseline）
  const sig = useMemo(() => {
    const r = signals?.recent;
    const b = signals?.baseline;
    const rate = (num?: number, den?: number) => (den && den > 0 ? (num! / den) : null);
    return {
      webhookRecent: rate(r?.webhookError, r?.webhookTotal),
      webhookBaseline: rate(b?.webhookError, b?.webhookTotal),
      webhookRN: r?.webhookError ?? 0, webhookRD: r?.webhookTotal ?? 0,
      webhookBN: b?.webhookError ?? 0, webhookBD: b?.webhookTotal ?? 0,
      checkoutRecent: rate(r?.checkoutFail, r?.checkoutTotal),
      checkoutBaseline: rate(b?.checkoutFail, b?.checkoutTotal),
      checkoutRN: r?.checkoutFail ?? 0, checkoutRD: r?.checkoutTotal ?? 0,
      checkoutBN: b?.checkoutFail ?? 0, checkoutBD: b?.checkoutTotal ?? 0,
      r404Recent: r?.route404 ?? 0, r404Baseline: b?.route404 ?? 0,
      r500Recent: r?.route500 ?? 0, r500Baseline: b?.route500 ?? 0,
    };
  }, [signals]);

  // 依步驟挑出最相關的訊號
  const stepSignals: Record<string, Array<{ label: string; recent: string; baseline: string; bad: boolean }>> = {
    click_upgrade: [
      { label: '路由 404', recent: String(sig.r404Recent), baseline: String(sig.r404Baseline), bad: sig.r404Recent > sig.r404Baseline },
      { label: '路由 500', recent: String(sig.r500Recent), baseline: String(sig.r500Baseline), bad: sig.r500Recent > sig.r500Baseline },
    ],
    checkout: [
      { label: 'Checkout 錯誤率', recent: `${fmtRate(sig.checkoutRecent)} (${sig.checkoutRN}/${sig.checkoutRD})`, baseline: `${fmtRate(sig.checkoutBaseline)} (${sig.checkoutBN}/${sig.checkoutBD})`, bad: (sig.checkoutRecent ?? 0) > (sig.checkoutBaseline ?? 0) },
      { label: '路由 500', recent: String(sig.r500Recent), baseline: String(sig.r500Baseline), bad: sig.r500Recent > sig.r500Baseline },
    ],
    subscribed: [
      { label: '金流 Webhook 失敗率', recent: `${fmtRate(sig.webhookRecent)} (${sig.webhookRN}/${sig.webhookRD})`, baseline: `${fmtRate(sig.webhookBaseline)} (${sig.webhookBN}/${sig.webhookBD})`, bad: (sig.webhookRecent ?? 0) > (sig.webhookBaseline ?? 0) },
      { label: 'Checkout 錯誤率', recent: `${fmtRate(sig.checkoutRecent)} (${sig.checkoutRN}/${sig.checkoutRD})`, baseline: `${fmtRate(sig.checkoutBaseline)} (${sig.checkoutBN}/${sig.checkoutBD})`, bad: (sig.checkoutRecent ?? 0) > (sig.checkoutBaseline ?? 0) },
    ],
    hit_limit: [],
  };

  const reportStamp = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  const buildReportRows = () => {
    const funnelRows = funnel.map((s, i) => {
      const stepRate = s.prev && s.prev > 0 ? `${((s.count / s.prev) * 100).toFixed(1)}%` : '';
      const overall = funnel[0].count > 0 ? `${((s.count / funnel[0].count) * 100).toFixed(2)}%` : '';
      return { idx: i + 1, label: s.label, count: s.count, prev: s.prev ?? '', stepRate, overall };
    });
    const alertRows = alerts.map((a) => ({
      key: a.key,
      label: a.label,
      baseline: fmtRate(a.baseRate),
      baselineFrac: `${a.baseNum}/${a.baseDen}`,
      recent: fmtRate(a.recentRate),
      recentFrac: `${a.recentNum}/${a.recentDen}`,
      absDropPp: a.recentRate !== null && a.baseRate !== null ? ((a.recentRate - a.baseRate) * 100).toFixed(1) : '',
      relDropPct: a.status === 'warn' ? (a.relDrop * 100).toFixed(1) : '',
      status: a.status,
    }));
    const signalRows = [
      { metric: '金流 Webhook 失敗率', baseline: fmtRate(sig.webhookBaseline), baselineFrac: `${sig.webhookBN}/${sig.webhookBD}`, recent: fmtRate(sig.webhookRecent), recentFrac: `${sig.webhookRN}/${sig.webhookRD}` },
      { metric: 'Checkout 錯誤率', baseline: fmtRate(sig.checkoutBaseline), baselineFrac: `${sig.checkoutBN}/${sig.checkoutBD}`, recent: fmtRate(sig.checkoutRecent), recentFrac: `${sig.checkoutRN}/${sig.checkoutRD}` },
      { metric: '路由 404 事件', baseline: String(sig.r404Baseline), baselineFrac: '', recent: String(sig.r404Recent), recentFrac: '' },
      { metric: '路由 500 事件', baseline: String(sig.r500Baseline), baselineFrac: '', recent: String(sig.r500Recent), recentFrac: '' },
    ];
    return { funnelRows, alertRows, signalRows };
  };

  const exportCsv = () => {
    const { funnelRows, alertRows, signalRows } = buildReportRows();
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(`Paywall 漏斗告警報表`);
    lines.push(`產出時間,${new Date().toISOString()}`);
    lines.push(`觀察區間,最近 ${SINCE_DAYS} 天 (近窗 ${RECENT_DAYS}d vs 基準 ${BASELINE_DAYS}d)`);
    lines.push('');
    lines.push('# 轉換漏斗');
    lines.push(['階段', '名稱', '人數', '前一階段', '上一步轉換', '佔曝光'].join(','));
    funnelRows.forEach((r) => lines.push([r.idx, r.label, r.count, r.prev, r.stepRate, r.overall].map(esc).join(',')));
    lines.push('');
    lines.push('# 步驟告警');
    lines.push(['步驟', '基準率', '基準分子/分母', '近窗率', '近窗分子/分母', '絕對變化(pp)', '相對下滑(%)', '狀態'].join(','));
    alertRows.forEach((r) => lines.push([r.label, r.baseline, r.baselineFrac, r.recent, r.recentFrac, r.absDropPp, r.relDropPct, r.status].map(esc).join(',')));
    lines.push('');
    lines.push('# 相關訊號（同時間窗）');
    lines.push(['指標', '基準', '基準分子/分母', '近窗', '近窗分子/分母'].join(','));
    signalRows.forEach((r) => lines.push([r.metric, r.baseline, r.baselineFrac, r.recent, r.recentFrac].map(esc).join(',')));

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paywall-funnel-${reportStamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = (autoTableMod as any).default ?? (autoTableMod as any);
    const { funnelRows, alertRows, signalRows } = buildReportRows();
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('Paywall Funnel & Alert Report', 40, 48);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toISOString()}`, 40, 66);
    doc.text(`Window: last ${SINCE_DAYS}d (recent ${RECENT_DAYS}d vs baseline ${BASELINE_DAYS}d)`, 40, 80);

    autoTable(doc, {
      startY: 100,
      head: [['#', 'Stage', 'Count', 'Prev', 'Step Rate', '% of View']],
      body: funnelRows.map((r) => [r.idx, r.label, r.count, r.prev, r.stepRate, r.overall]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 30, 30] },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Step', 'Baseline', 'B (n/d)', 'Recent', 'R (n/d)', 'Abs Δ (pp)', 'Rel Drop %', 'Status']],
      body: alertRows.map((r) => [r.label, r.baseline, r.baselineFrac, r.recent, r.recentFrac, r.absDropPp, r.relDropPct, r.status]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 30, 30] },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 7 && data.cell.raw === 'warn') {
          data.cell.styles.textColor = [200, 30, 30];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Signal', 'Baseline', 'B (n/d)', 'Recent', 'R (n/d)']],
      body: signalRows.map((r) => [r.metric, r.baseline, r.baselineFrac, r.recent, r.recentFrac]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 30, 30] },
    });

    doc.save(`paywall-funnel-${reportStamp()}.pdf`);
  };


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
            <div className="flex items-center gap-3">
              <button
                onClick={() => exportCsv()}
                className="text-xs text-muted-foreground underline disabled:opacity-40"
                disabled={loading || loadingSignals}
              >
                匯出 CSV
              </button>
              <button
                onClick={() => exportPdf()}
                className="text-xs text-muted-foreground underline disabled:opacity-40"
                disabled={loading || loadingSignals}
              >
                匯出 PDF
              </button>
              <button
                onClick={() => { refetchEvents(); refetchDown(); refetchSignals(); }}
                className="text-xs text-muted-foreground underline"
              >
                重新整理
              </button>
            </div>
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
                    <AlertDescription className="mt-2 space-y-2">
                      <div>
                        <div className="text-xs mb-1 opacity-80">可能原因（請依序排查）：</div>
                        <ul className="list-disc pl-5 space-y-0.5 text-xs">
                          {reasons.map((r) => <li key={r}>{r}</li>)}
                        </ul>
                      </div>
                      {(stepSignals[a.key]?.length ?? 0) > 0 && (
                        <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
                          <div className="text-[11px] mb-1 opacity-80 flex items-center gap-1">
                            <Activity className="w-3 h-3" /> 同時間窗（近 {RECENT_DAYS}d vs 基準 {BASELINE_DAYS}d）相關訊號
                            {loadingSignals && <span className="ml-1 opacity-60">載入中…</span>}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                            {stepSignals[a.key].map((s) => (
                              <div key={s.label} className="flex items-center justify-between gap-2 font-mono">
                                <span className="opacity-80">{s.label}</span>
                                <span className={s.bad ? 'font-semibold' : ''}>
                                  {s.baseline} → {s.recent}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                );
              })}

              {/* 全域相關訊號（時間窗對齊） */}
              {!loading && (
                <div className="rounded border bg-muted/30 p-3">
                  <div className="text-xs font-medium mb-2 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5" /> 相關訊號（近 {RECENT_DAYS}d vs 基準 {BASELINE_DAYS}d）
                    {loadingSignals && <span className="ml-1 text-muted-foreground font-normal">載入中…</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: '金流 Webhook 失敗率', recent: `${fmtRate(sig.webhookRecent)}`, baseline: `${fmtRate(sig.webhookBaseline)}`, sub: `${sig.webhookRN}/${sig.webhookRD} vs ${sig.webhookBN}/${sig.webhookBD}`, bad: (sig.webhookRecent ?? 0) > (sig.webhookBaseline ?? 0) && sig.webhookRD >= 10 },
                      { label: 'Checkout 錯誤率', recent: `${fmtRate(sig.checkoutRecent)}`, baseline: `${fmtRate(sig.checkoutBaseline)}`, sub: `${sig.checkoutRN}/${sig.checkoutRD} vs ${sig.checkoutBN}/${sig.checkoutBD}`, bad: (sig.checkoutRecent ?? 0) > (sig.checkoutBaseline ?? 0) && sig.checkoutRD >= 10 },
                      { label: '路由 404 事件', recent: String(sig.r404Recent), baseline: String(sig.r404Baseline), sub: '事件數', bad: sig.r404Recent > sig.r404Baseline },
                      { label: '路由 500 事件', recent: String(sig.r500Recent), baseline: String(sig.r500Baseline), sub: '事件數', bad: sig.r500Recent > sig.r500Baseline },
                    ].map((m) => (
                      <div key={m.label} className="border rounded p-2 bg-background">
                        <div className="text-[11px] text-muted-foreground">{m.label}</div>
                        <div className="mt-0.5 font-mono">
                          <span className="opacity-60">{m.baseline}</span>
                          <span className="mx-1 opacity-40">→</span>
                          <span className={m.bad ? 'text-destructive font-semibold' : ''}>{m.recent}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{m.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    來源：function_run_logs（fn 含 webhook/callback/notify-payment/verify-payment/ecpay/linepay/acpay/remittance）、payment_intents.status ∈ {'{failed,cancelled,abandoned,expired,error}'}、traffic_events（event_name 或 event_props.status 含 404/500）
                  </div>
                </div>
              )}

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
