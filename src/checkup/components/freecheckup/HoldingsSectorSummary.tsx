// @ts-nocheck
/**
 * HoldingsSectorSummary — 持倉族群分佈總覽
 *
 * 位置：`/holding-checkup` 持倉分頁 KPI Hero 下方。
 * 目標：一眼看出「哪些產業／題材壓太多、哪些沒有」，補足卡片標籤缺乏總覽的問題。
 *
 * 視覺遵守 mem://style/checkup/japanese-minimalist-aesthetic：
 *   - off-white 底、無陰影、字重 ≤500、字級 10-12
 *   - 產業條 6px 高、最大產業原色、其他灰階
 */
import { memo } from 'react'
import { IND_COLOR } from '@/checkup/seedData'
import {
  aggregateBySector,
  HOLDING_UNCLASSIFIED_LABEL,
} from '@/checkup/lib/holdingUtils'

function HoldingsSectorSummaryImpl({ holdings, stockMeta, overrides, C, alpha }) {
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
  const chip = (active, tone) => ({
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 4,
    color: active ? C.text : C.textMute,
    background: active ? alpha(tone || C.teal, '10') : 'transparent',
    fontWeight: active ? 500 : 400,
    letterSpacing: '0.02em',
    lineHeight: 1.6,
  })

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
              title={`${x.key} ${x.count}檔 ${x.pct.toFixed(0)}%`}
              style={{
                width: `${x.pct}%`,
                height: '100%',
                background:
                  i === 0
                    ? IND_COLOR[x.key] || C.teal
                    : alpha(C.textMute, '25'),
                transition: 'width 0.4s ease',
              }}
            />
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        {industryByValue.map((x, i) => {
          const isTop = i === 0 && !singleHolding
          return (
            <span key={x.key} style={chip(isTop, IND_COLOR[x.key])}>
              {`${x.key} ${x.count}檔${
                totalValue > 0 ? ` ${x.pct.toFixed(0)}%` : ''
              }`}
            </span>
          )
        })}
      </div>

      {singleHolding && (
        <div
          style={{
            fontSize: 10,
            color: C.textMute,
            marginBottom: 10,
            fontWeight: 400,
          }}
        >
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
          {warnings
            .map(
              (w) =>
                `${w.key}(${w.count}檔 ${w.pct.toFixed(0)}%)`
            )
            .join('、')}
          {warnings.some((w) => w.pct > 30) && ' — 建議分散風險'}
        </div>
      )}

      {overDiversified && (
        <div
          style={{
            fontSize: 10,
            color: C.textMute,
            marginBottom: 10,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          產業數多且無明顯核心倉，追蹤成本較高，可考慮精簡。
        </div>
      )}

      {unclassifiedCount > 0 && (
        <div
          style={{
            fontSize: 10,
            color: C.textMute,
            marginBottom: 10,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          {`${unclassifiedCount} 檔尚未歸入產業，建議手動補上產業標籤以獲得更準確的族群分佈。`}
        </div>
      )}

      {/* ── 題材 / 策略 ── */}
      {strategyByCount.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>
            題 材 / 策 略（依檔數）
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {strategyByCount.map((s) => {
              const isUncat = s.key === HOLDING_UNCLASSIFIED_LABEL
              return (
                <span
                  key={s.key}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 4,
                    color: isUncat ? C.textMute : C.textSec,
                    background: isUncat
                      ? 'transparent'
                      : alpha(C.textMute, '08'),
                    fontWeight: 400,
                    letterSpacing: '0.02em',
                    lineHeight: 1.6,
                  }}
                >
                  {`${s.key} ${s.count}`}
                </span>
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
