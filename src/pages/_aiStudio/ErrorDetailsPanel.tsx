import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Copy, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { EdgeCallError, type EdgeDebugInfo } from '@/lib/aiStudioInvoke';

export interface LastEdgeError {
  title: string;              // 動作標題，例：核可失敗
  message: string;            // 原始 error message
  at: number;                 // Date.now()
  debug: EdgeDebugInfo;
  partial?: {                 // 若是部分失敗（bulk_review / accept_knowledge）
    total?: number;
    ok?: number;
    failed?: Array<{ id?: string; candidate_id?: string; stage?: string; error?: string }>;
  };
}

export function fromEdgeError(title: string, err: unknown, extra: Partial<EdgeDebugInfo> = {}): LastEdgeError {
  if (err instanceof EdgeCallError) {
    return { title, message: err.message, at: Date.now(), debug: { ...err.debug, ...extra } };
  }
  const anyE = err as any;
  return { title, message: anyE?.message || String(err), at: Date.now(), debug: { ...extra } };
}

export function fromPartialFailure(
  title: string,
  res: any,
  partial: LastEdgeError['partial'],
): LastEdgeError {
  const first = partial?.failed?.[0];
  return {
    title,
    message: first?.error || `${partial?.failed?.length ?? 0} 條處理失敗`,
    at: Date.now(),
    debug: {
      requestId: res?._debug?.requestId || res?.requestId,
      correlationId: res?._debug?.correlationId || res?.requestId,
      action: res?._debug?.action,
      stage: first?.stage,
      candidateId: first?.candidate_id || first?.id,
    },
    partial,
  };
}

function shortCode(e: LastEdgeError): string {
  if (e.debug.errorId) return e.debug.errorId;
  if (e.debug.requestId) return `req_${e.debug.requestId.slice(0, 8)}`;
  return `t_${e.at.toString(36)}`;
}

function copy(text: string, label = '已複製') {
  navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error('複製失敗，請手動選取'),
  );
}

interface Props {
  error: LastEdgeError | null;
  onDismiss?: () => void;
}

export default function ErrorDetailsPanel({ error, onDismiss }: Props) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  if (!error) return null;

  const d = error.debug;
  const code = shortCode(error);
  const rows: Array<[string, string | undefined]> = [
    ['action', d.action],
    ['stage', d.stage],
    ['code', d.code],
    ['HTTP', d.status ? String(d.status) : undefined],
    ['requestId', d.requestId],
    ['correlationId', d.correlationId && d.correlationId !== d.requestId ? d.correlationId : undefined],
    ['errorId', d.errorId],
    ['candidate_id', d.candidateId],
  ];
  const visibleRows = rows.filter(([, v]) => v);

  const summary = [
    `[${error.title}] ${error.message}`,
    ...visibleRows.map(([k, v]) => `${k}=${v}`),
    error.partial?.failed?.length ? `failed=${error.partial.failed.length}/${error.partial.total ?? '?'}` : '',
  ].filter(Boolean).join('\n');

  const handleCopy = () => {
    copy(summary, `已複製錯誤詳情（${code}）`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm text-destructive">{error.title}</p>
            <Badge
              variant="outline"
              className="text-[10px] font-mono cursor-pointer hover:bg-destructive/10"
              onClick={() => copy(code, `已複製 ${code}`)}
              title="點擊複製短碼"
            >
              {code}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {new Date(error.at).toLocaleTimeString('zh-TW', { hour12: false })}
            </span>
          </div>
          <p className="text-sm text-foreground/90 break-words">{error.message}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-7 px-2 gap-1 text-xs"
            title="複製全部錯誤詳情"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            複製
          </Button>
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss} className="h-7 w-7 p-0" title="關閉">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? '收合' : '展開'}詳情（{visibleRows.length} 個欄位{error.partial?.failed?.length ? ` · ${error.partial.failed.length} 條失敗` : ''}）
      </button>

      {open && (
        <div className="space-y-2 pl-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {visibleRows.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground shrink-0">{k}</span>
                <code
                  className="font-mono text-[11px] bg-muted/60 px-1.5 py-0.5 rounded truncate cursor-pointer hover:bg-muted"
                  onClick={() => copy(v!, `已複製 ${k}`)}
                  title="點擊複製"
                >
                  {v}
                </code>
              </div>
            ))}
            {visibleRows.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full">（無額外追蹤資訊）</p>
            )}
          </div>

          {error.partial?.failed && error.partial.failed.length > 0 && (
            <div className="border-t border-destructive/20 pt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground">
                失敗明細（{error.partial.failed.length}/{error.partial.total ?? '?'}）：
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {error.partial.failed.slice(0, 10).map((f, i) => (
                  <div key={i} className="text-[11px] flex flex-wrap items-center gap-1.5 font-mono bg-muted/40 px-2 py-1 rounded">
                    {f.stage && <Badge variant="outline" className="text-[10px] h-4 px-1">{f.stage}</Badge>}
                    {(f.candidate_id || f.id) && (
                      <span className="text-muted-foreground">cand {String(f.candidate_id || f.id).slice(0, 8)}</span>
                    )}
                    <span className="text-destructive/90 break-words">{f.error || '(no message)'}</span>
                  </div>
                ))}
                {error.partial.failed.length > 10 && (
                  <p className="text-[11px] text-muted-foreground">…另有 {error.partial.failed.length - 10} 條，請按上方「複製」取得完整清單。</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
