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

// ---- 靜態守衛：每個 emit helper 都必須有真實元件呼叫端 ----------------------
import fs from 'node:fs'
import path from 'node:path'

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(t|j)sx?$/.test(e.name)) out.push(p)
  }
  return out
}

describe('emit helper 不得成為孤兒（無呼叫端）', () => {
  const modulesDir = path.resolve(process.cwd(), 'src/checkup/modules')
  const componentFiles = walk(path.resolve(process.cwd(), 'src/checkup/components'))
  const sources = componentFiles.map((f) => fs.readFileSync(f, 'utf8'))

  const helpers = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .flatMap((m) =>
      fs
        .readdirSync(path.join(modulesDir, m))
        .filter((f) => /^useEmit.*\.tsx?$/.test(f))
        .map((f) => ({ module: m, name: f.replace(/\.tsx?$/, '') })),
    )

  it.each(helpers)('$module/$name 至少被一個 checkup 元件呼叫', ({ module, name }) => {
    const used = sources.some((s) => s.includes(`modules/${module}/${name}`) && s.includes(`${name}()`))
    expect(used, `${module}/${name} 沒有任何元件呼叫端`).toBe(true)
  })
})
