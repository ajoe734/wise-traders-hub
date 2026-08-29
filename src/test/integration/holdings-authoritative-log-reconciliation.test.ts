import { describe, expect, it } from 'vitest'
import { applyMarketQuotesToHoldings } from '@/checkup/lib/holdings.js'
import { reconcileHoldingsWithTradeLog } from '@/checkup/lib/tradeLogOps.js'

const CODES = [
  '2330', '2317', '2454', '2382', '2412', '2881', '2882', '2891', '3008', '3034',
  '3711', '2303', '1301', '1303', '1326', '2002', '2207', '2603', '2609', '2615',
  '2884', '2885', '2886', '2887', '2890', '5871', '6505', '6669', '9910', '00637L',
  '2308',
]

const logs31 = CODES.map((code, index) => ({
  id: `trade-${code}`,
  date: '2026/08/01',
  time: '10:00',
  action: '買進',
  code,
  name: code === '2308' ? '台達電' : `名稱${index}`,
  qty: 1000,
  price: 100 + index,
}))

const cloudHoldings30 = CODES.slice(0, 30).map((code, index) => ({
  code,
  name: `名稱${index}`,
  qty: 1000,
  cost: 100 + index,
  price: 150 + index,
  yesterday: 149 + index,
  priceSource: 'close',
  priceUpdatedAt: '2026-08-29T05:30:00.000Z',
  priceTradeDate: '2026-08-28',
  priceState: 'confirmed',
  sector: '既有產業',
  type: '股票',
}))

describe('authoritative trade log reconciliation', () => {
  it('cloud holdings 30 / logs 31 時補回交易部位，保留既有 enrichment 且新部位待同步', () => {
    const repaired = reconcileHoldingsWithTradeLog(cloudHoldings30, logs31)

    expect(repaired).toHaveLength(31)
    expect(new Set(repaired.map((row) => row.code)).size).toBe(31)
    const preserved = repaired.find((row) => row.code === '2330')
    expect(preserved).toMatchObject({
      qty: 1000,
      cost: 100,
      price: 150,
      priceSource: 'close',
      priceTradeDate: '2026-08-28',
      sector: '既有產業',
    })
    const restored = repaired.find((row) => row.code === '2308')
    expect(restored).toMatchObject({
      code: '2308',
      name: '台達電',
      qty: 1000,
      cost: 130,
      price: 130,
      priceSource: null,
      userOrigin: true,
      tradeLogTouched: true,
    })
  })

  it.each([
    ['第二批成功', { price: 999, source: 'close', updatedAt: '2026-08-29T06:00:00.000Z' }],
    ['第二批延遲', undefined],
    ['第二批失敗', undefined],
    ['第二批空回覆', undefined],
  ])('%s 時 [30,1] refresh 不得丟失第 31 檔 identity', (_caseName, lastQuote) => {
    const hydrated = reconcileHoldingsWithTradeLog(cloudHoldings30, logs31)
    const firstBatchQuotes = Object.fromEntries(
      CODES.slice(0, 30).map((code, index) => [code, {
        price: 200 + index,
        source: 'close',
        updatedAt: '2026-08-29T06:00:00.000Z',
      }]),
    )

    const afterFirst = applyMarketQuotesToHoldings(hydrated, firstBatchQuotes)
    const secondBatchQuotes = lastQuote ? { '2308': lastQuote } : {}
    const afterSecond = applyMarketQuotesToHoldings(afterFirst, secondBatchQuotes)

    expect(afterFirst).toHaveLength(31)
    expect(afterSecond).toHaveLength(31)
    expect(new Set(afterSecond.map((row) => row.code))).toEqual(new Set(CODES))
    const boundary = afterSecond.find((row) => row.code === '2308')
    expect(boundary?.qty).toBe(1000)
    expect(boundary?.cost).toBe(130)
    if (lastQuote) {
      expect(boundary?.price).toBe(999)
      expect(boundary?.priceSource).toBe('close')
    } else {
      expect(boundary?.price).toBe(130)
      expect(boundary?.priceSource).toBeNull()
    }
  })

  it('reconciliation 不得創造重複交易或改變同代碼 replay 後的 qty/cost', () => {
    const duplicateCodeLogs = [
      ...logs31,
      { ...logs31[0], id: 'trade-2330-second', qty: 500, price: 200 },
    ]
    const repaired = reconcileHoldingsWithTradeLog(cloudHoldings30, duplicateCodeLogs)
    const tsmcRows = repaired.filter((row) => row.code === '2330')
    expect(tsmcRows).toHaveLength(1)
    expect(tsmcRows[0].qty).toBe(1500)
    expect(tsmcRows[0].cost).toBeCloseTo(133.33, 2)
  })
})