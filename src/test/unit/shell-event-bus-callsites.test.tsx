/**
 * 跨模組事件「實際呼叫端」守衛。
 *
 * 只有 emit helper 沒有呼叫端 = 事件在真實路徑永遠不會被觸發。
 * 這支測試在真實元件（DailyReportPanel / EventsPanel / HoldingsTable）上點擊，
 * 斷言 bus 收到正確事件與 source。
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShellEventBusProvider } from '@/checkup/shell/ShellEventBusProvider'
import { createShellEventBus } from '@/checkup/shell/eventBus'
import { HoldingsChanges } from '@/checkup/components/reports/DailyReportPanel.jsx'
import { EventCard } from '@/checkup/components/events/EventsPanel.jsx'

function renderWithBus(node: React.ReactElement) {
  const bus = createShellEventBus()
  const holdingsFocus = vi.fn()
  const researchPrefill = vi.fn()
  bus.on('holdings:focus', holdingsFocus)
  bus.on('research:prefill', researchPrefill)
  render(React.createElement(ShellEventBusProvider, { bus, children: node }))
  return { bus, holdingsFocus, researchPrefill }
}

const changes = [
  { code: '2330', name: '台積電', price: 1000, changePct: 1.2, todayPnl: 3000, type: '股票' },
]

describe('M2 Closing 呼叫端 — DailyReportPanel.HoldingsChanges', () => {
  it('點「→ 持倉」emit holdings:focus，source=closing', () => {
    const { holdingsFocus } = renderWithBus(
      React.createElement(HoldingsChanges, { changes }),
    )
    fireEvent.click(screen.getByTestId('closing-focus-holding-2330'))
    expect(holdingsFocus).toHaveBeenCalledWith({ stockCode: '2330', source: 'closing' })
  })

  it('點「→ 研究」emit research:prefill，source=closing 並帶主題', () => {
    const { researchPrefill } = renderWithBus(
      React.createElement(HoldingsChanges, { changes }),
    )
    fireEvent.click(screen.getByTestId('closing-research-2330'))
    expect(researchPrefill).toHaveBeenCalledWith({
      stockCode: '2330',
      topic: '收盤分析',
      source: 'closing',
    })
  })
})

describe('M3 Events 呼叫端 — EventsPanel.EventCard', () => {
  const event = {
    code: '2454',
    type: 'earnings',
    date: '2026-08-01',
    title: '法說會',
    impact: 'high',
  }

  it('點「→ 持倉」emit holdings:focus，source=events', () => {
    const { holdingsFocus } = renderWithBus(
      React.createElement(EventCard, { event, isPredicting: false }),
    )
    fireEvent.click(screen.getByTestId('events-focus-holding-2454'))
    expect(holdingsFocus).toHaveBeenCalledWith({ stockCode: '2454', source: 'events' })
  })

  it('沒有股票代號時不渲染跳持倉按鈕', () => {
    renderWithBus(
      React.createElement(EventCard, {
        event: { ...event, code: null, relatedCodes: [] },
        isPredicting: false,
      }),
    )
    expect(screen.queryByTestId(/events-focus-holding-/)).toBeNull()
  })
})
