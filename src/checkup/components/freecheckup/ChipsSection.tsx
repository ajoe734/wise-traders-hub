// @ts-nocheck
// ChipsSection — 抽屜「§4.6 籌碼面」（僅台股渲染）
// 三大法人 1/5/20/60 日 + BSR 前 3 買/賣 + 集中度
import React, { useMemo } from 'react';
import { useTwChipsDetail, isTaiwanStockCode, type TwChipsPayload } from '@/checkup/hooks/useTwChipsDetail';
import ChipsTrendChart from './ChipsTrendChart';

const SERIF = '"Source Serif 4", "Noto Serif TC", Georgia, serif';

// 台灣慣例：正值紅、負值綠
function tone(WB: any, n: number | null | undefined) {
  if (n == null || n === 0) return WB.inkMute;
  return n > 0 ? '#C43D3D' : '#2E7A4B';
}

function fmtShares(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 10_000).toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 張`;
  // 股數 → 張（1 張 = 1000 股）
  const lots = Math.round(n / 1000);
  if (lots === 0) return n > 0 ? '<1 張' : n < 0 ? '<1 張' : '0';
  const sign = lots > 0 ? '+' : '';
  return `${sign}${lots.toLocaleString('zh-TW')} 張`;
}

function fmtNet(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  const lots = Math.round(n / 1000);
  const sign = lots > 0 ? '+' : '';
  return `${sign}${lots.toLocaleString('zh-TW')}`;
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

  const { data, loading, error, fetchedAt, online, stale, refetch } = useTwChipsDetail(stockCode, true);

  const hasInst = useMemo(
    () => data && Object.values(data.institutional || {}).some((w) => w),
    [data],
  );

  const bsrLatest = data?.bsr?.d5 || data?.bsr?.d20 || data?.bsr?.d60 || null;

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
                const val = data?.institutional?.[w.key]?.[row.k as 'foreign_net'];
                return (
                  <div
                    key={w.key}
                    data-testid={`chips-inst-${row.k}-${w.key}`}
                    style={{ textAlign: 'right', color: tone(WB, val ?? null), fontVariantNumeric: 'tabular-nums' }}
                  >
                    {fmtNet(val ?? null)}
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
            <div style={{ fontSize: 10, color: WB.inkMute, textAlign: 'right' }}>
              BSR {data.bsr_as_of.replaceAll('-', '/')}
              {data.bsr_as_of_lag_days && data.bsr_as_of_lag_days >= 1
                ? `（前 ${data.bsr_as_of_lag_days} 個交易日）`
                : ''}
            </div>
          ) : data?.bsr_last_failure ? (
            <div style={{ fontSize: 10, color: '#8a5a1e' }}>BSR 同步進行中</div>
          ) : hasInst ? (
            <div style={{ fontSize: 10, color: WB.inkMute }}>BSR 排程等待中</div>
          ) : null}
        </div>

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
              {data.bsr_last_failure.reason === 'captcha_retry_exhausted'
                ? '舊 TWSE 驗證碼路徑失敗（已停用），已改由 FinMind 官方 API 抓取'
                : data.bsr_last_failure.reason === 'finmind_error'
                ? 'FinMind API 呼叫失敗（rate limit 或暫時性錯誤），下輪自動重試'
                : data.bsr_last_failure.reason === 'http_block'
                ? '上游暫時封鎖請求'
                : data.bsr_last_failure.reason === 'empty_rows'
                ? '當日無成交或上游回空'
                : data.bsr_last_failure.reason}
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
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, fontFamily: SERIF }}
          >
            <BrokerCol WB={WB} title="買超前 3" rows={bsrLatest.top_buy?.slice(0, 3) || []} positive />
            <BrokerCol WB={WB} title="賣超前 3" rows={bsrLatest.top_sell?.slice(0, 3) || []} />
            {bsrLatest.concentration_ratio != null && (
              <div style={{ gridColumn: '1 / -1', marginTop: 6, fontSize: 11, color: WB.inkSub }}>
                集中度：買超前 15 大占 {bsrLatest.concentration_ratio.toFixed(0)}%{' '}
                {bsrLatest.concentration_ratio > 70 ? '· 高（籌碼集中，跟隨風險升高）' : ''}
              </div>
            )}
          </div>
        ) : (
          <div data-testid="chips-bsr-missing" style={{ fontSize: 12, color: WB.inkMute, lineHeight: 1.6 }}>
            — 分點資料同步中
            <div style={{ fontSize: 10, color: WB.inkMute }}>
              （分點資料由 FinMind 官方 API 提供，僅在收盤後 14:00–20:59 每 10 分鐘處理一輪；受全域 1500/hr 限流保護，冷門代號或首次同步可能延後）
            </div>
          </div>
        )}
      </div>

      {/* 趨勢圖 + 歷史回放 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, marginTop: 12, paddingTop: 6 }}>
        <ChipsTrendChart WB={WB} data={data} />
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: WB.inkMute, letterSpacing: '0.06em' }}>
        資料來源：FinMind（分點）· 臺灣證券交易所 TWSE（三大法人）
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
