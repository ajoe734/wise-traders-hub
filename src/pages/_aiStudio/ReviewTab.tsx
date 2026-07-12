import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface Props { expertId: string; canEdit: boolean; }

async function call(action: string, expertId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('expert-ai-studio', {
    body: { action, expert_id: expertId, ...extra },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'failed');
  return data;
}

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
      if (res.failed?.length) toast.error(msg); else toast.success(msg);
      setPicked({});
      refetch();
    } catch (e: any) {
      toast.error(e.message || '審核失敗');
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
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={!canEdit} />
                <span>全選（{pickedIds.length}/{items.length}）</span>
              </label>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => doReview('reject')}
                    disabled={rejecting || approving || pickedIds.length === 0}
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    {rejecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <XCircle className="h-3.5 w-3.5" />退回
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => doReview('approve')}
                    disabled={approving || rejecting || pickedIds.length === 0}
                    className="gap-1.5"
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
                  <label
                    key={i.id}
                    className={`flex gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${picked[i.id] ? 'border-primary/60 bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <Checkbox
                      checked={!!picked[i.id]}
                      onCheckedChange={(v) => setPicked((s) => ({ ...s, [i.id]: !!v }))}
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
                  </label>
                );
              })}
            </div>
          </>
        )}
        {isRefetching && <p className="text-xs text-muted-foreground text-center">更新中…</p>}
      </CardContent>
    </Card>
  );
}
