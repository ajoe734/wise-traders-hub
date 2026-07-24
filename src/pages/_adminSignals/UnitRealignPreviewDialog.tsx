import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getActionMeta } from '@/lib/signalAction';


interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  expertId: string;
  symbolPrefix: string;
  fromUnit: string;
  toUnit: string;
}

interface Row {
  id: string;
  instrument: string;
  action?: string;
  quantity: number | null;
  quantity_unit: string | null;
  created_at?: string | null;
  entry_date?: string | null;
}

export function UnitRealignPreviewDialog({
  open, onClose, onConfirm, expertId, symbolPrefix, fromUnit, toUnit,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signals, setSignals] = useState<Row[]>([]);
  const [trades, setTrades] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(null);
      const like = `${symbolPrefix.trim()}%`;
      try {
        const [sig, tr] = await Promise.all([
          supabase
            .from('expert_signals')
            .select('id, instrument, action, quantity, quantity_unit, created_at')
            .eq('expert_id', expertId)
            .ilike('instrument', like)
            .neq('quantity_unit', toUnit)
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('trade_records')
            .select('id, instrument, quantity, quantity_unit, entry_date')
            .eq('expert_id', expertId)
            .ilike('instrument', like)
            .neq('quantity_unit', toUnit)
            .order('entry_date', { ascending: false })
            .limit(200),
        ]);
        if (cancelled) return;
        if (sig.error) throw sig.error;
        if (tr.error) throw tr.error;
        setSignals((sig.data || []) as Row[]);
        setTrades((tr.data || []) as Row[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, expertId, symbolPrefix, toUnit]);

  const totalAffected = signals.length + trades.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !confirming) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>預覽單位變更</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm px-1 py-2 rounded bg-muted/40">
          <span className="text-muted-foreground">代碼</span>
          <Badge variant="outline">{symbolPrefix}</Badge>
          <span className="text-muted-foreground ml-2">單位</span>
          <Badge variant="secondary">{fromUnit || '—'}</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge className="bg-primary text-primary-foreground">{toUnit}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            僅換單位標籤，不會改動數量數值
          </span>
        </div>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 讀取受影響的資料…
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive p-3 rounded border border-destructive/30 bg-destructive/5">
              預覽失敗：{error}
            </div>
          )}
          {!loading && !error && totalAffected === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              沒有需要調整的資料。
            </div>
          )}

          {!loading && !error && signals.length > 0 && (
            <section>
              <h4 className="text-xs font-medium mb-1.5 text-muted-foreground">
                訊號（expert_signals） · {signals.length} 筆
              </h4>
              <div className="border rounded divide-y text-xs">
                {signals.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="truncate flex-1">{r.instrument}</span>
                    {r.action && (
                      <Badge variant="outline" className="text-[10px]">
                        {actionLabels?.[r.action]?.label || r.action}
                      </Badge>
                    )}
                    <span className="tabular-nums">
                      {r.quantity ?? '—'}{' '}
                      <span className="text-muted-foreground line-through">{r.quantity_unit || '—'}</span>{' '}
                      <ArrowRight className="h-3 w-3 inline text-muted-foreground" />{' '}
                      <span className="font-medium text-primary">{toUnit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!loading && !error && trades.length > 0 && (
            <section>
              <h4 className="text-xs font-medium mb-1.5 text-muted-foreground">
                持倉（trade_records） · {trades.length} 筆
              </h4>
              <div className="border rounded divide-y text-xs">
                {trades.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="truncate flex-1">{r.instrument}</span>
                    <span className="tabular-nums">
                      {r.quantity ?? '—'}{' '}
                      <span className="text-muted-foreground line-through">{r.quantity_unit || '—'}</span>{' '}
                      <ArrowRight className="h-3 w-3 inline text-muted-foreground" />{' '}
                      <span className="font-medium text-primary">{toUnit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={confirming}>取消</Button>
          <Button
            data-testid="unit-realign-confirm"
            onClick={async () => {
              setConfirming(true);
              try { await onConfirm(); } finally { setConfirming(false); }
            }}
            disabled={loading || !!error || totalAffected === 0 || confirming}
          >
            {confirming ? (<><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />套用中…</>) : `確認改為「${toUnit}」（${totalAffected} 筆）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
