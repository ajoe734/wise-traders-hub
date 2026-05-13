import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ArrowRight, Settings, Plus, X } from 'lucide-react';
import { resetKnowledgeBaseCache, preloadKnowledgeBase } from '@/checkup/lib/knowledgeBase';
import { useQueryClient } from '@tanstack/react-query';

interface FieldDiff { from: any; to: any }
interface UpdateItem {
  category: string; item_id: string; title: string; version: string;
  changed_fields: string[]; diffs: Record<string, FieldDiff>;
  confidence?: number; tags?: string[];
}
interface InsertItem { category: string; item_id: string; title: string; confidence?: number; tags?: string[]; fact?: string; interpretation?: string; action?: string }
interface DeactivateItem { category: string; item_id: string; title: string; tags?: string[] }

interface SyncSummary {
  counts: { insert: number; update: number; deactivate_stale: number; unchanged: number };
  preview: { insert: InsertItem[]; update: UpdateItem[]; deactivate_stale: DeactivateItem[] };
}

interface SyncSettings {
  id?: string;
  notify_user_ids: string[];
  notify_on_success: boolean;
  notify_on_failure: boolean;
  retry_on_failure: boolean;
  max_retries: number;
  retry_delay_ms: number;
}

interface AdminUser { user_id: string; email?: string | null; display_name?: string | null }

const CAT_LABEL: Record<string, string> = {
  industry_trends: '產業趨勢',
  chip_analysis: '籌碼分析',
  technical_analysis: '技術分析',
  strategy_cases: '策略案例',
  news_correlation: '新聞事件',
};

const FIELD_LABEL: Record<string, string> = {
  title: '標題',
  fact: '事實 (fact)',
  interpretation: '解釋',
  action: '行動建議',
  confidence: '信心度',
  tags: '標籤',
};

export function SyncKnowledgeBaseDialog({ onApplied }: { onApplied?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  const [settings, setSettings] = useState<SyncSettings>({
    notify_user_ids: [], notify_on_success: false, notify_on_failure: true,
    retry_on_failure: true, max_retries: 2, retry_delay_ms: 1500,
  });
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  async function loadPreview() {
    setLoading(true);
    setSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-sync', {
        body: { dryRun: true, trigger: 'manual_preview' },
      });
      if (error) throw error;
      setSummary(data);
    } catch (e: any) {
      toast.error(`預覽失敗：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    const { data } = await supabase.from('knowledge_sync_settings' as any).select('*').limit(1).maybeSingle();
    if (data) setSettings({
      id: (data as any).id,
      notify_user_ids: (data as any).notify_user_ids ?? [],
      notify_on_success: (data as any).notify_on_success ?? false,
      notify_on_failure: (data as any).notify_on_failure ?? true,
      retry_on_failure: (data as any).retry_on_failure ?? true,
      max_retries: (data as any).max_retries ?? 2,
      retry_delay_ms: (data as any).retry_delay_ms ?? 1500,
    });

    const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'company_admin');
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id,email,display_name').in('user_id', ids);
      setAdmins((profiles ?? []) as any);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const payload = {
        notify_user_ids: settings.notify_user_ids,
        notify_on_success: settings.notify_on_success,
        notify_on_failure: settings.notify_on_failure,
        retry_on_failure: settings.retry_on_failure,
        max_retries: Number(settings.max_retries),
        retry_delay_ms: Number(settings.retry_delay_ms),
        updated_by: u.user?.id,
        updated_at: new Date().toISOString(),
      };
      const q = settings.id
        ? supabase.from('knowledge_sync_settings' as any).update(payload).eq('id', settings.id)
        : supabase.from('knowledge_sync_settings' as any).insert(payload);
      const { error } = await q;
      if (error) throw error;
      toast.success('通知設定已儲存');
    } catch (e: any) {
      toast.error(`儲存失敗：${e?.message ?? e}`);
    } finally {
      setSavingSettings(false);
    }
  }

  async function apply() {
    setApplying(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('knowledge-sync', {
        body: { dryRun: false, trigger: 'manual_apply', actorId: userData.user?.id },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(`同步部分失敗（重試 ${data?.retry_attempts ?? 0} 次）：${(data?.errors ?? []).slice(0, 2).join('; ')}`);
      } else {
        toast.success(`同步完成：新增 ${data.counts.insert}、更新 ${data.counts.update}、停用 ${data.counts.deactivate_stale}${data.retry_attempts ? `（重試 ${data.retry_attempts} 次）` : ''}`);
      }

      // 自動刷新前端 cache
      try {
        resetKnowledgeBaseCache();
        await preloadKnowledgeBase({ force: true });
      } catch {/* ignore */}
      // 連同所有 React Query 快取一起失效
      qc.invalidateQueries();

      setOpen(false);
      setSummary(null);
      onApplied?.();
    } catch (e: any) {
      toast.error(`同步失敗：${e?.message ?? e}`);
    } finally {
      setApplying(false);
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v);
    if (v) { loadPreview(); loadSettings(); }
    else setSummary(null);
  }

  const total = summary
    ? summary.counts.insert + summary.counts.update + summary.counts.deactivate_stale
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RefreshCw className="h-4 w-4 mr-1" /> 同步知識庫
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>同步種子 JSON 到知識庫資料表</DialogTitle>
          <DialogDescription>
            比對「種子 JSON」（前端 fallback 用，2025-2026 版 25 條）與「知識庫資料表」（DB checkup_knowledge_items，線上實際使用），逐欄預覽差異後套用，套用完成會自動刷新前端快取。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">差異預覽</TabsTrigger>
            <TabsTrigger value="settings"><Settings className="h-3 w-3 mr-1" /> 通知 / 重試設定</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="space-y-4 mt-4">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> 比對中…
              </div>
            )}

            {!loading && summary && (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <Stat label="新增" n={summary.counts.insert} cls="bg-emerald-100 text-emerald-800" />
                  <Stat label="更新" n={summary.counts.update} cls="bg-blue-100 text-blue-800" />
                  <Stat label="停用過時" n={summary.counts.deactivate_stale} cls="bg-orange-100 text-orange-800" />
                  <Stat label="未變動" n={summary.counts.unchanged} cls="bg-muted" />
                </div>

                {total === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    目前雲端與本地完全一致，無需同步。
                  </p>
                )}

                {summary.preview.update.length > 0 && (
                  <Section title="更新（逐欄差異）">
                    <div className="space-y-3">
                      {summary.preview.update.map((it, i) => (
                        <div key={`u-${i}`} className="border rounded-lg p-3">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <Badge variant="outline" className="bg-blue-50">
                              {CAT_LABEL[it.category] ?? it.category}
                            </Badge>
                            <code className="text-xs text-muted-foreground">{it.item_id}</code>
                            <span className="font-medium">{it.title}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{it.version}</span>
                          </div>
                          <div className="space-y-1.5">
                            {it.changed_fields.map(f => (
                              <FieldDiffRow key={f} field={f} diff={it.diffs[f]} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {summary.preview.insert.length > 0 && (
                  <Section title="新增條目">
                    <div className="border rounded-lg divide-y">
                      {summary.preview.insert.map((it, i) => (
                        <div key={`i-${i}`} className="p-2 text-sm flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-emerald-50">
                            {CAT_LABEL[it.category] ?? it.category}
                          </Badge>
                          <code className="text-xs text-muted-foreground">{it.item_id}</code>
                          <span className="font-medium">{it.title}</span>
                          {typeof it.confidence === 'number' && (
                            <span className="text-xs text-muted-foreground">信心 {(it.confidence * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {summary.preview.deactivate_stale.length > 0 && (
                  <Section title="停用過時條目（含 2024 標籤、未在新版 JSON 內）">
                    <div className="border rounded-lg divide-y">
                      {summary.preview.deactivate_stale.map((it, i) => (
                        <div key={`d-${i}`} className="p-2 text-sm flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-orange-50">
                            {CAT_LABEL[it.category] ?? it.category}
                          </Badge>
                          <code className="text-xs text-muted-foreground">{it.item_id}</code>
                          <span className="font-medium">{it.title}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">將設為 is_active=false</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="settings" className="space-y-4 mt-4">
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              admins={admins}
              saving={savingSettings}
              onSave={saveSettings}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={applying}>取消</Button>
          <Button variant="outline" onClick={loadPreview} disabled={loading || applying}>
            <RefreshCw className="h-4 w-4 mr-1" /> 重新比對
          </Button>
          <Button onClick={apply} disabled={applying || loading || !summary || total === 0}>
            {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            確認套用 {total > 0 && <Badge className="ml-2">{total}</Badge>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-xs">{label}</div>
      <div className="text-2xl font-medium tabular-nums">{n}</div>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      {children}
    </div>
  );
}

function fmt(v: any): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (Array.isArray(v)) return v.join(', ') || '∅';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function FieldDiffRow({ field, diff }: { field: string; diff: FieldDiff }) {
  const label = FIELD_LABEL[field] ?? field;
  const isLong = ['fact', 'interpretation', 'action'].includes(field);
  return (
    <div className="text-xs grid grid-cols-[80px_1fr_auto_1fr] gap-2 items-start py-1 border-t first:border-t-0">
      <div className="font-medium text-muted-foreground pt-1">{label}</div>
      <div className={`p-1.5 rounded bg-red-50 text-red-900 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`} title={fmt(diff.from)}>
        {fmt(diff.from)}
      </div>
      <ArrowRight className="h-3 w-3 text-muted-foreground mt-2" />
      <div className={`p-1.5 rounded bg-emerald-50 text-emerald-900 ${isLong ? 'whitespace-pre-wrap' : 'truncate'}`} title={fmt(diff.to)}>
        {fmt(diff.to)}
      </div>
    </div>
  );
}

function SettingsPanel({
  settings, setSettings, admins, saving, onSave,
}: {
  settings: SyncSettings;
  setSettings: (s: SyncSettings) => void;
  admins: AdminUser[];
  saving: boolean;
  onSave: () => void;
}) {
  const selected = new Set(settings.notify_user_ids);
  function toggle(uid: string) {
    const next = new Set(selected);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setSettings({ ...settings, notify_user_ids: Array.from(next) });
  }
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm">通知對象（公司管理員）</Label>
        <p className="text-xs text-muted-foreground mb-2">未選任何人時，會通知所有 company_admin。</p>
        <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
          {admins.length === 0 && <div className="p-3 text-xs text-muted-foreground">沒有可選的管理員</div>}
          {admins.map(a => (
            <label key={a.user_id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50">
              <input
                type="checkbox"
                checked={selected.has(a.user_id)}
                onChange={() => toggle(a.user_id)}
              />
              <span className="font-medium">{a.display_name ?? '(未命名)'}</span>
              <span className="text-xs text-muted-foreground">{a.email}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center justify-between border rounded p-2">
          <Label className="text-sm">成功時通知</Label>
          <Switch
            checked={settings.notify_on_success}
            onCheckedChange={v => setSettings({ ...settings, notify_on_success: v })}
          />
        </div>
        <div className="flex items-center justify-between border rounded p-2">
          <Label className="text-sm">失敗時通知</Label>
          <Switch
            checked={settings.notify_on_failure}
            onCheckedChange={v => setSettings({ ...settings, notify_on_failure: v })}
          />
        </div>
      </div>

      <div className="border rounded p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">失敗時自動重試</Label>
          <Switch
            checked={settings.retry_on_failure}
            onCheckedChange={v => setSettings({ ...settings, retry_on_failure: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">最大重試次數</Label>
            <Input
              type="number" min={0} max={5}
              value={settings.max_retries}
              disabled={!settings.retry_on_failure}
              onChange={e => setSettings({ ...settings, max_retries: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">每次間隔 (ms)</Label>
            <Input
              type="number" min={0} step={100}
              value={settings.retry_delay_ms}
              disabled={!settings.retry_on_failure}
              onChange={e => setSettings({ ...settings, retry_delay_ms: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} 儲存設定
        </Button>
      </div>
    </div>
  );
}
