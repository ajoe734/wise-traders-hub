/**
 * 刪除單筆成交後 replay 不得丟失行情／enrichment（Hosted blocker 2026-08-29）。
 *
 * 現場：31 檔皆已更新現價（priceSource=close / pending_close、priceUpdatedAt、yesterday…），
 * 手動新增 1101 後共 32 檔 / 32 筆 log；只刪掉 1101 這一筆後，
 * `recomputeHoldingsAfterDelete` 從空 rows replay，price 只剩成交價 → 全部現價=成本、
 * 損益 0、priceSource null（畫面顯示「未同步 31」）。
 *
 * 契約：交易權威欄位（qty / cost / totalCost / fee）以 replay 為準，
 * 其餘非交易衍生欄位（price / priceSource / priceUpdatedAt / yesterday / change /
 * changePct / targetPrice / alert / sector…）沿用刪除前同代碼的持倉；已刪代碼不得殘留。
 */
import { describe, it, expect } from 'vitest'
import { recomputeHoldingsAfterDelete, replayTradeLog } from '@/checkup/lib/tradeLogOps.js'

const CODES = [
  '2330', '2317', '2454', '2308', '2382', '2412', '2881', '2882', '2891', '3008',
  '3034', '3711', '2303', '1301', '1303', '1326', '2002', '2207', '2603', '2609',
  '2615', '2884', '2885', '2886', '2887', '2890', '5871', '6505', '6669', '9910',
  '00637L',
]

function buildPriorHoldings() {
  return CODES.map((code, i) => ({
    code,
    name: `名稱${i}`,
    qty: 1000,
    cost: 100 + i,
    price: 150 + i,
    yesterday: 148 + i,
    change: 2,
    changePct: 1.35,
    priceSource: i === 0 ? 'pending_close' : 'close',
    priceUpdatedAt: '2026-08-29T05:30:00.000Z',
    targetPrice: 200 + i,
    alert: i === 3 ? '跌破月線' : '',
    sector: '半導體',
    type: '股票',
  }))
}

function buildTradeLog() {
  const base = CODES.map((code, i) => ({
    id: `t-${code}`,
    date: '2026/08/01',
    time: '10:00',
    code,
    name: `名稱${i}`,
    action: '買進',
    qty: 1000,
    price: 100 + i,
  }))
  // 最新一筆：手動輸入的 1101
  return [
    { id: 't-1101', date: '2026/08/29', time: '13:20', code: '1101', name: '台泥手動驗證', action: '買進', qty: 1, price: 100 },
    ...base.slice().reverse(),
  ]
}

describe('刪除單筆成交後的 replay', () => {
  const prior = buildPriorHoldings()
  const log32 = buildTradeLog()
  const priorPlus1101 = [
    ...prior,
    { code: '1101', name: '台泥手動驗證', qty: 1, cost: 100, price: 100, priceSource: 'manual', type: '股票' },
  ]

  it('交易權威欄位依剩餘 31 筆交易正確 replay，1101 移除', () => {
    const next = recomputeHoldingsAfterDelete(log32, 't-1101', null, priorPlus1101)
    expect(next).toHaveLength(31)
    expect(next.find((h) => h.code === '1101')).toBeUndefined()
    CODES.forEach((code, i) => {
      const row = next.find((h) => h.code === code)
      expect(row, code).toBeTruthy()
      expect(row.qty).toBe(1000)
      expect(row.cost).toBe(100 + i)
    })
  })

  it('倖存持倉必須保留刪除前的行情／enrichment，不得被重設為成本', () => {
    const next = recomputeHoldingsAfterDelete(log32, 't-1101', null, priorPlus1101)
    CODES.forEach((code, i) => {
      const row = next.find((h) => h.code === code)
      expect(row.price, `${code} price`).toBe(150 + i)
      expect(row.priceSource, `${code} priceSource`).toBe(i === 0 ? 'pending_close' : 'close')
      expect(row.priceUpdatedAt).toBe('2026-08-29T05:30:00.000Z')
      expect(row.yesterday).toBe(148 + i)
      expect(row.targetPrice).toBe(200 + i)
      expect(row.sector).toBe('半導體')
      expect(row.userOrigin).toBe(true)
      expect(row.tradeLogTouched).toBe(true)
      // 損益不得為 0
      expect(row.pnl, `${code} pnl`).toBeGreaterThan(0)
    })
    expect(next.find((h) => h.code === '2308').alert).toBe('跌破月線')
  })

  it('沒有 prior 時行為與舊版一致（純 replay）', () => {
    const next = recomputeHoldingsAfterDelete(log32, 't-1101')
    expect(next).toHaveLength(31)
    expect(next.find((h) => h.code === '2330').price).toBe(100)
  })

  it('編輯成交後的 replay 也保留行情，且 prior 中已不存在的代碼不會殘留', () => {
    const edited = log32
      .filter((r) => r.id !== 't-1101')
      .map((r) => (r.id === 't-2330' ? { ...r, qty: 2000 } : r))
    const next = replayTradeLog(edited, null, priorPlus1101)
    expect(next).toHaveLength(31)
    expect(next.find((h) => h.code === '1101')).toBeUndefined()
    const tsmc = next.find((h) => h.code === '2330')
    expect(tsmc.qty).toBe(2000)
    expect(tsmc.cost).toBe(100)
    expect(tsmc.price).toBe(150)
    expect(tsmc.priceSource).toBe('pending_close')
  })

  it('prior 代碼大小寫／空白不一致時仍以 normalized code 合併', () => {
    const messy = priorPlus1101.map((h) => (h.code === '00637L' ? { ...h, code: ' 00637l ' } : h))
    const next = recomputeHoldingsAfterDelete(log32, 't-1101', null, messy)
    const etf = next.find((h) => h.code === '00637L')
    expect(etf.priceSource).toBe('close')
    expect(etf.price).toBe(150 + CODES.indexOf('00637L'))
  })
})
