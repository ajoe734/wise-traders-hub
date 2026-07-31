// @ts-nocheck
// ChipsSection — 抽屜「§4.6 籌碼面」（僅台股渲染）
// 三大法人 1/5/20/60 日 + BSR 前 3 買/賣 + 集中度
import React, { useEffect, useMemo, useRef } from 'react';
import { useTwChipsDetail, isTaiwanStockCode, isTaiwanChipEligible, type TwChipsPayload } from '@/checkup/hooks/useTwChipsDetail';
import { useChipsState } from '@/checkup/hooks/useChipsState';
import ChipsTrendChart from './ChipsTrendChart';
import { bsrHeaderLabel } from './bsrHeaderLabel';
import { useChipsBackfill } from '@/checkup/hooks/useChipsBackfill';
import { useChipsAutoBackfill } from '@/checkup/hooks/useChipsAutoBackfill';
import { isBackfillSatisfied, nextPollDelay } from '@/checkup/lib/chipsBackfillMachine';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/trafficTracker';
import { formatSharesAsLots, SHARES_PER_LOT } from '@/lib/lotSize';

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

const WINDOWS = [
  { key: 'd1', label: '1日' },
  { key: 'd5', label: '5日' },
  { key: 'd20', label: '20日' },
  { key: 'd60', label: '60日' },
] as const;

function relTime(ts: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

function fmtClock(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  const { data, loading, error, fetchedAt, online, stale, refetch } = useTwChipsDetail(stockCode, true);
  const uiState = useChipsState({
    stockCode,
    payload: data,
    error,
    chipEligible: isTaiwanChipEligible(stockCode),
  });

  const hasInst = useMemo(
    () => data && Object.values(data.institutional || {}).some((w) => w),
    [data],
  );

  const bsrLatest = data?.bsr?.d5 || data?.bsr?.d20 || data?.bsr?.d60 || null;
  const syncStatus = data?.bsr_sync_status;

  // BSR 對前端是唯讀的：排程一律由後端 cron（每日 15:30 + 盤後每 15 分鐘 delta）與
  // trade_records AFTER INSERT trigger 負責。開抽屜不再觸發 ensure_bsr_queued，
  // 避免使用者體感「打開才開始跑」。若使用者要強制立即同步，請用手動按鈕（走 mode=manual）。

  // 自動輪詢（退避）：僅在 status ∈ {pending, running} 時輪詢；一旦轉出立即停止
  const bsrPending = syncStatus?.status === 'pending' || syncStatus?.status === 'running';
  const attemptsRef = useRef(0);
  useEffect(() => {
    if (!bsrPending) { attemptsRef.current = 0; return; }
    const delay = nextPollDelay(attemptsRef.current);
    const t = setTimeout(() => { attemptsRef.current += 1; refetch(); }, delay);
    return () => clearTimeout(t);
  }, [bsrPending, fetchedAt, refetch]);

  // P3：契約收斂 — 前台不再於抽屜開啟時觸發 ensure_bsr_window。
  // 窗口補齊統一由 Orchestrator（三波 cron 15:35/17:35/19:35）+ trade_records
  // AFTER INSERT trigger 決定；使用者可用下方「回補歷史」手動按鈕強制。

  // 手動回補歷史（三大法人 + BSR 佇列）
  const instDays = data?.series?.institutional_daily?.length ?? 0;
  const bsrDays = data?.series?.bsr_concentration?.length ?? 0;
  const sparse = !!data && (instDays < 20 || bsrDays < 5);
  const { backfilling, requestBackfill } = useChipsBackfill(stockCode);
  const handleBackfill = React.useCallback(async () => {
    const result = await requestBackfill();
    if (!result) return;
    if (result.ok) {
      toast.success(
        `已排入歷史回補${result.bsrCount ? `（BSR ${result.bsrCount} 個交易日）` : ''}，三大法人約 10 秒、分點約 5–15 分鐘內完成`,
      );
      setTimeout(() => refetch(), 3000);
    } else {
      toast.error(`回補失敗：${String(result.error || '未知錯誤').slice(0, 80)}`);
    }
  }, [requestBackfill, refetch]);

  // 自動回補：資料稀疏時開抽屜自動排入一次，並追蹤 30 分鐘內是否補滿。
  // 狀態轉移全部下沉到純 reducer（chipsBackfillMachine），這裡只餵事實、收 phase。
  const satisfied = isBackfillSatisfied({
    readiness60: data?.readiness?.institutional?.['60']?.state,
    readiness20: data?.readiness?.institutional?.['20']?.state,
    instDays,
  });
  const { phase: autoBackfillPhase } = useChipsAutoBackfill({
    stockCode,
    hasData: !!data,
    sparse,
    eligible: syncStatus?.eligible,
    syncStatus: syncStatus?.status,
    satisfied,
    requestBackfill: handleBackfill,
    onTimeout: ({ stockCode: code, elapsedMs }) =>
      trackEvent('chips_auto_backfill_timeout', {
        stock_code: code,
        elapsed_ms: elapsedMs,
        inst_days: instDays,
        bsr_days: bsrDays,
      }),
  });


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
          {!loading && stale && !error && (
            <span data-testid="chips-stale-badge" style={{ fontSize: 10, color: WB.inkMute, border: `1px solid ${WB.hair}`, padding: '1px 6px', letterSpacing: '0.1em' }}>
              STALE
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
            <div title={fmtClock(fetchedAt)} style={{ fontSize: 9, letterSpacing: '0.08em', color: WB.inkMute, marginTop: 1 }}>
              更新於 {relTime(fetchedAt)}
            </div>
          )}
        </div>

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
                目前顯示的是 {fetchedAt ? relTime(fetchedAt) : '較早'}的快取資料
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
            （每交易日 17:45 收盤後同步；非交易日或新上市代號可能無資料）
          </div>
        </div>
      )}

      {/* BSR 分點 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.14em' }}>關鍵分點（近 5 日）</div>
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

        {/* 昨日 fallback 提示：有資料但落後預期交易日，或今日同步進行中但先顯示昨日資料 */}
        {data?.bsr_as_of && (data.bsr_freshness_status === 'lagging' || (data.bsr_freshness_status === 'syncing' && data.bsr_source === 'raw_fallback')) && (
          <div
            data-testid="chips-bsr-fallback-note"
            data-bsr-source={data.bsr_source || 'unknown'}
            data-bsr-freshness={data.bsr_freshness_status}
            style={{
              fontSize: 10,
              color: '#8a5a1e',
              marginBottom: 8,
              letterSpacing: '0.06em',
            }}
          >
            {data.bsr_freshness_status === 'syncing'
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
              {data.bsr_as_of ? '分點資料延遲（顯示前次成功抓取）' : '分點資料首次同步中'}
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
              {data.bsr_last_failure.error_code === 'captcha_retry_exhausted'
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
              {data.bsr_last_failure.next_retry_at && (
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
          <div data-testid="chips-bsr-missing" style={{ fontSize: 12, color: WB.inkMute, lineHeight: 1.6 }}>
            — 分點資料尚未同步（BSR 未同步）
            <div style={{ fontSize: 10, color: WB.inkMute }}>
              （每交易日 18:15 起排程自動抓取，14:00–21:00 每 10 分鐘一輪，取得後畫面自動刷新）
            </div>
          </div>


        )}
      </div>

      {/* 趨勢圖 + 歷史回放 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, marginTop: 12, paddingTop: 6 }}>
        <ChipsTrendChart WB={WB} data={data} />
      </div>

      <div
        data-testid="chips-data-source"
        style={{ marginTop: 10, fontSize: 10, color: WB.inkMute, letterSpacing: '0.06em' }}
      >
        資料來源：臺灣證券交易所 TWSE・證券櫃檯買賣中心 TPEx
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
