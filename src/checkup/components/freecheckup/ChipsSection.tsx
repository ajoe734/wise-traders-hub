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
          {data?.as_of ? `AS OF ${data.as_of.replaceAll('-', '/')}` : loading ? '' : '尚未同步'}
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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.14em' }}>關鍵分點（近 5 日）</div>
          {data?.bsr_as_of ? (
            <div style={{ fontSize: 10, color: WB.inkMute }}>BSR {data.bsr_as_of.replaceAll('-', '/')}</div>
          ) : hasInst ? (
            <div style={{ fontSize: 10, color: WB.inkMute }}>BSR 未同步</div>
          ) : null}
        </div>

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
            — 分點資料尚未同步
            <div style={{ fontSize: 10, color: WB.inkMute }}>
              （每交易日 18:15 由 TWSE BSR 抓取；每批次 20 檔，冷門代號可能延後或當日無成交）
            </div>
          </div>
        )}
      </div>

      {/* 趨勢圖 + 歷史回放 */}
      <div style={{ borderTop: `1px dashed ${WB.hair}`, marginTop: 12, paddingTop: 6 }}>
        <ChipsTrendChart WB={WB} data={data} />
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: WB.inkMute, letterSpacing: '0.06em' }}>
        資料來源：臺灣證券交易所（TWSE）
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
