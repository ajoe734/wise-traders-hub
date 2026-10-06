import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';

const OPTIONS = [30, 40, 45, 50, 55, 60, 65, 70, 75, 80];
const DEFAULT = '__default';

interface Props { experts: Array<{ id: string; name: string; role?: string; status?: string }> }

/** 老師級分潤比例：方案覆寫 > 老師比例 > 全站預設。只影響之後的新付款。 */
export function ExpertSplitPanel({ experts }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['company', 'expert-split-settings'],
    queryFn: async () => {
      const [s, std] = await Promise.all([
        (supabase.from as any)('expert_split_settings').select('expert_id, pct_platform, pct_expert, updated_at'),
        (supabase.from as any)('payment_settings_safe').select('value').eq('key', 'split_standard').maybeSingle(),
      ]);
      if (s.error) throw s.error;
      const map: Record<string, { pct_expert: number; updated_at: string }> = {};
      for (const r of s.data || []) map[r.expert_id] = r;
      return { map, standardExpert: Number(std.data?.value?.pct_expert ?? NaN) };
    },
  });

  const save = async (expertId: string, name: string, value: string) => {
    setSaving(expertId);
    const before = data?.map[expertId]?.pct_expert ?? null;
    const { data: u } = await supabase.auth.getUser();
    const res = value === DEFAULT
      ? await (supabase.from as any)('expert_split_settings').delete().eq('expert_id', expertId)
      : await (supabase.from as any)('expert_split_settings').upsert({
          expert_id: expertId, pct_expert: Number(value), pct_platform: 100 - Number(value),
          updated_by: u.user?.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'expert_id' });
    setSaving(null);
    if (res.error) return toast.error('儲存失敗：' + res.error.message);
    await logAdminAction({
      action: 'expert_split.update', targetType: 'expert_split_settings', targetId: expertId,
      detail: { before: { pct_expert: before }, after: { pct_expert: value === DEFAULT ? null : Number(value) }, context: { name } },
    });
    toast.success(`${name} 分潤比例已更新，之後的新付款生效`);
    qc.invalidateQueries({ queryKey: ['company', 'expert-split-settings'] });
  };

  const list = experts.filter((e) => e.status !== 'suspended');
  const std = data?.standardExpert;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">老師分潤比例</CardTitle>
        <p className="text-xs text-muted-foreground">
          選擇老師可分得的比例；只套用之後的新付款，已付款與已發放月份不變。若某方案另有單獨設定，以方案設定為準。
          {Number.isFinite(std) && ` 未設定時用全站預設：老師 ${std}%。`}
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((e) => {
          const cur = data?.map[e.id];
          return (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{e.name}</div>
                <div className="text-xs text-muted-foreground">
                  {cur ? `老師 ${cur.pct_expert}%／平台 ${100 - cur.pct_expert}%` : '使用全站預設'}
                </div>
              </div>
              <Select
                value={cur ? String(cur.pct_expert) : DEFAULT}
                onValueChange={(v) => save(e.id, e.name, v)}
                disabled={saving === e.id}
              >
                <SelectTrigger className="h-8 w-[120px]" aria-label={`${e.name} 分潤比例`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>全站預設</SelectItem>
                  {OPTIONS.map((p) => <SelectItem key={p} value={String(p)}>老師 {p}%</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {!list.length && <div className="text-sm text-muted-foreground">尚無老師</div>}
      </CardContent>
    </Card>
  );
}
