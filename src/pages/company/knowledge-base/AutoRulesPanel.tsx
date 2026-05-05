import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Settings } from 'lucide-react';
import { toast } from 'sonner';

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

export function AutoRulesPanel() {
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('knowledge_auto_rules').select('*').limit(1).maybeSingle();
    if (data) setRules(data as any);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
      toast.success('已儲存自動規則');
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="border rounded-lg p-4 bg-card flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />載入規則…</div>;

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium flex items-center gap-2">
          <Settings className="h-4 w-4" />每日自動排程規則
        </h3>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{rules.enabled ? '已啟用' : '停用'}</Label>
          <Switch checked={rules.enabled} onCheckedChange={(v) => setRules({ ...rules, enabled: v })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        每日 03:00 (Asia/Taipei) 自動跑回測 → 套門檻分流 → 救援池網格搜尋 → 備選池觀察期升降。所有動作會記錄到 audit_logs。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">勝率低於 → 歸檔停用</Label>
          <Input type="number" min={0} max={1} step={0.05}
            value={rules.archive_below_win_rate}
            onChange={(e) => setRules({ ...rules, archive_below_win_rate: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">目前：{(rules.archive_below_win_rate * 100).toFixed(0)}%</p>
        </div>
        <div>
          <Label className="text-xs">勝率高於 → 提升信心度</Label>
          <Input type="number" min={0} max={1} step={0.05}
            value={rules.promote_above_win_rate}
            onChange={(e) => setRules({ ...rules, promote_above_win_rate: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">目前：{(rules.promote_above_win_rate * 100).toFixed(0)}%</p>
        </div>
        <div>
          <Label className="text-xs">勝率低於此但未達歸檔 → 自動跑網格搜尋</Label>
          <Input type="number" min={0} max={1} step={0.05}
            value={rules.auto_grid_search_below}
            onChange={(e) => setRules({ ...rules, auto_grid_search_below: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">目前：{(rules.auto_grid_search_below * 100).toFixed(0)}%</p>
        </div>
        <div>
          <Label className="text-xs">最小樣本數（n）</Label>
          <Input type="number" min={1} step={1}
            value={rules.min_sample_size}
            onChange={(e) => setRules({ ...rules, min_sample_size: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">小於此值時不觸發任何規則</p>
        </div>
        <div>
          <Label className="text-xs">網格升版的最小改善幅度（%）</Label>
          <Input type="number" min={0} step={0.5}
            value={rules.promote_min_improvement_pct}
            onChange={(e) => setRules({ ...rules, promote_min_improvement_pct: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">新勝率 &gt; 舊勝率 + 此值 才會升版</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}儲存規則
        </Button>
      </div>
    </div>
  );
}
