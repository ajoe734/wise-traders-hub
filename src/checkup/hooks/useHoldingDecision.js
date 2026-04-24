/**
 * useHoldingDecision
 * 從 holding + dossier 推算決策狀態（hold / review / exit / add）
 * 與 urgency（high / medium / low）
 *
 * 並提供 assignCardVariants：依排序產生 ink/accent/plain 配額
 */
import { useMemo } from 'react'
import {
  getHoldingMarketValue,
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
} from '../lib/holdings.js'

const decisionFor = (holding, dossier) => {
  const pct = getHoldingReturnPct(holding) || 0
  const thesis = dossier?.thesis || null
  const stop = Number(thesis?.stopLoss)
  const target = Number(thesis?.targetPrice)
  const price = Number(holding?.price)

  // 強制離場：跌破停損或 -8%
  if ((Number.isFinite(stop) && Number.isFinite(price) && price <= stop) || pct <= -8) {
    return { kind: 'exit', label: '出場', tone: 'down' }
  }
  // 達標：碰到目標價或 +20%
  if ((Number.isFinite(target) && Number.isFinite(price) && price >= target) || pct >= 20) {
    return { kind: 'review', label: '檢視', tone: 'up' }
  }
  // 警報條件被觸發或 dossier 缺資料
  if (holding?.alert) {
    return { kind: 'review', label: '檢視', tone: 'amber' }
  }
  if (pct >= 5) {
    return { kind: 'add', label: '加碼', tone: 'up' }
  }
  return { kind: 'hold', label: '續抱', tone: 'mute' }
}

const urgencyFor = (decision, pct) => {
  if (decision.kind === 'exit') return 'high'
  if (decision.kind === 'review' && Math.abs(pct) >= 15) return 'high'
  if (decision.kind === 'review') return 'medium'
  if (decision.kind === 'add') return 'medium'
  return 'low'
}

const todayChangeFor = (holding) => {
  const cp = Number(holding?.changePercent ?? holding?.change_percent)
  const cv = Number(holding?.changeValue ?? holding?.change_value)
  const qty = Number(holding?.qty) || 0
  const pnl = Number.isFinite(cv) ? cv * qty : null
  return {
    pct: Number.isFinite(cp) ? cp : null,
    pnl,
  }
}

export function useHoldingDecisions(holdings = [], holdingDossiers = []) {
  return useMemo(() => {
    const dossierMap = new Map(
      (holdingDossiers || []).map((d) => [String(d.code).trim(), d])
    )
    return holdings.map((holding) => {
      const dossier = dossierMap.get(String(holding.code).trim()) || null
      const pct = getHoldingReturnPct(holding) || 0
      const pnl = getHoldingUnrealizedPnl(holding) || 0
      const value = getHoldingMarketValue(holding) || 0
      const decision = decisionFor(holding, dossier)
      const urgency = urgencyFor(decision, pct)
      const today = todayChangeFor(holding)
      return {
        holding,
        dossier,
        pct,
        pnl,
        value,
        decision,
        urgency,
        today,
        isFeatured: urgency === 'high' || decision.kind === 'exit' || decision.kind === 'review',
      }
    })
  }, [holdings, holdingDossiers])
}

export const URGENCY_RANK = { high: 3, medium: 2, low: 1 }

/**
 * 配額規則：限制畫面上強視覺卡片數量
 *
 * 規則：
 *  - 最多 1 張 ink 卡（exit 中報酬率最差的那張）
 *  - 最多 2 張 accent 卡（exit 第 2、3 張 OR review 中最緊急的）
 *  - 其餘全部 plain 卡
 *
 * 排序基準：
 *  - exit 優先於 review
 *  - exit 內按 pct 升冪（越虧越前面）
 *  - review 內按 |pct| 降冪（變動越大越前面）
 *
 * @param {Array} items - holdings (with optional .actionType / .urgency from decisionsMap)
 * @param {Object} options
 * @param {(item) => string} options.getActionType - 從 item 取得 actionType ('exit' | 'review' | 'hold' | 'add')
 * @param {(item) => number} options.getPct - 從 item 取得 pct
 * @returns {Map<string, 'ink'|'accent'|'plain'>} key 為 holding.code
 */
export function assignCardVariants(items = [], { getActionType, getPct } = {}) {
  const result = new Map()
  if (!Array.isArray(items) || items.length === 0) return result

  const _getActionType = getActionType || ((it) => it?.actionType || it?.decision?.kind || 'hold')
  const _getPct = getPct || ((it) => it?.pct ?? 0)

  // 分組
  const exits = []
  const reviews = []
  for (const item of items) {
    const kind = _getActionType(item)
    if (kind === 'exit') exits.push(item)
    else if (kind === 'review') reviews.push(item)
  }

  // exit 升冪（最虧的在前）
  exits.sort((a, b) => _getPct(a) - _getPct(b))
  // review 按 |pct| 降冪
  reviews.sort((a, b) => Math.abs(_getPct(b)) - Math.abs(_getPct(a)))

  let inkUsed = 0
  let accentUsed = 0
  const INK_QUOTA = 1
  const ACCENT_QUOTA = 2

  // 第一名 exit → ink
  for (const item of exits) {
    const code = item?.code
    if (!code) continue
    if (inkUsed < INK_QUOTA) {
      result.set(code, 'ink')
      inkUsed += 1
    } else if (accentUsed < ACCENT_QUOTA) {
      result.set(code, 'accent')
      accentUsed += 1
    } else {
      result.set(code, 'plain')
    }
  }

  // review 補滿 accent quota
  for (const item of reviews) {
    const code = item?.code
    if (!code || result.has(code)) continue
    if (accentUsed < ACCENT_QUOTA) {
      result.set(code, 'accent')
      accentUsed += 1
    } else {
      result.set(code, 'plain')
    }
  }

  // 其餘 plain
  for (const item of items) {
    const code = item?.code
    if (code && !result.has(code)) result.set(code, 'plain')
  }

  return result
}
