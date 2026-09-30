/**
 * HoldingDeleteSellHarnessEntry — `/e2e/holding-delete-sell-harness`
 *
 * 互動驗收「記賣出並刪除 / 只刪除」二選一，資料全部 fixture：
 *  - 掛載真正的 HoldingDeleteDialog（radix 互動、預填、錯誤提示）
 *  - 記賣出：buildSellTradeEntry → applyTradeEntryToHoldings（replay 權威）
 *    → tradeLog 前插；零 gateway 寫入、零排除標記
 *  - 只刪除：走 holdingDeleteService 排除標記管線（fake gateway）
 *  - 掛載即封鎖 fetch / XHR / sendBeacon，零真實使用者資料
 */
import { useMemo, useState } from 'react';
import HoldingDeleteDialog, { type HoldingDeleteChoice } from '@/checkup/components/freecheckup/HoldingDeleteDialog';
import { buildSellTradeEntry, deleteHoldingWithExclusion } from '@/checkup/lib/holdingDeleteService';
import { applyTradeEntryToHoldings } from '@/checkup/lib/holdings';
import { createFakeGateway, HARNESS_MARKER } from '@/pages/HoldingDeleteHarnessEntry';

interface Row { code: string; name: string; qty: number; cost: number; price: number; [k: string]: unknown; }

const BASE: Row[] = [
  { code: '2338', name: '光罩', qty: 1000, cost: 40, price: 61.8 },
  { code: '6706', name: '惠特', qty: 500, cost: 100, price: 500 },
  { code: '0050', name: '元大台灣50', qty: 100, cost: 150, price: 160 },
];

const box: React.CSSProperties = { border: '1px solid #ddd8d0', padding: 12, marginTop: 12, fontSize: 13 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, padding: '2px 0', flexWrap: 'wrap', alignItems: 'center' };

export function HoldingDeleteSellHarnessEntry() {
  const [holdings, setHoldings] = useState<Row[]>([...BASE]);
  const [tradeLog, setTradeLog] = useState<unknown[]>([]);
  const [exclusionCount, setExclusionCount] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { gateway } = useMemo(
    () => createFakeGateway({ holdings: [] }),
    [],
  );

  // 與 FreeCheckup.handleDeleteHolding 同一條接線（fixture 版）。
  const onDeleteHolding = async (code: string, choice: HoldingDeleteChoice) => {
    setError(null);
    if (choice.withSell) {
      const held = holdings.find((h) => h.code === String(code));
      const built = buildSellTradeEntry({
        code,
        name: held?.name,
        qty: choice.qty ?? held?.qty,
        price: choice.price ?? held?.price,
        heldQty: held?.qty ?? 0,
        now: new Date(2026, 8, 30, 11, 30),
      });
      if (!built.ok) {
        setError(built.error);
        return { ok: false, reason: built.error };
      }
      const remaining = (held?.qty ?? 0) - built.entry.qty;
      setHoldings((prev) => applyTradeEntryToHoldings(prev, built.entry) as Row[]);
      setTradeLog((prev) => [built.entry, ...(prev || [])]);
      return { ok: true, viaSell: true, remaining };
    }
    const result = await deleteHoldingWithExclusion({ gateway, holdings, exclusions: [], code });
    if (result.ok) {
      setHoldings(result.holdings as Row[]);
      setExclusionCount((n) => n + 1);
    } else setError(result.reason ?? 'write-failed');
    return result;
  };

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', color: '#292520', background: '#F5F3EF', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>刪除二選一互動驗收（fixture only）</h1>
      <div style={rowStyle}>
        <span data-testid="build-marker">{`build_marker=${HARNESS_MARKER}`}</span>
        <span data-testid="exclusion-count">{`exclusion_count=${exclusionCount}`}</span>
        <span data-testid="holdings-count">{`holdings_count=${holdings.length}`}</span>
        <span data-testid="trade-log-count">{`trade_log_count=${tradeLog.length}`}</span>
      </div>

      {error && <div data-testid="harness-error" style={{ color: '#B42318', marginTop: 8 }}>{`error=${error}`}</div>}

      <div style={box} data-testid="holdings-box">
        <div style={{ fontWeight: 700 }}>目前持倉</div>
        {holdings.map((h) => (
          <div key={h.code} style={rowStyle} data-testid={`holding-row-${h.code}`}>
            <span>{`${h.code} ${h.name}`}</span>
            <span data-testid={`holding-qty-${h.code}`}>{`qty=${h.qty}`}</span>
            <button
              type="button"
              data-testid={`delete-${h.code}`}
              onClick={() => setDeleteTarget(h)}
            >刪除</button>
          </div>
        ))}
      </div>

      <div style={box} data-testid="trade-log-box">
        <div style={{ fontWeight: 700 }}>交易紀錄（前插）</div>
        {tradeLog.length === 0 && <div data-testid="trade-log-empty">（空）</div>}
        {tradeLog.map((t, i) => {
          const e = t as { code: string; name: string; action: string; qty: number; price: number; date: string };
          return (
            <div key={i} data-testid={`trade-log-${i}`}>
              {`${e.date} ${e.action} ${e.code} ${e.name} qty=${e.qty} price=${e.price}`}
            </div>
          );
        })}
      </div>

      {deleteTarget && (
        <HoldingDeleteDialog
          open
          onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
          code={deleteTarget.code}
          name={deleteTarget.name}
          heldQty={deleteTarget.qty}
          currentPrice={deleteTarget.price}
          onConfirm={async (choice) => onDeleteHolding(deleteTarget.code, choice)}
        />
      )}
    </div>
  );
}

export default HoldingDeleteSellHarnessEntry;
