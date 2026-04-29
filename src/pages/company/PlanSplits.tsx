import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Pencil, Trash2 } from 'lucide-react';

interface PlanRow {
  id: string;
  name: string;
  expert_id: string;
  is_active: boolean;
  expert_name: string;
  expert_slug: string;
  override?: {
    id: string;
    pct_platform: number;
    pct_expert: number;
    is_active: boolean;
    notes: string | null;
  } | null;
}

interface DefaultRule { pct_platform: number; pct_expert: number; }

export default function CompanyPlanSplits() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [defaultRule, setDefaultRule] = useState<DefaultRule>({ pct_platform: 55, pct_expert: 45 });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [form, setForm] = useState({ pct_platform: 55, pct_expert: 45, is_active: true, notes: '' });

  const load = async () => {
    setLoading(true);
    const [plansRes, overridesRes, settingsRes] = await Promise.all([
      supabase
        .from('expert_plans')
        .select('id, name, expert_id, is_active, experts:expert_id(name, slug)')
        .order('expert_id', { ascending: true }),
      supabase
        .from('plan_split_overrides')
        .select('id, plan_id, pct_platform, pct_expert, is_active, notes'),
      supabase.from('payment_settings').select('key, value').eq('key', 'split_standard').maybeSingle(),
    ]);

    const overrideMap = new Map<string, any>();
    (overridesRes.data || []).forEach((o: any) => overrideMap.set(o.plan_id, o));

    const merged: PlanRow[] = (plansRes.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      expert_id: p.expert_id,
      is_active: p.is_active,
      expert_name: p.experts?.name ?? '(未知分析師)',
      expert_slug: p.experts?.slug ?? '',
      override: overrideMap.get(p.id) ?? null,
    }));

    // sort by expert name then plan name
    merged.sort((a, b) => a.expert_name.localeCompare(b.expert_name) || a.name.localeCompare(b.name));
    setRows(merged);

    const s = settingsRes.data?.value as any;
    if (s) setDefaultRule({ pct_platform: s.pct_platform ?? 55, pct_expert: s.pct_expert ?? 45 });

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (row: PlanRow) => {
    setEditing(row);
    if (row.override) {
      setForm({
        pct_platform: row.override.pct_platform,
        pct_expert: row.override.pct_expert,
        is_active: row.override.is_active,
        notes: row.override.notes ?? '',
      });
    } else {
      setForm({ pct_platform: defaultRule.pct_platform, pct_expert: defaultRule.pct_expert, is_active: true, notes: '' });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (form.pct_platform + form.pct_expert !== 100) {
      toast({ title: '比例錯誤', description: '平台 + 專家需為 100%', variant: 'destructive' });
      return;
    }
    const payload = {
      plan_id: editing.id,
      pct_platform: form.pct_platform,
      pct_expert: form.pct_expert,
      is_active: form.is_active,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('plan_split_overrides')
      .upsert(payload, { onConflict: 'plan_id' });
    if (error) {
      toast({ title: '儲存失敗', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '已儲存覆寫' });
    setEditing(null);
    load();
  };

  const remove = async (row: PlanRow) => {
    if (!row.override) return;
    if (!confirm(`確定刪除「${row.name}」的分潤覆寫？刪除後將回退到全站預設 ${defaultRule.pct_platform}/${defaultRule.pct_expert}。`)) return;
    const { error } = await supabase.from('plan_split_overrides').delete().eq('id', row.override.id);
    if (error) {
      toast({ title: '刪除失敗', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '已刪除覆寫' });
    load();
  };

  if (loading) return <CompanyLayout><div className="p-6">載入中…</div></CompanyLayout>;

  // group by expert
  const groups = new Map<string, PlanRow[]>();
  rows.forEach(r => {
    const key = `${r.expert_name}__${r.expert_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });

  return (
    <CompanyLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">方案分潤</h1>
          <p className="text-sm text-muted-foreground mt-1">
            為個別方案設定分潤覆寫。未設定覆寫的方案使用全站預設：
            <span className="font-medium ml-1">平台 {defaultRule.pct_platform}% / 專家 {defaultRule.pct_expert}%</span>
          </p>
        </div>

        {Array.from(groups.entries()).map(([key, plans]) => {
          const [expertName] = key.split('__');
          return (
            <Card key={key} className="p-5 space-y-3">
              <h2 className="font-semibold text-lg">{expertName}</h2>
              <div className="divide-y">
                {plans.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{p.name}</div>
                      {!p.is_active && <div className="text-xs text-muted-foreground">（方案未啟用）</div>}
                    </div>
                    <div className="text-sm shrink-0">
                      {p.override && p.override.is_active ? (
                        <span className="px-2 py-1 rounded bg-primary/10 text-primary">
                          覆寫 {p.override.pct_platform}/{p.override.pct_expert}
                        </span>
                      ) : p.override && !p.override.is_active ? (
                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
                          覆寫已停用（用預設）
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
                          預設 {defaultRule.pct_platform}/{defaultRule.pct_expert}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                        <Pencil className="h-3 w-3 mr-1" />
                        {p.override ? '編輯' : '新增覆寫'}
                      </Button>
                      {p.override && (
                        <Button variant="ghost" size="sm" onClick={() => remove(p)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {rows.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            尚無任何方案。
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.override ? '編輯' : '新增'}分潤覆寫</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {editing.expert_name} / {editing.name}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">平台（%）</Label>
                  <Input
                    type="number" min={0} max={100}
                    value={form.pct_platform}
                    onChange={e => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      setForm(p => ({ ...p, pct_platform: v, pct_expert: 100 - v }));
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">專家（%）</Label>
                  <Input
                    type="number" min={0} max={100}
                    value={form.pct_expert}
                    onChange={e => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      setForm(p => ({ ...p, pct_expert: v, pct_platform: 100 - v }));
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm(p => ({ ...p, is_active: v }))} />
                <Label className="text-sm">啟用此覆寫</Label>
              </div>
              <div>
                <Label className="text-xs">備註（選填）</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={save}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
}
