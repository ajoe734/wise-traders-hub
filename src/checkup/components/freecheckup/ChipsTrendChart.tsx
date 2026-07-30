// @ts-nocheck
// ChipsTrendChart — 籌碼面趨勢圖 + 歷史 scrubber
// 1) 三大法人：柱體恆為「每日淨買賣」（紅正 / 綠負），視窗 5/20/60 只影響右下讀值的滾動加總
// 2) 分點集中度：每日柱狀（Top15 買超集中度 %），>70% 紅色，保留 70% 警戒虛線
// 3) Scrubber：拖曳選日，圓點對齊柱頂
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
import { formatSharesAsLots, sharesToLots, SHARES_PER_LOT } from '@/lib/lotSize';
  TwChipsPayload,
  WindowReadinessPayload,
  ReadinessState,
} from '@/checkup/hooks/useTwChipsDetail';

const SERIF = '"Source Serif 4", "Noto Serif TC", Georgia, serif';
const UP = '#C43D3D';
const DOWN = '#2E7A4B';

type Mode = 'inst' | 'bsr';
type Window = 1 | 5 | 20 | 60;


function fmtLots(n: number | null | undefined) {
  return formatSharesAsLots(n, { signed: true, subLotLabel: '0 張' });
}

function fmtDate(d: string) {
  return d.replaceAll('-', '/');
}

const WIDTH = 560;
const HEIGHT = 160;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

export default function ChipsTrendChart({
  WB,
  data,
}: {
  WB: any;
  data: TwChipsPayload | null;
}) {
  const [mode, setMode] = useState<Mode>('inst');
  const [win, setWin] = useState<Window>(1);
  const [idx, setIdx] = useState<number>(-1); // -1 = latest
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(WIDTH);

  const inst = data?.series?.institutional_daily || [];
  const bsr = data?.series?.bsr_concentration || [];

  // 響應式寬度
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 視窗自動 clamp
  const instLen = inst.length;
  useEffect(() => {
    if (mode !== 'inst') return;
    if (instLen > 0 && win > instLen) {
      const fallback = ([60, 20, 5, 1] as Window[]).find((w2) => w2 <= instLen) ?? 1;
      setWin(fallback);
    }
  }, [mode, win, instLen]);

  // series：inst = 每日淨買賣（柱體）；bsr = 每日集中度
  const series = useMemo(() => {
    if (mode === 'inst') {
      return inst.map((r) => ({ date: r.date, value: r.total_net, raw: r }));
    }
    return bsr.map((r) => ({ date: r.date, value: r.concentration_ratio, raw: r }));
  }, [mode, inst, bsr]);

  const validPts = series.filter((p) => p.value != null && !Number.isNaN(p.value));
  const activeIdx = idx < 0 || idx >= series.length ? series.length - 1 : idx;

  // Readiness
  const currentReadiness: WindowReadinessPayload | null =
    mode === 'inst'
      ? (win === 1 ? null : (data?.readiness?.institutional?.[String(win) as '5' | '20' | '60'] ?? null))
      : (data?.readiness?.bsr_concentration?.['5'] ?? null);
  const currentNeed = currentReadiness?.need ?? (mode === 'inst' ? win : 5);
  const currentHave = currentReadiness?.have ?? validPts.length;
  const currentState: ReadinessState =
    currentReadiness?.state ??
    (validPts.length === 0
      ? 'no_data'
      : validPts.length >= currentNeed
        ? 'ready'
        : 'filling');
  const captionText =
    currentState === 'ready'
      ? ''
      : currentState === 'filling'
        ? `補齊中：已 ${currentHave}/${currentNeed} 個交易日`
        : currentState === 'upstream_exhausted'
          ? (currentReadiness?.oldest_available
              ? `此檔歷史自 ${currentReadiness.oldest_available.replaceAll('-', '/')} 起,${currentNeed} 日視窗資料不足`
              : `此檔上游歷史不足 ${currentNeed} 個交易日`)
          : '暫無資料,正在收集';

  if (!series.length) {
    return (
      <div style={{ fontSize: 12, color: WB.inkMute, padding: '10px 0' }} data-testid="chips-trend-empty">
        — 尚無歷史序列資料
      </div>
    );
  }

  // 座標映射
  const xs = (i: number) => PAD_L + (i * (w - PAD_L - PAD_R)) / Math.max(series.length - 1, 1);
  const values = validPts.map((p) => p.value as number);
  let vMin = Math.min(...values, 0);
  let vMax = Math.max(...values, 0);
  if (mode === 'bsr') {
    vMin = 0;
    vMax = Math.max(vMax, 100);
  }
  const vSpan = vMax - vMin || 1;
  const ys = (v: number) => PAD_T + (HEIGHT - PAD_T - PAD_B) * (1 - (v - vMin) / vSpan);
  const yZero = ys(0);

  const activePt = series[activeIdx];
  const activeVal = activePt?.value as number | null;

  // 高亮視窗：以 activeIdx 為終點,往前 W-1 天
  const windowSize = mode === 'inst' ? win : 5;
  const windowEnd = activeIdx;
  const windowStart = Math.max(0, windowEnd - windowSize + 1);
  const windowActualLen = windowEnd - windowStart + 1;
  const windowTruncated = windowActualLen < windowSize;

  // 讀值:視窗內加總/平均(對應高亮柱)
  const windowSlice = series.slice(windowStart, windowEnd + 1);
  const windowValidVals = windowSlice
    .map((p) => p.value)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const readoutVal =
    mode === 'inst'
      ? (windowValidVals.length
          ? windowValidVals.reduce((a, b) => a + b, 0)
          : undefined)
      : (windowValidVals.length
          ? windowValidVals.reduce((a, b) => a + b, 0) / windowValidVals.length
          : null);

  const barW = Math.max(1, (w - PAD_L - PAD_R) / series.length - 1);

  return (
    <div style={{ marginTop: 14 }} data-testid="chips-trend-chart" data-readiness-state={currentState} data-readiness-have={currentHave} data-readiness-need={currentNeed}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.14em' }}>
          趨勢與歷史回放
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <SegBtn WB={WB} active={mode === 'inst'} onClick={() => setMode('inst')}>
            三大法人
          </SegBtn>
          <SegBtn WB={WB} active={mode === 'bsr'} onClick={() => setMode('bsr')}>
            分點集中度
          </SegBtn>
        </div>
      </div>

      {mode === 'inst' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {([1, 5, 20, 60] as Window[]).map((wv) => {
            const disabled = wv > instLen;
            return (
              <SegBtn
                key={wv}
                WB={WB}
                active={win === wv}
                onClick={() => !disabled && setWin(wv)}
                small
                disabled={disabled}
              >
                {wv} 日
              </SegBtn>
            );
          })}
        </div>
      )}

      <div ref={wrapRef} style={{ width: '100%' }}>
        <svg
          viewBox={`0 0 ${w} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          style={{ display: 'block' }}
          role="img"
          aria-label="籌碼面歷史趨勢"
        >
          {/* 零軸（inst 有正負才畫） */}
          {mode === 'inst' && vMin < 0 && vMax > 0 && (
            <line x1={PAD_L} x2={w - PAD_R} y1={yZero} y2={yZero} stroke={WB.hair} strokeWidth={1} />
          )}
          {/* 集中度 70% 警戒 */}
          {mode === 'bsr' && (
            <line
              x1={PAD_L}
              x2={w - PAD_R}
              y1={ys(70)}
              y2={ys(70)}
              stroke={WB.hair}
              strokeDasharray="3 4"
            />
          )}

          {/* readiness fallback：資料 < 2 點時的提示 */}
          {validPts.length < 2 && (() => {
            const only = validPts[0];
            const i = only ? series.indexOf(only) : -1;
            const v = only?.value as number | undefined;
            return (
              <g data-testid="chips-trend-empty-hint" data-readiness-state={currentState}>
                {only && i >= 0 && v != null && !Number.isNaN(v) && (
                  <rect
                    x={xs(i) - barW / 2}
                    y={Math.min(ys(v), yZero)}
                    width={barW}
                    height={Math.max(1, Math.abs(ys(v) - yZero))}
                    fill={mode === 'bsr' ? (v > 70 ? UP : WB.ink) : v >= 0 ? UP : DOWN}
                    opacity={0.75}
                  />
                )}
                {captionText && (
                  <text
                    x={w / 2}
                    y={HEIGHT / 2}
                    fontSize={10}
                    fill={WB.inkMute}
                    textAnchor="middle"
                    fontFamily={SERIF}
                  >
                    {captionText}
                  </text>
                )}
              </g>
            );
          })()}

          {/* 視窗高亮背景 */}
          {validPts.length >= 2 && windowActualLen > 0 && (() => {
            const halfBar = barW / 2 + 1;
            const x1 = Math.max(PAD_L, xs(windowStart) - halfBar);
            const x2 = Math.min(w - PAD_R, xs(windowEnd) + halfBar);
            return (
              <rect
                data-testid="chips-trend-window-band"
                x={x1}
                y={PAD_T}
                width={Math.max(1, x2 - x1)}
                height={HEIGHT - PAD_T - PAD_B}
                fill="rgba(0,0,0,0.04)"
              />
            );
          })()}

          {/* 每日長條 — 視窗內飽和,視窗外淡化 */}
          {validPts.length >= 2 && series.map((p, i) => {
            const v = p.value as number;
            if (v == null || Number.isNaN(v)) return null;
            const y1 = ys(v);
            const base = mode === 'bsr' ? ys(vMin) : yZero;
            const fill =
              mode === 'bsr'
                ? (v > 70 ? UP : WB.ink)
                : v >= 0 ? UP : DOWN;
            const inWindow = i >= windowStart && i <= windowEnd;
            return (
              <rect
                key={i}
                data-window-active={inWindow ? 'true' : 'false'}
                x={xs(i) - barW / 2}
                y={Math.min(y1, base)}
                width={barW}
                height={Math.max(1, Math.abs(y1 - base))}
                fill={fill}
                opacity={inWindow ? 0.85 : 0.2}
              />
            );
          })}

          {/* BSR 低品質日 → 空心圓標記 */}
          {mode === 'bsr' && series.map((p, i) => {
            const raw = (p as any).raw as { low_quality?: boolean; broker_count?: number } | undefined;
            const v = p.value;
            if (!raw?.low_quality || v == null || Number.isNaN(v)) return null;
            return (
              <circle
                key={`lq-${i}`}
                data-testid="chips-trend-low-quality-dot"
                cx={xs(i)}
                cy={ys(v as number)}
                r={3}
                fill="#fff"
                stroke={WB.ink}
                strokeWidth={1.2}
              >
                <title>{`分點列數 ${raw.broker_count ?? '?'}（<5，僅供參考）`}</title>
              </circle>
            );
          })}

          {/* Scrubber 游標：對齊當日柱頂 */}
          {activePt && activeVal != null && !Number.isNaN(activeVal) && (
            <>
              <line
                x1={xs(activeIdx)}
                x2={xs(activeIdx)}
                y1={PAD_T}
                y2={HEIGHT - PAD_B}
                stroke={WB.ink}
                strokeDasharray="2 3"
                opacity={0.5}
              />
              <circle
                cx={xs(activeIdx)}
                cy={ys(activeVal)}
                r={3.5}
                fill={mode === 'bsr' ? ((activeVal as number) > 70 ? UP : WB.ink) : activeVal >= 0 ? UP : DOWN}
              />
            </>
          )}

          {/* X 軸首尾日期 */}
          <text x={PAD_L} y={HEIGHT - 6} fontSize={9} fill={WB.inkMute} fontFamily={SERIF}>
            {series[0] ? fmtDate(series[0].date) : ''}
          </text>
          <text
            x={w - PAD_R}
            y={HEIGHT - 6}
            fontSize={9}
            fill={WB.inkMute}
            textAnchor="end"
            fontFamily={SERIF}
          >
            {series[series.length - 1] ? fmtDate(series[series.length - 1].date) : ''}
          </text>
        </svg>
      </div>

      {/* Readiness caption */}
      {captionText && (
        <div
          data-testid="chips-trend-readiness-caption"
          data-readiness-state={currentState}
          style={{
            marginTop: 6,
            fontSize: 11,
            fontFamily: SERIF,
            color: currentState === 'filling' ? WB.inkSub : WB.inkMute,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{captionText}</span>
          {currentState === 'filling' && currentNeed > currentHave && (
            <span aria-hidden style={{ display: 'inline-flex', gap: 3 }}>
              {Array.from({ length: currentNeed }).map((_, i) => (
                <span
                  key={i}
                  data-testid={i < currentHave ? 'chips-trend-slot-filled' : 'chips-trend-slot-empty'}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: i < currentHave ? WB.ink : 'transparent',
                    border: `1px solid ${i < currentHave ? WB.ink : WB.hair}`,
                    opacity: i < currentHave ? 0.85 : 0.5,
                  }}
                />
              ))}
            </span>
          )}
        </div>
      )}

      {/* Scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <input
          type="range"
          min={0}
          max={Math.max(series.length - 1, 0)}
          value={activeIdx}
          onChange={(e) => setIdx(Number(e.target.value))}
          data-testid="chips-trend-scrubber"
          style={{ flex: 1, accentColor: WB.ink }}
        />
        <div
          style={{
            fontSize: 11,
            color: WB.inkSub,
            fontFamily: SERIF,
            minWidth: 82,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {activePt ? fmtDate(activePt.date) : '—'}
        </div>
      </div>

      {/* 讀值 */}
      <div
        data-testid="chips-trend-readout"
        style={{
          marginTop: 6,
          fontSize: 12,
          fontFamily: SERIF,
          color: WB.inkSub,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {mode === 'inst' ? (
          <>
            <span data-testid="chips-trend-readout-label">
              {win === 1
                ? '當日淨買賣'
                : `${win} 日累計淨買賣${windowTruncated ? `(僅 ${windowActualLen} 日)` : ''}`}
            </span>
            <span
              data-testid="chips-trend-readout-value"
              style={{
                color: readoutVal == null || Number.isNaN(readoutVal)
                  ? WB.inkMute
                  : (readoutVal as number) >= 0 ? UP : DOWN,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {readoutVal == null || Number.isNaN(readoutVal) ? '—' : fmtLots(readoutVal as number)}
            </span>
          </>
        ) : (
          <>
            <span data-testid="chips-trend-readout-label">
              {`${windowSize} 日平均集中度${windowTruncated ? `(僅 ${windowActualLen} 日)` : ''}`}
            </span>
            <span
              data-testid="chips-trend-readout-value"
              style={{
                color: readoutVal == null || Number.isNaN(readoutVal)
                  ? WB.inkMute
                  : (readoutVal as number) > 70 ? UP : WB.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {readoutVal == null || Number.isNaN(readoutVal)
                ? '—'
                : `${(readoutVal as number).toFixed(1)}%`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function SegBtn({ WB, active, onClick, children, small = false, disabled = false }: any) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        fontSize: small ? 10 : 11,
        padding: small ? '3px 8px' : '4px 10px',
        border: `1px solid ${active ? WB.ink : WB.hair}`,
        background: active ? WB.ink : 'transparent',
        color: active ? '#fff' : WB.inkSub,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: SERIF,
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </button>
  );
}
