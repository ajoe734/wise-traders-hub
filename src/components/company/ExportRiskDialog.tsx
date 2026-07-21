import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Copy, Download, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPORT_RISK_LABEL,
  type ExportRiskCode,
  type ExportRiskIssue,
  type ExportRiskReport,
} from '@/lib/journalsExport';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ExportRiskReport | null;
  onForceExport: () => void;
  onCancel?: () => void;
  /** 週別標籤 (YYYY-MM-DD)，用於下載檔名 */
  weekLabel?: string;
}

/** 每個風險代碼的處理建議（給管理員做修正依據） */
const FIX_HINTS: Record<ExportRiskCode, string> = {
  UNIT_MIX:
    '同一標的的張／股數量必須統一。請進入該老師的訊號後台，將所有相關訊號改成同一單位（建議台股一律用「張」）。',
  UNIT_MISSING:
    '訊號缺少單位標註。請於訊號後台補齊 quantity_unit 欄位，避免匯出時預設為「股」造成誤解。',
  DIRECTION_NO_ENTRY:
    '本週只有出場動作但查無期初持倉。請確認是否遺漏歷史買進訊號未補建；或該筆賣出應改為 hold/教學筆記。',
  DIRECTION_OVERSELL:
    '賣出量超過買進 + 期初持倉。請於訊號後台檢查數量與方向，修正後再匯出。',
  QTY_INVALID:
    '交易訊號的數量為 0 或非有效數字。請補上正確數量或改為非交易動作 (hold)。',
  PENDING_IN_EXPORT:
    '在「僅發布」模式下仍出現非 published 訊號。請將該訊號改為 published，或關閉「僅發布」再匯出。',
};

export function ExportRiskDialog({
  open, onOpenChange, report, onForceExport, onCancel, weekLabel,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  const groupedByMentor = useMemo(() => {
    if (!report) return new Map<string, ExportRiskIssue[]>();
    const m = new Map<string, ExportRiskIssue[]>();
    for (const i of report.issues) {
      const key = `${i.expert_id}::${i.expert_name ?? ''}`;
      const arr = m.get(key) ?? [];
      arr.push(i);
      m.set(key, arr);
    }
    return m;
  }, [report]);

  const codeAggregation = useMemo(() => {
    if (!report) return [] as { code: ExportRiskCode; count: number; block: number; warn: number }[];
    const agg = new Map<ExportRiskCode, { count: number; block: number; warn: number }>();
    for (const i of report.issues) {
      const cur = agg.get(i.code) ?? { count: 0, block: 0, warn: 0 };
      cur.count += 1;
      if (i.severity === 'block') cur.block += 1; else cur.warn += 1;
      agg.set(i.code, cur);
    }
    return Array.from(agg.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.block - a.block || b.count - a.count);
  }, [report]);

  if (!report) return null;

  const blocked = report.blocked;
  const summary = report.summary;

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast.success('已複製風險清單 JSON 到剪貼簿');
    } catch (e: any) {
      toast.error(`複製失敗：${e?.message ?? '未知錯誤'}`);
    }
  };

  const downloadReport = () => {
    const payload = {
      generated_at: new Date().toISOString(),
      week: weekLabel ?? null,
      summary,
      blocked,
      opening_balances_provided: report.openingBalancesProvided,
      code_aggregation: codeAggregation,
      issues: report.issues,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-export-risk-report-${weekLabel ?? new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleForce = () => {
    if (blocked && !acknowledged) return;
    setAcknowledged(false);
    onForceExport();
  };

  const handleCancel = () => {
    setAcknowledged(false);
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setAcknowledged(false); onOpenChange(v); }}>
      <DialogContent
        className="max-w-3xl max-h-[88vh] overflow-y-auto"
        data-testid="export-risk-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {blocked
              ? <ShieldAlert className="h-5 w-5 text-destructive" />
              : <AlertTriangle className="h-5 w-5 text-amber-500" />}
            {blocked ? '偵測到高風險資料，已阻擋匯出' : '匯出前提醒'}
          </DialogTitle>
          <DialogDescription>
            共 <strong data-testid="risk-summary-block">{summary.block}</strong> 項嚴重 (block)、
            <strong data-testid="risk-summary-warn">{summary.warn}</strong> 項提醒 (warn)。
            {!report.openingBalancesProvided && (
              <span className="block text-xs text-muted-foreground mt-1">
                （前端檢查未帶入歷史庫存，若需完整賣超判定請透過 Edge Function 匯出）
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* 依代碼彙總 + 修正建議 */}
        {codeAggregation.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2" data-testid="risk-code-aggregation">
            <div className="text-xs font-semibold text-muted-foreground">依風險類別彙總</div>
            <div className="space-y-2">
              {codeAggregation.map(({ code, count, block, warn }) => (
                <div key={code} className="text-sm space-y-1" data-testid={`risk-code-row-${code}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={block > 0 ? 'destructive' : 'secondary'}>
                      {EXPORT_RISK_LABEL[code]}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">{code}</span>
                    <span className="text-xs text-muted-foreground">
                      共 {count} 筆
                      {block > 0 && <> · <span className="text-destructive font-medium">阻擋 {block}</span></>}
                      {warn > 0 && <> · <span className="text-amber-600 font-medium">提醒 {warn}</span></>}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground pl-1 leading-relaxed">
                    → {FIX_HINTS[code]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 依老師分組的明細 */}
        <div className="space-y-3" data-testid="risk-issue-list">
          <div className="text-xs font-semibold text-muted-foreground">明細（依老師分組）</div>
          {Array.from(groupedByMentor.entries()).map(([key, issues]) => {
            const first = issues[0];
            return (
              <div key={key} className="border rounded-md p-3 space-y-2" data-testid={`risk-group-${first.expert_id}`}>
                <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                  <span>{first.expert_name ?? '(未命名老師)'}</span>
                  <span className="text-xs text-muted-foreground font-mono">{first.expert_id}</span>
                  <Badge variant="outline" className="text-[10px]">{issues.length} 項</Badge>
                </div>
                <ul className="space-y-2">
                  {issues.map((i, idx) => (
                    <li key={idx} className="text-sm space-y-1" data-testid={`risk-issue-${i.code}`}>
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge variant={i.severity === 'block' ? 'destructive' : 'secondary'}>
                          {EXPORT_RISK_LABEL[i.code]}
                        </Badge>
                        {i.instrument && <span className="font-mono text-xs">{i.instrument}</span>}
                        <span className="flex-1 min-w-[200px]">{i.detail}</span>
                      </div>
                      {i.rowIds.length > 0 && (
                        <details className="text-[11px] text-muted-foreground pl-1">
                          <summary className="cursor-pointer select-none">
                            影響訊號 ID（{i.rowIds.length} 筆）
                          </summary>
                          <div className="font-mono break-all mt-1 leading-relaxed">
                            {i.rowIds.join(', ')}
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {blocked && (
          <label className="flex items-start gap-2 pt-2 text-sm cursor-pointer">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              data-testid="risk-acknowledge-checkbox"
            />
            <span>我已確認上述風險，仍要強制匯出（此操作將寫入稽核紀錄）</span>
          </label>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={downloadReport} data-testid="risk-download-btn">
            <Download className="h-3.5 w-3.5 mr-1" /> 下載完整報告
          </Button>
          <Button variant="outline" size="sm" onClick={copyList} data-testid="risk-copy-btn">
            <Copy className="h-3.5 w-3.5 mr-1" /> 複製 JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel} data-testid="risk-cancel-btn">
            {blocked ? '返回修正' : '取消'}
          </Button>
          <Button
            variant={blocked ? 'destructive' : 'default'}
            size="sm"
            onClick={handleForce}
            disabled={blocked && !acknowledged}
            data-testid="risk-force-export-btn"
          >
            {blocked ? '強制匯出' : '仍要匯出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
