import { describe, it, expect, beforeEach } from 'vitest'
import {
  coerceStocksString,
  coerceStocksArray,
  coerceHoldingsList,
  applyCoercion,
} from '@/checkup/lib/edgeCoerce'
import { resetCoercePrefs, setCoercePrefs } from '@/checkup/lib/edgeCoercePrefs'

beforeEach(() => {
  // 確保每個測試都從預設偏好開始
  resetCoercePrefs()
})

describe('coerceStocksString — 邊界案例', () => {
  it('空白與只有空字串應回傳空字串、無重複', () => {
    const r = coerceStocksString('   ,  , 、 ')
    expect(r.value).toBe('')
    expect(r.removedDuplicates).toBe(0)
    expect(r.duplicates).toEqual([])
  })

  it('null / undefined / 數字維持原值且不變動', () => {
    expect(coerceStocksString(null).changed).toBe(false)
    expect(coerceStocksString(undefined).changed).toBe(false)
    expect(coerceStocksString(123 as any).changed).toBe(false)
  })

  it('多種分隔符（、, ; \n |）一視同仁', () => {
    const r = coerceStocksString('2330 台積電,2317 鴻海;3443 創意\n2454 聯發科|2330 台積電')
    expect(r.value).toBe('2330 台積電、2317 鴻海、3443 創意、2454 聯發科')
    expect(r.removedDuplicates).toBe(1)
    expect(r.duplicates).toEqual([{ item: '2330 台積電', count: 2 }])
  })

  it('陣列輸入會被轉成頓號字串', () => {
    const r = coerceStocksString(['2330 台積電', ' 2317 鴻海 ', '2330 台積電'])
    expect(r.value).toBe('2330 台積電、2317 鴻海')
    expect(r.removedDuplicates).toBe(1)
  })

  it('混合 trim 與多空白會壓縮', () => {
    const r = coerceStocksString('  2330   台積電  、 2330 台積電 ')
    expect(r.value).toBe('2330 台積電')
    expect(r.removedDuplicates).toBe(1)
  })
})

describe('coerceStocksArray — 邊界案例', () => {
  it('字串輸入轉陣列並去重', () => {
    const r = coerceStocksArray('2330,2317,2330,2454')
    expect(r.value).toEqual(['2330', '2317', '2454'])
    expect(r.removedDuplicates).toBe(1)
  })

  it('已是乾淨陣列時 changed=false', () => {
    const r = coerceStocksArray(['2330', '2317'])
    expect(r.changed).toBe(false)
    expect(r.value).toEqual(['2330', '2317'])
  })

  it('陣列含多筆重複時，重複明細會列出每個 key 與正確次數', () => {
    const r = coerceStocksArray(['2330', '2330', '2330', '2317', '2317'])
    expect(r.value).toEqual(['2330', '2317'])
    expect(r.removedDuplicates).toBe(3)
    const sorted = r.duplicates.sort((a, b) => b.count - a.count)
    expect(sorted).toEqual([
      { item: '2330', count: 3 },
      { item: '2317', count: 2 },
    ])
  })
})

describe('coerceHoldingsList — 重用 stocksString 引擎', () => {
  it('多行貼上的持倉文字會被攤平 + 去重', () => {
    const input = [
      '2330 台積電 100 股 600',
      '2317 鴻海 200 股 100',
      '2330 台積電 100 股 600',
    ].join('\n')
    const r = coerceHoldingsList(input)
    expect(r.value).toBe('2330 台積電 100 股 600、2317 鴻海 200 股 100')
    expect(r.removedDuplicates).toBe(1)
  })
})

describe('去重策略切換', () => {
  it('keepFirst（預設）會保留第一個出現的字串', () => {
    const r = coerceStocksString(['A台積電', 'A 台積電', '  A台積電 '])
    // keepFirst 且預設不忽略空白：上面三筆會被視為三個不同字串（因空白不同）
    expect(r.value).toBe('A台積電、A 台積電')
    expect(r.removedDuplicates).toBe(1)
  })

  it('keepLast 會以最後一次出現的順序保留', () => {
    setCoercePrefs({ strategy: 'keepLast' })
    const r = coerceStocksArray(['2330', '2317', '2330', '2454'])
    expect(r.value).toEqual(['2317', '2330', '2454'])
    expect(r.removedDuplicates).toBe(1)
  })

  it('ignoreWhitespace 開啟時，空白差異視為同一筆', () => {
    setCoercePrefs({ ignoreWhitespace: true })
    const r = coerceStocksString('2330 台積電、2330台積電、 2330  台積電 ')
    expect(r.value).toBe('2330 台積電')
    expect(r.removedDuplicates).toBe(2)
  })

  it('normalizeWidth 開啟時，全形/半形視為同一筆', () => {
    setCoercePrefs({ normalizeWidth: true })
    const r = coerceStocksString('2330 台積電,２３３０ 台積電')
    // 第二筆的 ２３３０ 會被轉成 2330，與第一筆視為同一筆
    expect(r.removedDuplicates).toBe(1)
    expect(r.value.split('、')[0]).toBe('2330 台積電')
  })

  it('per-call prefs 會覆蓋全域偏好', () => {
    // 全域維持 keepFirst，但這次呼叫指定 keepLast
    const r = coerceStocksArray(['2330', '2317', '2330'], { strategy: 'keepLast' })
    expect(r.value).toEqual(['2317', '2330'])
  })
})

describe('applyCoercion — 多欄位合併修正', () => {
  it('同時修正多個欄位，回傳 fixes 含 label/before/after', () => {
    const fields = {
      stocks: { coerce: 'stocksString', label: '股票' },
      codes: { coerce: 'stocksArray', label: '代碼' },
    } as const
    const src = {
      stocks: '2330,2330,2317',
      codes: ['2330', '2330'],
      other: 'untouched',
    }
    const { source, fixes } = applyCoercion(fields as any, src)
    expect(source).not.toBe(src) // 不變動原物件
    expect(source.stocks).toBe('2330、2317')
    expect(source.codes).toEqual(['2330'])
    expect(source.other).toBe('untouched')
    expect(fixes).toHaveLength(2)
    expect(fixes.map((f) => f.key).sort()).toEqual(['codes', 'stocks'])
    expect(fixes.find((f) => f.key === 'stocks')!.removedDuplicates).toBe(1)
    expect(fixes.find((f) => f.key === 'codes')!.removedDuplicates).toBe(1)
  })

  it('沒有變動的欄位不會出現在 fixes', () => {
    const fields = { stocks: { coerce: 'stocksString', label: '股票' } } as const
    const { fixes } = applyCoercion(fields as any, { stocks: '2330、2317' })
    expect(fixes).toHaveLength(0)
  })

  it('source 為 null 時安全回傳', () => {
    const r = applyCoercion({ x: { coerce: 'stocksString' } } as any, null as any)
    expect(r.fixes).toEqual([])
  })
})
