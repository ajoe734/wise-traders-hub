import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Loader2, Sparkles, ArrowLeft, CheckCircle2, Trash2, MessageCircleQuestion, Lightbulb, RefreshCw, History } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface Props { expertId: string; canEdit: boolean; }

async function call(action: string, expertId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('expert-ai-training', {
    body: { action, expert_id: expertId, ...extra },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'failed');
  return data;
}

interface Question { id: string; question: string; rationale: string }
interface Answer { id: string; answer: string }
interface KnowledgeCand { id: string; title: string; content: string; source: string }
interface JournalEdit { id: string; area: string; suggestion: string }
interface Revision {
  revision: number;
  action: 'regenerate_questions' | 'regenerate_suggestions';
  snapshotted_at: string;
  triggered_by: string | null;
  ai_questions: Question[];
  answers: Answer[];
  suggested_knowledge: KnowledgeCand[];
  suggested_journal_edits: JournalEdit[];
}
interface Session {
  id: string;
  expert_id: string;
  week_start: string;
  status: 'open' | 'reviewing' | 'completed' | 'discarded';
  ai_questions: Question[] | null;
  answers: Answer[] | null;
  suggested_knowledge: KnowledgeCand[] | null;
  suggested_journal_edits: JournalEdit[] | null;
  revisions: Revision[] | null;
}

interface WeekRow {
  week_start: string;
  signal_count: number;
  latest_published_at: string;
  session: { id: string; status: Session['status'] } | null;
}

function statusBadge(status?: string) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: '進行中', cls: 'bg-blue-500/10 text-blue-700' },
    reviewing: { label: '待採納', cls: 'bg-amber-500/10 text-amber-700' },
    completed: { label: '已完成', cls: 'bg-emerald-500/10 text-emerald-700' },
    discarded: { label: '已捨棄', cls: 'bg-muted text-muted-foreground' },
  };
  if (!status) return null;
  const m = map[status];
  if (!m) return null;
  return <Badge className={`text-[10px] ${m.cls} hover:${m.cls}`}>{m.label}</Badge>;
}

export default function WeeklyTrainerTab({ expertId, canEdit }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  if (activeId) {
    return <SessionView expertId={expertId} sessionId={activeId} canEdit={canEdit} onBack={() => setActiveId(null)} />;
  }
  return <WeekList expertId={expertId} canEdit={canEdit} onOpen={(id) => setActiveId(id)} />;
}

function WeekList({ expertId, canEdit, onOpen }: { expertId: string; canEdit: boolean; onOpen: (id: string) => void }) {
  const [starting, setStarting] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['training-weeks', expertId],
    queryFn: () => call('list_weeks', expertId),
  });
  const weeks: WeekRow[] = data?.weeks || [];

  const start = async (weekStart: string) => {
    if (!canEdit) { toast.error('沒有權限'); return; }
    setStarting(weekStart);
    try {
      const res = await call('start_session', expertId, { week_start: weekStart });
      toast.success('已產出補完題');
      refetch();
      onOpen(res.session.id);
    } catch (e: any) {
      toast.error(e.message || '啟動失敗');
    } finally { setStarting(null); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-mentor" />週五訓練對話台</CardTitle>
        <CardDescription>
          每週發完週記後，讓 AI 讀完本週內容→反問你 3–5 個補完題→根據你的回答產出「候選知識條目」與「週記完善建議」，你逐條決定要不要納入。這是最能讓 AI 分身「越用越像你」的迴圈。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground">載入中…</div>
        ) : weeks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">最近 12 週沒有已發佈的週記，無法訓練。</div>
        ) : (
          <div className="divide-y">
            {weeks.map((w) => (
              <div key={w.week_start} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{w.week_start.replace(/-/g, '/')} 起這一週</p>
                    {statusBadge(w.session?.status)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    本週發佈 {w.signal_count} 篇 · 最新 {w.latest_published_at.slice(0, 10).replace(/-/g, '/')}
                  </p>
                </div>
                <div className="shrink-0 flex gap-2">
                  {w.session && w.session.status !== 'discarded' ? (
                    <Button size="sm" variant="outline" onClick={() => onOpen(w.session!.id)}>開啟</Button>
                  ) : (
                    <Button size="sm" onClick={() => start(w.week_start)} disabled={!canEdit || starting === w.week_start} className="gap-1.5">
                      {starting === w.week_start && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      開始訓練
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionView({ expertId, sessionId, canEdit, onBack }: { expertId: string; sessionId: string; canEdit: boolean; onBack: () => void }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['training-session', sessionId],
    queryFn: () => call('get_session', expertId, { id: sessionId }),
  });
  const session: Session | null = data?.session || null;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [regenQ, setRegenQ] = useState(false);
  const [regenS, setRegenS] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (session && Array.isArray(session.answers) && session.answers.length > 0) {
      const map: Record<string, string> = {};
      for (const a of session.answers) map[a.id] = a.answer || '';
      setAnswers((prev) => (Object.keys(prev).length === 0 ? map : prev));
    }
  }, [session]);

  const questions: Question[] = session?.ai_questions || [];
  const suggested: KnowledgeCand[] = session?.suggested_knowledge || [];
  const journalEdits: JournalEdit[] = session?.suggested_journal_edits || [];

  const saveAnswers = async () => {
    setSaving(true);
    try {
      const arr = questions.map((q) => ({ id: q.id, answer: answers[q.id] || '' }));
      await call('save_answers', expertId, { id: sessionId, answers: arr });
      toast.success('已儲存');
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const generate = async () => {
    const unanswered = questions.filter((q) => !(answers[q.id] || '').trim()).length;
    if (unanswered > 0 && !confirm(`還有 ${unanswered} 題沒回答，仍要產出候選條目？`)) return;
    setGenerating(true);
    try {
      const arr = questions.map((q) => ({ id: q.id, answer: answers[q.id] || '' }));
      await call('save_answers', expertId, { id: sessionId, answers: arr });
      await call('generate_suggestions', expertId, { id: sessionId });
      toast.success('AI 已產出候選條目');
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setGenerating(false); }
  };

  const acceptPicked = async () => {
    const items = suggested.filter((k) => picked[k.id]);
    if (items.length === 0) { toast.error('請至少勾選一條'); return; }
    setAccepting(true);
    try {
      const res = await call('accept_knowledge', expertId, { id: sessionId, items });
      toast.success(`已加入 ${res.inserted_count} 條到知識庫`);
      setPicked({});
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setAccepting(false); }
  };

  const regenerateQuestions = async () => {
    if (!confirm('重新產題會清空目前候選條目、保留你的回覆，並把現在的內容存成一個歷史版本，確定嗎？')) return;
    setRegenQ(true);
    try {
      // 先把當前輸入中的答覆存回去，避免快照到舊值
      const arr = questions.map((q) => ({ id: q.id, answer: answers[q.id] || '' }));
      if (questions.length > 0) await call('save_answers', expertId, { id: sessionId, answers: arr });
      const res = await call('regenerate_questions', expertId, { id: sessionId });
      toast.success(`已重新產題（v${res.revision}）`);
      setPicked({});
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setRegenQ(false); }
  };
  const regenerateSuggestions = async () => {
    if (!confirm('重新產出候選條目會覆蓋現在的候選列表，並把現在的內容存成一個歷史版本，確定嗎？')) return;
    setRegenS(true);
    try {
      const arr = questions.map((q) => ({ id: q.id, answer: answers[q.id] || '' }));
      if (questions.length > 0) await call('save_answers', expertId, { id: sessionId, answers: arr });
      const res = await call('regenerate_suggestions', expertId, { id: sessionId });
      toast.success(`已重新產出候選（v${res.revision}）`);
      setPicked({});
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setRegenS(false); }
  };

  const complete = async () => {
    try { await call('complete_session', expertId, { id: sessionId }); toast.success('已標記完成'); refetch(); }
    catch (e: any) { toast.error(e.message); }
  };
  const discard = async () => {
    if (!confirm('確定捨棄這次訓練？')) return;
    try { await call('discard_session', expertId, { id: sessionId }); toast.success('已捨棄'); onBack(); }
    catch (e: any) { toast.error(e.message); }
  };

  if (isLoading || !session) return <div className="p-6 text-center text-muted-foreground">載入中…</div>;
  const revisions: Revision[] = session.revisions || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1"><ArrowLeft className="h-4 w-4" />返回週次列表</Button>
        <div className="flex gap-2 items-center">
          {statusBadge(session.status)}
          {session.status !== 'discarded' && canEdit && (
            <Button variant="ghost" size="sm" onClick={discard} className="text-destructive gap-1"><Trash2 className="h-3.5 w-3.5" />捨棄</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-mentor" />
            AI 對本週週記的補完題（{session.week_start.replace(/-/g, '/')}）
          </CardTitle>
          <CardDescription>逐題用你自己的話回答，AI 會根據你的回覆整理成可讓 AI 分身引用的知識條目。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">此訓練尚未產出補完題。</p>
          ) : questions.map((q, i) => (
            <div key={q.id} className="space-y-2">
              <div>
                <p className="font-medium text-sm">Q{i + 1}. {q.question}</p>
                <p className="text-xs text-muted-foreground mt-0.5">💡 {q.rationale}</p>
              </div>
              <Textarea
                value={answers[q.id] || ''}
                onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
                placeholder="用你自己的話回答…"
                className="min-h-[100px]"
                disabled={!canEdit || session.status === 'completed'}
              />
            </div>
          ))}
          {questions.length > 0 && canEdit && session.status !== 'completed' && (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={saveAnswers} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}僅儲存回覆
              </Button>
              <Button size="sm" onClick={generate} disabled={generating} className="gap-1.5">
                {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <Sparkles className="h-3.5 w-3.5" />
                產出候選條目
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(suggested.length > 0 || journalEdits.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-600" />AI 產出的候選條目</CardTitle>
            <CardDescription>勾選要加入知識庫的條目，其餘會忽略。已加入條目可日後在「知識庫」分頁編輯或刪除。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggested.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">📚 候選知識條目（{suggested.length}）</p>
                {suggested.map((k) => (
                  <div key={k.id} className="flex gap-3 border rounded-lg p-3">
                    <Checkbox
                      checked={!!picked[k.id]}
                      onCheckedChange={(v) => setPicked((s) => ({ ...s, [k.id]: !!v }))}
                      disabled={!canEdit}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{k.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">來源：{k.source}</p>
                      <p className="text-sm whitespace-pre-wrap mt-1.5">{k.content}</p>
                    </div>
                  </div>
                ))}
                {canEdit && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={acceptPicked} disabled={accepting} className="gap-1.5">
                      {accepting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      加入勾選的條目到知識庫
                    </Button>
                  </div>
                )}
              </div>
            )}

            {journalEdits.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">✍️ 週記完善建議（供你參考，是否回頭修週記由你決定）</p>
                  {journalEdits.map((e) => (
                    <div key={e.id} className="border-l-2 border-amber-400 pl-3 py-1 text-sm">
                      <p className="font-medium">{e.area}</p>
                      <p className="text-muted-foreground">{e.suggestion}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {canEdit && session.status !== 'completed' && (
              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={complete} className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />標記本次訓練完成</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
