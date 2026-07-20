import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { SEO } from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Save, History, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const KEY = 'bsr_sync';

type BackfillConfig = {
  batch: number;
  lookback: number;
  batch_max: number;
  lookback_max: number;
  max_runs_per_hour: number;
  max_attempts_per_day: number;
  cooldown_hours: number;
};

type ConfigRow = {
  key: string;
  config: Record<string, any>;
  version: number;
  updated_at: string;
  updated_by: string | null;
  note: string | null;
};

type HistoryRow = {
  id: string;
  key: string;
  version: number;
  config: Record<string, any>;
  changed_at: string;
  changed_by: string | null;
  note: string | null;
};

const DEFAULT_BACKFILL: BackfillConfig = {
  batch: 6,
  lookback: 7,
  batch_max: 20,
  lookback_max: 10,
  max_runs_per_hour: 6,
  max_attempts_per_day: 8,
  cooldown_hours: 12,
};

function normalize(input: any): BackfillConfig {
  const src = input && typeof input === 'object' ? input : {};
  const num = (k: keyof BackfillConfig, min: number) => {
    const n = Number(src[k]);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : DEFAULT_BACKFILL[k];
  };
  return {
    batch: Math.max(1, num('batch', 1)),
    lookback: Math.max(1, num('lookback', 1)),
    batch_max: Math.max(1, num('batch_max', 1)),
    lookback_max: Math.max(1, num('lookback_max', 1)),
    max_runs_per_hour: Math.max(0, num('max_runs_per_hour', 0)),
    max_attempts_per_day: Math.max(1, num('max_attempts_per_day', 1)),
    cooldown_hours: Math.max(1, num('cooldown_hours', 1)),
  };
}


export default function BsrSyncConfig() {
  const qc = useQueryClient();
  const [form, setForm] = useState<BackfillConfig>(DEFAULT_BACKFILL);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: current, isLoading, refetch } = useQuery<ConfigRow | null>({
    queryKey: ['tw_bsr_sync_config', KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tw_bsr_sync_config' as any)
        .select('*')
        .eq('key', KEY)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    },
  });

  const { data: history } = useQuery<HistoryRow[]>({
    queryKey: ['tw_bsr_sync_config_history', KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tw_bsr_sync_config_history' as any)
        .select('*')
        .eq('key', KEY)
        .order('version', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as any) ?? [];
    },
  });

  useEffect(() => {
    if (current?.config?.backfill) setForm(normalize(current.config.backfill));
  }, [current?.version]);

  const fullConfigPreview = useMemo(() => {
    const base = current?.config ?? {};
    return { ...base, backfill: form };
  }, [current, form]);

  async function handleSave() {
    if (!current) {
      toast.error('讀取現有設定失敗，無法儲存');
      return;
    }
    setSaving(true);
    try {
      const nextConfig = { ...current.config, backfill: form };
      const nextVersion = (current.version || 0) + 1;
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('tw_bsr_sync_config' as any)
        .update({
          config: nextConfig,
          version: nextVersion,
          updated_at: new Date().toISOString(),
          updated_by: userData?.user?.id ?? null,
          note: note.trim() || `backfill tune v${nextVersion}`,
        })
        .eq('key', KEY);
      if (error) throw error;
      toast.success(`已生效（v${nextVersion}）`);
      setNote('');
      qc.invalidateQueries({ queryKey: ['tw_bsr_sync_config'] });
      qc.invalidateQueries({ queryKey: ['tw_bsr_sync_config_history'] });
    } catch (e: any) {
      toast.error(e?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CompanyLayout>
      <SEO title="BSR Backfill 設定 | Company" description="動態調整 BSR backfill 的 batch、lookback 與高頻上限" />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">BSR Backfill 動態設定</h1>
            <p className="text-sm text-muted-foreground mt-1">
              調整 backfill 批次量、lookback 深度與每小時上限；變更會即時生效並記錄版本。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {current && (
              <Badge variant="outline" className="text-xs">
                目前 v{current.version} · {new Date(current.updated_at).toLocaleString('zh-TW')}
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Backfill 參數</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="每輪批次量 (batch)" hint="每次 backfill 執行處理的股票數">
                <Input
                  type="number" min={1} max={form.batch_max} value={form.batch}
                  onChange={(e) => setForm({ ...form, batch: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
              <Field label="回補 Lookback 天數" hint="每檔往回嘗試的交易日數">
                <Input
                  type="number" min={1} max={form.lookback_max} value={form.lookback}
                  onChange={(e) => setForm({ ...form, lookback: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
              <Field label="每小時最多執行次數" hint="0 = 不限；達上限會回傳 rate_limited">
                <Input
                  type="number" min={0} value={form.max_runs_per_hour}
                  onChange={(e) => setForm({ ...form, max_runs_per_hour: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
              <Field label="Batch 上限 (batch_max)" hint="呼叫端傳入 batch 的硬上限">
                <Input
                  type="number" min={1} value={form.batch_max}
                  onChange={(e) => setForm({ ...form, batch_max: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
              <Field label="Lookback 上限 (lookback_max)" hint="呼叫端傳入 lookback 的硬上限">
                <Input
                  type="number" min={1} value={form.lookback_max}
                  onChange={(e) => setForm({ ...form, lookback_max: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">變更備註（會寫入版本歷史）</Label>
              <Textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="例如：提高高頻上限應對盤中失效…"
                className="mt-1" rows={2}
              />
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <div className="text-xs text-muted-foreground">
                儲存後立即生效，edge function 下次執行即讀取新設定。
              </div>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />{saving ? '儲存中…' : '儲存並啟用'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />版本歷史
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!history?.length ? (
              <div className="text-sm text-muted-foreground py-4">尚無歷史紀錄。</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => {
                  const bf = normalize(h.config?.backfill);
                  const isCurrent = h.version === current?.version;
                  return (
                    <div key={h.id} className="flex items-start justify-between border rounded-md px-3 py-2 text-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={isCurrent ? 'default' : 'outline'} className="text-xs">
                            v{h.version}{isCurrent ? ' · 目前' : ''}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {new Date(h.changed_at).toLocaleString('zh-TW')}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          batch={bf.batch} · lookback={bf.lookback} · max/h={bf.max_runs_per_hour} ·
                          {' '}bmax={bf.batch_max} · lmax={bf.lookback_max}
                        </div>
                        {h.note && <div className="text-xs">{h.note}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs text-muted-foreground">完整 config 預覽</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64">
{JSON.stringify(fullConfigPreview, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
