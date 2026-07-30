import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { JournalFetchDiagnostics } from '@/lib/journalRepository';

/**
 * 預覽診斷面板：只給導師本人／管理員／?preview=1 看，
 * 用來判斷資料是走 RLS 直讀還是 owner fallback RPC。
 */
export const PreviewDiagnosticsBlock = ({
  diagnostics,
  currentUserId,
  effectiveUserId,
  currentExpertSlug,
  ownerSlug,
  previewSlugFromSession,
  isPreviewSession,
  previewFlagFromUrl,
  topLevelError,
}: {
  diagnostics: JournalFetchDiagnostics | null;
  currentUserId: string | null | undefined;
  effectiveUserId: string | null | undefined;
  currentExpertSlug: string | null | undefined;
  ownerSlug: string | null | undefined;
  previewSlugFromSession: string | null | undefined;
  isPreviewSession: boolean;
  previewFlagFromUrl: boolean;
  topLevelError: string | null;
}) => {
  const [expanded, setExpanded] = useState(true);
  if (!diagnostics) return null;
  const sourceLabel =
    diagnostics.source === 'rls' ? 'RLS 直接讀取' :
    diagnostics.source === 'owner_rpc' ? 'Owner Fallback RPC' :
    '未取得資料';
  const sourceColor =
    diagnostics.source === 'rls' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    diagnostics.source === 'owner_rpc' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-red-700 bg-red-50 border-red-200';
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className="w-32 shrink-0 text-muted-foreground">{k}</span>
      <span className="flex-1 font-mono break-all">{v ?? <em className="text-muted-foreground">null</em>}</span>
    </div>
  );
  return (
    <div className="max-w-3xl mx-auto mt-4 px-4" data-testid="journal-preview-diagnostics">
      <div className="rounded border border-dashed border-warning/40 bg-warning/5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
        >
          <span className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${sourceColor}`}>
              {sourceLabel}
            </span>
            <span>預覽診斷</span>
          </span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {expanded && (
          <div className="px-3 pb-3 space-y-1 border-t border-warning/20 pt-2">
            <Row k="Signal ID" v={diagnostics.signalId} />
            <Row k="Owner Expert ID" v={diagnostics.ownerExpertId} />
            <Row k="Owner Slug" v={ownerSlug} />
            <Row k="Current User ID" v={currentUserId} />
            <Row k="Effective User ID" v={effectiveUserId} />
            <Row k="Current Expert Slug" v={currentExpertSlug} />
            <Row k="Force Owner" v={String(diagnostics.forceOwner)} />
            <Row k="Preview Session" v={String(isPreviewSession)} />
            <Row k="Preview URL Flag" v={String(previewFlagFromUrl)} />
            <Row k="Preview Slug (session)" v={previewSlugFromSession} />
            <Row k="RLS 命中" v={String(diagnostics.rlsHitRow)} />
            <Row k="RLS 錯誤" v={diagnostics.rlsError} />
            <Row k="Owner RPC 觸發" v={String(diagnostics.ownerRpcAttempted)} />
            <Row k="Owner RPC 錯誤" v={diagnostics.ownerRpcError} />
            <Row k="Top-level Error" v={topLevelError} />
            <Row k="抓取時間" v={diagnostics.fetchedAt} />
          </div>
        )}
      </div>
    </div>
  );
};
