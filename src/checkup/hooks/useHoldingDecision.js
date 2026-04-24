/**
 * useHoldingDecision
 * 從 holding + dossier 推算決策狀態（hold / review / exit / add）
 * 與 urgency（high / medium / low）
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
  // 用 change 或 changeValue 估今日損益
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
        // 大卡判定：高優先（exit/review/high urgency）
        isFeatured: urgency === 'high' || decision.kind === 'exit' || decision.kind === 'review',
      }
    })
  }, [holdings, holdingDossiers])
}

export const URGENCY_RANK = { high: 3, medium: 2, low: 1 }
