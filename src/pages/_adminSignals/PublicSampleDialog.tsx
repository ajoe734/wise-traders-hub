import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { taipeiMondayOf, taipeiWeekRangeLabelMD } from '@/lib/taipeiWeek';
import {
  useExpertSampleAdmin, useExpertSampleStatus, sampleRpcErrorMessage,
  type SampleSelection, type SamplePreviewRow,
} from '@/hooks/useExpertSampleAdmin';
import { redactSampleM1, SAMPLE_REDACTION_REASON_LABEL } from '@/lib/sampleRedaction';

const FIELDS: Array<{ key: SampleSelection['source_field']; label: string }> = [
  { key: 'overall_summary', label: '當週操作復盤' },
  { key: 'reason_summary', label: '判斷依據' },
  { key: 'reason_detail', label: '判斷依據（細節）' },
  { key: 'risk_notes', label: '風險情境' },
  { key: 'learning_points', label: '學習重點' },
];

interface Row {
  id: string;
  published_at: string | null;
  symbol: string | null;
  values: Record<string, string | null>;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expertId?: string;
  expertName?: string;
}

export function PublicSampleDialog({ open, onOpenChange, expertId, expertName }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [week, setWeek] = useState<string>('');
  const [selected, setSelected] = useState<SampleSelection[]>([]);

  const status = useExpertSampleStatus(expertId, open);
  const { preview, setPreview, busy, runPreview, approve, revoke } = useExpertSampleAdmin(expertId);

  useEffect(() => {
    if (!open || !expertId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('expert_signals')
        .select('id, published_at, symbol, overall_summary, reason_summary, reason_detail, risk_notes, learning_points')
        .eq('expert_id', expertId)
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      setLoading(false);
      if (error) { toast.error(`讀取週記失敗：${error.message}`); return; }
      setRows((data ?? []).map((d) => ({
        id: d.id,
        published_at: d.published_at,
        symbol: (d as { symbol?: string | null }).symbol ?? null,
        values: {
          overall_summary: d.overall_summary, reason_summary: d.reason_summary,
          reason_detail: d.reason_detail, risk_notes: d.risk_notes,
          learning_points: d.learning_points,
        },
      })));
    })();
    return () => { cancelled = true; };
  }, [open, expertId]);

  const weeks = useMemo(() => {
    const todayTpe = taipeiMondayOf(new Date());
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.published_at) continue;
      const w = taipeiMondayOf(r.published_at);
      if (w >= todayTpe) continue; // 只允許已完整結束的週
      const arr = map.get(w) ?? [];
      arr.push(r);
      map.set(w, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  useEffect(() => {
    if (!week && weeks.length) setWeek(weeks[0][0]);
  }, [weeks, week]);

  const weekRows = useMemo(() => weeks.find(([w]) => w === week)?.[1] ?? [], [weeks, week]);

  const toggle = (signal_id: string, source_field: SampleSelection['source_field']) => {
    setPreview(null);
    setSelected((prev) => {
      const hit = prev.some((s) => s.signal_id === signal_id && s.source_field === source_field);
      if (hit) return prev.filter((s) => !(s.signal_id === signal_id && s.source_field === source_field));
      if (prev.length >= 4) { toast.warning('最多選取 4 個段落'); return prev; }
      return [...prev, { signal_id, source_field }];
    });
  };

  const isSelected = (id: string, f: string) =>
    selected.some((s) => s.signal_id === id && s.source_field === f);

  const allPreviewOk = !!preview && preview.length > 0 && preview.every((p) => p.ok);

  const handlePreview = async () => {
    try { await runPreview(week, selected); }
    catch (e) { toast.error(sampleRpcErrorMessage(e)); }
  };

  const handleApprove = async () => {
    try {
      await approve(week, selected);
      toast.success('已核准並公開此範例');
      setSelected([]); setPreview(null);
    } catch (e) { toast.error(sampleRpcErrorMessage(e)); }
  };

  const handleRevoke = async () => {
    try {
      const n = await revoke();
      toast.success(n > 0 ? '已撤回公開範例' : '目前沒有已公開的範例');
    } catch (e) { toast.error(sampleRpcErrorMessage(e)); }
  };

  const s = status.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>公開週記範例{expertName ? `：${expertName}` : ''}</DialogTitle>
          <DialogDescription>
            選 2～4 個段落，系統會在伺服器端取原文、遮罩價格／數量／比例後公開。含個資或未來操作指示者一律不予核准。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border p-3 text-sm">
          {s ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">已公開</Badge>
              <span>{taipeiWeekRangeLabelMD(s.week_start_taipei)}．{s.section_count} 段．{s.mask_level}</span>
              {s.source_drifted && <Badge variant="destructive">來源原文已被改動</Badge>}
              <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={handleRevoke}>
                撤回公開
              </Button>
            </div>
          ) : (
            <span className="text-muted-foreground">目前沒有已公開的範例。</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {weeks.map(([w]) => (
            <Button
              key={w}
              size="sm"
              variant={w === week ? 'default' : 'outline'}
              onClick={() => { setWeek(w); setSelected([]); setPreview(null); }}
            >
              {taipeiWeekRangeLabelMD(w)}
            </Button>
          ))}
          {!loading && weeks.length === 0 && (
            <span className="text-sm text-muted-foreground">沒有可用的已結束週次。</span>
          )}
        </div>

        <div className="space-y-3">
          {weekRows.map((r) => (
            <div key={r.id} className="rounded-md border p-3">
              <div className="text-sm font-medium">{r.symbol || '（無標的）'}</div>
              <div className="mt-2 space-y-2">
                {FIELDS.filter((f) => (r.values[f.key] ?? '').trim() !== '').map((f) => {
                  const local = redactSampleM1(r.values[f.key]);
                  return (
                    <label key={f.key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={isSelected(r.id, f.key)}
                        onCheckedChange={() => toggle(r.id, f.key)}
                      />
                      <span className="flex-1">
                        <span className="font-medium">{f.label}</span>
                        {!local.ok && local.reason && (
                          <Badge variant="outline" className="ml-2">
                            預檢：{SAMPLE_REDACTION_REASON_LABEL[local.reason]}
                          </Badge>
                        )}
                        <span className="mt-0.5 block text-muted-foreground line-clamp-2">
                          {(r.values[f.key] ?? '').slice(0, 160)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {preview && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-sm font-medium">伺服器遮罩結果（權威）</div>
            {preview.map((p: SamplePreviewRow, i) => (
              <div key={`${p.signal_id}-${p.source_field}-${i}`} className="text-sm">
                <div className="font-medium">
                  {p.label}
                  {!p.ok && (
                    <Badge variant="destructive" className="ml-2">
                      {SAMPLE_REDACTION_REASON_LABEL[
                        p.fail_reason as keyof typeof SAMPLE_REDACTION_REASON_LABEL
                      ] ?? p.fail_reason}
                    </Badge>
                  )}
                </div>
                {p.ok && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {p.masked_text}{p.truncated ? '…' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy || selected.length < 2 || !week}
            onClick={handlePreview}
          >
            預覽遮罩結果（{selected.length}/4）
          </Button>
          <Button disabled={busy || !allPreviewOk} onClick={handleApprove}>
            核准公開
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
