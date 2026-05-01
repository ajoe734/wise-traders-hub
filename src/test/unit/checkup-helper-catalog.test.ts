import { describe, it, expect } from 'vitest'
import {
  APP_RUNTIME_CORE_LIFECYCLE_HELPERS,
  APP_RUNTIME_WORKFLOW_HELPERS,
} from '@/checkup/hooks/useAppRuntimeHelperCatalog.js'

/**
 * Smoke test for useAppRuntimeHelperCatalog.
 *
 * Goal: prevent silent breakage when a helper import is removed/renamed in
 * upstream utils (例如 holdingEventUtils 重新命名後 catalog 漏改 import 會
 * 讓對應 key 變成 undefined，整個 runtime 雪崩)。
 *
 * 不重測 helper 內部邏輯——那是各 utils 自己的單元測試責任。
 */

const assertCatalogShape = (
  label: string,
  catalog: Record<string, unknown>,
  minSize: number,
) => {
  it(`${label} 是 plain object 且非空`, () => {
    expect(catalog).toBeTypeOf('object')
    expect(catalog).not.toBeNull()
    expect(Array.isArray(catalog)).toBe(false)
    expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(minSize)
  })

  it(`${label} 每個 export 都必須是 function（防漏 import → undefined）`, () => {
    const broken: string[] = []
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'function') {
        broken.push(`${key}: ${typeof value}`)
      }
    }
    expect(broken, `Non-function exports detected:\n${broken.join('\n')}`).toEqual([])
  })
}

describe('useAppRuntimeHelperCatalog', () => {
  describe('APP_RUNTIME_CORE_LIFECYCLE_HELPERS', () => {
    assertCatalogShape(
      'APP_RUNTIME_CORE_LIFECYCLE_HELPERS',
      APP_RUNTIME_CORE_LIFECYCLE_HELPERS as unknown as Record<string, unknown>,
      30,
    )

    it('關鍵 lifecycle helpers 必須存在（防 catalog 漏 export）', () => {
      const required = [
        'createDefaultReviewForm',
        'migrateLegacyPortfolioStorageIfNeeded',
        'seedJinlianchengIfNeeded',
        'ensurePortfolioRegistry',
        'loadPortfolioSnapshot',
        'normalizeHoldings',
        'normalizeNewsEvents',
        'normalizeStrategyBrain',
        'savePortfolioData',
        'save',
        'toSlashDate',
        'parseSlashDate',
      ]
      for (const key of required) {
        expect(
          (APP_RUNTIME_CORE_LIFECYCLE_HELPERS as Record<string, unknown>)[key],
          `Missing lifecycle helper: ${key}`,
        ).toBeTypeOf('function')
      }
    })

    it('toSlashDate 可實際被呼叫（薄行為驗證）', () => {
      const result = APP_RUNTIME_CORE_LIFECYCLE_HELPERS.toSlashDate(
        new Date('2026-01-02T00:00:00+08:00'),
      )
      expect(typeof result).toBe('string')
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
    })

    it('createDefaultReviewForm 可實際被呼叫且回傳 object', () => {
      const result = APP_RUNTIME_CORE_LIFECYCLE_HELPERS.createDefaultReviewForm()
      expect(result).toBeTypeOf('object')
      expect(result).not.toBeNull()
    })
  })

  describe('APP_RUNTIME_WORKFLOW_HELPERS', () => {
    assertCatalogShape(
      'APP_RUNTIME_WORKFLOW_HELPERS',
      APP_RUNTIME_WORKFLOW_HELPERS as unknown as Record<string, unknown>,
      25,
    )

    it('關鍵 workflow helpers 必須存在（含 Decision System v6）', () => {
      const required = [
        'formatEventStockOutcomeLine',
        'isClosedEvent',
        'resolveHoldingPrice',
        'getHoldingUnrealizedPnl',
        'getHoldingReturnPct',
        'buildDailyHoldingDossierContext',
        'formatPortfolioNotesContext',
        'createDefaultFundamentalDraft',
        // Decision System v6 — Step 4 才剛因漏 import 出包
        'buildDecision',
        'buildDecisionFingerprint',
        'isEventOpen',
        'getEffectiveStatus',
        'toLegacyDisplayStatus',
        'sortByDecisionPriority',
        'isDuplicateEvent',
        'mergeEvents',
        'validateEventMutation',
        'validateAiEvent',
        'detectConflict',
        'deriveConfidence',
      ]
      for (const key of required) {
        expect(
          (APP_RUNTIME_WORKFLOW_HELPERS as Record<string, unknown>)[key],
          `Missing workflow helper: ${key}`,
        ).toBeTypeOf('function')
      }
    })

    it('createDefaultFundamentalDraft 可實際被呼叫且回傳 object', () => {
      const result = APP_RUNTIME_WORKFLOW_HELPERS.createDefaultFundamentalDraft()
      expect(result).toBeTypeOf('object')
      expect(result).not.toBeNull()
    })
  })
})
