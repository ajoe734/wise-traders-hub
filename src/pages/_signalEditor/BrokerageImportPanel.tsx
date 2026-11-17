import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { AssetClass } from '@/lib/asset';
import { buildImportCandidates, isImportable, mergeImport, type ConfirmedSnapshotRow, type ImportCandidate } from '@/lib/plaid/journalImport';
import type { OpenPosition, TradeDraft } from './types';

const STATUS_TEXT: Record<ImportCandidate['status'], string> = {
  new: '帳本尚無此持倉', diff: '數量與帳本不同', match: '與帳本一致', ledger_only: '帳本有、券商沒有（請自行判斷是否已出場）',
  in_editor: '已在本次週記中', unsupported: '無法帶入',
};
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

interface Props {
  expertId?: string;
  expertSlug?: string;
  assetClass: AssetClass;
  openPositions: OpenPosition[];
  trades: TradeDraft[];
  setTrades: (next: TradeDraft[]) => void;
}

/** Brings teacher-confirmed Firstrade snapshots into the editor as pre-filled rows (no action / price). */
export function BrokerageImportPanel({ expertId, expertSlug, assetClass, openPositions, trades, setTrades }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['brokerage-confirmed', expertId], enabled: !!expertId,
    queryFn: async () => {
      const { data: conn } = await (supabase as any).from('plaid_connections')
        .select('id, last_sync_at').eq('expert_id', expertId).eq('status', 'active').eq('sync_blocked', false).maybeSingle();
      if (!conn) return { conn: null, rows: [] as ConfirmedSnapshotRow[] };
      const { data: rows } = await (supabase as any).from('plaid_holding_drafts')
        .select('connection_id, symbol, name, security_type, quantity, as_of, review_status')
        .eq('connection_id', conn.id).eq('review_status', 'confirmed');
      return { conn, rows: (rows || []) as ConfirmedSnapshotRow[] };
    },
  });
  const candidates = useMemo(
    () => buildImportCandidates(data?.rows || [], openPositions, trades, assetClass),
    [data, openPositions, trades, assetClass],
  );
  if (!data?.conn) return null;
  const importable = candidates.filter(isImportable);

  return (
    <Card data-testid="brokerage-import">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold">Firstrade 已確認持倉</p>
            <p className="text-xs text-muted-foreground">只帶入代號、名稱與和帳本的數量差；操作方向、價格、理由仍需您填寫。持倉快照不會自動變成交易紀錄。</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? '收合' : `查看（${candidates.length}）`}</Button>
            <Button size="sm" disabled={importable.length === 0} onClick={() => { setTrades(mergeImport(trades, importable, assetClass)); setOpen(true); }}>
              帶入週記（{importable.length}）
            </Button>
          </div>
        </div>
        {candidates.length === 0 && (
          <p className="text-xs text-muted-foreground">尚無已確認持倉，請先到 <Link className="underline" to={`/admin/${expertSlug}/brokerage`}>券商持倉</Link> 確認草稿。</p>
        )}
        {open && candidates.length > 0 && (
          <div className="divide-y text-sm">
            {candidates.map((c) => (
              <div key={c.key} className="py-2 flex items-center justify-between gap-2" data-status={c.status}>
                <div className="min-w-0">
                  <span className="font-bold">{c.symbol}</span> <span className="text-muted-foreground text-xs">{c.name}</span>
                  <p className="text-xs text-muted-foreground">券商 {fmt(c.snapshotQty)}・帳本 {fmt(c.ledgerQty)}・{c.reason || STATUS_TEXT[c.status]}</p>
                </div>
                {isImportable(c) && (
                  <Button size="sm" variant="outline" onClick={() => setTrades(mergeImport(trades, [c], assetClass))}>帶入</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
