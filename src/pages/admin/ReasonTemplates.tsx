import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Plus, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFormDraft } from '@/hooks/useFormDraft';

interface Template {
  id: string;
  expert_id: string;
  title: string;
  content: string;
  sort_order: number;
}

const ReasonTemplates = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      const { data } = await supabase
        .from('expert_reason_templates' as any)
        .select('*')
        .eq('expert_id', exp.id)
        .order('sort_order', { ascending: true });
      setTemplates((data as any as Template[]) || []);
    }
    setLoading(false);
  }, [expertSlug]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditingId(t.id);
    setTitle(t.title);
    setContent(t.content);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!expert || !title.trim() || !content.trim()) {
      toast.error('請填寫標題與內容');
      return;
    }
    if (editingId) {
      const { error } = await supabase
        .from('expert_reason_templates' as any)
        .update({ title: title.trim(), content: content.trim() } as any)
        .eq('id', editingId);
      if (error) { toast.error(error.message); return; }
      toast.success('模板已更新');
    } else {
      const maxSort = templates.length > 0 ? Math.max(...templates.map(t => t.sort_order)) + 1 : 0;
      const { error } = await supabase
        .from('expert_reason_templates' as any)
        .insert({ expert_id: expert.id, title: title.trim(), content: content.trim(), sort_order: maxSort } as any);
      if (error) { toast.error(error.message); return; }
      toast.success('模板已新增');
    }
    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('expert_reason_templates' as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('模板已刪除');
    fetchData();
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...templates];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setTemplates(reordered);
    setDragIdx(idx);
  };

  const handleDragEnd = async () => {
    setDragIdx(null);
    // Batch update sort_order
    const updates = templates.map((t, i) => 
      supabase.from('expert_reason_templates' as any).update({ sort_order: i } as any).eq('id', t.id)
    );
    await Promise.all(updates);
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">理由模板管理</h1>
            <p className="text-muted-foreground text-sm mt-1">預設常用的操作理由，發布訊號時可一鍵填入</p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />新增模板
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                尚無模板，點擊右上角「新增模板」開始建立
              </div>
            ) : (
              <div className="divide-y">
                {templates.map((t, idx) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.content}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? '編輯模板' : '新增模板'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>標題（按鈕顯示文字）</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="例：突破壓力位" />
            </div>
            <div className="space-y-2">
              <Label>內容（自動填入理由欄）</Label>
              <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="例：突破壓力位，順勢做多" rows={3} />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={!title.trim() || !content.trim()}>
                {editingId ? '儲存' : '新增'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ReasonTemplates;
