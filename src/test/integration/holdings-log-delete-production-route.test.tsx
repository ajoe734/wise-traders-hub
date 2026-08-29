import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LogTab from '@/checkup/components/freecheckup/LogTab'

const trade = {
  id: 'qa-trade-1',
  action: '買進',
  code: '2330',
  name: '台積電',
  qty: 100,
  price: 1000,
  date: '2026/8/29',
  time: '19:55',
  qa: [],
}

const colors = {
  text: '#292520',
  textSec: '#514c46',
  textMute: '#817b73',
}

describe('Hosted /holding-checkup 記錄頁 mutation contract', () => {
  it('正常帳號有 tradeLog 與 setters 時顯示編輯與刪除，刪除沿用既有重算流程', () => {
    const setTradeLog = vi.fn()
    const setHoldings = vi.fn()

    render(
      <LogTab
        isDemo={false}
        tradeLog={[trade]}
        C={colors}
        alpha={(color: string) => color}
        card={{}}
        navigate={vi.fn()}
        startLineLogin={vi.fn()}
        setTradeLog={setTradeLog}
        setHoldings={setHoldings}
        flashSaved={vi.fn()}
      />
    )

    expect(screen.getByLabelText('編輯這筆')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('刪除這筆'))
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(setTradeLog).toHaveBeenCalledWith([])
    expect(setHoldings).toHaveBeenCalledWith([])
  })
})