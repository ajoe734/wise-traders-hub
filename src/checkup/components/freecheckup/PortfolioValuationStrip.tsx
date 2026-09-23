/**
 * PortfolioValuationStrip —— 持倉看板 Hero 下方的「投組加權估值指數」單列。
 *
 * 設計硬合約（比照 ValuationRulers）：
 *   - 顏色不單獨承載意義：每把尺同時顯示數字 + 文字標籤（高於／接近／低於同業）。
 *   - 不出現任何買賣建議字眼。
 *   - as-of 永遠可見；stale 時加註「資料較舊」。
 *   - 所有數字由 `valuationRulers.ts` 純函式算好後傳入，本檔案不做運算。
 *   - 「計算說明」折疊面板文字必須與 valuationRulers.ts 的常數一致（MIN_PEER_N、
 *     WINSOR 5%/95%、PORTFOLIO_PREMIUM_CAP、PORTFOLIO_PREMIUM_NEUTRAL），禁止口頭另刻數字。
 *   - 手機 ≤640px 允許換行，禁止橫向溢出。
 */
import { useState } from 'react';
import {
  PORTFOLIO_VALUATION_CONTRACT,
  summarizePortfolioValuation,
} from '@/checkup/lib/valuationRulers';
import { usePortfolioValuation, type PortfolioHoldingLike } from '@/checkup/hooks/usePortfolioValuation';
import type { CheckupGateway } from '@/checkup/lib/gateway';

const SERIF = '"Source Serif 4", "Noto Serif TC", serif';

function fmtPremium(v: number | null): string {
  if (v == null) return '—';
  const pct = v * 100;
  const rounded = Math.sign(pct) * (Math.round(Math.abs(pct) * 10) / 10);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function fmtClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Taipei',
    });
  } catch {
    return '';
  }
}

export default function PortfolioValuationStrip({
  holdings,
  WB,
  injectedGateway,
}: {
  holdings: PortfolioHoldingLike[] | null | undefined;
  WB: any;
  injectedGateway?: CheckupGateway;
}) {
  const { status, result, asOf, stale, error, lastFetchedAt } = usePortfolioValuation(holdings, {
    injectedGateway,
  });
  const [explainOpen, setExplainOpen] = useState(false);

  // 無台股持倉時整列不出現（避免佔空間）。
  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div
        data-testid="portfolio-valuation-loading"
        data-contract={PORTFOLIO_VALUATION_CONTRACT}
        style={{
          margin: '4px 0 10px',
          border: `1px solid ${WB.hair}`,
          padding: '10px 12px',
          fontSize: 11,
          color: WB.inkMute,
        }}
      >
        投組估值計算中…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        data-testid="portfolio-valuation-error"
        data-contract={PORTFOLIO_VALUATION_CONTRACT}
        style={{
          margin: '4px 0 10px',
          border: `1px solid ${WB.hair}`,
          padding: '10px 12px',
          fontSize: 11,
          color: WB.inkSub,
        }}
      >
        投組估值暫時取不到{error ? `（${error}）` : ''}，不影響其他資訊
      </div>
    );
  }

  const summary = result ? summarizePortfolioValuation(result) : null;

  return (
    <div
      data-testid="portfolio-valuation-strip"
      data-contract={PORTFOLIO_VALUATION_CONTRACT}
      style={{
        margin: '4px 0 10px',
        border: `1px solid ${WB.hair}`,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.12em' }}>
          投組估值（市值加權 vs 同業中位數）
        </div>
        <button
          type="button"
          data-testid="portfolio-valuation-explain-toggle"
          aria-expanded={explainOpen}
          onClick={() => setExplainOpen((v) => !v)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            font: 'inherit',
            fontSize: 10,
            color: WB.inkMute,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            cursor: 'pointer',
          }}
        >
          {explainOpen ? '收起說明' : '計算說明'}
        </button>
      </div>
      {explainOpen && (
        <div
          data-testid="portfolio-valuation-explain"
          style={{
            margin: '6px 0 2px',
            padding: '8px 10px',
            border: `1px solid ${WB.hair}`,
            fontSize: 10,
            lineHeight: 1.7,
            color: WB.inkSub,
          }}
        >
          <div>涵蓋率：每把尺只納入「該尺算得出溢折價」的持股（個股數值有效、且同業樣本足夠），以市值加權；涵蓋率＝納入計算的市值 ÷ 全部台股持股市值。涵蓋率低代表該尺主要反映少數持股，判讀時應保守。</div>
          <div>同業門檻：同業中位數需至少 3 家同業有當日有效數值才計算；母體先做極端值處理（保留 5%–95% 區間）再取中位數。個股溢折價＝個股數值 ÷ 同業中位數 − 1，單檔溢價上限 +200%，避免單一極端股主導加權指數。</div>
          <div>判讀：加權溢折價絕對值在 10% 以內顯示「與同業相當」。以上僅描述與同業的相對位置，不構成任何買賣建議。</div>
        </div>
      )}
      {!summary ? (
        <div data-testid="portfolio-valuation-insufficient" style={{ fontSize: 11, color: WB.inkMute }}>
          估值資料不足，暫不顯示投組加權指數
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 18px',
            alignItems: 'baseline',
            minWidth: 0,
          }}
        >
          {result!.rulers.map((r) => (
            <div key={r.key} data-testid={`portfolio-valuation-${r.key}`} style={{ minWidth: 0 }}>
              <span style={{ fontSize: 11, color: WB.inkSub }}>{r.label} </span>
              <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700, color: WB.ink }}>
                {fmtPremium(r.weightedPremium)}
              </span>
              <span style={{ fontSize: 11, color: WB.inkSub }}>（{r.text}）</span>
              <span data-testid={`portfolio-valuation-${r.key}-coverage`} style={{ fontSize: 10, color: WB.inkMute }}>
                {' '}
                涵蓋 {Math.round((r.coverage || 0) * 100)}% 市值
              </span>
            </div>
          ))}
        </div>
      )}
      <div data-testid="portfolio-valuation-meta" style={{ fontSize: 10, color: WB.inkMute, marginTop: 6 }}>
        {result && result.totalWeight > 0
          ? `納入計算 ${result.stockCount} 檔台股；各尺涵蓋率以同業樣本足夠者為準`
          : '無可計算的持倉'}
        {asOf ? `・截至 ${asOf.split('-').join('/')}` : ''}
        {stale ? '・資料較舊' : ''}
        {'・來源：交易所公告'}
        <span data-testid="portfolio-valuation-autorefresh">
          {'・每 30 分鐘自動更新'}
          {lastFetchedAt ? `（上次 ${fmtClock(lastFetchedAt)}）` : ''}
        </span>
      </div>
    </div>
  );
}
