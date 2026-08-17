// @ts-nocheck
// ChipsSection — 抽屜「§4.6 籌碼面」（僅台股渲染）
// 三大法人 1/5/20/60 日 + BSR 前 3 買/賣 + 集中度
import React, { useMemo } from 'react';
import { isTaiwanStockCode, isTaiwanChipEligible, type TwChipsPayload } from '@/checkup/hooks/useTwChipsDetail';
import { useChipsLifecycle } from '@/checkup/hooks/useChipsLifecycle';
import ChipsTrendChart from './ChipsTrendChart';
import { bsrHeaderLabel } from './bsrHeaderLabel';
import { buildFreshnessSegments, segmentColor } from './chipsFreshnessSegments';

import { formatSharesAsLots, SHARES_PER_LOT } from '@/lib/lotSize';
import { chipsPrefs, type BsrWindowKey } from '@/checkup/lib/drawerPrefs';

// 過期自動重抓的狀態文案（單一資料源：useTwChipsDetail 的 AutoRefreshState）
const AUTO_STATE_BADGE: Record<string, string> = {
  refreshing: 'AUTO',
  failed: 'RETRY',
  exhausted: 'STOPPED',
  paused: 'PAUSED',
};
const AUTO_STATE_TEXT: Record<string, string> = {
  refreshing: '資料已過期，自動重新抓取中…',
  failed: '自動更新失敗，將自動重試',
  exhausted: '自動更新已停止，請手動重新整理',
  paused: '分頁在背景，自動更新暫停',
};

const SERIF = '"Source Serif 4", "Noto Serif TC", Georgia, serif';

// 台灣慣例：正值紅、負值綠
function tone(WB: any, n: number | null | undefined) {
  if (n == null || n === 0) return WB.inkMute;
  return n > 0 ? '#C43D3D' : '#2E7A4B';
}

function fmtShares(n: number | null | undefined) {
  // 張股換算單一資料源：@/lib/lotSize（1 張 = SHARES_PER_LOT 股）
  return formatSharesAsLots(n, { signed: true });
}

function fmtNet(n: number | null | undefined) {
  return formatSharesAsLots(n, { signed: true, suffix: '', subLotLabel: '0' });
}

/** 關鍵分點可切換的視窗（單一資料源，UI 與偏好共用）。 */
export const BSR_WINDOWS = [
  { key: 'd1', label: '1日', days: 1 },
  { key: 'd5', label: '5日', days: 5 },
  { key: 'd10', label: '10日', days: 10 },
] as const;

const WINDOWS = [
  { key: 'd1', label: '1日' },
  { key: 'd5', label: '5日' },
  { key: 'd20', label: '20日' },
  { key: 'd60', label: '60日' },
] as const;

/**
 * 單一事實：摘要格子該怎麼顯示，由後端 readiness + 本地 days_covered 決定。
 * 不要讓 6 天資料看起來像 60 日完成。
 */
export function getInstReadiness(data: TwChipsPayload | null, key: 'd1' | 'd5' | 'd20' | 'd60') {
  const cell = data?.institutional?.[key];
  if (!cell) {
    return {
      state: 'no_data' as const,
      have: 0,
      need: key === 'd1' ? 1 : Number(key.replace('d', '')),
      partial: false,
    };
  }
  const need = key === 'd1' ? 1 : Number(key.replace('d', ''));
  if (key !== 'd1') {
    const rd = data?.readiness?.institutional?.[String(need) as '5' | '20' | '60'];
    if (rd) {
      return {
        state: rd.state,
        have: rd.have,
        need: rd.need,
        partial: rd.have < rd.need && rd.state !== 'ready',
      };
    }
  }
  const have = cell.days_covered ?? 0;
  const ready = have >= need;
  return { state: ready ? 'ready' : ('filling' as const), have, need, partial: !ready };
}

/**
 * 回傳「下一次 BSR worker 執行」的 Taipei 時鐘描述。
 * 排程窗口：Taipei 週一至週五 14:00–20:59（cron: 0/10 6-12 * * 1-5，UTC 06-12 → Taipei 14-20）。
 * - 若現在在窗口內 → { inWindow: true, label: '每 10 分鐘處理一輪' }
 * - 若現在早於當日 14:00 → 下次為「今天 14:00」
 * - 若現在晚於 20:59 → 下次為「明天 14:00」（若明天是週末則順延到週一）
 */
function nextWorkerWindow(now = new Date()): { inWindow: boolean; label: string } {
  // 取 Taipei 現在的 hour/minute/weekday
  const tp = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const h = tp.getHours();
  const m = tp.getMinutes();
  const dow = tp.getDay(); // 0=Sun ... 6=Sat
  const isWeekday = dow >= 1 && dow <= 5;
  const inWindow = isWeekday && ((h >= 14 && h <= 20));
  if (inWindow) return { inWindow: true, label: '排程執行中（每 10 分鐘處理一輪）' };
  // 計算下一次執行的日期
  let addDays = 0;
  if (isWeekday && (h < 14 || (h === 20 && m > 59))) {
    // 今日尚未開始 or 剛過窗口 → 今天／明天
    addDays = h < 14 ? 0 : 1;
  } else {
    addDays = 1;
  }
  // 找出下一個週一至週五
  for (let i = 0; i < 7; i++) {
    const cand = new Date(tp);
    cand.setDate(tp.getDate() + addDays + i);
    const cdow = cand.getDay();
    if (cdow >= 1 && cdow <= 5) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const isToday = cand.toDateString() === tp.toDateString();
      const dayLabel = isToday ? '今天' : `${cand.getMonth() + 1}/${pad(cand.getDate())}`;
      return { inWindow: false, label: `下一輪：${dayLabel} 14:00 起` };
    }
  }
  return { inWindow: false, label: '下一輪：下個交易日 14:00 起' };
}



export default function ChipsSection({ WB, stockCode }: { WB: any; stockCode: string }) {
  if (!isTaiwanStockCode(stockCode)) return null;

  // ETF / 權證 / 受益憑證 / DR：無分點資料，直接顯示提示（不進 sync 佇列）
  if (!isTaiwanChipEligible(stockCode)) {
    return (
      <section
        data-testid="chips-section"
        data-chip-eligible="false"
        style={{
          margin: '18px 0 8px',
          padding: '14px 0',
          borderTop: `1px solid ${WB.hair}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, color: WB.ink, letterSpacing: '0.02em' }}>籌碼面</div>
          <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.14em' }}>NOT APPLICABLE</div>
        </div>
        <div data-testid="chips-not-eligible" style={{ fontSize: 12, color: WB.inkMute, lineHeight: 1.7 }}>
          — 此代號為 ETF／權證／受益憑證，無分點資料
          <div style={{ fontSize: 10, color: WB.inkMute, marginTop: 2 }}>
            （僅一般個股 4 碼、首位 1–9 之代號會納入分點同步）
          </div>
        </div>
      </section>
    );
  }

  // 單一生命週期入口（候選 C）：取數／新鮮度／顯示 5 態／佇列輪詢／回補全在這裡。
  // 元件不再自組四台機器，也不再自己從 payload 挖 instDays / syncStatus。
  const {
    data, loading, error, fetchedAt, ageLabel, fetchedAtClock, online, stale, refetch,
    autoState, nextAutoAt,
    ui: uiState,
    facts,
    backfilling, backfillPhase: autoBackfillPhase, requestBackfill: handleBackfill,
  } = useChipsLifecycle(stockCode, true);
  const { instDays, bsrDays, sparse } = facts;

  const hasInst = useMemo(
    () => data && Object.values(data.institutional || {}).some((w) => w),
    [data],
  );

  // 關鍵分點視窗（1／5／10 日）：使用者選擇記在 drawerPrefs，抽屜再開沿用。
  const [bsrWin, setBsrWin] = React.useState<BsrWindowKey>(() => chipsPrefs.load().bsrWindow);
  const selectBsrWin = React.useCallback((key: BsrWindowKey) => {
    setBsrWin(key);
    chipsPrefs.update({ bsrWindow: key });
  }, []);
  const bsrSelected = data?.bsr?.[bsrWin] ?? null;
  // 舊 payload／舊快取只有 d5/d20/d60；選 5 日時仍沿用既有降級鏈，避免回歸。
  const bsrLatest =
    bsrSelected || (bsrWin === 'd5' ? data?.bsr?.d20 || data?.bsr?.d60 || null : null);
  const bsrWinDays = BSR_WINDOWS.find((w) => w.key === bsrWin)?.days ?? 5;
  const bsrWinReadiness =
    data?.readiness?.bsr_concentration?.[String(bsrWinDays) as '1' | '5' | '10'] ?? null;
  const syncStatus = data?.bsr_sync_status;
  // Plan v2：上游狀態一律以 server classifier 的 enum 為準，前端不重判。
  const providerState = data?.bsr_provider_state ?? syncStatus?.provider_state ?? null;
  const isTerminalProvider = providerState === 'terminal_provider_rejected';
  const retryPromised = data?.bsr_retry_promised ?? syncStatus?.retry_promised ?? false;


  // BSR 對前端是唯讀的：排程一律由後端 cron（每日 15:30 + 盤後每 15 分鐘 delta）與
  // trade_records AFTER INSERT trigger 負責；使用者可用下方「回補歷史」手動按鈕強制。
  // P3：前台不再於抽屜開啟時觸發 ensure_bsr_window / ensure_bsr_queued。

  // 依真實 status 渲染 BSR 標頭文案（單一來源：bsrHeaderLabel.ts）
  const headerLabel = bsrHeaderLabel(syncStatus, !!data?.bsr_as_of);



  return (
    <section
      data-testid="chips-section"
      style={{
        margin: '18px 0 8px',
        padding: '14px 0',
        borderTop: `1px solid ${WB.hair}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, color: WB.ink, letterSpacing: '0.02em' }}>籌碼面</div>
          {loading && (
            <span data-testid="chips-loading" style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.14em' }}>
              載入中…
            </span>
          )}
          {/* 注意：FRESH／STALE 指的是「本次請求取得的時間」，不是資料日期。
              各來源的資料日期一律看下方 chips-freshness-segments。 */}
          {!loading && stale && !error && (
            <span data-testid="chips-stale-badge" title="本次請求的取得時間已過期（非資料日期）" style={{ fontSize: 10, color: WB.inkMute, border: `1px solid ${WB.hair}`, padding: '1px 6px', letterSpacing: '0.1em' }}>
              STALE
            </span>
          )}
          {/* FRESH 與 STALE 互斥：兩者條件互為否定，永遠不會同時出現。 */}
          {!loading && !stale && !error && online && !!fetchedAt && (
            <span data-testid="chips-fresh-badge" title="本次請求剛取得（非資料日期；資料日期見下方分段標示）" style={{ fontSize: 10, color: WB.inkSub, border: `1px solid ${WB.hair}`, padding: '1px 6px', letterSpacing: '0.1em' }}>
              FRESH
            </span>
          )}

          {autoState !== 'idle' && (
            <span
              data-testid="chips-auto-refresh-badge"
              data-auto-state={autoState}
              title={AUTO_STATE_TEXT[autoState]}
              style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                padding: '1px 6px',
                border: `1px solid ${autoState === 'exhausted' ? '#b04a4a' : WB.hair}`,
                color: autoState === 'exhausted' ? '#b04a4a' : WB.inkMute,
              }}
            >
              {AUTO_STATE_BADGE[autoState]}
            </span>
          )}
          {!online && (
            <span data-testid="chips-offline-badge" style={{ fontSize: 10, color: '#8a5a1e', border: '1px solid #8a5a1e', padding: '1px 6px', letterSpacing: '0.1em' }}>
              OFFLINE
            </span>
          )}
          {(uiState.state === 'd1_fallback' || uiState.state === 'filling_new_stock' || uiState.state === 'upstream_outage') && (
            <span
              data-testid="chips-state-badge"
              data-state={uiState.state}
              style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                padding: '1px 6px',
                border: `1px solid ${uiState.state === 'upstream_outage' ? '#b04a4a' : uiState.state === 'filling_new_stock' ? '#8a5a1e' : WB.hair}`,
                color: uiState.state === 'upstream_outage' ? '#b04a4a' : uiState.state === 'filling_new_stock' ? '#8a5a1e' : WB.inkSub,
              }}
              title={uiState.reason}
            >
              {uiState.state === 'd1_fallback' ? 'D-1' : uiState.state === 'filling_new_stock' ? 'FILLING' : 'OUTAGE'}
            </span>
          )}
          {data?.coalesced && (
            <span
              data-testid="chips-coalesced-badge"
              title="本次回應與其他併發請求共用同一次上游 fetch"
              style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                padding: '1px 6px',
                border: `1px solid ${WB.hair}`,
                color: WB.inkMute,
              }}
            >
              COALESCED
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.14em', textAlign: 'right' }}>
          {data?.as_of
            ? `AS OF ${data.as_of.replaceAll('-', '/')}${data.as_of_lag_days && data.as_of_lag_days >= 1 ? `（前 ${data.as_of_lag_days} 個交易日）` : ''}`
            : loading ? '' : '尚未同步'}
          {fetchedAt && (
            <div data-testid="chips-fetched-age" title={fetchedAtClock} style={{ fontSize: 9, letterSpacing: '0.08em', color: WB.inkMute, marginTop: 1 }}>
              更新於 {ageLabel}
            </div>
          )}
          {autoState !== 'idle' && (
            <div
              data-testid="chips-auto-refresh-status"
              data-auto-state={autoState}
              aria-live="polite"
              style={{ fontSize: 9, letterSpacing: '0.04em', color: autoState === 'exhausted' ? '#b04a4a' : WB.inkMute, marginTop: 1 }}
            >
              {AUTO_STATE_TEXT[autoState]}
              {autoState === 'failed' && nextAutoAt ? `（約 ${Math.max(1, Math.round((nextAutoAt - Date.now()) / 1000))} 秒後重試）` : ''}
            </div>
          )}
        </div>

      </div>

      {/* H6 · 分段新鮮度：三大法人 與 券商分點 是兩個獨立來源，各自標示 as_of 與狀態 */}
      <div
        data-testid="chips-freshness-segments"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 14px',
          marginBottom: 10,
          fontSize: 10,
          letterSpacing: '0.06em',
          fontFamily: SERIF,
        }}
      >
        {buildFreshnessSegments(data).map((seg) => (
          <span
            key={seg.key}
            data-testid={`chips-seg-${seg.key}`}
            data-seg-state={seg.state}
            title={seg.title}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 6,
              padding: '2px 8px',
              border: `1px solid ${seg.tone === 'error' ? 'rgba(176,74,74,0.4)' : WB.hair}`,
              color: segmentColor(seg.tone, WB),
            }}
          >
            <span style={{ color: WB.inkMute }}>{seg.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{seg.text}</span>
          </span>
        ))}
      </div>



      {/* 稀疏資料：手動回補過去 60 日 */}
      {sparse && !error && (
        <div
          data-testid="chips-backfill-hint"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '8px 10px', marginBottom: 10,
            border: `1px dashed ${WB.hair}`, background: 'rgba(0,0,0,0.02)',
            fontSize: 11, color: WB.inkSub, fontFamily: SERIF,
          }}
        >
          <div>
            歷史資料僅 {Math.max(instDays, bsrDays)} 天，趨勢圖繪製點不足。
            <div style={{ fontSize: 10, color: WB.inkMute, marginTop: 2 }}>
              點右側可一次回補過去 60 個交易日（三大法人即時完成、分點需 5–15 分鐘）
            </div>
          </div>
          <button
            data-testid="chips-backfill-btn"
            onClick={handleBackfill}
            disabled={backfilling}
            style={{
              fontSize: 11, padding: '4px 10px',
              border: `1px solid ${WB.ink}`, background: 'transparent', color: WB.ink,
              cursor: backfilling ? 'not-allowed' : 'pointer', opacity: backfilling ? 0.5 : 1,
              fontFamily: SERIF, letterSpacing: '0.1em', whiteSpace: 'nowrap',
            }}
          >
            {backfilling ? '排入中…' : '回補 60 日'}
          </button>
        </div>
      )}

      {/* 自動回補逾時通知：資料已進入佇列，但 30 分鐘內仍未補滿 */}
      {autoBackfillPhase === 'timeout' && !error && (
        <div
          data-testid="chips-backfill-timeout"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', marginBottom: 10,
            border: `1px dashed #8a5a1e`, background: 'rgba(138,90,30,0.04)',
            fontSize: 11, color: '#8a5a1e', fontFamily: SERIF,
          }}
        >
          <span style={{ fontSize: 12 }}>⏳</span>
          <div>
            歷史資料補齊中，預計 5–15 分鐘後完成。
            <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>
              已將此狀況回報後台；稍後重新打開抽屜即可查看最新資料。
            </div>
          </div>
        </div>
      )}

      {/* 錯誤 / 離線橫幅 */}
      {error && (
        <div
          data-testid="chips-error-banner"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px',
            marginBottom: 10,
            border: `1px solid ${error.kind === 'offline' ? '#8a5a1e' : '#b04a4a'}`,
            background: error.kind === 'offline' ? 'rgba(240,190,90,0.08)' : 'rgba(196,61,61,0.06)',
            fontSize: 12,
            color: WB.inkSub,
            fontFamily: SERIF,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: error.kind === 'offline' ? '#8a5a1e' : '#b04a4a', letterSpacing: '0.1em', fontSize: 10 }}>
              {error.kind === 'offline'
                ? '離線'
                : error.kind === 'timeout'
                ? '請求逾時'
                : error.kind === 'auth'
                ? '權限失效'
                : error.kind === 'not_found'
                ? '無資料'
                : error.kind === 'server'
                ? '伺服器錯誤'
                : error.kind === 'network'
                ? '網路異常'
                : '錯誤'}
              {error.status ? ` · ${error.status}` : ''}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{error.reason}</span>
            {data && (
              <span style={{ fontSize: 10, color: WB.inkMute, marginTop: 2 }}>
                目前顯示的是 {fetchedAt ? ageLabel : '較早'}的快取資料
              </span>
            )}
          </div>
          <button
            data-testid="chips-retry"
            onClick={refetch}
            disabled={loading || !online}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              border: `1px solid ${WB.ink}`,
              background: 'transparent',
              color: WB.ink,
              cursor: loading || !online ? 'not-allowed' : 'pointer',
              opacity: loading || !online ? 0.4 : 1,
              fontFamily: SERIF,
              letterSpacing: '0.1em',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? '重試中…' : '重試'}
          </button>
        </div>
      )}

      {/* 三大法人 */}
      {hasInst ? (
        <div
          data-testid="chips-institutional"
          style={{
            display: 'grid',
            gridTemplateColumns: '80px repeat(4, 1fr)',
            gap: '6px 12px',
            fontSize: 13,
            fontFamily: SERIF,
            marginBottom: 14,
          }}
        >
          <div />
          {WINDOWS.map((w) => (
            <div key={w.key} style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.08em', textAlign: 'right' }}>
              {w.label}
            </div>
          ))}
          {[
            { label: '外資', k: 'foreign_net' },
            { label: '投信', k: 'trust_net' },
            { label: '自營商', k: 'dealer_net' },
          ].map((row) => (
            <React.Fragment key={row.k}>
              <div style={{ color: WB.inkSub }}>{row.label}</div>
              {WINDOWS.map((w) => {
                const cell = data?.institutional?.[w.key];
                const val = cell?.[row.k as 'foreign_net'];
                const rd = getInstReadiness(data, w.key);
                const isReady = rd.state === 'ready';
                const isPartial = rd.partial && cell != null;
                return (
                  <div
                    key={w.key}
                    data-testid={`chips-inst-${row.k}-${w.key}`}
                    data-readiness-state={rd.state}
                    title={isPartial ? `僅 ${rd.have}/${rd.need} 個交易日` : undefined}
                    style={{
                      textAlign: 'right',
                      color: isReady ? tone(WB, val ?? null) : WB.inkMute,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {isReady ? fmtNet(val ?? null) : isPartial ? `${fmtNet(val ?? null)} (${rd.have}/${rd.need})` : '—'}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      ) : (
        <div data-testid="chips-inst-missing" style={{ fontSize: 12, color: WB.inkMute, marginBottom: 14, lineHeight: 1.6 }}>
          — 三大法人資料尚未同步
          <div style={{ fontSize: 10, color: WB.inkMute }}>
            （僅交易日有新資料：每交易日 17:45 收盤後同步；週末與國定假日休市不更新，新上市代號可能尚無資料）
          </div>
        </div>
      )}

      {/* BSR 分點 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.14em' }}>
              關鍵分點（近 {bsrWinDays} 日）
            </div>
            {bsrSelected && bsrWinReadiness && bsrWinReadiness.have > 0 && bsrWinReadiness.have < bsrWinDays ? (
              <span
                data-testid="chips-bsr-partial"
                data-bsr-have={bsrWinReadiness.have}
                style={{ fontSize: 10, color: WB.inkMute, border: `1px solid ${WB.hair}`, padding: '1px 6px', fontFamily: SERIF }}
              >
                僅 {bsrWinReadiness.have}/{bsrWinDays} 個交易日
              </span>
            ) : null}

            <div data-testid="chips-bsr-window-switch" style={{ display: 'inline-flex', border: `1px solid ${WB.hair}` }}>
              {BSR_WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  data-testid={`chips-bsr-window-${w.key}`}
                  data-active={bsrWin === w.key ? 'true' : 'false'}
                  aria-pressed={bsrWin === w.key}
                  onClick={() => selectBsrWin(w.key)}
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    padding: '2px 8px',
                    border: 'none',
                    borderRight: w.key === 'd10' ? 'none' : `1px solid ${WB.hair}`,
                    background: bsrWin === w.key ? WB.ink : 'transparent',
                    color: bsrWin === w.key ? WB.paper : WB.inkSub,
                    cursor: 'pointer',
                    fontFamily: SERIF,
                    lineHeight: 1.6,
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          {data?.bsr_as_of ? (
            <div style={{ fontSize: 10, color: WB.inkMute, textAlign: 'right' }} data-testid="chips-bsr-as-of">
              BSR {data.bsr_as_of.replaceAll('-', '/')}
              {data.bsr_as_of_lag_days && data.bsr_as_of_lag_days >= 1
                ? `（前 ${data.bsr_as_of_lag_days} 個交易日）`
                : ''}
            </div>
          ) : headerLabel ? (
            <div
              data-testid="chips-bsr-status"
              data-bsr-status={syncStatus?.status || 'unknown'}
              style={{
                fontSize: 10,
                color: headerLabel.tone === 'error' ? '#b04a4a' : headerLabel.tone === 'warn' ? '#8a5a1e' : WB.inkMute,
                textAlign: 'right',
              }}
            >
              {headerLabel.text}
            </div>
          ) : null}

        </div>

        {/* 昨日 fallback 提示：有資料但落後預期交易日，或上游仍可重試時先顯示昨日資料。
            Plan v2：terminal / unknown 一律不得說「同步中」。 */}
        {data?.bsr_as_of && (data.bsr_freshness_status === 'lagging' || (data.bsr_freshness_status === 'syncing' && data.bsr_source === 'raw_fallback')) && (
          <div
            data-testid="chips-bsr-fallback-note"
            data-bsr-source={data.bsr_source || 'unknown'}
            data-bsr-freshness={data.bsr_freshness_status}
            data-bsr-provider-state={providerState || 'unknown'}
            style={{
              fontSize: 10,
              color: '#8a5a1e',
              marginBottom: 8,
              letterSpacing: '0.06em',
            }}
          >
            {providerState === 'terminal_provider_rejected'
              ? `上游來源中止，顯示 ${data.bsr_as_of.replaceAll('-', '/')} 的前次成功分點`
              : providerState === 'unknown_degraded'
              ? `上游狀態待確認，先顯示 ${data.bsr_as_of.replaceAll('-', '/')} 的關鍵分點`
              : data.bsr_freshness_status === 'syncing'
              ? `今日資料同步中，先顯示 ${data.bsr_as_of.replaceAll('-', '/')} 的關鍵分點`
              : `顯示 ${data.bsr_as_of.replaceAll('-', '/')} 資料（較預期日期落後 ${data.bsr_lag_weekdays ?? 1} 個交易日）`}
          </div>

        )}




        {/* 有失敗紀錄就顯示診斷 banner；不再要求同時要有 bsr_as_of，
            因為首次同步尚未成功時 bsr_as_of 會是 null，此時最需要向使用者說明狀態 */}
        {data?.bsr_last_failure && (
          <div
            data-testid="chips-bsr-fallback-hint"
            style={{
              fontSize: 10,
              color: '#8a5a1e',
              background: 'rgba(240,190,90,0.08)',
              border: '1px solid rgba(138,90,30,0.35)',
              padding: '6px 8px',
              marginBottom: 8,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 600, letterSpacing: '0.08em', marginBottom: 2 }}>
              {isTerminalProvider
                ? (data.bsr_as_of ? '分點資料更新已暫停（上游來源中止）' : '上游目前不提供此資料')
                : providerState === 'unknown_degraded'
                ? '分點資料狀態待確認'
                : data.bsr_as_of ? '分點資料延遲（顯示前次成功抓取）' : '分點資料首次同步中'}
            </div>
            <div>
              {data.bsr_last_failure.last_successful_as_of || data.bsr_as_of ? (
                <>
                  最後成功日：
                  <b style={{ color: '#5c3d10' }}>
                    {(data.bsr_last_failure.last_successful_as_of || data.bsr_as_of)!.replaceAll('-', '/')}
                  </b>
                  ；
                </>
              ) : (
                <>此代號尚無成功紀錄；</>
              )}
              已嘗試回推：
              <b style={{ color: '#5c3d10' }}>
                {data.bsr_last_failure.lookback_to && data.bsr_last_failure.lookback_from
                  ? `${data.bsr_last_failure.lookback_to.replaceAll('-', '/')} ~ ${data.bsr_last_failure.lookback_from.replaceAll('-', '/')}`
                  : data.bsr_last_failure.trade_date.replaceAll('-', '/')}
              </b>
              {data.bsr_last_failure.lookback_days && data.bsr_last_failure.lookback_days > 1
                ? `（共 ${data.bsr_last_failure.lookback_days} 個日期）`
                : ''}
              。
            </div>
            <div>
              失敗原因：
              {isTerminalProvider
                ? '上游來源不再提供此資料（供應商方案／資格限制），更新已暫停，恢復時間未知'
                : providerState === 'unknown_degraded'
                ? '上游回應無法歸類，狀態待確認，暫不承諾更新時間'
                : data.bsr_last_failure.error_code === 'captcha_retry_exhausted'
                ? '舊資料路徑失敗（已停用），改由官方 API 抓取'
                : data.bsr_last_failure.error_code === 'finmind_error'
                ? '上游 API 呼叫失敗（額度或暫時性錯誤），下輪自動重試'
                : data.bsr_last_failure.error_code === 'http_block'
                ? '上游暫時封鎖請求'
                : data.bsr_last_failure.error_code === 'no_chip_data'
                ? '尚無此代號分點（多為新上市或非常規個股）'
                : data.bsr_last_failure.error_code === 'not_chip_eligible'
                ? 'ETF／權證／受益憑證無分點資料'
                : data.bsr_last_failure.error_code === 'rate_limited'
                ? 'API 額度已用完，將於下輪自動重試'
                : data.bsr_last_failure.error_code === 'empty_rows'
                ? '當日無成交或上游回空'
                : '同步暫時失敗，將自動重試'}
              {typeof data.bsr_last_failure.consecutive_failures === 'number' && data.bsr_last_failure.consecutive_failures > 1
                ? `（已連續失敗 ${data.bsr_last_failure.consecutive_failures} 次）`
                : ''}
              。
              {retryPromised && data.bsr_last_failure.next_retry_at && (
                <>
                  {' '}將於
                  {' '}
                  {new Date(data.bsr_last_failure.next_retry_at).toLocaleString('zh-TW', {
                    timeZone: 'Asia/Taipei',
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                  {' '}自動重試。
                </>
              )}
            </div>
          </div>
        )}


        {bsrLatest ? (
          <div
            data-testid="chips-bsr"
            data-bsr-low-quality={data?.bsr_low_quality ? 'true' : 'false'}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, fontFamily: SERIF }}
          >
            <BrokerCol WB={WB} title="買超前 3" rows={bsrLatest.top_buy?.slice(0, 3) || []} positive />
            <BrokerCol WB={WB} title="賣超前 3" rows={bsrLatest.top_sell?.slice(0, 3) || []} />
            {bsrLatest.concentration_ratio != null && Number.isFinite(Number(bsrLatest.concentration_ratio)) && (
              <div style={{ gridColumn: '1 / -1', marginTop: 6, fontSize: 11, color: WB.inkSub, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  集中度：買超前 15 大占 {Number(bsrLatest.concentration_ratio).toFixed(0)}%{' '}
                  {Number(bsrLatest.concentration_ratio) > 70 ? '· 高（籌碼集中，跟隨風險升高）' : ''}
                </span>
                {data?.bsr_low_quality && (
                  <span
                    data-testid="chips-bsr-low-quality-badge"
                    title={`當日僅回 ${Number(data?.bsr_broker_count ?? 0)} 筆分點（<${Number(data?.bsr_low_quality_threshold ?? 5)}），資料稀疏僅供參考`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '1px 6px', borderRadius: 4,
                      border: `1px solid ${WB.hair}`,
                      fontSize: 10, color: WB.inkSub, background: 'transparent',
                      letterSpacing: '0.05em',
                    }}
                  >
                    低品質・{Number(data?.bsr_broker_count ?? 0)}/5 分點
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div data-testid="chips-bsr-missing" data-bsr-window={bsrWin} style={{ fontSize: 12, color: WB.inkMute, lineHeight: 1.6 }}>
            {bsrWinReadiness && bsrWinReadiness.have > 0
              ? `— 近 ${bsrWinDays} 日分點補齊中（已 ${bsrWinReadiness.have}/${bsrWinDays} 個交易日）`
              : '— 分點資料尚未同步（BSR 未同步）'}
            <div style={{ fontSize: 10, color: WB.inkMute }}>
              （僅交易日有新資料：週一～五 14:00–21:00 每 10 分鐘一輪自動抓取；
              週末與國定假日休市不更新，週日排程會自動補齊本週漏抓的交易日）
            </div>
          </div>


        )}
      </div>

      {/* 趨勢圖 + 歷史回放 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, marginTop: 12, paddingTop: 6 }}>
        <ChipsTrendChart WB={WB} data={data} />
      </div>

      {/* 資料來源標示：三大法人與分點資料的官方來源是 TWSE（上市）與 TPEx
          （上櫃／興櫃）。這行是對外可稽核的出處聲明，不是裝飾字，測試以
          data-testid="chips-data-source" 固定。 */}
      <div
        data-testid="chips-data-source"
        style={{
          marginTop: 10,
          fontSize: 10,
          color: WB.inkMute,
          letterSpacing: '0.08em',
        }}
      >
        資料來源：TWSE 臺灣證券交易所 · TPEx 證券櫃檯買賣中心
      </div>
    </section>

  );
}

function BrokerCol({ WB, title, rows, positive = false }: any) {
  return (
    <div>
      <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.14em', marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: WB.inkMute }}>—</div>
      ) : (
        rows.map((b: any, i: number) => (
          <div key={b.broker_id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: WB.inkSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            <span
              style={{
                color: positive ? '#C43D3D' : '#2E7A4B',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 8,
              }}
            >
              {fmtShares(b.net)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
