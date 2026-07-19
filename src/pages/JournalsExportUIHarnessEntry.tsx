// @ts-nocheck
/**
 * Preview-only E2E harness for weekly journal export **UI feedback**:
 *   - Empty rows → toast warning + status
 *   - Confirm dialog cancel → dialog closed，狀態不受影響，後續匯出仍正確
 *   - Force failure → 錯誤橫幅（含 detail + retry），點重試後成功下載
 *   - 所有情境跑完後再次觸發正常匯出，週別行必須固定 index 2、不被污染
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCw, X } from 'lucide-react';
import {
  buildJournalExport,
  downloadBlob,
  type JournalRowExport,
} from '@/lib/journalsExport';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch { return false; }
}

const RANGE = { startLabel: '2026-07-13', endLabel: '2026-07-19' };

const MENTOR_A: JournalRowExport[] = [
  {
    id: 'ui-a-1', status: 'published', instrument: '2330 台積電', action: 'buy',
    price_hint: 1050, quantity: 2, quantity_unit: '張',
    reason_summary: 'UI-A-summary', reason_detail: null, risk_notes: null,
    learning_points: 'UI-A-token',
    published_at: '2026-07-14T01:00:00Z', created_at: '2026-07-14T00:30:00Z',
    expert_id: 'ui-expert-a',
    experts: { name: 'UI老周', slug: 'ui-master-zhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  },
];
const MENTOR_B: JournalRowExport[] = [
  {
    id: 'ui-b-1', status: 'published', instrument: 'AAPL', action: 'buy',
    price_hint: 220, quantity: 50, quantity_unit: '股',
    reason_summary: 'UI-B-summary', reason_detail: null, risk_notes: null,
    learning_points: 'UI-B-token',
    published_at: '2026-07-16T13:30:00Z', created_at: '2026-07-16T13:00:00Z',
    expert_id: 'ui-expert-b',
    experts: { name: 'UI-Wendy', slug: 'ui-wendy', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
  },
];

interface Failure {
  message: string;
  detail?: string;
  source: 'edge' | 'network' | 'payload' | 'server' | 'unknown';
  at: number;
}

export default function JournalsExportUIHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const [status, setStatus] = useState<string>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [building, setBuilding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string>('none'); // none|cancelled|downloaded
  const [failNextN, setFailNextN] = useState<number>(0); // 剩餘要注入失敗的次數
  const [downloadHistory, setDownloadHistory] = useState<string[]>([]);
  const [lastFilename, setLastFilename] = useState<string>('');

  const doExport = async (rows: JournalRowExport[], label: string) => {
    if (rows.length === 0) {
      toast.warning('目前條件下沒有可匯出的週記（請至少勾選一位老師）');
      setStatus(`empty:${label}`);
      return;
    }
    setBuilding(true);
    setFailure(null);
    try {
      if (failNextN > 0) {
        setFailNextN((n) => n - 1);
        throw new Error(`Injected failure #${failNextN}`);
      }
      const res = await buildJournalExport(rows, RANGE, true);
      if (!res) {
        const info: Failure = {
          message: '匯出建構回傳空值',
          detail: 'buildJournalExport 回傳 null',
          source: 'payload',
          at: Date.now(),
        };
        setFailure(info);
        toast.error(info.message, { description: info.detail });
        setStatus(`empty-build:${label}`);
        return;
      }
      downloadBlob(res.filename, res.blob);
      setLastFilename(res.filename);
      setDownloadHistory((h) => [...h, res.filename]);
      toast.success(`已匯出 ${res.totalRows} 則週記（${res.mentorCount} 位）`);
      setStatus(`success:${label}:${res.filename}`);
    } catch (e: any) {
      const info: Failure = {
        message: 'Markdown 匯出過程失敗',
        detail: e?.message ?? String(e ?? '未知錯誤'),
        source: 'unknown',
        at: Date.now(),
      };
      setFailure(info);
      toast.error(info.message, { description: info.detail });
      setStatus(`fail:${label}:${info.detail}`);
    } finally {
      setBuilding(false);
    }
  };

  const retryLast = () => void doExport([...MENTOR_A, ...MENTOR_B], 'retry');

  return (
    <div id="je-ui-harness-root" style={{ padding: 24, background: '#fff', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Journals Export UI Feedback Harness</h1>
      <div data-testid="je-ui-status" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>{status}</div>
      <div data-testid="je-ui-fail-next" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>failNextN={failNextN}</div>
      <div data-testid="je-ui-confirm-result" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>confirm={confirmResult}</div>
      <div data-testid="je-ui-last-filename" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>last={lastFilename}</div>
      <div data-testid="je-ui-download-history" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>
        history={JSON.stringify(downloadHistory)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Button data-testid="je-ui-export-empty" onClick={() => void doExport([], 'empty')}>
          Export empty (no rows)
        </Button>
        <Button data-testid="je-ui-export-ok" onClick={() => void doExport([...MENTOR_A, ...MENTOR_B], 'ok')}>
          Export A+B (ok)
        </Button>
        <Button data-testid="je-ui-arm-fail-1" onClick={() => setFailNextN(1)}>
          Arm fail x1
        </Button>
        <Button data-testid="je-ui-arm-fail-2" onClick={() => setFailNextN(2)}>
          Arm fail x2
        </Button>
        <Button data-testid="je-ui-export-flaky" onClick={() => void doExport([...MENTOR_A, ...MENTOR_B], 'flaky')}>
          Export A+B (respects failNextN)
        </Button>
        <Button data-testid="je-ui-open-confirm" onClick={() => { setConfirmOpen(true); setConfirmResult('opened'); }}>
          Open confirm dialog
        </Button>
      </div>

      {failure && (
        <div
          role="alert"
          data-testid="je-md-error"
          data-error-source={failure.source}
          style={{ border: '1px solid #f43f5e', background: '#fef2f2', padding: 12, marginBottom: 12, borderRadius: 6 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ color: '#b91c1c', fontWeight: 600 }}>
                <AlertTriangle style={{ display: 'inline', width: 14, height: 14 }} />{' '}
                匯出失敗：{failure.message}
                <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
                  來源：{failure.source}
                </span>
              </div>
              {failure.detail && (
                <div data-testid="je-md-error-detail" style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  {failure.detail}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                size="sm"
                variant="outline"
                data-testid="je-md-retry"
                disabled={building}
                onClick={retryLast}
              >
                <RotateCw style={{ width: 12, height: 12 }} /> 重試
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="關閉錯誤提示"
                data-testid="je-md-error-dismiss"
                onClick={() => setFailure(null)}
              >
                <X style={{ width: 12, height: 12 }} />
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open && confirmResult === 'opened') setConfirmResult('cancelled');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認匯出週記 Markdown？</AlertDialogTitle>
            <AlertDialogDescription>
              <span data-testid="je-ui-confirm-week">週別：{RANGE.startLabel} ~ {RANGE.endLabel}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="je-ui-confirm-cancel"
              onClick={() => setConfirmResult('cancelled')}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="je-ui-confirm-download"
              onClick={() => {
                setConfirmResult('downloaded');
                void doExport([...MENTOR_A, ...MENTOR_B], 'confirm');
              }}
            >
              確認下載
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
