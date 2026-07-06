import { describe, it, expect } from 'vitest'
// @ts-ignore - js module
import { holdingsInSector } from '@/checkup/lib/holdingUtils'

const meta: any = {
  '2454': { name: '聯發科', industry: 'IC設計', themes: ['AI伺服器'], strategy: '成長股' },
  '3037': { name: '欣興', industries: ['PCB/材料', '光通訊'], strategy: '景氣循環' },
  '6446': {
    name: '藥華藥',
    industries: ['生技'],
    revenueMix: [
      { industry: '生技', pct: 70 },
      { industry: 'CDMO', pct: 30 },
    ],
    themes: ['資料中心'],
    strategy: '成長股',
  },
  '2330': { name: '台積電', industry: '半導體設備' },
}

const holdings = [
  { code: '2454', value: 1000, pnlPct: 12.3 },
  { code: '3037', value: 500 },
  { code: '6446', value: 1000, pnlPct: -3.4 },
  { code: '2330', value: 500 },
]

describe('holdingsInSector', () => {
  it('依 revenueMix 拆分權重', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'industry', key: 'CDMO' })
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('6446')
    expect(rows[0].weight).toBeCloseTo(0.3)
    expect(rows[0].contribValue).toBeCloseTo(300)
    expect(rows[0].isMulti).toBe(true)
    expect(rows[0].pctOfSector).toBeCloseTo(100)
  })

  it('industries 平均拆（無 mix）', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'industry', key: '光通訊' })
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('3037')
    expect(rows[0].weight).toBeCloseTo(0.5)
  })

  it('題材命中權重=1', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'theme', key: 'AI伺服器' })
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('2454')
    expect(rows[0].weight).toBe(1)
    expect(rows[0].pctOfSector).toBeCloseTo(100)
  })

  it('策略命中', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'strategy', key: '成長股' })
    expect(rows.map((r) => r.code).sort()).toEqual(['2454', '6446'])
    // 依 contribValue 排序，兩者皆 = 1000 x 1，先出現的排前
    expect(rows[0].contribValue).toBe(1000)
  })

  it('未命中回空', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'industry', key: '不存在' })
    expect(rows).toEqual([])
  })

  it('未分類策略回收 fallback', () => {
    const rows = holdingsInSector(holdings, meta, {}, { kind: 'strategy', key: '未分類' })
    expect(rows.map((r) => r.code)).toContain('2330')
  })

  it('sel 缺少參數回空', () => {
    expect(holdingsInSector(holdings, meta, {}, null as any)).toEqual([])
    expect(holdingsInSector(holdings, meta, {}, { kind: 'industry' } as any)).toEqual([])
  })
})
