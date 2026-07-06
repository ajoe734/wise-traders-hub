// @ts-nocheck
/**
 * HoldingsSectorSummary — 持倉族群分佈總覽（可點 chip 展開對應個股）
 *
 * 位置：`/holding-checkup` 持倉分頁 KPI Hero 下方。
 * 交互：點任一 chip（產業／題材／策略）→ 就地在該區塊下方展開屬於該族群的個股清單。
 *      再點同 chip = 收合；點別的 chip = 切換。
 */
import { memo, useState, useMemo } from 'react'
import { IND_COLOR } from '@/checkup/seedData'
import {
  aggregateBySector,
  holdingsInSector,
  HOLDING_UNCLASSIFIED_LABEL,
} from '@/checkup/lib/holdingUtils'

const MAX_ROWS = 12

function SectorDrilldown({ selected, holdings, stockMeta, overrides, C, alpha, onClear }) {
  const rows = useMemo(
    () => holdingsInSector(holdings, stockMeta, overrides, selected),
    [holdings, stockMeta, overrides, selected],
  )
  if (!selected) return null

  const kindLabel = selected.kind === 'industry' ? '產業' : selected.kind === 'theme' ? '題材' : '策略'
  const shown = rows.slice(0, MAX_ROWS)
  const more = rows.length - shown.length

  return (
    <div
      role="region"
      aria-label={`${selected.key} 相關持股`}
      style={{
        marginTop: 4,
        marginBottom: 10,
        padding: '10px 12px',
        background: C.paper || '#fff',
        border: `1px solid ${alpha(C.textMute, '15')}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 11, color: C.text, fontWeight: 500, letterSpacing: '0.04em' }}>
          <span style={{ color: C.textMute, fontWeight: 400, marginRight: 6 }}>{kindLabel}</span>
          {selected.key}
          <span style={{ color: C.textMute, fontWeight: 400, marginLeft: 6 }}>
            {rows.length} 檔
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          style={{
            fontSize: 10,
            color: C.textMute,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
            letterSpacing: '0.04em',
          }}
        >
          清除 ✕
        </button>
      </div>

      {rows.length === 0 && (
        <div style={{ fontSize: 10, color: C.textMute, padding: '4px 0' }}>
          此族群目前無個股。
        </div>
      )}

      {shown.map((r) => {
        const up = r.pnlPct != null && r.pnlPct > 0
        const down = r.pnlPct != null && r.pnlPct < 0
        const pnlColor = up ? C.red || '#c0392b' : down ? C.green || '#27ae60' : C.textMute
        return (
          <div
            key={r.code}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 0',
              borderTop: `1px dashed ${alpha(C.textMute, '10')}`,
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: C.textMute, fontFamily: 'monospace', minWidth: 40 }}>
              {r.code}
            </span>
            <span style={{ color: C.text, fontWeight: 500, flex: 1, minWidth: 0 }}>
              {r.name || '—'}
            </span>
            <span style={{ color: C.textSec, minWidth: 60, textAlign: 'right' }}>
              市值 {r.pctOfPortfolio.toFixed(1)}%
            </span>
            {r.pnlPct != null && (
              <span style={{ color: pnlColor, minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.pnlPct > 0 ? '+' : ''}
                {r.pnlPct.toFixed(1)}%
              </span>
            )}
            {r.isMulti && (
              <span style={{ color: C.textMute, fontSize: 9, minWidth: 52, textAlign: 'right' }}>
                拆 {(r.weight * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )
      })}

      {more > 0 && (
        <div style={{ fontSize: 10, color: C.textMute, marginTop: 6 }}>
          ⋯ 還有 {more} 檔
        </div>
      )}
    </div>
  )
}

function HoldingsSectorSummaryImpl({ holdings, stockMeta, overrides, C, alpha }) {
  const [selected, setSelected] = useState(null)

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
  const toggle = (kind, key) =>
    setSelected((prev) => (prev?.kind === kind && prev?.key === key ? null : { kind, key }))

  const chipBtn = (kind, key, label, tone, active) => (
    <button
      key={`${kind}:${key}`}
      type="button"
      onClick={() => toggle(kind, key)}
      aria-pressed={isSelected(kind, key)}
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 4,
        color: isSelected(kind, key) ? C.text : active ? C.text : C.textSec,
        background: isSelected(kind, key)
          ? alpha(tone || C.teal, '22')
          : active
            ? alpha(tone || C.teal, '10')
            : alpha(C.textMute, '06'),
        fontWeight: isSelected(kind, key) ? 500 : active ? 500 : 400,
        letterSpacing: '0.02em',
        lineHeight: 1.6,
        border: isSelected(kind, key) ? `1px solid ${alpha(tone || C.teal, '40')}` : '1px solid transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {isSelected(kind, key) && <span style={{ marginRight: 4 }}>●</span>}
      {label}
    </button>
  )

  const drilldown = (kind) =>
    selected?.kind === kind ? (
      <SectorDrilldown
        selected={selected}
        holdings={holdings}
        stockMeta={stockMeta}
        overrides={overrides}
        C={C}
        alpha={alpha}
        onClear={() => setSelected(null)}
      />
    ) : null

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
              title={`${x.key} ${x.count}檔 ${x.pct.toFixed(0)}%（點擊展開）`}
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

      {drilldown('industry')}

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
          {drilldown('theme')}
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
          {drilldown('strategy')}
        </>
      )}
    </section>
  )
}

const HoldingsSectorSummary = memo(HoldingsSectorSummaryImpl)
export default HoldingsSectorSummary
