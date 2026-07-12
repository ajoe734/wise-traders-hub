import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Loader2, Trash2, Pencil, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { edgeCall, formatEdgeError } from '@/lib/aiStudioInvoke';

interface Props { expertId: string; canEdit: boolean; isCompanyAdmin: boolean; }

const call = (action: string, expertId: string, extra: Record<string, unknown> = {}) =>
  edgeCall('expert-ai-studio', action, expertId, extra);

interface Chunk {
  id: string;
  title: string | null;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  source_type: string;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
}

export default function KnowledgeTab({ expertId, canEdit, isCompanyAdmin }: Props) {
  const [scope, setScope] = useState<'manual' | 'all'>('manual');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['chunks', expertId, scope, statusFilter],
    queryFn: () => call('list_chunks', expertId, { scope, status: statusFilter === 'all' ? undefined : statusFilter }),
  });
  const items: Chunk[] = data?.items || [];

  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; chunk?: Chunk } | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const openAdd = () => { setTitle(''); setContent(''); setDialog({ mode: 'add' }); };
  const openEdit = (c: Chunk) => { setTitle(c.title || ''); setContent(c.content); setDialog({ mode: 'edit', chunk: c }); };

  const save = async () => {
    if (!content.trim()) { toast.error('請填寫內容'); return; }
    setSaving(true);
    try {
      if (dialog?.mode === 'add') {
        await call('add_chunk', expertId, { title, content });
        toast.success('知識條目已新增並索引');
      } else if (dialog?.chunk) {
        await call('update_chunk', expertId, { id: dialog.chunk.id, title, content });
        toast.success('知識條目已更新');
      }
      setDialog(null);
      refetch();
    } catch (e: any) {
      toast.error(e.message || '儲存失敗');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('確定刪除這條知識？')) return;
    try {
      await call('delete_chunk', expertId, { id });
      toast.success('已刪除');
      refetch();
    } catch (e: any) { toast.error(e.message); }
  };

  const review = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await call('update_chunk', expertId, { id, status });
      toast.success(status === 'approved' ? '已核可' : '已退回');
      refetch();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">知識庫條目</CardTitle>
          <CardDescription>
            <strong>手動</strong>條目是你自己貼上的補充知識（口訣、選股邏輯、常見誤解澄清），不會被自動索引洗掉；<strong>自動</strong>條目是從你已發佈的週記與策略欄位同步的。AI 回答時只會用<strong>已核可</strong>的條目。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              <Button size="sm" variant={scope === 'manual' ? 'default' : 'outline'} onClick={() => setScope('manual')}>
                手動條目
              </Button>
              <Button size="sm" variant={scope === 'all' ? 'default' : 'outline'} onClick={() => setScope('all')}>
                全部（含週記自動）
              </Button>
            </div>
            {canEdit && (
              <Button size="sm" onClick={openAdd} className="gap-1.5">
                <Plus className="h-4 w-4" />新增條目
              </Button>
            )}
          </div>

          <div className="flex gap-1 flex-wrap border-t pt-3">
            <span className="text-xs text-muted-foreground self-center mr-1">狀態：</span>
            {([
              { k: 'all', label: '全部' },
              { k: 'pending', label: '待審', icon: <Clock className="h-3 w-3" /> },
              { k: 'approved', label: '已核可', icon: <CheckCircle2 className="h-3 w-3" /> },
              { k: 'rejected', label: '已退回', icon: <XCircle className="h-3 w-3" /> },
            ] as const).map((s) => (
              <Button
                key={s.k}
                size="sm"
                variant={statusFilter === s.k ? 'secondary' : 'ghost'}
                onClick={() => setStatusFilter(s.k)}
                className="gap-1 h-7 text-xs"
              >
                {'icon' in s && s.icon}
                {s.label}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">載入中…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              沒有符合條件的條目。{canEdit && scope === 'manual' && statusFilter === 'all' ? '點右上「新增條目」開始建立。' : ''}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((c) => {
                const canReview = canEdit || isCompanyAdmin;
                const canModify = canEdit && (c.is_manual || c.status === 'pending');
                return (
                <div key={c.id} className="border rounded-lg p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {c.title && <span className="font-medium text-sm truncate">{c.title}</span>}
                      <Badge variant="outline" className="text-[10px]">{c.source_type}</Badge>
                      {c.is_manual && <Badge variant="secondary" className="text-[10px]">手動</Badge>}
                      {c.status === 'approved' && <Badge className="text-[10px] bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10"><CheckCircle2 className="h-3 w-3 mr-0.5" />已核可</Badge>}
                      {c.status === 'pending' && <Badge className="text-[10px] bg-amber-500/10 text-amber-700 hover:bg-amber-500/10"><Clock className="h-3 w-3 mr-0.5" />待審</Badge>}
                      {c.status === 'rejected' && <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-0.5" />退回</Badge>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {canReview && c.status !== 'approved' && (
                        <Button size="sm" variant="ghost" onClick={() => review(c.id, 'approved')} title="核可">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {canReview && c.status !== 'rejected' && (
                        <Button size="sm" variant="ghost" onClick={() => review(c.id, 'rejected')} title="退回">
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      {canModify && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="編輯">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(c.id)} title="刪除">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">{c.content}</p>
                </div>
              );})}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'add' ? '新增知識條目' : '編輯知識條目'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">標題（選填）</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：波段選股三步驟" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">內容 <span className="text-destructive">*</span>（最多 6000 字，一個概念寫一條）</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'例：\n我看波段股會先看月線是否高於年線，再看成交量是否放大 1.5 倍以上，最後才進日線找進場點。這個順序不能顛倒，否則會被短線雜訊帶偏。'}
                className="min-h-[240px]"
                maxLength={6000}
              />
              <p className="text-xs text-right text-muted-foreground mt-1">{content.length} / 6000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              儲存並索引
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
