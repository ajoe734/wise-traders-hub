/**
 * Regression tests — todayPnl / todayPct / total P&L 一致性
 *
 * 對應 audit 2026-06 的 H2/H3/H4 修復：
 *   - 市場已收盤 → yesterday=quote.yesterday，todayPnl=(price-yesterday)*qty
 *   - 市場盤中   → 同上；quote 未帶 yesterday 時 todayPnl 必須為 null，不得 fallback 到「總損益」
 *   - overrideQuote 換價後，yesterday/todayPnl/todayPct 必須全部重算，不得沿用 stale 值
 *   - 精確模式（totalCost+fee）與 fallback 模式 total P&L 應與 calcPnlWithNet 一致
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeHoldingMetrics,
  getHoldingUnrealizedPnl,
  getHoldingReturnPct,
  getPortfolioPnl,
} from '../holdings.js'
import { calcPnlWithNet } from '../holdingMath.ts'

const BASE = { code: '2330', name: '台積電', qty: 100, cost: 900 }

describe('normalizeHoldingMetrics — todayPnl / todayPct', () => {
  it('市場已收盤：quote 帶 price + yesterday 時，todayPnl / todayPct 由昨收換算', () => {
    const n = normalizeHoldingMetrics(BASE, {
      price: 1050,
      yesterday: 1030,
      source: 'yclose',
    })
    expect(n.price).toBe(1050)
    expect(n.yesterday).toBe(1030)
    expect(n.todayPnl).toBe(2000) // (1050-1030)*100
    expect(n.todayPct).toBeCloseTo(1.94, 1)
    expect(n.changePct).toBe(n.todayPct) // BC alias
  })

  it('市場盤中：quote 只帶 price（未帶 yesterday）→ todayPnl / todayPct = null，不 fallback 到總損益', () => {
    const n = normalizeHoldingMetrics(BASE, { price: 1050, source: 'live' })
    expect(n.pnl).toBe(15000) // 總損益仍算
    expect(n.todayPnl).toBeNull()
    expect(n.todayPct).toBeNull()
  })

  it('overrideQuote 用純數字（BC）時，todayPnl 為 null（無昨收資訊）', () => {
    const n = normalizeHoldingMetrics(BASE, 1050)
    expect(n.price).toBe(1050)
    expect(n.todayPnl).toBeNull()
    expect(n.todayPct).toBeNull()
  })

  it('overrideQuote 變更 → 所有 today 欄位重算，禁止 stale', () => {
    const first = normalizeHoldingMetrics(BASE, { price: 1050, yesterday: 1030 })
    expect(first.todayPnl).toBe(2000)

    // 換一個 quote：新收盤 1000、新昨收 1030 → today 為 -3000
    const second = normalizeHoldingMetrics(first, { price: 1000, yesterday: 1030 })
    expect(second.price).toBe(1000)
    expect(second.yesterday).toBe(1030)
    expect(second.todayPnl).toBe(-3000)
    expect(second.todayPct).toBeCloseTo(-2.91, 1)

    // 換成盤中 quote（無 yesterday）→ 沿用先前收盤 1030 作為昨收，但 today 必須用新價重算，
    // 絕不能沿用 second.todayPnl (-3000) 這種 stale 值。
    const third = normalizeHoldingMetrics(second, { price: 1010, source: 'live' })
    expect(third.yesterday).toBe(1030)
    expect(third.todayPnl).toBe(-2000) // (1010-1030)*100，非 -3000（stale）
    expect(third.todayPct).toBeCloseTo(-1.94, 1)
  })

  it('quote 帶 changePct 但無 yesterday → todayPct 取自 quote.changePct，todayPnl 仍為 null', () => {
    const n = normalizeHoldingMetrics(BASE, { price: 1050, changePct: 1.5 })
    expect(n.todayPct).toBe(1.5)
    expect(n.todayPnl).toBeNull()
  })
})

describe('Total P&L — 精確模式 vs Fallback 一致性', () => {
  it('fallback：pnl = (price - cost) * qty', () => {
    const item = { ...BASE }
    const n = normalizeHoldingMetrics(item, { price: 1050, yesterday: 1030 })
    const expected = calcPnlWithNet({ qty: 100, cost: 900 }, 1050)
    expect(n.pnl).toBe(expected.pnl)
    expect(n.pct).toBeCloseTo(expected.pct, 2)
    expect(getHoldingUnrealizedPnl(item, { price: 1050 })).toBe(expected.pnl)
  })

  it('精確模式（totalCost + fee）：走 calcNetSettlement', () => {
    const item = { code: '2330', qty: 100, cost: 900, totalCost: 90000, fee: 128 }
    const n = normalizeHoldingMetrics(item, { price: 1050, yesterday: 1030 })
    const expected = calcPnlWithNet(
      { qty: 100, cost: 900, totalCost: 90000, fee: 128, code: '2330' },
      1050,
    )
    expect(n.pnl).toBe(expected.pnl)
    expect(n.pct).toBeCloseTo(expected.pct, 2)
    // 有 totalCost 時應該走精確模式，pnl 不等於單純 (1050-900)*100=15000
    expect(n.pnl).not.toBe(15000)
    expect(getHoldingReturnPct(item, { price: 1050 })).toBeCloseTo(expected.pct, 2)
  })

  it('組合 total P&L = 各筆之和', () => {
    const holdings = [
      { code: '2330', qty: 100, cost: 900, price: 1050 },
      { code: '2317', qty: 500, cost: 120, price: 115 }, // 虧
    ]
    const total = getPortfolioPnl(holdings)
    const sum = holdings.reduce((a, h) => a + getHoldingUnrealizedPnl(h), 0)
    expect(total).toBe(sum)
    expect(total).toBe(15000 + -2500)
  })
})

describe('overridePrice safeguard — 換價後絕不能留 stale', () => {
  it('連續呼叫 normalizeHoldingMetrics，pnl/value/todayPnl 每次都以新 quote 為準', () => {
    const item = { ...BASE }
    const snapshots = [
      { price: 1000, yesterday: 990 },
      { price: 1020, yesterday: 1010 },
      { price: 970, yesterday: 1010 },
    ]
    const results = snapshots.map((q) => normalizeHoldingMetrics(item, q))
    expect(results[0].todayPnl).toBe(1000)   // (1000-990)*100
    expect(results[1].todayPnl).toBe(1000)   // (1020-1010)*100
    expect(results[2].todayPnl).toBe(-4000)  // (970-1010)*100
    // value 也重算
    expect(results[0].value).toBe(100000)
    expect(results[1].value).toBe(102000)
    expect(results[2].value).toBe(97000)
  })
})
