// @ts-nocheck
/**
 * Preview-only E2E harness for HoldingsTable target-price editing.
 *
 * Mounts a single-row `<HoldingsTable>` with a fixed holding and exposes:
 *   - the input `placeholder="輸入目標價"`（受控於 targetPrice state）
 *   - `[data-testid="target-value"]`：實際被寫回 store 的值（JSON 序列化，null → "null"）
 *
 * 用來測試 target = 0 不被 falsy 吞成 null / 空白 的回歸。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { Suspense, lazy, useState } from 'react';

const HoldingsTable = lazy(() =>
  import('@/checkup/components/holdings/HoldingsTable.jsx').then((m) => ({
    default: m.HoldingsTable ?? m.default,
  })),
);

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
  } catch {
    return false;
  }
}

export default function HoldingsTableTargetHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const [holding, setHolding] = useState({
    code: '2330',
    name: '台積電',
    qty: 100,
    cost: 500,
    price: 600,
    targetPrice: null,
  });
  const [expanded, setExpanded] = useState<string | null>('2330');

  const handleUpdateTarget = (code: string, target: number | null) => {
    setHolding((prev) => (prev.code === code ? { ...prev, targetPrice: target } : prev));
  };

  return (
    <div
      id="harness-root"
      style={{ padding: 24, background: '#fff', color: '#1a1a1a', width: 520 }}
    >
      <div
        data-testid="target-value"
        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
      >
        {holding.targetPrice === null ? 'null' : JSON.stringify(holding.targetPrice)}
      </div>
      <Suspense fallback={<div>loading…</div>}>
        <HoldingsTable
          holdings={[holding]}
          expandedStock={expanded}
          setExpandedStock={setExpanded}
          onUpdateTarget={handleUpdateTarget}
        />
      </Suspense>
    </div>
  );
}
