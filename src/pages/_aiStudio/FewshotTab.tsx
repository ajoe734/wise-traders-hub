import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Loader2, Trash2, Pencil, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface Props { expertId: string; canEdit: boolean; isCompanyAdmin: boolean; }

async function call(action: string, expertId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('expert-ai-studio', {
    body: { action, expert_id: expertId, ...extra },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'failed');
  return data;
}

interface Item {
  id: string; question: string; answer: string;
  status: 'pending' | 'approved' | 'rejected';
  sort_order: number;
}

export default function FewshotTab({ expertId, canEdit, isCompanyAdmin }: Props) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fewshots', expertId],
    queryFn: () => call('list_fewshots', expertId),
  });
  const items: Item[] = data?.items || [];

  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item?: Item } | null>(null);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [saving, setSaving] = useState(false);

  const openAdd = () => { setQ(''); setA(''); setDialog({ mode: 'add' }); };
  const openEdit = (i: Item) => { setQ(i.question); setA(i.answer); setDialog({ mode: 'edit', item: i }); };

  const save = async () => {
    if (!q.trim() || !a.trim()) { toast.error('請填寫問答'); return; }
    setSaving(true);
    try {
      const extra: any = { question: q, answer: a };
      if (dialog?.mode === 'edit') extra.id = dialog.item!.id;
      await call('upsert_fewshot', expertId, extra);
      toast.success('已儲存');
      setDialog(null);
      refetch();
    } catch (e: any) {
      toast.error(e.message || '儲存失敗');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('確定刪除？')) return;
    try { await call('delete_fewshot', expertId, { id }); toast.success('已刪除'); refetch(); }
    catch (e: any) { toast.error(e.message); }
  };

  const review = async (id: string, status: 'approved' | 'rejected') => {
    try { await call('review_fewshot', expertId, { id, status }); toast.success('已更新'); refetch(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">示範問答（Few-shot）</CardTitle>
          <CardDescription>
            預先示範「訂閱者這樣問，你會怎麼答」。AI 每次對話會參考這些示範來校準語氣與立場。建議 5–15 條，涵蓋高頻問題（進場邏輯／停損／看盤節奏／初學者建議）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={openAdd} className="gap-1.5">
                <Plus className="h-4 w-4" />新增示範
              </Button>
            </div>
          )}
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">載入中…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">尚無示範問答。</div>
          ) : (
            <div className="space-y-3">
              {items.map((i) => (
                <div key={i.id} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex gap-2 items-center">
                      {i.status === 'approved' && <Badge className="text-[10px] bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10"><CheckCircle2 className="h-3 w-3 mr-0.5" />已核可</Badge>}
                      {i.status === 'pending' && <Badge className="text-[10px] bg-amber-500/10 text-amber-700 hover:bg-amber-500/10"><Clock className="h-3 w-3 mr-0.5" />待審</Badge>}
                      {i.status === 'rejected' && <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-0.5" />退回</Badge>}
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 shrink-0">
                        {isCompanyAdmin && i.status !== 'approved' && (
                          <Button size="sm" variant="ghost" onClick={() => review(i.id, 'approved')}>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        {isCompanyAdmin && i.status !== 'rejected' && (
                          <Button size="sm" variant="ghost" onClick={() => review(i.id, 'rejected')}>
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <p><span className="text-xs text-muted-foreground mr-1">問</span>{i.question}</p>
                    <p className="whitespace-pre-wrap"><span className="text-xs text-muted-foreground mr-1">答</span>{i.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'add' ? '新增示範問答' : '編輯示範問答'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">訂閱者問題</label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：現在該進 2330 嗎？" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">你會怎麼回答</label>
              <Textarea value={a} onChange={(e) => setA(e.target.value)} className="min-h-[180px]"
                placeholder={'我不會給你「該不該進」的答案，那是你自己的決定。但我可以告訴你我怎麼看：先看月線是否…'} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
