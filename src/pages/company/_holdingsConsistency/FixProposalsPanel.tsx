import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, ShieldCheck, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  applyFixProposal, generateFixProposals, listFixProposals, rejectFixProposal,
  type FixProposal, type FixProposalStatus,
} from '@/lib/holdingsFixProposals';

const STATUS_TABS: { key: FixProposalStatus; label: string }[] = [
  { key: 'pending', label: '待處理' },
  { key: 'applied', label: '已套用' },
  { key: 'rejected', label: '已忽略' },
  { key: 'failed', label: '失敗' },
  { key: 'superseded', label: '已淘汰' },
];

const ACTION_LABEL: Record<string, string> = {
  normalize_unit: '單位正規化',
  adjust_trade_quantity: '調整帳本數量',
  close_trade_record: '平倉',
  cancel_signal: '刪除 pending 訊號',
  delete_orphan_signal: '刪除孤兒訊號',
  create_trade_record: '建立持倉',
  manual_review: '人工處理',
};

export function FixProposalsPanel() {
  const [status, setStatus] = useState<FixProposalStatus>('pending');
  const [items, setItems] = useState<FixProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<FixProposal | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setItems(await listFixProposals(status)); }
    catch (e: any) { toast.error(`載入失敗：${e.message ?? e}`); setItems([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [status]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const r = await generateFixProposals();
      toast.success(`已生成/更新 ${r.inserted} 筆，共 ${r.total_pending} 筆待處理（淘汰舊 pending ${r.superseded} 筆）`);
      setStatus('pending');
      await load();
    } catch (e: any) {
      toast.error(`產生失敗：${e.message ?? e}`);
    } finally { setGenerating(false); }
  }

  async function handleApply(p: FixProposal) {
    setBusyId(p.id);
    try {
      await applyFixProposal(p.id);
      toast.success('已套用');
      await load();
    } catch (e: any) {
      toast.error(`套用失敗：${e.message ?? e}`);
      await load();
    } finally {
      setBusyId(null);
      setConfirmTarget(null);
      setConfirmed(false);
    }
  }

  async function handleReject(p: FixProposal) {
    setBusyId(p.id);
    try {
      await rejectFixProposal(p.id, '管理員手動忽略');
      toast.success('已忽略');
      await load();
    } catch (e: any) {
      toast.error(`忽略失敗：${e.message ?? e}`);
    } finally { setBusyId(null); }
  }

  const counts: Record<string, number> = {};
  items.forEach(i => { counts[i.status] = (counts[i.status] ?? 0) + 1; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            建議修復
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            所有寫入變更需管理員逐筆確認；套用時會透過 audit_logs 追蹤。
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          {generating ? '產生中…' : '產生／重新產生建議'}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-slate-200">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              status === t.key
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> 載入中…
        </div>
      ) : !items.length ? (
        <div className="py-10 text-center text-slate-400 text-sm">
          {status === 'pending' ? '目前沒有待處理建議 — 可點右上「產生建議」重新掃描' : '此狀態下沒有紀錄'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(p => (
            <ProposalCard
              key={p.id}
              p={p}
              busy={busyId === p.id}
              onApply={() => { setConfirmTarget(p); setConfirmed(false); }}
              onReject={() => handleReject(p)}
            />
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmTarget} onOpenChange={o => { if (!o) { setConfirmTarget(null); setConfirmed(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              確認套用資料修復
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="text-slate-700">{confirmTarget?.summary}</div>
                <div className="rounded border bg-slate-50 p-3 text-xs">
                  <div className="text-slate-500 mb-1">動作：{ACTION_LABEL[confirmTarget?.proposed_action ?? ''] ?? confirmTarget?.proposed_action}</div>
                  <pre className="whitespace-pre-wrap break-all text-slate-700">
                    {JSON.stringify(confirmTarget?.preview ?? {}, null, 2)}
                  </pre>
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(!!v)} />
                  <span className="text-slate-700">我已檢查 preview，確認要寫入資料庫（此動作會建立 audit log）</span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!confirmed || !!busyId}
              onClick={(e) => { e.preventDefault(); if (confirmTarget) void handleApply(confirmTarget); }}
              className="bg-primary text-primary-foreground"
            >
              {busyId ? '套用中…' : '確認套用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProposalCard({
  p, busy, onApply, onReject,
}: { p: FixProposal; busy: boolean; onApply: () => void; onReject: () => void }) {
  const isManual = p.proposed_action === 'manual_review';
  const isPending = p.status === 'pending';
  const severityTone =
    p.severity === 'high' ? 'text-red-700 bg-red-50 border-red-200' :
    p.severity === 'medium' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-slate-600 bg-slate-50 border-slate-200';
  return (
    <div className="border rounded-md bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-slate-700">{p.drift_category}</span>
            <span className={`inline-flex px-2 py-0.5 rounded border ${severityTone}`}>{p.severity}</span>
            <span className="text-slate-400">{ACTION_LABEL[p.proposed_action] ?? p.proposed_action}</span>
            {isManual && <span className="text-amber-600 text-[11px]">（不可自動套用）</span>}
          </div>
          <div className="text-sm text-slate-900">{p.summary}</div>
          <div className="text-xs text-slate-500">
            {p.expert_name} · <span className="font-mono">{p.expert_slug}</span>
            {p.symbol && <> · <span className="font-mono">{p.symbol}</span></>}
          </div>
        </div>
        {isPending && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onReject}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" /> 忽略
            </button>
            {!isManual && (
              <button
                onClick={onApply}
                disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> 套用修復
              </button>
            )}
          </div>
        )}
      </div>
      {p.preview && Object.keys(p.preview).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 select-none">Preview / 明細</summary>
          <pre className="mt-2 bg-slate-50 border rounded p-2 whitespace-pre-wrap break-all text-slate-700">
            {JSON.stringify(p.preview, null, 2)}
          </pre>
        </details>
      )}
      {p.apply_result && (
        <div className="text-xs text-slate-500">
          結果：<span className="font-mono text-slate-700">{JSON.stringify(p.apply_result)}</span>
        </div>
      )}
      {p.review_note && (
        <div className="text-xs text-slate-500">備註：{p.review_note}</div>
      )}
    </div>
  );
}
