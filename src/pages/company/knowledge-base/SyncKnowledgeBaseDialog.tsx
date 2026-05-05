import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ArrowRight } from 'lucide-react';

interface PreviewItem {
  category: string;
  item_id: string;
  title: string;
  changes?: string[];
  version?: string;
  confidence?: number;
  tags?: string[];
}

interface SyncSummary {
  counts: { insert: number; update: number; deactivate_stale: number; unchanged: number };
  preview: { insert: PreviewItem[]; update: PreviewItem[]; deactivate_stale: PreviewItem[] };
}

const CAT_LABEL: Record<string, string> = {
  industry_trends: '產業趨勢',
  chip_analysis: '籌碼分析',
  technical_analysis: '技術分析',
  strategy_cases: '策略案例',
  news_correlation: '新聞事件',
};

export function SyncKnowledgeBaseDialog({ onApplied }: { onApplied?: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

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

  async function apply() {
    setApplying(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('knowledge-sync', {
        body: { dryRun: false, trigger: 'manual_apply', actorId: userData.user?.id },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(`同步部分失敗：${(data?.errors ?? []).slice(0, 2).join('; ')}`);
      } else {
        toast.success(`同步完成：新增 ${data.counts.insert}、更新 ${data.counts.update}、停用過時 ${data.counts.deactivate_stale}`);
      }
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
    if (v) loadPreview();
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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>同步本地知識庫到雲端</DialogTitle>
          <DialogDescription>
            比對本地 JSON（2025-2026 版）與雲端 <code>checkup_knowledge_items</code>，
            預覽差異後再決定是否套用。同步動作會寫入審計紀錄。
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> 比對中…
          </div>
        )}

        {!loading && summary && (
          <div className="space-y-4">
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
              <Section title="更新（含信心度／標籤變更）">
                {summary.preview.update.map((it, i) => (
                  <Row key={`u-${i}`}>
                    <Badge variant="outline" className="bg-blue-50">
                      {CAT_LABEL[it.category] ?? it.category}
                    </Badge>
                    <code className="text-xs text-muted-foreground">{it.item_id}</code>
                    <span className="font-medium">{it.title}</span>
                    <span className="text-xs text-muted-foreground">{it.version}</span>
                    <div className="w-full flex flex-wrap gap-1 mt-1 text-xs">
                      {it.changes?.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                      ))}
                      {typeof it.confidence === 'number' && (
                        <span className="text-muted-foreground ml-2">信心 {(it.confidence * 100).toFixed(0)}%</span>
                      )}
                      {it.tags && it.tags.length > 0 && (
                        <span className="text-muted-foreground">· tags: {it.tags.join(', ')}</span>
                      )}
                    </div>
                  </Row>
                ))}
              </Section>
            )}

            {summary.preview.insert.length > 0 && (
              <Section title="新增條目">
                {summary.preview.insert.map((it, i) => (
                  <Row key={`i-${i}`}>
                    <Badge variant="outline" className="bg-emerald-50">
                      {CAT_LABEL[it.category] ?? it.category}
                    </Badge>
                    <code className="text-xs text-muted-foreground">{it.item_id}</code>
                    <span className="font-medium">{it.title}</span>
                    {typeof it.confidence === 'number' && (
                      <span className="text-xs text-muted-foreground">
                        信心 {(it.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </Row>
                ))}
              </Section>
            )}

            {summary.preview.deactivate_stale.length > 0 && (
              <Section title="停用過時條目（含 2024 標籤、未在新版 JSON 內）">
                {summary.preview.deactivate_stale.map((it, i) => (
                  <Row key={`d-${i}`}>
                    <Badge variant="outline" className="bg-orange-50">
                      {CAT_LABEL[it.category] ?? it.category}
                    </Badge>
                    <code className="text-xs text-muted-foreground">{it.item_id}</code>
                    <span className="font-medium">{it.title}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">將設為 is_active=false</span>
                  </Row>
                ))}
              </Section>
            )}
          </div>
        )}

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
      <div className="border rounded-lg divide-y">{children}</div>
    </div>
  );
}

function Row({ children }: any) {
  return (
    <div className="p-2 text-sm flex items-center gap-2 flex-wrap">{children}</div>
  );
}
