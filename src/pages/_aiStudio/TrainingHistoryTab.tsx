import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Clock, CheckCircle2, XCircle, FileText, Sparkles, Lightbulb, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface Props { expertId: string; }

async function call(action: string, expertId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('expert-ai-training', {
    body: { action, expert_id: expertId, ...extra },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'failed');
  return data;
}

interface SessionRow {
  id: string;
  week_start: string;
  status: 'open' | 'reviewing' | 'completed' | 'discarded';
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  question_count: number;
  answered_count: number;
  suggested_count: number;
  accepted_count: number;
  rejected_count: number;
  accepted_pending_count: number;
}

interface Question { id: string; question: string; rationale: string }
interface Answer { id: string; answer: string }
interface KnowledgeCand { id: string; title: string; content: string; source: string }
interface JournalEdit { id: string; area: string; suggestion: string }
interface SessionDetail {
  id: string;
  week_start: string;
  status: SessionRow['status'];
  ai_questions: Question[] | null;
  answers: Answer[] | null;
  suggested_knowledge: KnowledgeCand[] | null;
  suggested_journal_edits: JournalEdit[] | null;
  started_at: string | null;
  completed_at: string | null;
}
interface SignalRow {
  id: string; instrument: string; action: string; published_at: string;
  reason_summary: string | null; reason_detail: string | null;
  risk_notes: string | null; learning_points: string | null; overall_summary: string | null;
}
interface AcceptedChunk {
  id: string; title: string | null; content: string;
  status: 'pending' | 'approved' | 'rejected';
  source_type: string; created_at: string; reviewed_at: string | null;
  metadata: Record<string, unknown> | null;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  open: { label: '進行中', cls: 'bg-blue-500/10 text-blue-700' },
  reviewing: { label: '待採納', cls: 'bg-amber-500/10 text-amber-700' },
  completed: { label: '已完成', cls: 'bg-emerald-500/10 text-emerald-700' },
  discarded: { label: '已捨棄', cls: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status?: string }) {
  const m = status ? statusMap[status] : null;
  if (!m) return null;
  return <Badge className={`text-[10px] ${m.cls} hover:${m.cls}`}>{m.label}</Badge>;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

export default function TrainingHistoryTab({ expertId }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (activeId) return <DetailView expertId={expertId} sessionId={activeId} onBack={() => setActiveId(null)} />;
  return <ListView expertId={expertId} onOpen={setActiveId} />;
}

function ListView({ expertId, onOpen }: { expertId: string; onOpen: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['training-sessions', expertId],
    queryFn: () => call('list_sessions', expertId),
  });
  const rows: SessionRow[] = data?.sessions || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />訓練歷史</CardTitle>
        <CardDescription>
          每一次訓練 session 都會保留輸入的週記、AI 產出的題目與候選條目、你的回覆、以及你核准了哪些條目。方便日後回顧「AI 分身是怎麼被你養成現在這樣的」。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground">載入中…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">尚無訓練紀錄。到「週五訓練」開始第一次訓練。</div>
        ) : (
          <div className="divide-y">
            {rows.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="w-full text-left py-3 hover:bg-muted/40 rounded px-2 -mx-2 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{s.week_start.replace(/-/g, '/')} 起這一週</p>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      啟動 {fmtDate(s.started_at)}
                      {s.completed_at && ` · 完成 ${fmtDate(s.completed_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1 text-xs shrink-0 flex-wrap">
                    <span>題目 <b>{s.answered_count}/{s.question_count}</b></span>
                    <span>候選 <b>{s.suggested_count}</b></span>
                    <span className="text-emerald-700">已納入 <b>{s.accepted_count}</b></span>
                    {s.accepted_pending_count > 0 && <span className="text-amber-700">待審 <b>{s.accepted_pending_count}</b></span>}
                    {s.rejected_count > 0 && <span className="text-destructive">退回 <b>{s.rejected_count}</b></span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailView({ expertId, sessionId, onBack }: { expertId: string; sessionId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['training-session-detail', sessionId],
    queryFn: () => call('get_session_detail', expertId, { id: sessionId }),
  });

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">載入中…</div>;
  if (!data?.session) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1"><ArrowLeft className="h-4 w-4" />返回列表</Button>
        <div className="p-8 text-center text-sm text-muted-foreground">Session 不存在或已被刪除。</div>
      </div>
    );
  }

  const session: SessionDetail = data.session;
  const signals: SignalRow[] = data.signals || [];
  const accepted: AcceptedChunk[] = data.accepted_chunks || [];
  const questions = session.ai_questions || [];
  const answers = session.answers || [];
  const suggested = session.suggested_knowledge || [];
  const journalEdits = session.suggested_journal_edits || [];

  const answerFor = (qid: string) => answers.find((a) => a?.id === qid)?.answer || '';

  // 建 candidate_id→chunk 對照（優先），fallback to title
  const chunkByCandidate = new Map<string, AcceptedChunk>();
  const chunkByTitle = new Map<string, AcceptedChunk>();
  for (const c of accepted) {
    const cid = (c.metadata as any)?.candidate_id;
    if (cid) chunkByCandidate.set(String(cid), c);
    if (c.title) chunkByTitle.set(c.title, c);
  }
  const remainingAccepted = accepted.filter((c) => {
    const cid = (c.metadata as any)?.candidate_id;
    if (cid && suggested.some((s) => s.id === cid)) return false;
    if (c.title && suggested.some((s) => s.title === c.title)) return false;
    return true;
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('已複製'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1"><ArrowLeft className="h-4 w-4" />返回列表</Button>
        <div className="flex items-center gap-2"><StatusBadge status={session.status} /></div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{session.week_start.replace(/-/g, '/')} 起這一週</CardTitle>
          <CardDescription>
            啟動：{fmtDate(session.started_at)} · 完成：{fmtDate(session.completed_at)}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>輸入週記 <b className="text-foreground">{signals.length}</b> 篇</div>
          <div>AI 題目 <b className="text-foreground">{questions.length}</b> 題</div>
          <div>候選條目 <b className="text-foreground">{suggested.length}</b> 條</div>
          <div className="text-emerald-700">實際納入 <b>{accepted.filter((c) => c.status !== 'rejected').length}</b> 條</div>
        </CardContent>
      </Card>

      {/* 輸入：週記 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />1. 輸入 — 本週已發佈週記</CardTitle>
          <CardDescription>訓練當下實際餵給 AI 的週記內容。</CardDescription>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <p className="text-sm text-muted-foreground">此週已無對應的已發佈週記（可能已下架）。</p>
          ) : (
            <div className="space-y-3">
              {signals.map((s) => (
                <div key={s.id} className="border rounded-lg p-3 text-sm space-y-1">
                  <p className="font-medium">
                    【{s.published_at.slice(0, 10).replace(/-/g, '/')}】{s.instrument} {s.action}
                  </p>
                  {s.reason_summary && <p className="text-muted-foreground"><span className="text-xs mr-1">摘要</span>{s.reason_summary}</p>}
                  {s.reason_detail && <p className="text-muted-foreground whitespace-pre-wrap"><span className="text-xs mr-1">細節</span>{s.reason_detail}</p>}
                  {s.risk_notes && <p className="text-muted-foreground"><span className="text-xs mr-1">風險</span>{s.risk_notes}</p>}
                  {s.learning_points && <p className="text-muted-foreground"><span className="text-xs mr-1">教學</span>{s.learning_points}</p>}
                  {s.overall_summary && <p className="text-muted-foreground"><span className="text-xs mr-1">整體</span>{s.overall_summary}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI 題目 + 我的回覆 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-mentor" />2. AI 補完題與我的回覆</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">此 session 未產出題目。</p>
          ) : questions.map((q, i) => {
            const ans = answerFor(q.id);
            return (
              <div key={q.id} className="border rounded-lg p-3 space-y-1.5">
                <p className="text-sm font-medium">Q{i + 1}. {q.question}</p>
                <p className="text-xs text-muted-foreground">💡 {q.rationale}</p>
                <Separator className="my-2" />
                {ans ? (
                  <p className="text-sm whitespace-pre-wrap">{ans}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">（未回答）</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* AI 候選條目 + 每條的最終處置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="h-4 w-4" />3. AI 產出的候選知識條目</CardTitle>
          <CardDescription>右上角標籤表示這條後來被你怎麼處置。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggested.length === 0 ? (
            <p className="text-sm text-muted-foreground">此 session 未產出候選條目。</p>
          ) : suggested.map((k) => {
            const linked = chunkByCandidate.get(k.id) ?? (k.title ? chunkByTitle.get(k.title) : undefined);
            const disposition = linked
              ? linked.status === 'approved' ? { label: '已納入', cls: 'text-emerald-700 border-emerald-400', icon: <CheckCircle2 className="h-3 w-3 mr-0.5" /> }
              : linked.status === 'rejected' ? { label: '已退回', cls: 'text-destructive border-destructive/60', icon: <XCircle className="h-3 w-3 mr-0.5" /> }
              : { label: '待審核', cls: 'text-amber-700 border-amber-400', icon: <Clock className="h-3 w-3 mr-0.5" /> }
              : { label: '未納入', cls: 'text-muted-foreground', icon: null };
            return (
              <div key={k.id} className="border rounded-lg p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm">{k.title}</p>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${disposition.cls}`}>
                    {disposition.icon}{disposition.label}
                  </Badge>
                </div>
                {k.source && <p className="text-xs text-muted-foreground">來源：{k.source}</p>}
                <p className="text-sm whitespace-pre-wrap">{k.content}</p>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy(k.content)}>複製</Button>
                </div>
              </div>
            );
          })}

          {remainingAccepted.length > 0 && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">另外由此 session 加入的其他條目（不在候選名單中，可能是手動編輯後新增）：</p>
              {remainingAccepted.map((c) => (
                <div key={c.id} className="border rounded-lg p-3 space-y-1 bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    {c.title && <p className="font-medium text-sm">{c.title}</p>}
                    <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* 週記完善建議 */}
      {journalEdits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-600" />4. 週記完善建議</CardTitle>
            <CardDescription>當時 AI 建議可以回頭補在週記裡的段落。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {journalEdits.map((e) => (
              <div key={e.id} className="border-l-2 border-amber-400 pl-3 py-1 text-sm">
                <p className="font-medium">{e.area}</p>
                <p className="text-muted-foreground">{e.suggestion}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
