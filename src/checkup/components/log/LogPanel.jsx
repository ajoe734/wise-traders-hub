import { createElement as h, useState } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button, TextFieldDialog } from '../common'
import {
  recomputeHoldingsAfterDelete,
  replayTradeLog,
  tradeLogToCSV,
  downloadCSV,
  summarizeDay,
} from '../../lib/tradeLogOps.js'
import { useLogPanelFilters } from '../../hooks/useLogPanelFilters.js'
import { useDialogEscape } from '../../hooks/useDialogEscape.js'

/**
 * Log Panel — 含搜尋／買賣篩選／日期區間／CSV 匯出／逐筆編輯備忘／刪除（並回滾持倉）
 *
 * 單色橘憲法：買賣以箭頭+字重區分，禁紅綠對撞。
 */
export function LogPanel({ tradeLog = [], setTradeLog, setHoldings, flashSaved }) {
  const {
    q, setQ,
    actionFilter, setActionFilter,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    filtered, grouped, totals,
  } = useLogPanelFilters(tradeLog)
  const [editing, setEditing] = useState(null) // memo: { id, qIndex, value }
  const [editingRow, setEditingRow] = useState(null) // row: { id, action, qty, price, date }
  const [confirmDelete, setConfirmDelete] = useState(null) // log

  const canMutate = typeof setTradeLog === 'function'

  useDialogEscape(Boolean(editingRow), () => setEditingRow(null))
  useDialogEscape(Boolean(confirmDelete), () => setConfirmDelete(null))

  const handleExport = () => {
    if (!filtered.length) {
      flashSaved?.('沒有可匯出的紀錄', 2500)
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    downloadCSV(`trade-log-${today}.csv`, tradeLogToCSV(filtered))
    flashSaved?.(`✅ 已匯出 ${filtered.length} 筆 CSV`, 2500)
  }

  const handleDelete = (log) => {
    if (!canMutate) return
    const nextLog = (Array.isArray(tradeLog) ? tradeLog : []).filter((r) => r.id !== log.id)
    setTradeLog(nextLog)
    if (typeof setHoldings === 'function') {
      // Replay from empty 起點重算，比反向回滾更穩（均價、全賣後再買、跨筆都對）
      setHoldings((prev) => recomputeHoldingsAfterDelete(tradeLog, log.id, null, prev))
    }
    flashSaved?.(`↺ 已刪除並用所有交易紀錄重新計算持倉`, 2800)
    setConfirmDelete(null)
  }

  const submitEdit = () => {
    if (!editing || !canMutate) return
    const { id, qIndex, value } = editing
    setTradeLog((prev) =>
      (Array.isArray(prev) ? prev : []).map((r) => {
        if (r.id !== id) return r
        const qa = Array.isArray(r.qa) ? [...r.qa] : []
        if (qa[qIndex]) qa[qIndex] = { ...qa[qIndex], a: value }
        return { ...r, qa }
      })
    )
    flashSaved?.('✅ 備忘已更新', 2000)
    setEditing(null)
  }

  const submitRowEdit = () => {
    if (!editingRow || !canMutate) return
    const qty = Number(editingRow.qty)
    const price = Number(editingRow.price)
    if (!Number.isFinite(qty) || qty <= 0) {
      flashSaved?.('❌ 股數需為正數', 2500)
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      flashSaved?.('❌ 價格需為正數', 2500)
      return
    }
    const date = String(editingRow.date || '').trim()
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(date)) {
      flashSaved?.('❌ 日期格式需為 YYYY/MM/DD', 2800)
      return
    }
    const action = editingRow.action === '賣出' ? '賣出' : '買進'
    const nextLog = (Array.isArray(tradeLog) ? tradeLog : []).map((r) =>
      r.id === editingRow.id ? { ...r, action, qty, price, date } : r
    )
    setTradeLog(nextLog)
    if (typeof setHoldings === 'function') {
      setHoldings((prev) => replayTradeLog(nextLog, null, prev))
    }
    flashSaved?.('✅ 已更新並重新計算持倉', 2800)
    setEditingRow(null)
  }

  if (!tradeLog.length) {
    return h(
      'div',
      null,
      null,
      h(
        Card,
        { style: { textAlign: 'center', padding: '24px 14px' } },
        h('div', { style: { fontSize: 20, marginBottom: 6, opacity: 0.3 } }, '◌'),
        h(
          'div',
          { style: { fontSize: 12, color: C.textMute, fontWeight: 400 } },
          '還沒有交易記錄',
          h('br'),
          h('span', { style: { fontSize: 10 } }, '上傳成交截圖後自動記錄在這裡')
        )
      )
    )
  }

  const inputStyle = {
    fontSize: 11,
    padding: '6px 8px',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    minWidth: 0,
  }


  return h(
    'div',
    null,
    null,
    // ── Summary card ──
    h(
      Card,
      { style: { marginBottom: 10, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
      h('div', null,
        h('div', { style: { fontSize: 10, color: C.textMute, marginBottom: 2 } }, '紀錄總覽'),
        h('div', { style: { fontSize: 13, color: C.text, fontWeight: 600 } },
          `${filtered.length} 筆 · ${totals.buy} 買 / ${totals.sell} 賣`)
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div', { style: { fontSize: 10, color: C.textMute, marginBottom: 2 } },
          totals.net >= 0 ? '淨流出（賣出多）' : '淨流入（買入多）'),
        h('div', { style: { fontSize: 13, color: C.text, fontWeight: 600 } },
          `${totals.net >= 0 ? '+' : ''}${Math.round(totals.net).toLocaleString()} 元`)
      )
    ),
    // ── Toolbar ──
    h(
      Card,
      { style: { marginBottom: 10, padding: '10px 12px' } },
      h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
        h('input', {
          type: 'search',
          placeholder: '搜尋代碼／名稱',
          value: q,
          onChange: (e) => setQ(e.target.value),
          style: { ...inputStyle, flex: '1 1 140px' },
        }),
        ['all', 'buy', 'sell'].map((v) =>
          h(
            'button',
            {
              key: v,
              onClick: () => setActionFilter(v),
              className: 'ui-btn',
              style: {
                ...inputStyle,
                cursor: 'pointer',
                background: actionFilter === v ? alpha(C.accent || C.text, '12') : C.card,
                fontWeight: actionFilter === v ? 600 : 400,
              },
            },
            v === 'all' ? '全部' : v === 'buy' ? '買進' : '賣出'
          )
        ),
        h('input', {
          type: 'date',
          value: dateFrom,
          onChange: (e) => setDateFrom(e.target.value),
          style: { ...inputStyle, flex: '0 0 auto' },
          'aria-label': '起始日',
        }),
        h('span', { style: { color: C.textMute, fontSize: 10 } }, '→'),
        h('input', {
          type: 'date',
          value: dateTo,
          onChange: (e) => setDateTo(e.target.value),
          style: { ...inputStyle, flex: '0 0 auto' },
          'aria-label': '結束日',
        }),
        h(Button, { onClick: handleExport, size: 'xs' }, '匯出 CSV')
      ),
      h(
        'div',
        { style: { fontSize: 10, color: C.textMute, marginTop: 6 } },
        `顯示 ${filtered.length} / ${tradeLog.length} 筆`
      )
    ),

    grouped.map(([date, rows]) => {
      const sum = summarizeDay(rows)
      return h(
        'div',
        { key: date, style: { marginBottom: 14 } },
        h(
          'div',
          {
            style: {
              position: 'sticky',
              top: 0,
              background: C.bg,
              padding: '6px 4px',
              zIndex: 1,
              fontSize: 11,
              color: C.textMute,
              borderBottom: `1px solid ${C.border}`,
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
            },
          },
          h('span', { style: { fontWeight: 600, color: C.textSec } }, date),
          h(
            'span',
            null,
            `買 ${sum.buy} · 賣 ${sum.sell} · 淨 ${sum.net >= 0 ? '+' : ''}${Math.round(sum.net).toLocaleString()}`
          )
        ),
        rows.map((log) => {
          const isBuy = log.action === '買進'
          const arrow = isBuy ? '↑' : '↓'
          return h(
            Card,
            {
              key: log.id,
              style: {
                marginBottom: 8,
                borderLeft: `2px solid ${alpha(C.accent || C.text, '40')}`,
              },
            },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
                h(
                  'span',
                  {
                    style: {
                      background: isBuy ? alpha(C.accent || C.text, '12') : 'transparent',
                      color: C.accent || C.text,
                      border: `1px solid ${alpha(C.accent || C.text, '40')}`,
                      fontSize: 9,
                      fontWeight: isBuy ? 700 : 500,
                      padding: '2px 8px',
                      borderRadius: 4,
                      letterSpacing: '0.06em',
                    },
                  },
                  `${arrow} ${isBuy ? '買' : '賣'}`
                ),
                h('span', { style: { fontSize: 14, fontWeight: 600, color: C.text } }, log.name),
                h('span', { style: { fontSize: 10, color: C.textMute } }, log.code)
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('span', { style: { fontSize: 10, color: C.textMute } }, `${log.date} ${log.time}`),
                canMutate &&
                  h(
                    'button',
                    {
                      className: 'ui-btn',
                      onClick: () =>
                        setEditingRow({
                          id: log.id,
                          action: log.action,
                          qty: log.qty,
                          price: log.price,
                          date: log.date,
                        }),
                      style: {
                        border: 'none',
                        background: 'transparent',
                        color: C.textMute,
                        cursor: 'pointer',
                        fontSize: 10,
                        padding: '0 4px',
                      },
                      'aria-label': '編輯這筆',
                      title: '修正股數 / 價格 / 日期 / 動作',
                    },
                    '編'
                  ),
                canMutate &&
                  h(
                    'button',
                    {
                      className: 'ui-btn',
                      onClick: () => setConfirmDelete(log),
                      style: {
                        border: 'none',
                        background: 'transparent',
                        color: C.textMute,
                        cursor: 'pointer',
                        fontSize: 14,
                        lineHeight: 1,
                        padding: '0 4px',
                      },
                      'aria-label': '刪除這筆',
                      title: '刪除這筆並回滾持倉',
                    },
                    '×'
                  )
              )
            ),
            h(
              'div',
              { style: { fontSize: 11, color: C.textMute, marginBottom: 10 } },
              `${log.qty}股 @ ${log.price?.toLocaleString()}元`
            ),
            (log.qa || []).map((item, i) =>
              h(
                'div',
                { key: i, style: { marginBottom: 8 } },
                h(
                  'div',
                  {
                    style: {
                      fontSize: 10,
                      color: C.textMute,
                      marginBottom: 3,
                      display: 'flex',
                      justifyContent: 'space-between',
                    },
                  },
                  h('span', null, item.q),
                  canMutate &&
                    h(
                      'button',
                      {
                        className: 'ui-btn',
                        onClick: () =>
                          setEditing({ id: log.id, qIndex: i, value: item.a || '' }),
                        style: {
                          border: 'none',
                          background: 'transparent',
                          color: C.textMute,
                          cursor: 'pointer',
                          fontSize: 10,
                          padding: 0,
                        },
                      },
                      '編輯'
                    )
                ),
                h(
                  'div',
                  {
                    style: {
                      fontSize: 11,
                      color: C.textSec,
                      background: C.subtle,
                      borderRadius: 6,
                      padding: '7px 10px',
                      lineHeight: 1.7,
                    },
                  },
                  item.a || '（未填）'
                )
              )
            )
          )
        })
      )
    }),

    // Edit memo dialog
    h(TextFieldDialog, {
      open: Boolean(editing),
      title: '編輯備忘',
      subtitle: '修正後會立即覆蓋並重新同步雲端。',
      label: '備忘內容',
      value: editing?.value || '',
      onChange: (e) =>
        setEditing((prev) => (prev ? { ...prev, value: e?.target?.value ?? '' } : prev)),
      onCancel: () => setEditing(null),
      onSubmit: submitEdit,
    }),

    // Edit row dialog (qty/price/date/action)
    editingRow &&
      h(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '修正交易紀錄',
          style: {
            position: 'fixed',
            inset: 0,
            background: alpha('#000', '40'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 55,
            padding: 16,
          },
          onClick: () => setEditingRow(null),
        },
        h(
          Card,
          {
            style: { maxWidth: 380, width: '100%', padding: 16 },
            onClick: (e) => e.stopPropagation(),
          },
          h(
            'div',
            { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } },
            '修正交易紀錄'
          ),
          h(
            'div',
            { style: { fontSize: 11, color: C.textMute, marginBottom: 12, lineHeight: 1.6 } },
            '修正後系統會用所有交易紀錄重新計算持倉（含均價）。'
          ),
          h(
            'div',
            { style: { display: 'grid', gap: 10 } },
            h(
              'div',
              { style: { display: 'grid', gap: 4 } },
              h('span', { style: { fontSize: 10, color: C.textMute } }, '動作'),
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                ['買進', '賣出'].map((a) =>
                  h(
                    'button',
                    {
                      key: a,
                      className: 'ui-btn',
                      onClick: () => setEditingRow((p) => ({ ...p, action: a })),
                      style: {
                        flex: 1,
                        padding: '7px 10px',
                        fontSize: 12,
                        borderRadius: 6,
                        border: `1px solid ${editingRow.action === a ? C.borderStrong : C.border}`,
                        background: editingRow.action === a ? alpha(C.accent || C.text, '12') : C.card,
                        color: C.text,
                        cursor: 'pointer',
                        fontWeight: editingRow.action === a ? 600 : 400,
                      },
                    },
                    a
                  )
                )
              )
            ),
            h(
              'label',
              { style: { display: 'grid', gap: 4 } },
              h('span', { style: { fontSize: 10, color: C.textMute } }, '股數'),
              h('input', {
                type: 'number',
                value: editingRow.qty,
                onChange: (e) => setEditingRow((p) => ({ ...p, qty: e.target.value })),
                style: {
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: C.subtle,
                  color: C.text,
                  fontFamily: 'inherit',
                  outline: 'none',
                },
              })
            ),
            h(
              'label',
              { style: { display: 'grid', gap: 4 } },
              h('span', { style: { fontSize: 10, color: C.textMute } }, '成交價（元）'),
              h('input', {
                type: 'number',
                step: '0.01',
                value: editingRow.price,
                onChange: (e) => setEditingRow((p) => ({ ...p, price: e.target.value })),
                style: {
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: C.subtle,
                  color: C.text,
                  fontFamily: 'inherit',
                  outline: 'none',
                },
              })
            ),
            h(
              'label',
              { style: { display: 'grid', gap: 4 } },
              h('span', { style: { fontSize: 10, color: C.textMute } }, '成交日期（YYYY/MM/DD）'),
              h('input', {
                value: editingRow.date,
                onChange: (e) => setEditingRow((p) => ({ ...p, date: e.target.value })),
                placeholder: '2026/05/03',
                style: {
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: C.subtle,
                  color: C.text,
                  fontFamily: 'inherit',
                  outline: 'none',
                },
              })
            )
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } },
            h(Button, { size: 'xs', onClick: () => setEditingRow(null) }, '取消'),
            h(
              Button,
              {
                size: 'xs',
                onClick: submitRowEdit,
                style: {
                  background: alpha(C.accent || C.text, '15'),
                  border: `1px solid ${alpha(C.accent || C.text, '60')}`,
                },
              },
              '儲存並重算'
            )
          )
        )
      ),

    // Delete confirm dialog（使用簡單原生 confirm 風格 inline 卡片）
    confirmDelete &&
      h(
        'div',
        {
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-label': '確認刪除交易',
          style: {
            position: 'fixed',
            inset: 0,
            background: alpha('#000', '40'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          },
          onClick: () => setConfirmDelete(null),
        },
        h(
          Card,
          {
            style: { maxWidth: 360, padding: 16 },
            onClick: (e) => e.stopPropagation(),
          },
          h(
            'div',
            { style: { fontSize: 14, fontWeight: 600, marginBottom: 6 } },
            '確認刪除這筆交易？'
          ),
          h(
            'div',
            { style: { fontSize: 12, color: C.textMute, marginBottom: 14, lineHeight: 1.6 } },
            `${confirmDelete.date} ${confirmDelete.action} ${confirmDelete.name || confirmDelete.code} ${confirmDelete.qty} 股 @ ${confirmDelete.price}`,
            h('br'),
            '系統會用所有剩餘交易紀錄重新計算持倉（均價也會更正）。'
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h(Button, { size: 'xs', onClick: () => setConfirmDelete(null) }, '取消'),
            h(
              Button,
              {
                size: 'xs',
                onClick: () => handleDelete(confirmDelete),
                style: {
                  background: alpha(C.amber || C.accent || C.text, '20'),
                  border: `1px solid ${alpha(C.amber || C.accent || C.text, '60')}`,
                },
              },
              '刪除並回滾'
            )
          )
        )
      )
  )
}
