import { describe, it, expect } from 'vitest'
import { replayTradeLog, recomputeHoldingsAfterDelete } from '../tradeLogOps.js'

const trades = [
  // newer → older 順序（畫面順）
  { id: 't3', date: '2024/03/10', time: '10:00', code: '2330', name: '台積電', action: '賣出', qty: 1000, price: 700 },
  { id: 't2', date: '2024/02/10', time: '10:00', code: '2330', name: '台積電', action: '買進', qty: 1000, price: 600 },
  { id: 't1', date: '2024/01/10', time: '10:00', code: '2330', name: '台積電', action: '買進', qty: 1000, price: 500 },
]

describe('replayTradeLog', () => {
  it('買 1000+1000 後賣 1000 → 殘 1000 股，均價 550', () => {
    const out = replayTradeLog(trades)
    const h = out.find((r) => r.code === '2330')
    expect(h.qty).toBe(1000)
    expect(Math.round(h.cost)).toBe(550)
  })

  it('刪掉中間賣出 → 應該得回兩筆買的加權均價', () => {
    const out = recomputeHoldingsAfterDelete(trades, 't3')
    const h = out.find((r) => r.code === '2330')
    expect(h).toBeTruthy()
    expect(h.qty).toBe(2000)
    // (500+600)/2 = 550
    expect(Math.round(h.cost)).toBe(550)
  })

  it('刪掉首筆買進 → 剩下買進+賣出，殘量為 0', () => {
    const out = recomputeHoldingsAfterDelete(trades, 't1')
    expect(out.find((h) => h.code === '2330')).toBeUndefined()
  })

  it('replay 與正向套用結果一致（順序不依賴輸入順）', () => {
    const reversed = [...trades].reverse()
    const a = replayTradeLog(trades)
    const b = replayTradeLog(reversed)
    expect(a).toEqual(b)
  })
})
