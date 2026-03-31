// 風險管理 Hook
// 用於部位規模計算和風險監控

import { useState, useCallback, useMemo } from 'react'
import { DEFAULT_RISK_SETTINGS, STORAGE_KEYS } from '../constants.js'
import { calculatePositionSize, checkRiskLimits } from '../lib/dataUtils.js'

/**
 * Read risk settings from localStorage
 */
function readRiskSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RISK_SETTINGS)
    return raw ? JSON.parse(raw) : { ...DEFAULT_RISK_SETTINGS }
  } catch {
    return { ...DEFAULT_RISK_SETTINGS }
  }
}

/**
 * Save risk settings to localStorage
 */
function saveRiskSettingsToStorage(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.RISK_SETTINGS, JSON.stringify(settings))
    return true
  } catch (err) {
    console.error('Failed to save risk settings:', err)
    return false
  }
}

/**
 * Risk Management Hook
 *
 * @param {Object} options - Hook options
 * @returns {Object} Risk management methods and state
 */
export function useRiskManagement(options = {}) {
  const { holdings = [] } = options

  const [settings, setSettings] = useState(() => readRiskSettingsFromStorage())
  const [warnings, setWarnings] = useState([])

  /**
   * Update risk settings
   */
  const updateSettings = useCallback(
    async (newSettings) => {
      const updated = { ...settings, ...newSettings }
      setSettings(updated)
      const saved = saveRiskSettingsToStorage(updated)
      return { success: saved }
    },
    [settings]
  )

  /**
   * Reset to default settings
   */
  const resetSettings = useCallback(async () => {
    setSettings({ ...DEFAULT_RISK_SETTINGS })
    const saved = saveRiskSettingsToStorage(DEFAULT_RISK_SETTINGS)
    return { success: saved }
  }, [])

  /**
   * Calculate position size for a new trade
   */
  const calcPositionSize = useCallback(
    (entryPrice, stopLossPrice, customSettings = {}) => {
      const effectiveSettings = { ...settings, ...customSettings }

      if (!effectiveSettings.totalCapital) {
        return {
          error: '請先設定總資金',
          requiresSetup: true,
        }
      }

      return calculatePositionSize({
        totalCapital: effectiveSettings.totalCapital,
        riskPerTrade: effectiveSettings.riskPerTrade,
        entryPrice,
        stopLossPrice,
      })
    },
    [settings]
  )

  /**
   * Check portfolio risk limits
   */
  const checkLimits = useCallback(
    (customHoldings = null) => {
      const targetHoldings = customHoldings || holdings
      const limits = checkRiskLimits(targetHoldings, settings)
      setWarnings(limits)
      return limits
    },
    [holdings, settings]
  )

  /**
   * Get risk summary
   */
  const riskSummary = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0)
    const totalCost = holdings.reduce((sum, h) => sum + (h.cost || 0), 0)
    const totalPnl = totalValue - totalCost
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

    // Sector exposure
    const sectorExposure = {}
    for (const holding of holdings) {
      const sector = holding.sector || holding.industry || 'unknown'
      sectorExposure[sector] = (sectorExposure[sector] || 0) + (holding.value || 0)
    }

    // Convert to percentages
    const sectorPercentages = {}
    for (const [sector, value] of Object.entries(sectorExposure)) {
      sectorPercentages[sector] = totalValue > 0 ? (value / totalValue) * 100 : 0
    }

    // Find largest positions
    const positionPercentages = holdings.map((h) => ({
      code: h.code || h.stockId,
      name: h.name,
      value: h.value || 0,
      percent: totalValue > 0 ? ((h.value || 0) / totalValue) * 100 : 0,
      pnl: h.pnl || (h.value || 0) - (h.cost || 0),
      pnlPercent: h.cost > 0 ? (((h.value || 0) - (h.cost || 0)) / (h.cost || 0)) * 100 : 0,
    }))

    positionPercentages.sort((a, b) => b.percent - a.percent)

    return {
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      sectorPercentages,
      positionPercentages,
      warningCount: warnings.length,
    }
  }, [holdings, warnings])

  /**
   * Get risk level
   */
  const riskLevel = useMemo(() => {
    if (warnings.length === 0) {
      return { level: 'low', label: '低風險', color: 'green' }
    }

    const criticalWarnings = warnings.filter(
      (w) => w.type === 'position_limit' || w.type === 'sector_limit'
    )
    if (criticalWarnings.length > 0) {
      return { level: 'high', label: '高風險', color: 'red' }
    }

    return { level: 'medium', label: '中風險', color: 'yellow' }
  }, [warnings])

  /**
   * Validate if a new trade is within risk limits
   */
  const validateTrade = useCallback(
    (trade) => {
      const { value, sector } = trade
      const issues = []

      // Check single position limit
      const currentTotal = holdings.reduce((sum, h) => sum + (h.value || 0), 0)
      const newTotal = currentTotal + value
      const newPositionPercent = (value / newTotal) * 100

      if (newPositionPercent > settings.maxPosition) {
        issues.push({
          type: 'position_limit',
          message: `單一標的持倉 ${newPositionPercent.toFixed(1)}% 超過上限 ${settings.maxPosition}%`,
        })
      }

      // Check sector limit
      const currentSectorValue = holdings
        .filter((h) => (h.sector || h.industry) === sector)
        .reduce((sum, h) => sum + (h.value || 0), 0)

      const newSectorValue = currentSectorValue + value
      const newSectorPercent = (newSectorValue / newTotal) * 100

      if (newSectorPercent > settings.maxSector) {
        issues.push({
          type: 'sector_limit',
          message: `${sector || '未知'} 產業集中度 ${newSectorPercent.toFixed(1)}% 超過上限 ${settings.maxSector}%`,
        })
      }

      // Check total loss limit
      const currentPnl = holdings.reduce((sum, h) => sum + (h.pnl || 0), 0)
      const maxLossAmount = settings.totalCapital * (settings.maxLoss / 100)

      if (currentPnl < -maxLossAmount) {
        issues.push({
          type: 'total_loss',
          message: `總虧損 ${Math.abs(currentPnl).toFixed(0)} 超過上限 ${maxLossAmount.toFixed(0)}`,
        })
      }

      return {
        valid: issues.length === 0,
        issues,
      }
    },
    [holdings, settings]
  )

  return {
    // State
    settings,
    warnings,
    riskSummary,
    riskLevel,

    // Methods
    updateSettings,
    resetSettings,
    calcPositionSize,
    checkLimits,
    validateTrade,
  }
}

/**
 * Risk Settings Form Fields
 */
export const RISK_SETTINGS_FIELDS = {
  totalCapital: {
    label: '總資金 (萬元)',
    type: 'number',
    required: true,
    min: 0,
    step: 10,
  },
  riskPerTrade: {
    label: '每筆交易風險 (%)',
    type: 'range',
    required: true,
    min: 0.5,
    max: 5,
    step: 0.5,
  },
  maxPosition: {
    label: '單一標的最大持倉 (%)',
    type: 'range',
    required: true,
    min: 10,
    max: 50,
    step: 5,
  },
  maxSector: {
    label: '單一產業最大持倉 (%)',
    type: 'range',
    required: true,
    min: 30,
    max: 100,
    step: 10,
  },
  maxLoss: {
    label: '總持倉最大虧損 (%)',
    type: 'range',
    required: true,
    min: 5,
    max: 30,
    step: 5,
  },
  stopLossDefault: {
    label: '預設停損 (%)',
    type: 'range',
    required: true,
    min: 5,
    max: 20,
    step: 1,
  },
}

/**
 * Validate risk settings
 */
export function validateRiskSettings(values) {
  const errors = {}

  if (!values.totalCapital || values.totalCapital <= 0) {
    errors.totalCapital = '請輸入有效的總資金'
  }

  if (!values.riskPerTrade || values.riskPerTrade <= 0 || values.riskPerTrade > 10) {
    errors.riskPerTrade = '每筆風險必須在 0.5-10% 之間'
  }

  if (!values.maxPosition || values.maxPosition <= 0 || values.maxPosition > 100) {
    errors.maxPosition = '單一持倉上限必須在 10-100% 之間'
  }

  if (!values.maxSector || values.maxSector <= 0 || values.maxSector > 100) {
    errors.maxSector = '產業集中度上限必須在 30-100% 之間'
  }

  if (!values.maxLoss || values.maxLoss <= 0 || values.maxLoss > 50) {
    errors.maxLoss = '最大虧損必須在 5-50% 之間'
  }

  // Check logical constraints
  if (values.maxPosition && values.maxSector && values.maxPosition > values.maxSector) {
    errors.maxPosition = '單一持倉上限不能超過產業集中度上限'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}
