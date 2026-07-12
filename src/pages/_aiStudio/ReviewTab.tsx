import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Sparkles, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { edgeCall, formatEdgeError } from '@/lib/aiStudioInvoke';
import ErrorDetailsPanel, { fromEdgeError, fromPartialFailure, type LastEdgeError } from './ErrorDetailsPanel';

interface Props { expertId: string; canEdit: boolean; }

const call = (action: string, expertId: string, extra: Record<string, unknown> = {}) =>
  edgeCall('expert-ai-studio', action, expertId, extra);

interface PendingItem {
  id: string;
  source_type: string;
  title: string | null;
  content: string;
  is_manual: boolean;
  has_embedding: boolean;
  created_at: string;
  training_session_id: string | null;
  metadata: Record<string, unknown> | null;
}

const sourceLabel: Record<string, { label: string; cls: string }> = {
  training: { label: '週五訓練', cls: 'bg-mentor/10 text-mentor' },
  manual: { label: '手動輸入', cls: 'bg-slate-500/10 text-slate-700' },
  signal: { label: '週記自動', cls: 'bg-blue-500/10 text-blue-700' },
  bio: { label: '個人簡介', cls: 'bg-blue-500/10 text-blue-700' },
};

export default function ReviewTab({ expertId, canEdit }: Props) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['pending-chunks', expertId],
    queryFn: () => call('list_pending_chunks', expertId),
  });
  const items: PendingItem[] = data?.items || [];

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState<PendingItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [lastError, setLastError] = useState<LastEdgeError | null>(null);

  const openEdit = (i: PendingItem) => {
    setEditing(i);
    setEditTitle(i.title || '');
    setEditContent(i.content);
  };
  const saveEdit = async (thenApprove = false) => {
    if (!editing) return;
    if (!editContent.trim()) { toast.error('請填寫內容'); return; }
    if (editContent.length > 6000) { toast.error('內容超過 6000 字'); return; }
    setSavingEdit(true);
    try {
      await call('update_chunk', expertId, { id: editing.id, title: editTitle, content: editContent });
      if (thenApprove) {
        const res = await call('bulk_review_chunks', expertId, { ids: [editing.id], decision: 'approve' });
        if (res.failed?.length) {
          const f = res.failed[0];
          toast.error(
            `核可失敗（${f.stage || '?'}）：${f.error || '未知'}\n[cand ${String(f.id).slice(0, 8)} · req ${String(res.requestId || '').slice(0, 8)}]`,
          );
          setLastError(fromPartialFailure('編輯後核可失敗', res, {
            total: 1,
            ok: 0,
            failed: res.failed,
          }));
          // 不關 dialog、不 refetch，讓使用者能重試
          return;
        }
        toast.success('已更新並核可');
      } else {
        toast.success('已更新並重新索引');
      }
      setLastError(null);
      setEditing(null);
      refetch();
    } catch (e) {
      toast.error(formatEdgeError(e, '儲存失敗'));
      setLastError(fromEdgeError(thenApprove ? '編輯後核可失敗' : '儲存編輯失敗', e, {
        action: thenApprove ? 'bulk_review_chunks' : 'update_chunk',
        candidateId: editing.id,
      }));
    } finally { setSavingEdit(false); }
  };

  const pickedIds = Object.keys(picked).filter((k) => picked[k] && items.some((i) => i.id === k));
  const allChecked = items.length > 0 && pickedIds.length === items.length;
  const toggleAll = () => {
    if (allChecked) setPicked({});
    else setPicked(Object.fromEntries(items.map((i) => [i.id, true])));
  };

  const doReview = async (decision: 'approve' | 'reject') => {
    if (pickedIds.length === 0) { toast.error('請至少勾選一條'); return; }
    if (decision === 'reject' && !confirm(`確定退回 ${pickedIds.length} 條候選？此動作會標記為 rejected，可再手動刪除。`)) return;
    if (decision === 'approve') setApproving(true); else setRejecting(true);
    try {
      const res = await call('bulk_review_chunks', expertId, { ids: pickedIds, decision });
      const msg = decision === 'approve'
        ? `已核可 ${res.approved} 條${res.embedded ? `（其中 ${res.embedded} 條補跑 embedding）` : ''}${res.failed?.length ? `，失敗 ${res.failed.length}` : ''}`
        : `已退回 ${res.rejected} 條`;
      if (res.failed?.length) {
        const f = res.failed[0];
        const req = String(res.requestId || '').slice(0, 8);
        toast.error(
          `${msg}\n首筆失敗：${f.error || '未知'}\n[${f.stage || '?'} · cand ${String(f.id).slice(0, 8)} · req ${req}]`,
        );
        setLastError(fromPartialFailure(decision === 'approve' ? '批次核可部分失敗' : '批次退回部分失敗', res, {
          total: pickedIds.length,
          ok: decision === 'approve' ? res.approved : res.rejected,
          failed: res.failed,
        }));
      } else {
        toast.success(msg);
        setLastError(null);
      }
      setPicked({});
      refetch();
    } catch (e) {
      toast.error(formatEdgeError(e, '審核失敗'));
      setLastError(fromEdgeError(decision === 'approve' ? '批次核可失敗' : '批次退回失敗', e, { action: 'bulk_review_chunks' }));
    } finally { setApproving(false); setRejecting(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          待審核候選條目
        </CardTitle>
        <CardDescription>
          所有 <code className="text-xs">status=pending</code> 的知識條目彙整在這裡。勾選後可批次核可（核可時會補跑 embedding，若缺）或退回。核可後即進入 RAG 檢索範圍，AI 分身開始引用。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground">載入中…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">目前沒有待審核條目。</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={!canEdit} />
                <span>全選（{pickedIds.length}/{items.length}）</span>
              </label>
              {canEdit && (
                <div className="flex gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doReview('reject')}
                    disabled={rejecting || approving || pickedIds.length === 0}
                    className="gap-1.5 text-destructive hover:text-destructive flex-1 sm:flex-none"
                  >
                    {rejecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <XCircle className="h-3.5 w-3.5" />退回
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => doReview('approve')}
                    disabled={approving || rejecting || pickedIds.length === 0}
                    className="gap-1.5 flex-1 sm:flex-none"
                  >
                    {approving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <CheckCircle2 className="h-3.5 w-3.5" />核可並啟用
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {items.map((i) => {
                const s = sourceLabel[i.source_type] || { label: i.source_type, cls: 'bg-muted text-muted-foreground' };
                return (
                  <div
                    key={i.id}
                    className={`flex gap-3 border rounded-lg p-3 transition-colors ${picked[i.id] ? 'border-primary/60 bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <Checkbox
                      checked={!!picked[i.id]}
                      onCheckedChange={(v) => setPicked((prev) => ({ ...prev, [i.id]: !!v }))}
                      disabled={!canEdit}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-[10px] ${s.cls} hover:${s.cls}`}>{s.label}</Badge>
                        {i.has_embedding ? (
                          <Badge variant="outline" className="text-[10px]"><Sparkles className="h-3 w-3 mr-0.5" />已 embed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400">待 embed</Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(i.created_at).toLocaleString('zh-TW', { hour12: false })}
                        </span>
                      </div>
                      {i.title && <p className="font-medium text-sm">{i.title}</p>}
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">{i.content}</p>
                    </div>
                    {canEdit && (
                      <div className="shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(i)} className="gap-1 h-8 text-xs px-2">
                          <Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline">編輯</span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {isRefetching && <p className="text-xs text-muted-foreground text-center">更新中…</p>}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>編輯候選條目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">標題（選填）</label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                內容 <span className="text-destructive">*</span>（儲存時會重新計算 embedding）
              </label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[200px] sm:min-h-[260px]"
                maxLength={6000}
              />
              <p className="text-xs text-right text-muted-foreground mt-1">{editContent.length} / 6000</p>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={savingEdit} className="w-full sm:w-auto">取消</Button>
            <Button variant="secondary" onClick={() => saveEdit(false)} disabled={savingEdit} className="gap-1.5 w-full sm:w-auto">
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              僅儲存
            </Button>
            <Button onClick={() => saveEdit(true)} disabled={savingEdit} className="gap-1.5 w-full sm:w-auto">
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              <CheckCircle2 className="h-4 w-4" />儲存並核可
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
