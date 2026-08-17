import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileDown, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useFactsheetSource } from '@/hooks/admin/useFactsheetSource';
import { useProjectionStatus } from '@/hooks/useProjectionStatus';
import { canExportFactsheet } from '@/contracts/publicProjection';
import { PerformanceReviewNotice } from '@/components/expert/PerformanceReviewNotice';
import {
  buildFactsheet, fmtOrNA, RANGE_LABEL, tradeDateBounds, validateCustomRange,
  type FactsheetRange,
} from '@/lib/performance/factsheet';

const money = (n: number) =>
  `${n < 0 ? '−' : ''}NT$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
const dt = (v: string | null) => (v ? v.replace(/-/g, '/') : '—');

/**
 * 「匯出績效 PDF」入口：先顯示資料口徑預覽（含缺漏揭露），管理員確認後才生成。
 * 後端仍以 authorize-pdf-export 做一次授權閘門，前端被竄改也無法產出。
 */
export function FactsheetExportDialog({ expertSlug }: { expertSlug: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<FactsheetRange>('inception');
  const [custom, setCustom] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useFactsheetSource(open ? expertSlug : undefined);

  const bounds = useMemo(
    () => (data ? tradeDateBounds(data.trades) : { min: null, max: null }),
    [data],
  );
  const customError = range === 'custom' ? validateCustomRange(custom, bounds) : null;

  const fs = useMemo(
    () => (data && !customError
      ? buildFactsheet({ expert: data.expert, trades: data.trades, range, custom })
      : null),
    [data, range, custom, customError],
  );


  const handleExport = async () => {
    if (!fs || !exportAllowed) return;
    setBusy(true);
    const toastId = toast.loading('驗證權限並產生 PDF 中…');
    try {
      const { data: authz, error: authzErr } = await supabase.functions.invoke('authorize-pdf-export', { body: {} });
      if (authzErr || !authz?.allowed) throw new Error(authz?.message || authzErr?.message || '後端拒絕匯出授權');
      const { exportFactsheetPdf } = await import('@/lib/performance/factsheetPdf');
      await exportFactsheetPdf({ fs });
      toast.success('已匯出績效 PDF', { id: toastId });
      setOpen(false);
    } catch (e: any) {
      toast.error(`匯出失敗：${e?.message ?? '未知錯誤'}`, { id: toastId, duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  // R1-P: a scope under review may not be exported at all.
  const projection = useProjectionStatus((data as any)?.expert?.id);
  const exportAllowed = canExportFactsheet(projection);

  const m = fs?.metrics;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="factsheet-export-trigger">
          <FileDown className="h-3.5 w-3.5" />
          匯出績效 PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto" data-testid="factsheet-export-dialog">
        <PerformanceReviewNotice status={projection} className="mb-2" />
        <DialogHeader>
          <DialogTitle>資料口徑預覽</DialogTitle>
          <DialogDescription>
            確認以下數字與缺漏揭露後再產生 PDF。內容全部取自平台實際交易紀錄，不含任何模擬或推估值。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">統計期間</span>
            <Select value={range} onValueChange={(v) => setRange(v as FactsheetRange)}>
              <SelectTrigger className="w-40" data-testid="factsheet-range"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABEL) as FactsheetRange[]).map((r) => (
                  <SelectItem key={r} value={r}>{RANGE_LABEL[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {range === 'custom' && (
            <div className="space-y-2" data-testid="factsheet-custom-range">
              <div className="flex items-center gap-2">
                <Input
                  type="date" className="w-40" value={custom.start}
                  min={bounds.min ?? undefined} max={bounds.max ?? undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                  data-testid="factsheet-custom-start"
                />
                <span className="text-muted-foreground">至</span>
                <Input
                  type="date" className="w-40" value={custom.end}
                  min={bounds.min ?? undefined} max={bounds.max ?? undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                  data-testid="factsheet-custom-end"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                資料庫可用日期：{dt(bounds.min)} – {dt(bounds.max)}
              </p>
              {customError && (
                <p className="text-destructive text-xs" data-testid="factsheet-custom-error">{customError}</p>
              )}
            </div>
          )}

          {isLoading && <p className="text-muted-foreground">讀取交易紀錄中…</p>}
          {error && <p className="text-destructive">讀取失敗：{(error as Error).message}</p>}

          {fs && (
            <p className="text-xs text-muted-foreground" data-testid="factsheet-period">
              期間 {fs.rangeLabel}：{dt(fs.periodStart)} – {dt(fs.periodEnd)}
            </p>
          )}


          {fs && m && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2" data-testid="factsheet-preview-metrics">
                {[
                  ['總報酬率', fmtOrNA(m.totalReturnPct, pct)],
                  ['最大回撤', fmtOrNA(m.maxDrawdownPct, (v) => `−${v.toFixed(2)}%`)],
                  ['已實現損益', money(m.realizedAmount)],
                  ['未實現損益', fmtOrNA(m.unrealizedAmount, money)],
                  ['已結案 / 在倉', `${m.closedTrades} 筆 / ${m.openTrades} 檔`],
                  ['勝率', fmtOrNA(m.winRate, (v) => `${v.toFixed(2)}%`)],
                  ['獲利因子', fmtOrNA(m.profitFactor, (v) => v.toFixed(2))],
                  ['初始資金', fmtOrNA(m.startingCapital, money)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-border/60 pb-1">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className="font-semibold mb-1">未涵蓋項目（會印在 PDF 上）</p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-xs">
                  {fs.missing.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleExport} disabled={!fs || busy || !exportAllowed} data-testid="factsheet-export-confirm">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            產生 PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
