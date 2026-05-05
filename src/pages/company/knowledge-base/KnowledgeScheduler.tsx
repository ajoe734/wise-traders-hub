import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Settings2, PlayCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';

interface Rules {
  id?: string;
  enabled: boolean;
  archive_below_win_rate: number;
  promote_above_win_rate: number;
  min_sample_size: number;
  auto_grid_search_below: number;
  promote_min_improvement_pct: number;
  daily_grid_search_quota: number;
  rescue_max_weeks: number;
  candidate_observe_days: number;
}

interface ItemRow {
  id: string;
  item_id: string;
  title: string;
  category: string;
  lifecycle_status: string;
  win_rate: number | null;
  sample_size: number;
  rescue_started_at: string | null;
  rescue_attempts: number;
  candidate_observed_since: string | null;
  parent_item_id: string | null;
}

const DEFAULT_RULES: Rules = {
  enabled: false,
  archive_below_win_rate: 0.40,
  promote_above_win_rate: 0.70,
  min_sample_size: 30,
  auto_grid_search_below: 0.55,
  promote_min_improvement_pct: 5,
  daily_grid_search_quota: 5,
  rescue_max_weeks: 3,
  candidate_observe_days: 14,
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: '使用中', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  candidate: { label: '備選', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  rescue: { label: '救援中', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  archived: { label: '已歸檔', cls: 'bg-muted text-muted-foreground' },
};

function NumField({
  label, value, onChange, min = 0, max = 1, step = 0.05, suffix, hint,
}: any) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" min={min} max={max} step={step}
          value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export default function KnowledgeScheduler() {
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [origRules, setOrigRules] = useState<Rules>(DEFAULT_RULES);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRunSummary, setLastRunSummary] = useState<any>(null);

  async function load() {
    setLoading(true);
    const [rulesRes, itemsRes] = await Promise.all([
      supabase.from('knowledge_auto_rules').select('*').limit(1).maybeSingle(),
      supabase.from('checkup_knowledge_items')
        .select('id,item_id,title,category,lifecycle_status,win_rate,sample_size,rescue_started_at,rescue_attempts,candidate_observed_since,parent_item_id')
        .in('lifecycle_status', ['active', 'rescue', 'candidate']),
    ]);
    if (rulesRes.data) {
      setRules(rulesRes.data as any);
      setOrigRules(rulesRes.data as any);
    }
    if (itemsRes.data) setItems(itemsRes.data as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // 預覽：如果用目前 rules 跑一次排程，每個條目會被分到哪？
  const preview = useMemo(() => {
    const counts = { promote: 0, demote_rescue: 0, archive_rescue: 0, archive_candidate: 0, promote_candidate: 0, no_change: 0 };
    const examples: { kind: string; item: ItemRow; reason: string }[] = [];
    const now = Date.now();
    const rescueDeadline = now - rules.rescue_max_weeks * 7 * 86400_000;
    const candDeadline = now - rules.candidate_observe_days * 86400_000;

    for (const it of items) {
      const wr = Number(it.win_rate ?? 0);
      const n = it.sample_size ?? 0;
      let kind: keyof typeof counts | null = null;
      let reason = '';

      if (it.lifecycle_status === 'active' || it.lifecycle_status === 'rescue') {
        if (n < rules.min_sample_size) {
          kind = 'no_change'; reason = `樣本不足 (n=${n}<${rules.min_sample_size})`;
        } else if (wr >= rules.promote_above_win_rate && it.lifecycle_status !== 'active') {
          kind = 'promote'; reason = `勝率 ${(wr * 100).toFixed(0)}% ≥ ${(rules.promote_above_win_rate * 100).toFixed(0)}% → 升回使用中`;
        } else if (wr < rules.auto_grid_search_below && it.lifecycle_status === 'active') {
          kind = 'demote_rescue'; reason = `勝率 ${(wr * 100).toFixed(0)}% < ${(rules.auto_grid_search_below * 100).toFixed(0)}% → 進救援`;
        } else {
          kind = 'no_change'; reason = '門檻內，維持現狀';
        }
      }

      if (it.lifecycle_status === 'rescue' && it.rescue_started_at &&
          new Date(it.rescue_started_at).getTime() < rescueDeadline) {
        kind = 'archive_rescue';
        reason = `救援已超過 ${rules.rescue_max_weeks} 週 → 歸檔`;
      }

      if (it.lifecycle_status === 'candidate' && it.candidate_observed_since &&
          new Date(it.candidate_observed_since).getTime() < candDeadline && n >= rules.min_sample_size) {
        // 不知 parent win_rate，這裡只示意
        kind = wr >= 0.5 ? 'promote_candidate' : 'archive_candidate';
        reason = `備選觀察期滿 → ${kind === 'promote_candidate' ? '升使用中' : '歸檔'}`;
      }

      if (kind) {
        counts[kind]++;
        if (kind !== 'no_change' && examples.length < 30) examples.push({ kind, item: it, reason });
      }
    }
    return { counts, examples };
  }, [items, rules]);

  const dirty = JSON.stringify(rules) !== JSON.stringify(origRules);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        enabled: rules.enabled,
        archive_below_win_rate: Number(rules.archive_below_win_rate),
        promote_above_win_rate: Number(rules.promote_above_win_rate),
        min_sample_size: Number(rules.min_sample_size),
        auto_grid_search_below: Number(rules.auto_grid_search_below),
        promote_min_improvement_pct: Number(rules.promote_min_improvement_pct),
        daily_grid_search_quota: Number(rules.daily_grid_search_quota),
        rescue_max_weeks: Number(rules.rescue_max_weeks),
        candidate_observe_days: Number(rules.candidate_observe_days),
        updated_at: new Date().toISOString(),
      };
      let res;
      if (rules.id) {
        res = await supabase.from('knowledge_auto_rules').update(payload).eq('id', rules.id).select().single();
      } else {
        res = await supabase.from('knowledge_auto_rules').insert(payload).select().single();
      }
      if (res.error) throw res.error;
      setRules(res.data as any);
      setOrigRules(res.data as any);
      await logAdminAction({
        action: 'knowledge.update_auto_rules',
        target_type: 'knowledge_auto_rules',
        target_id: res.data?.id,
        context: { from: origRules, to: payload },
      });
      toast.success('已儲存自動規則');
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setLastRunSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-daily-scheduler', { body: {} });
      if (error) throw error;
      setLastRunSummary(data);
      toast.success('已手動執行排程');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <CompanyLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Settings2 className="h-6 w-6" /> 知識庫自動排程控制台
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              每日 03:00 (Asia/Taipei) 自動執行：回測 → 套門檻 → 救援池網格搜尋 → 備選池升降。改動門檻會立即顯示影響預覽。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={rules.enabled ? 'default' : 'secondary'}>
              {rules.enabled ? '排程已啟用' : '排程已停用'}
            </Badge>
            <Switch checked={rules.enabled} onCheckedChange={(v) => setRules({ ...rules, enabled: v })} />
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> 載入中…
          </div>
        )}

        {!loading && (
          <>
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="text-base font-medium">門檻設定</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <NumField
                    label="升使用中：勝率 ≥"
                    value={rules.promote_above_win_rate} min={0} max={1} step={0.05}
                    onChange={(v: number) => setRules({ ...rules, promote_above_win_rate: v })}
                    suffix={`(${(rules.promote_above_win_rate * 100).toFixed(0)}%)`}
                    hint="達標的救援條目自動升回使用中"
                  />
                  <NumField
                    label="進救援：勝率 <"
                    value={rules.auto_grid_search_below} min={0} max={1} step={0.05}
                    onChange={(v: number) => setRules({ ...rules, auto_grid_search_below: v })}
                    suffix={`(${(rules.auto_grid_search_below * 100).toFixed(0)}%)`}
                    hint="低於此值的使用中條目自動進救援池"
                  />
                  <NumField
                    label="完全失效：勝率 <"
                    value={rules.archive_below_win_rate} min={0} max={1} step={0.05}
                    onChange={(v: number) => setRules({ ...rules, archive_below_win_rate: v })}
                    suffix={`(${(rules.archive_below_win_rate * 100).toFixed(0)}%)`}
                    hint="僅作參考；實際歸檔由救援逾期觸發"
                  />
                  <NumField
                    label="最小樣本數 n ≥"
                    value={rules.min_sample_size} min={1} max={500} step={1}
                    onChange={(v: number) => setRules({ ...rules, min_sample_size: v })}
                    hint="樣本不足時不觸發任何分流"
                  />
                  <NumField
                    label="網格升版最小改善"
                    value={rules.promote_min_improvement_pct} min={0} max={50} step={0.5}
                    onChange={(v: number) => setRules({ ...rules, promote_min_improvement_pct: v })}
                    suffix="%"
                    hint="新勝率 > 舊勝率 + 此值 才會升版"
                  />
                  <NumField
                    label="每日網格搜尋配額"
                    value={rules.daily_grid_search_quota} min={1} max={50} step={1}
                    onChange={(v: number) => setRules({ ...rules, daily_grid_search_quota: v })}
                    suffix="條 / 天"
                    hint="控制 API 成本"
                  />
                  <NumField
                    label="救援池最長停留"
                    value={rules.rescue_max_weeks} min={1} max={12} step={1}
                    onChange={(v: number) => setRules({ ...rules, rescue_max_weeks: v })}
                    suffix="週"
                    hint="超過後自動歸檔並通知"
                  />
                  <NumField
                    label="備選觀察期"
                    value={rules.candidate_observe_days} min={1} max={90} step={1}
                    onChange={(v: number) => setRules({ ...rules, candidate_observe_days: v })}
                    suffix="天"
                    hint="新版本累積實戰樣本的觀察天數"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  {dirty && (
                    <Button variant="ghost" size="sm" onClick={() => setRules(origRules)}>還原</Button>
                  )}
                  <Button onClick={save} disabled={saving || !dirty}>
                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    {dirty ? '儲存規則' : '已儲存'}
                  </Button>
                  <Button variant="outline" onClick={runNow} disabled={running}>
                    {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
                    立即執行排程
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 即時預覽 */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h2 className="text-base font-medium flex items-center gap-2">
                  即時影響預覽
                  {dirty && <Badge variant="outline" className="bg-amber-100 text-amber-800">未儲存</Badge>}
                </h2>
                <p className="text-xs text-muted-foreground">
                  以目前 {items.length} 條使用中／救援／備選條目，套用上方門檻試算下次排程的結果。
                </p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { k: 'promote', label: '升使用中', cls: 'bg-emerald-100 text-emerald-800' },
                    { k: 'demote_rescue', label: '降救援', cls: 'bg-orange-100 text-orange-800' },
                    { k: 'archive_rescue', label: '救援逾期歸檔', cls: 'bg-muted' },
                    { k: 'promote_candidate', label: '備選升使用中', cls: 'bg-emerald-100 text-emerald-800' },
                    { k: 'archive_candidate', label: '備選歸檔', cls: 'bg-muted' },
                  ].map(c => (
                    <div key={c.k} className={`rounded-lg border p-3 ${c.cls}`}>
                      <div className="text-xs">{c.label}</div>
                      <div className="text-2xl font-medium tabular-nums">
                        {(preview.counts as any)[c.k]}
                      </div>
                    </div>
                  ))}
                </div>

                {preview.examples.length > 0 && (
                  <div className="border rounded-lg divide-y mt-3">
                    {preview.examples.map((ex, i) => {
                      const cur = STATUS_BADGE[ex.item.lifecycle_status] ?? STATUS_BADGE.active;
                      return (
                        <div key={i} className="p-2 text-xs flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={cur.cls}>{cur.label}</Badge>
                          <code className="text-muted-foreground">{ex.item.item_id}</code>
                          <span className="font-medium truncate max-w-[200px]">{ex.item.title}</span>
                          <span className="text-muted-foreground">→</span>
                          <span>{ex.reason}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {preview.examples.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertCircle className="h-4 w-4" />目前條件下無條目會被自動處理
                  </div>
                )}
              </CardContent>
            </Card>

            {lastRunSummary && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <h2 className="text-base font-medium">上次執行結果</h2>
                  <pre className="bg-muted p-3 rounded text-xs overflow-auto">
                    {JSON.stringify(lastRunSummary, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </CompanyLayout>
  );
}
