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
      <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.12em', marginBottom: 6 }}>
        投組估值（市值加權 vs 同業中位數）
      </div>
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
