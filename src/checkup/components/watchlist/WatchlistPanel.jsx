import { createElement as h, useState } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button, ConfirmDialog } from '../common'

const bgTints = [C.card, C.cardBlue, C.cardAmber]
const inputStyle = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.text,
  fontSize: 12,
  boxSizing: 'border-box',
}

function createWatchlistForm(item = null) {
  return {
    code: item?.code || '',
    name: item?.name || '',
    price: item?.price != null && item.price !== 0 ? String(item.price) : '',
    target: item?.target != null && item.target !== 0 ? String(item.target) : '',
    status: item?.status || '',
    catalyst: item?.catalyst || '',
    scKey: item?.scKey || 'blue',
    note: item?.note || '',
  }
}

/**
 * Watchlist Focus Card
 */
export function WatchlistFocus({ focus }) {
  if (!focus) return null

  return h(
    Card,
    {
      style: {
        borderLeft: `3px solid ${alpha(C.teal, '40')}`,
        marginBottom: 8,
        background: C.cardBlue,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
          flexWrap: 'wrap',
        },
      },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(
          'div',
          {
            style: {
              fontSize: 9,
              color: C.teal,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            },
          },
          '焦點觀察'
        ),
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 600,
              color: C.text,
              marginTop: 3,
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
            },
          },
          h('span', null, `${focus.item.name} ${focus.item.code}`),
          h(
            'span',
            {
              style: {
                fontSize: 9,
                padding: '2px 7px',
                borderRadius: 20,
                background: C.subtle,
                border: `1px solid ${C.border}`,
                color: C.textSec,
              },
            },
            focus.item.status || (focus.trackingCount > 0 ? '追蹤中' : '觀察中')
          )
        ),
        h(
          'div',
          { style: { fontSize: 10, color: C.textSec, marginTop: 5, lineHeight: 1.7 } },
          focus.summary
        ),
        h(
          'div',
          { style: { fontSize: 10, color: C.textMute, marginTop: 5, lineHeight: 1.7 } },
          focus.action
        )
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h(
          'span',
          {
            style: {
              fontSize: 9,
              padding: '4px 8px',
              borderRadius: 20,
              background: C.subtle,
              color: C.textSec,
              border: `1px solid ${C.borderSub}`,
            },
          },
          `現價 ${focus.item.price ? focus.item.price.toLocaleString() : '—'}`
        ),
        h(
          'span',
          {
            style: {
              fontSize: 9,
              padding: '4px 8px',
              borderRadius: 20,
              background: C.subtle,
              color: C.textSec,
              border: `1px solid ${C.borderSub}`,
            },
          },
          `目標 ${focus.item.target ? focus.item.target.toLocaleString() : '未設定'}`
        ),
        h(
          'span',
          {
            style: {
              fontSize: 9,
              padding: '4px 8px',
              borderRadius: 20,
              background: C.subtle,
              color: C.textSec,
              border: `1px solid ${C.borderSub}`,
            },
          },
          focus.upside != null
            ? `潛在 ${focus.upside >= 0 ? '+' : ''}${focus.upside.toFixed(1)}%`
            : `事件 ${focus.relatedEvents.length} 筆`
        )
      )
    )
  )
}

/**
 * Single Watchlist Row
 */
export function WatchlistRow({
  item,
  index,
  relatedEvents,
  hits,
  misses,
  pendingCount,
  trackingCount,
  upside,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}) {
  const w = item
  const upsideText = upside != null ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'
  const prog = w.target > 0 && w.price > 0 ? Math.min((w.price / w.target) * 100, 100) : 0
  const sc = C[w.scKey] || C.blue
  const isWExp = expanded

  return h(
    Card,
    {
      style: {
        background: bgTints[index % 3],
        marginBottom: 8,
      },
    },
    h(
      'div',
      { onClick: onToggle, style: { cursor: 'pointer' } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 10,
          },
        },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(
            'div',
            { style: { fontSize: 16, fontWeight: 600, color: C.text } },
            w.name,
            h(
              'span',
              {
                style: { fontSize: 10, color: C.textMute, fontWeight: 400, marginLeft: 6 },
              },
              w.code
            ),
            relatedEvents.length > 0 &&
              h(
                'span',
                {
                  style: {
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 3,
                    marginLeft: 6,
                    background: C.lavBg,
                    color: C.lavender,
                    fontWeight: 500,
                  },
                },
                hits > 0 && `✓${hits}`,
                misses > 0 && ` ✗${misses}`,
                pendingCount > 0 && ` ⏳${pendingCount}`,
                trackingCount > 0 && ` 👁${trackingCount}`
              )
          ),
          h(
            'div',
            {
              style: { fontSize: 10, color: C.textMute, marginTop: 2, lineHeight: 1.6 },
            },
            w.catalyst || '尚未補上催化劑',
            h('span', { style: { fontSize: 9 } }, isWExp ? '▲' : '▼')
          )
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h(
            Button,
            {
              onClick: (e) => {
                e.stopPropagation()
                onEdit()
              },
              style: {
                padding: '4px 8px',
                background: 'transparent',
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                fontSize: 9,
                color: C.textMute,
                cursor: 'pointer',
              },
            },
            '編輯'
          ),
          h(
            Button,
            {
              onClick: (e) => {
                e.stopPropagation()
                onDelete()
              },
              style: {
                padding: '4px 8px',
                background: 'transparent',
                border: `1px solid ${C.up}`,
                borderRadius: 12,
                fontSize: 9,
                color: C.up,
                cursor: 'pointer',
              },
            },
            '刪除'
          )
        ),
        h(
          'span',
          {
            style: {
              background: C.subtle,
              color: C.textSec,
              fontSize: 10,
              fontWeight: 500,
              border: `1px solid ${C.border}`,
              padding: '3px 11px',
              borderRadius: 20,
              flexShrink: 0,
            },
          },
          w.status || '觀察中'
        )
      ),
      h(
        'div',
        {
          style: { display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' },
        },
        h(
          'div',
          null,
          h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '現價'),
          h(
            'div',
            { style: { fontSize: 17, fontWeight: 600, color: C.text } },
            w.price != null && w.price > 0 ? w.price.toLocaleString() : '—'
          )
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '目標價'),
          h(
            'div',
            { style: { fontSize: 17, fontWeight: 600, color: C.textSec } },
            w.target != null && w.target > 0 ? w.target.toLocaleString() : '未設定'
          )
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '潛在漲幅'),
          h('div', { style: { fontSize: 17, fontWeight: 600, color: C.text } }, upsideText)
        )
      ),
      h(
        'div',
        { style: { marginTop: 12 } },
        h(
          'div',
          { style: { background: C.subtle, borderRadius: 3, height: 3 } },
          h('div', {
            style: {
              width: `${prog}%`,
              height: '100%',
              background: `linear-gradient(90deg,${alpha(sc, '40')},${alpha(C.olive, '40')})`,
              borderRadius: 3,
            },
          })
        )
      ),
      h(
        'div',
        {
          style: { fontSize: 10, color: C.textMute, marginTop: 9, lineHeight: 1.7 },
        },
        w.note || '尚未補上觀察重點。'
      )
    ),

    // Expanded: Strategy tracking
    isWExp &&
      h(
        'div',
        {
          style: {
            marginTop: 10,
            padding: '10px 12px',
            background: C.bg,
            borderRadius: 10,
          },
        },
        relatedEvents.length === 0
          ? h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: C.textMute,
                  textAlign: 'center',
                  padding: '8px 0',
                },
              },
              '尚無相關事件預測紀錄'
            )
          : h(
              'div',
              null,
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  },
                },
                h(
                  'div',
                  { style: { fontSize: 10, color: C.lavender, fontWeight: 600 } },
                  `策略追蹤（${relatedEvents.length} 筆）`
                ),
                h(
                  'div',
                  { style: { fontSize: 10 } },
                  hits > 0 &&
                    h('span', { style: { color: C.olive, marginRight: 8 } }, `準確 ${hits}`),
                  misses > 0 &&
                    h('span', { style: { color: C.up, marginRight: 8 } }, `失誤 ${misses}`),
                  pendingCount + trackingCount > 0 &&
                    h(
                      'span',
                      { style: { color: C.textMute } },
                      `待處理 ${pendingCount + trackingCount}`
                    ),
                  hits + misses > 0 &&
                    h(
                      'span',
                      {
                        style: { color: C.amber, marginLeft: 8, fontWeight: 600 },
                      },
                      `勝率 ${Math.round((hits / (hits + misses)) * 100)}%`
                    )
                )
              ),
              relatedEvents.map((e) =>
                h(
                  'div',
                  {
                    key: e.id,
                    style: { padding: '8px 0', borderBottom: `1px solid ${C.borderSub}` },
                  },
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      },
                    },
                    h(
                      'div',
                      { style: { flex: 1 } },
                      h(
                        'div',
                        { style: { fontSize: 11, fontWeight: 500, color: C.text } },
                        e.title
                      ),
                      h('div', { style: { fontSize: 9, color: C.textMute, marginTop: 2 } }, e.date)
                    ),
                    h(
                      'div',
                      {
                        style: { display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 },
                      },
                      h(
                        'span',
                        {
                          style: {
                            fontSize: 9,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background:
                              e.pred === 'up' ? C.upBg : e.pred === 'down' ? C.downBg : C.blueBg,
                            color: e.pred === 'up' ? C.up : e.pred === 'down' ? C.down : C.blue,
                          },
                        },
                        `預測${e.pred === 'up' ? '看漲' : e.pred === 'down' ? '看跌' : '中性'}`
                      ),
                      e.correct === true &&
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 9,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: C.oliveBg,
                              color: C.olive,
                              fontWeight: 600,
                            },
                          },
                          '✓ 準確'
                        ),
                      e.correct === false &&
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 9,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: C.upBg,
                              color: C.up,
                              fontWeight: 600,
                            },
                          },
                          '✗ 失誤'
                        ),
                      e.correct == null &&
                        e.status === 'pending' &&
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 9,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: C.blueBg,
                              color: C.blue,
                            },
                          },
                          '待驗證'
                        ),
                      e.correct == null &&
                        e.status === 'tracking' &&
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 9,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: C.blueBg,
                              color: C.blue,
                            },
                          },
                          '追蹤中'
                        )
                    )
                  ),
                  h(
                    'div',
                    {
                      style: { fontSize: 10, color: C.textMute, marginTop: 4, lineHeight: 1.6 },
                    },
                    e.predReason
                  ),
                  e.actualNote &&
                    h(
                      'div',
                      {
                        style: {
                          fontSize: 10,
                          color: C.textSec,
                          marginTop: 3,
                          lineHeight: 1.6,
                          borderLeft: `2px solid ${alpha(e.correct ? C.olive : C.up, '40')}`,
                          paddingLeft: 8,
                        },
                      },
                      `結果：${e.actualNote}`
                    ),
                  Array.isArray(e.stockOutcomes) &&
                    e.stockOutcomes.length > 0 &&
                    h(
                      'div',
                      {
                        style: {
                          fontSize: 9,
                          color: C.textMute,
                          marginTop: 4,
                          lineHeight: 1.6,
                          paddingLeft: 8,
                        },
                      },
                      `逐檔結果：${e.stockOutcomes.map((o) => o.note || '').join('；')}`
                    ),
                  e.lessons &&
                    h(
                      'div',
                      {
                        style: { fontSize: 10, color: C.amber, marginTop: 3, lineHeight: 1.6 },
                      },
                      `教訓：${e.lessons}`
                    )
                )
              )
            )
      )
  )
}

function WatchlistEditor({ open, editingItem, form, setForm, onClose, onSubmit }) {
  if (!open) return null

  const updateField = (key) => (event) => {
    const value = event?.target?.value ?? ''
    setForm((current) => ({ ...current, [key]: value }))
  }

  return h(
    'div',
    {
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 40,
      },
      onClick: (event) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      Card,
      {
        style: {
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'auto',
          padding: '16px 18px',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 10,
            marginBottom: 14,
          },
        },
        h(
          'div',
          null,
          h(
            'div',
            { style: { fontSize: 10, color: C.teal, fontWeight: 700, letterSpacing: '0.08em' } },
            editingItem ? '編輯觀察股' : '新增觀察股'
          ),
          h(
            'div',
            { style: { fontSize: 13, color: C.text, fontWeight: 600, marginTop: 4 } },
            editingItem ? `${editingItem.name} ${editingItem.code}` : '補上待追蹤標的與觸發條件'
          )
        ),
        h(
          Button,
          {
            onClick: onClose,
            style: { padding: '4px 10px' },
          },
          '關閉'
        )
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          },
        },
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '代碼',
          h('input', {
            value: form.code,
            onChange: updateField('code'),
            placeholder: '2330',
            style: inputStyle,
          })
        ),
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '名稱',
          h('input', {
            value: form.name,
            onChange: updateField('name'),
            placeholder: '台積電',
            style: inputStyle,
          })
        ),
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '現價',
          h('input', {
            value: form.price,
            onChange: updateField('price'),
            placeholder: '0',
            inputMode: 'decimal',
            style: inputStyle,
          })
        ),
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '目標價',
          h('input', {
            value: form.target,
            onChange: updateField('target'),
            placeholder: '0',
            inputMode: 'decimal',
            style: inputStyle,
          })
        ),
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '狀態',
          h('input', {
            value: form.status,
            onChange: updateField('status'),
            placeholder: '觀察中 / 追蹤中',
            style: inputStyle,
          })
        ),
        h(
          'label',
          { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute } },
          '色彩 key',
          h(
            'select',
            {
              value: form.scKey,
              onChange: updateField('scKey'),
              style: inputStyle,
            },
            h('option', { value: 'blue' }, 'blue'),
            h('option', { value: 'teal' }, 'teal'),
            h('option', { value: 'amber' }, 'amber'),
            h('option', { value: 'olive' }, 'olive'),
            h('option', { value: 'lavender' }, 'lavender')
          )
        )
      ),
      h(
        'label',
        { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute, marginTop: 10 } },
        '催化劑',
        h('textarea', {
          value: form.catalyst,
          onChange: updateField('catalyst'),
          rows: 3,
          placeholder: '例：法說、營收回升、新產品量產',
          style: { ...inputStyle, resize: 'vertical' },
        })
      ),
      h(
        'label',
        { style: { display: 'grid', gap: 4, fontSize: 10, color: C.textMute, marginTop: 10 } },
        '補充備註',
        h('textarea', {
          value: form.note,
          onChange: updateField('note'),
          rows: 4,
          placeholder: '把進場條件、風險、驗證點記在這裡',
          style: { ...inputStyle, resize: 'vertical' },
        })
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 14,
            flexWrap: 'wrap',
          },
        },
        h(
          Button,
          {
            onClick: onClose,
            style: { padding: '6px 12px' },
          },
          '取消'
        ),
        h(
          Button,
          {
            variant: 'filled',
            color: 'blue',
            onClick: onSubmit,
            style: { padding: '6px 14px' },
          },
          editingItem ? '儲存變更' : '加入觀察'
        )
      )
    )
  )
}

/**
 * Main Watchlist Panel
 */
export function WatchlistPanel({
  watchlistFocus,
  watchlistRows = [],
  expandedStock,
  setExpandedStock,
  onUpsertItem,
  handleWatchlistDelete,
  formatEventStockOutcomeLine: _formatEventStockOutcomeLine,
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [pendingDeleteItem, setPendingDeleteItem] = useState(null)
  const [form, setForm] = useState(() => createWatchlistForm())

  const openAddModal = () => {
    setEditingItem(null)
    setForm(createWatchlistForm())
    setEditorOpen(true)
  }

  const openEditModal = (item) => {
    setEditingItem(item)
    setForm(createWatchlistForm(item))
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditingItem(null)
    setForm(createWatchlistForm())
  }

  const submitEditor = () => {
    const saved = onUpsertItem?.(form, editingItem?.code || null)
    if (saved !== false) closeEditor()
  }

  const confirmDelete = () => {
    if (!pendingDeleteItem?.code) return
    handleWatchlistDelete?.(pendingDeleteItem.code)
    setPendingDeleteItem(null)
  }

  return h(
    'div',
    null,
    h(ConfirmDialog, {
      open: Boolean(pendingDeleteItem),
      title: '刪除觀察股',
      message: pendingDeleteItem
        ? `確定要刪除「${pendingDeleteItem.name} (${pendingDeleteItem.code})」嗎？`
        : '',
      confirmLabel: '確認刪除',
      onConfirm: confirmDelete,
      onCancel: () => setPendingDeleteItem(null),
    }),
    h(WatchlistEditor, {
      open: editorOpen,
      editingItem,
      form,
      setForm,
      onClose: closeEditor,
      onSubmit: submitEditor,
    }),

    // Focus card
    watchlistFocus &&
      h(WatchlistFocus, {
        focus: watchlistFocus,
      }),

    // Add button
    watchlistRows.length === 0
      ? h(
          Card,
          {
            style: { textAlign: 'center', padding: '24px 14px' },
          },
          h('div', { style: { fontSize: 20, marginBottom: 6, opacity: 0.3 } }, '◌'),
          h(
            'div',
            {
              style: { fontSize: 12, color: C.textMute, fontWeight: 400 },
            },
            '這個組合目前沒有觀察股'
          ),
          h(
            Button,
            {
              onClick: openAddModal,
              style: {
                marginTop: 12,
                padding: '8px 16px',
                background: C.teal,
                color: 'white',
                border: 'none',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              },
            },
            '＋ 新增觀察股'
          )
        )
      : h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 } },
          h(
            Button,
            {
              onClick: openAddModal,
              style: {
                padding: '6px 12px',
                background: C.teal,
                color: 'white',
                border: 'none',
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              },
            },
            '＋ 新增觀察股'
          )
        ),

    // Watchlist rows
    watchlistRows.map(
      ({
        item: w,
        index: wi,
        relatedEvents: wEvents,
        hits: wHits,
        misses: wMisses,
        pendingCount,
        trackingCount,
        upside,
      }) =>
        h(WatchlistRow, {
          key: w.code,
          item: w,
          index: wi,
          relatedEvents: wEvents,
          hits: wHits,
          misses: wMisses,
          pendingCount,
          trackingCount,
          upside,
          expanded: expandedStock === `w-${w.code}`,
          onToggle: () => setExpandedStock(expandedStock === `w-${w.code}` ? null : `w-${w.code}`),
          onEdit: () => openEditModal(w),
          onDelete: () => setPendingDeleteItem(w),
        })
    )
  )
}
