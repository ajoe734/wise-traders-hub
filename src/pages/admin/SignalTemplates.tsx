import { SEO } from '@/components/SEO';
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Plus, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useFormDraft } from '@/hooks/useFormDraft';
import step1AdvImg from '@/assets/template-step1.png';
import step2AdvImg from '@/assets/template-step2-new.png';
import step1MenImg from '@/assets/template-step1-mentor.png';
import step2MenImg from '@/assets/template-step2-mentor.webp';

interface SignalTemplate {
  id: string;
  expert_id: string;
  title: string;
  action: string;
  reason: string;
  risk_note: string;
  strategy_note: string;
  sort_order: number;
}

import { SIGNAL_ACTION_META, getActionMeta, type SignalActionKey } from '@/lib/signalAction';

const TEMPLATE_ACTION_KEYS: SignalActionKey[] = ['buy', 'sell', 'add', 'trim', 'exit'];
const actionOptions = TEMPLATE_ACTION_KEYS.map((value) => ({
  value,
  label: SIGNAL_ACTION_META[value].label,
  className: SIGNAL_ACTION_META[value].className,
}));

const getActionLabel = (val: string) => getActionMeta(val).label;
const getActionClass = (val: string) => getActionMeta(val).className;

const emptyForm = { title: '', action: 'buy', reason: '', risk_note: '', strategy_note: '' };

const AdminSignalTemplates = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const isCompanyAdmin = hasRole('company_admin');
  const [templates, setTemplates] = useState<SignalTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const draftKey = `signal-template-draft-${expertSlug}-${editingId ?? 'new'}`;
  const { discard: discardDraft } = useFormDraft(
    draftKey,
    form,
    (saved) => setForm({ ...emptyForm, ...saved }),
    { enabled: dialogOpen }
  );

  const queryKey = ['admin', 'signal-templates', expertSlug ?? null] as const;
  const { data, isLoading: loading } = useQuery({
    queryKey,
    enabled: !!expertSlug,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug!).single();
      if (!exp) return { expert: null, templates: [] as SignalTemplate[] };
      const { data: tpl } = await supabase
        .from('expert_signal_templates' as any)
        .select('*')
        .eq('expert_id', exp.id)
        .order('sort_order', { ascending: true });
      return { expert: exp, templates: (tpl as any as SignalTemplate[]) || [] };
    },
  });

  const expert = data?.expert ?? null;
  // sync server templates -> local (so drag reorder can work)
  React.useEffect(() => {
    setTemplates(data?.templates ?? []);
  }, [data?.templates]);

  const invalidate = () => qc.invalidateQueries({ queryKey });


  const openCreate = () => {
    // 規範第 2 條：點擊「新增」必須清空 + 清除舊草稿
    try { sessionStorage.removeItem(`signal-template-draft-${expertSlug}-new`); } catch { /* noop */ }
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const openEdit = (t: SignalTemplate) => {
    setEditingId(t.id);
    setForm({ title: t.title, action: t.action, reason: t.reason, risk_note: t.risk_note, strategy_note: t.strategy_note });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!expert || !form.title.trim()) { toast.error('請填寫模板標題'); return; }
    if (editingId) {
      const { error } = await (supabase.from('expert_signal_templates' as any) as any)
        .update({ title: form.title, action: form.action, reason: form.reason, risk_note: form.risk_note, strategy_note: form.strategy_note })
        .eq('id', editingId);
      if (error) { toast.error(error.message); return; }
      toast.success('模板已更新');
    } else {
      const { error } = await (supabase.from('expert_signal_templates' as any) as any)
        .insert({ expert_id: expert.id, title: form.title, action: form.action, reason: form.reason, risk_note: form.risk_note, strategy_note: form.strategy_note, sort_order: templates.length });
      if (error) { toast.error(error.message); return; }
      toast.success('模板已新增');
    }
    discardDraft();
    setDialogOpen(false);
    invalidate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此模板？')) return;
    const { error } = await (supabase.from('expert_signal_templates' as any) as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('模板已刪除');
    invalidate();
  };

  // Drag reorder
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...templates];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setTemplates(updated);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    for (let i = 0; i < templates.length; i++) {
      if (templates[i].sort_order !== i) {
        await (supabase.from('expert_signal_templates' as any) as any).update({ sort_order: i }).eq('id', templates[i].id);
      }
    }
    invalidate();
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <SEO title={`${expertSlug || ''} 訊號範本 | legendflow`} description={'管理訊號模板（標的、進出場條件）。'} path={`/admin/${expertSlug || ''}/signal-templates`} noindex />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">訊號模板管理</h1>
            <p className="text-muted-foreground text-sm mt-1">建立常用訊號模板，發布時一鍵填入完整內容</p>
          </div>
          <Button onClick={openCreate} className={cn(expert?.role === 'mentor' ? "bg-mentor hover:bg-mentor/90" : "bg-advisor hover:bg-advisor/90")}>
            <Plus className="h-4 w-4 mr-2" />新增模板
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">尚未建立任何訊號模板</div>
            ) : (
              <div className="divide-y">
                {templates.map((t, idx) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      dragIdx === idx && "opacity-50"
                    )}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
                    <span className="font-medium text-sm min-w-[80px]">{t.title}</span>
                    <Badge className={cn('text-[10px] px-1.5 py-0 shrink-0', getActionClass(t.action))}>
                      {getActionLabel(t.action)}
                    </Badge>
                    <span className="text-sm text-muted-foreground truncate flex-1">{t.reason || '-'}</span>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workflow Guide */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">📖 操作流程範例</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="rounded-lg overflow-hidden border">
                  <img src={expert?.role === 'mentor' ? step1MenImg : step1AdvImg} alt="步驟一：新增模板" className="w-full h-auto" />
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="text-xs mb-1">步驟一</Badge>
                  <p className="text-xs text-muted-foreground">點擊「新增模板」，填寫名稱、方向、理由、風險與策略後儲存</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg overflow-hidden border">
                  <img src={expert?.role === 'mentor' ? step2MenImg : step2AdvImg} alt="步驟二：發布訊號時套用模板" className="w-full h-auto" />
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="text-xs mb-1">步驟二</Badge>
                  <p className="text-xs text-muted-foreground">發布訊號時，點擊模板標籤即可快速套用預設內容</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '編輯模板' : '新增模板'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>模板名稱 *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="例：突破壓力位" />
            </div>
            <div className="space-y-2">
              <Label>操作方向 *</Label>
              <Select value={form.action} onValueChange={v => setForm(f => ({ ...f, action: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {actionOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>操作理由</Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="突破壓力位，順勢做多" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>風險提示</Label>
              <Textarea value={form.risk_note} onChange={e => setForm(f => ({ ...f, risk_note: e.target.value }))} placeholder="跌破前低停損" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>策略說明</Label>
              <Textarea value={form.strategy_note} onChange={e => setForm(f => ({ ...f, strategy_note: e.target.value }))} placeholder="短線波段" rows={2} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { discardDraft(); setDialogOpen(false); }}>取消</Button>
              <Button onClick={handleSave} disabled={!form.title.trim()} className={cn(expert?.role === 'mentor' ? "bg-mentor hover:bg-mentor/90" : "bg-advisor hover:bg-advisor/90")}>儲存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminSignalTemplates;
