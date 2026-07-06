// @ts-nocheck
/**
 * HoldingsSectorSummary — 持倉族群分佈總覽（可點 chip 就地篩選下方卡片牆）
 *
 * 位置：`/holding-checkup` 持倉分頁 KPI Hero 下方。
 * 交互：點任一 chip（產業／題材／策略）→ 通知 parent 設定 sectorFilter，
 *      下方持倉資料庫（卡片牆）即時只顯示屬於該族群的個股；
 *      再點同一 chip = 清除；點別的 chip = 切換。
 *
 * Props:
 *   selected  { kind, key } | null  — 由 parent（HoldingsTab）持有
 *   onSelect  (next|null) => void
 */
import { memo } from 'react'
import { IND_COLOR } from '@/checkup/seedData'
import {
  aggregateBySector,
  HOLDING_UNCLASSIFIED_LABEL,
} from '@/checkup/lib/holdingUtils'

function HoldingsSectorSummaryImpl({
  holdings,
  stockMeta,
  overrides,
  C,
  alpha,
  selected,
  onSelect,
}) {
  if (!Array.isArray(holdings) || holdings.length === 0) return null

  const {
    industryByValue,
    themeByCount,
    strategyByCount,
    totalValue,
    unclassifiedCount,
    multiIndustryCount,
    warnings,
    overDiversified,
  } = aggregateBySector(holdings, stockMeta, overrides)

  if (industryByValue.length === 0) return null

  const singleHolding = holdings.length === 1
  const sectionTitle = {
    fontSize: 9,
    color: C.textMute,
    marginBottom: 8,
    letterSpacing: '0.16em',
    fontWeight: 400,
  }

  const isSelected = (kind, key) => selected?.kind === kind && selected?.key === key
  const toggle = (kind, key) => {
    if (typeof onSelect !== 'function') return
    onSelect(isSelected(kind, key) ? null : { kind, key })
  }

  const chipBtn = (kind, key, label, tone, active) => {
    const on = isSelected(kind, key)
    return (
      <button
        key={`${kind}:${key}`}
        type="button"
        onClick={() => toggle(kind, key)}
        aria-pressed={on}
        title={on ? '再次點擊清除篩選' : '點擊只顯示此族群個股'}
        style={{
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 4,
          color: on ? C.text : active ? C.text : C.textSec,
          background: on
            ? alpha(tone || C.teal, '22')
            : active
              ? alpha(tone || C.teal, '10')
              : alpha(C.textMute, '06'),
          fontWeight: on ? 500 : active ? 500 : 400,
          letterSpacing: '0.02em',
          lineHeight: 1.6,
          border: on ? `1px solid ${alpha(tone || C.teal, '40')}` : '1px solid transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {on && <span style={{ marginRight: 4 }}>●</span>}
        {label}
      </button>
    )
  }

  const activeLabel = selected
    ? `${selected.kind === 'industry' ? '產業' : selected.kind === 'theme' ? '題材' : '策略'}：${selected.key}`
    : null

  return (
    <section
      aria-label="持倉族群分佈"
      style={{
        margin: '4px 0 18px',
        padding: '14px 16px',
        background: alpha(C.textMute, '04'),
        borderLeft: `2px solid ${alpha(C.textMute, '20')}`,
        borderRadius: 4,
      }}
    >
      {activeLabel && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            padding: '6px 10px',
            background: C.paper || '#fff',
            border: `1px solid ${alpha(C.textMute, '18')}`,
            borderRadius: 4,
            fontSize: 10,
            color: C.text,
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ color: C.textMute }}>下方僅顯示</span>
          <span style={{ fontWeight: 500 }}>{activeLabel}</span>
          <button
            type="button"
            onClick={() => onSelect?.(null)}
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: C.textMute,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            清除 ✕
          </button>
        </div>
      )}

      {/* ── 產業 ── */}
      <div style={sectionTitle}>產 業 分 佈（依市值）</div>

      {!singleHolding && totalValue > 0 && (
        <div
          role="img"
          aria-label="產業市值分佈長條"
          style={{
            display: 'flex',
            borderRadius: 3,
            overflow: 'hidden',
            height: 6,
            marginBottom: 10,
            background: alpha(C.textMute, '10'),
          }}
        >
          {industryByValue.map((x, i) => (
            <div
              key={x.key}
              title={`${x.key} ${x.count}檔 ${x.pct.toFixed(0)}%（點擊只顯示此族群）`}
              onClick={() => toggle('industry', x.key)}
              style={{
                width: `${x.pct}%`,
                height: '100%',
                background:
                  isSelected('industry', x.key)
                    ? IND_COLOR[x.key] || C.teal
                    : i === 0
                      ? IND_COLOR[x.key] || C.teal
                      : alpha(C.textMute, '25'),
                transition: 'width 0.4s ease',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {industryByValue.map((x, i) => {
          const isTop = i === 0 && !singleHolding
          const label = `${x.key} ${x.count}檔${totalValue > 0 ? ` ${x.pct.toFixed(0)}%` : ''}`
          return chipBtn('industry', x.key, label, IND_COLOR[x.key], isTop)
        })}
      </div>

      {singleHolding && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400 }}>
          僅 1 檔，暫無族群比較意義。
        </div>
      )}

      {warnings.length > 0 && (
        <div
          role="status"
          style={{
            borderLeft: `2px solid ${alpha(C.amber, '30')}`,
            background: alpha(C.amber, '04'),
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 10,
            fontSize: 10,
            color: C.amber,
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {'集中：'}
          {warnings.map((w) => `${w.key}(${w.count}檔 ${w.pct.toFixed(0)}%)`).join('、')}
          {warnings.some((w) => w.pct > 30) && ' — 建議分散風險'}
        </div>
      )}

      {overDiversified && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400, lineHeight: 1.6 }}>
          產業數多且無明顯核心倉，追蹤成本較高，可考慮精簡。
        </div>
      )}

      {unclassifiedCount > 0 && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400, lineHeight: 1.6 }}>
          {`${unclassifiedCount} 檔尚未歸入產業，建議手動補上產業標籤以獲得更準確的族群分佈。`}
        </div>
      )}

      {multiIndustryCount > 0 && (
        <div
          style={{
            fontSize: 9,
            color: C.textMute,
            marginBottom: 10,
            fontWeight: 400,
            lineHeight: 1.6,
            letterSpacing: '0.04em',
          }}
        >
          {`${multiIndustryCount} 檔跨多族群，市值按營收比重加權拆分。`}
        </div>
      )}

      {/* ── 題材 ── */}
      {themeByCount.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>題 材 曝 險（依檔數）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {themeByCount.map((t) =>
              chipBtn('theme', t.key, `${t.key} ${t.count}`, C.teal, false),
            )}
          </div>
        </>
      )}

      {/* ── 策略 ── */}
      {strategyByCount.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>策 略（依檔數）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {strategyByCount.map((s) => {
              const isUncat = s.key === HOLDING_UNCLASSIFIED_LABEL
              return chipBtn(
                'strategy',
                s.key,
                `${s.key} ${s.count}`,
                isUncat ? C.textMute : C.textSec,
                false,
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

const HoldingsSectorSummary = memo(HoldingsSectorSummaryImpl)
export default HoldingsSectorSummary
