// @ts-nocheck
// ChipsTrendChart — 籌碼面趨勢圖 + 歷史回放
// 提供：
//   1) 三大法人淨買賣（可切換 1/5/20/60 日滾動加總）—— 每日長條 + 累積線
//   2) 分點集中度（Top15 買超 / 總買量, %）—— 折線
//   3) 時間軸 scrubber + 播放按鈕，marker 顯示當日數值
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  InstitutionalDailyPoint,
  BsrConcentrationPoint,
  TwChipsPayload,
  WindowReadinessPayload,
  ReadinessState,
} from '@/checkup/hooks/useTwChipsDetail';

const SERIF = '"Source Serif 4", "Noto Serif TC", Georgia, serif';
const UP = '#C43D3D';
const DOWN = '#2E7A4B';

type Mode = 'inst' | 'bsr';
type Window = 1 | 5 | 20 | 60;

function rollingSum(arr: number[], w: number): number[] {
  const out: number[] = new Array(arr.length).fill(0);
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += arr[i];
    if (i >= w) acc -= arr[i - w];
    out[i] = i >= w - 1 ? acc : NaN;
  }
  return out;
}

function fmtLots(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  const lots = Math.round(n / 1000);
  const sign = lots > 0 ? '+' : '';
  return `${sign}${lots.toLocaleString('zh-TW')} 張`;
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
  const [win, setWin] = useState<Window>(5);
  const [idx, setIdx] = useState<number>(-1); // -1 = latest
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
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

  // 視窗自動 clamp：資料不足時退到最大可用視窗
  const instLen = inst.length;
  useEffect(() => {
    if (mode !== 'inst') return;
    if (instLen > 0 && win > instLen) {
      const fallback = ([60, 20, 5, 1] as Window[]).find((w2) => w2 <= instLen) ?? 1;
      setWin(fallback);
    }
  }, [mode, win, instLen]);

  const series = useMemo(() => {
    if (mode === 'inst') {
      const totals = inst.map((r) => r.total_net);
      const rolled = win === 1 ? totals : rollingSum(totals, win);
      return inst.map((r, i) => ({ date: r.date, value: rolled[i], raw: r }));
    }
    return bsr.map((r) => ({ date: r.date, value: r.concentration_ratio, raw: r }));
  }, [mode, win, inst, bsr]);

  const validPts = series.filter((p) => p.value != null && !Number.isNaN(p.value));
  const activeIdx = idx < 0 || idx >= series.length ? series.length - 1 : idx;

  // 播放
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (t: number) => {
      if (t - last > 220) {
        last = t;
        setIdx((prev) => {
          const cur = prev < 0 ? series.length - 1 : prev;
          const next = cur + 1;
          if (next >= series.length) {
            setPlaying(false);
            return series.length - 1;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, series.length]);

  // 播放前先跳回起點
  const handlePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (series.length < 3) return;
    setIdx(Math.max(win - 1, 0));
    setPlaying(true);
  };

  // 當前模式/視窗對應的 readiness（供 caption / placeholder 使用）
  const currentReadiness: WindowReadinessPayload | null =
    mode === 'inst'
      ? (data?.readiness?.institutional?.[String(win) as '5' | '20' | '60'] ?? null)
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
              ? `此檔歷史自 ${currentReadiness.oldest_available.replaceAll('-', '/')} 起，${currentNeed} 日視窗資料不足`
              : `此檔上游歷史不足 ${currentNeed} 個交易日`)
          : '暫無資料，正在收集';

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

  // 折線路徑
  const linePath = series
    .map((p, i) => {
      const v = p.value;
      if (v == null || Number.isNaN(v)) return '';
      return `${i === 0 || Number.isNaN(series[i - 1]?.value as number) ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v as number).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

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
          {/* 零軸 */}
          {mode === 'inst' && vMin < 0 && vMax > 0 && (
            <line x1={PAD_L} x2={w - PAD_R} y1={yZero} y2={yZero} stroke={WB.hair} strokeWidth={1} />
          )}
          {/* 集中度警戒 70% */}
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

          {/* M1: readiness-driven fallback — 移除「至少 N 個交易日」誤導文案 */}
          {validPts.length < 2 && (() => {
            const rd: WindowReadinessPayload | null =
              mode === 'inst'
                ? (data?.readiness?.institutional?.[String(win) as '5' | '20' | '60'] ?? null)
                : (data?.readiness?.bsr_concentration?.['5'] ?? null);
            const state: ReadinessState = rd?.state
              ?? (validPts.length === 0 ? 'no_data' : 'filling');
            const have = rd?.have ?? validPts.length;
            const need = rd?.need ?? (mode === 'inst' ? win : 5);
            const oldest = rd?.oldest_available ?? null;
            const hint =
              state === 'ready'
                ? ''
                : state === 'filling'
                  ? `補齊中：已 ${have}/${need} 個交易日`
                  : state === 'upstream_exhausted'
                    ? (oldest
                        ? `此檔歷史自 ${oldest.replaceAll('-', '/')} 起，${need} 日視窗資料不足`
                        : `此檔上游歷史不足 ${need} 個交易日`)
                    : '暫無資料，正在收集';
            const only = validPts[0];
            const i = only ? series.indexOf(only) : -1;
            const v = only?.value as number | undefined;
            return (
              <g data-testid="chips-trend-empty-hint" data-readiness-state={state}>
                {only && i >= 0 && v != null && !Number.isNaN(v) && (
                  <circle
                    cx={xs(i)}
                    cy={ys(v)}
                    r={4}
                    fill={mode === 'bsr' ? WB.ink : v >= 0 ? UP : DOWN}
                  />
                )}
                {hint && (
                  <text
                    x={w / 2}
                    y={HEIGHT / 2}
                    fontSize={10}
                    fill={WB.inkMute}
                    textAnchor="middle"
                    fontFamily={SERIF}
                  >
                    {hint}
                  </text>
                )}
              </g>
            );
          })()}

          {/* 每日長條（inst mode + 1 日）or 面積折線；至少要 2 個有效點才畫線 */}
          {validPts.length >= 2 && (mode === 'inst' && win === 1
            ? series.map((p, i) => {
                const v = p.value as number;
                if (v == null || Number.isNaN(v)) return null;
                const x = xs(i);
                const bw = Math.max(1, (w - PAD_L - PAD_R) / series.length - 1);
                const y1 = ys(v);
                return (
                  <rect
                    key={i}
                    x={x - bw / 2}
                    y={Math.min(y1, yZero)}
                    width={bw}
                    height={Math.abs(y1 - yZero)}
                    fill={v >= 0 ? UP : DOWN}
                    opacity={0.75}
                  />
                );
              })
            : (
              <path d={linePath} fill="none" stroke={mode === 'bsr' ? WB.ink : UP} strokeWidth={1.4} />
            ))}


          {/* 播放游標 */}
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
                fill={mode === 'bsr' ? WB.ink : activeVal >= 0 ? UP : DOWN}
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

      {/* Scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          onClick={handlePlay}
          data-testid="chips-trend-play"
          style={{
            fontSize: 11,
            padding: '4px 10px',
            border: `1px solid ${WB.hair}`,
            background: playing ? WB.ink : 'transparent',
            color: playing ? '#fff' : WB.inkSub,
            cursor: 'pointer',
            fontFamily: SERIF,
            letterSpacing: '0.1em',
          }}
        >
          {playing ? '暫停' : '播放'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(series.length - 1, 0)}
          value={activeIdx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
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
            <span>{win === 1 ? '當日淨買賣' : `${win} 日滾動淨買賣`}</span>
            <span
              style={{
                color: activeVal == null || Number.isNaN(activeVal)
                  ? WB.inkMute
                  : activeVal >= 0 ? UP : DOWN,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {activeVal == null || Number.isNaN(activeVal) ? '—' : fmtLots(activeVal)}
            </span>
          </>
        ) : (
          <>
            <span>Top15 買超集中度</span>
            <span
              style={{
                color: activeVal == null || Number.isNaN(activeVal)
                  ? WB.inkMute
                  : (activeVal as number) > 70 ? UP : WB.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {activeVal == null || Number.isNaN(activeVal)
                ? '—'
                : `${(activeVal as number).toFixed(1)}%`}
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

