import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { useCheckupMode } from '../../contexts/CheckupModeContext.jsx'

/**
 * Inline DemoCTA — 訪客模式下，在功能頁面上方顯眼地引導 LINE 登入。
 * 與 sticky 的 DemoBanner 互補：DemoBanner 是全頁通知，DemoCTA 是當頁說明。
 *
 * 已登入者不會 render（return null）。
 */
export function DemoCTA({ feature = 'trade', message }) {
  let mode = null
  try { mode = useCheckupMode() } catch { mode = null }
  if (!mode?.isDemo) return null

  const defaultMsg = {
    trade: '訪客模式無法上傳成交、解析 OCR 或寫入持倉。LINE 登入後立刻解鎖你的真實交易紀錄。',
    log: '訪客模式無法新增、修改或刪除交易紀錄。LINE 登入後即可使用個人交易日誌。',
    research: '訪客模式無法執行 AI 研究與寫入。LINE 登入即可解鎖完整 AI 額度。',
  }[feature] || '訪客模式僅供瀏覽，LINE 登入即可解鎖完整功能。'

  return h(
    'div',
    {
      role: 'note',
      style: {
        marginBottom: 12,
        padding: '12px 14px',
        background: alpha(C.accent || C.text, '06'),
        border: `1px solid ${alpha(C.accent || C.text, '20')}`,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
      },
    },
    h(
      'div',
      { style: { fontSize: 12, color: C.textSec, lineHeight: 1.6, flex: '1 1 240px' } },
      message || defaultMsg
    ),
    h(
      'button',
      {
        onClick: mode.startLineLogin,
        style: {
          background: '#06C755',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          letterSpacing: '0.02em',
          flexShrink: 0,
        },
      },
      'LINE 登入解鎖'
    )
  )
}
