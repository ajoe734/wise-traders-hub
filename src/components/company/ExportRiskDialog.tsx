import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPORT_RISK_LABEL,
  type ExportRiskIssue,
  type ExportRiskReport,
} from '@/lib/journalsExport';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ExportRiskReport | null;
  onForceExport: () => void;
  onCancel?: () => void;
}

/**
 * 匯出前風險守門對話框：
 *  - 顯示 detectExportRisks 的結果
 *  - 若含 block，需勾選確認 checkbox 才能點「強制匯出」
 *  - 若僅有 warn，仍顯示「已知風險提醒」按鈕（呼叫端可決定是否直接匯出）
 */
export function ExportRiskDialog({ open, onOpenChange, report, onForceExport, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const grouped = useMemo(() => {
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
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="export-risk-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={blocked ? 'h-5 w-5 text-destructive' : 'h-5 w-5 text-amber-500'} />
            {blocked ? '偵測到高風險資料，已阻擋匯出' : '匯出前提醒'}
          </DialogTitle>
          <DialogDescription>
            共 <strong data-testid="risk-summary-block">{summary.block}</strong> 項嚴重、
            <strong data-testid="risk-summary-warn">{summary.warn}</strong> 項提醒。
            {!report.openingBalancesProvided && (
              <span className="block text-xs text-muted-foreground mt-1">
                （前端檢查未帶入歷史庫存，若需完整賣超判定請透過 Edge Function 匯出）
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" data-testid="risk-issue-list">
          {Array.from(grouped.entries()).map(([key, issues]) => {
            const first = issues[0];
            return (
              <div key={key} className="border rounded-md p-3 space-y-2" data-testid={`risk-group-${first.expert_id}`}>
                <div className="text-sm font-semibold">
                  {first.expert_name ?? '(未命名老師)'} · <span className="text-xs text-muted-foreground font-mono">{first.expert_id}</span>
                </div>
                <ul className="space-y-1.5">
                  {issues.map((i, idx) => (
                    <li key={idx} className="text-sm flex flex-wrap items-start gap-2" data-testid={`risk-issue-${i.code}`}>
                      <Badge variant={i.severity === 'block' ? 'destructive' : 'secondary'}>
                        {EXPORT_RISK_LABEL[i.code]}
                      </Badge>
                      {i.instrument && <span className="font-mono text-xs">{i.instrument}</span>}
                      <span className="flex-1 min-w-[200px]">{i.detail}</span>
                      {i.rowIds.length > 0 && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {i.rowIds.slice(0, 3).join(', ')}{i.rowIds.length > 3 ? '…' : ''}
                        </span>
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
          <Button variant="outline" size="sm" onClick={copyList} data-testid="risk-copy-btn">
            <Copy className="h-3.5 w-3.5 mr-1" /> 複製清單
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel} data-testid="risk-cancel-btn">
            取消
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
