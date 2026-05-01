// @ts-check
/**
 * Phase 3A.4 Step 3: Type guardrails for the composer / args / downstream-hook chain.
 *
 * Background
 * ----------
 * After the Zustand migration (Phase 3A), 15 setters are now consumed directly
 * inside the downstream hooks via `useHoldingsStore` / `useEventStore` /
 * `useReportsStore` / `useBrainStore`. Passing them through props would
 * (a) silently shadow the store-backed setter with `undefined`, and
 * (b) re-introduce the prop-drill bug we just removed in Step 2.
 *
 * These typedefs make the contract machine-checkable: when a file enables
 * `// @ts-check`, the TS language service will flag any of the forbidden
 * setter keys appearing in composer args / hook params.
 *
 * Files that opt-in via `// @ts-check`:
 *   - src/checkup/hooks/runtimeArgs.types.js (this file)
 *   - src/checkup/hooks/useAppRuntimeArgs.js
 *   - src/checkup/hooks/useAppRuntimeComposer.js
 *   - src/checkup/hooks/useAppRuntimeCoreLifecycle.js
 *   - src/checkup/hooks/useAppRuntimeWorkflows.js
 *
 * tsconfig.app.json already has `allowJs: true` + `checkJs: false` (default),
 * so opt-in is per-file. No global toggle needed.
 */

/**
 * Setter keys that have been migrated to Zustand stores. They MUST NOT be
 * passed through composer args or hook parameters; downstream hooks read
 * them directly from the relevant store via selector hooks.
 *
 * If you need to add another store-backed setter, add it here AND remove it
 * from any composer/args object literal — TypeScript will guide the cleanup.
 *
 * @typedef {(
 *   | 'setHoldings'
 *   | 'setTradeLog'
 *   | 'setTargets'
 *   | 'setFundamentals'
 *   | 'setWatchlist'
 *   | 'setAnalystReports'
 *   | 'setReportRefreshMeta'
 *   | 'setHoldingDossiers'
 *   | 'setNewsEvents'
 *   | 'setReversalConditions'
 *   | 'setAnalysisHistory'
 *   | 'setDailyReport'
 *   | 'setStrategyBrain'
 *   | 'setBrainValidation'
 *   | 'setResearchHistory'
 * )} ForbiddenStoreSetterKey
 */

/**
 * Object type that is guaranteed NOT to contain any store-backed setter.
 * Use as the type of every `setters` slot in composer/args layers.
 *
 * @template {Record<string, any>} T
 * @typedef {{
 *   [K in keyof T]: K extends ForbiddenStoreSetterKey ? never : T[K]
 * }} WithoutStoreSetters
 */

/**
 * UI / cloud / portfolio-orchestration setters that legitimately stay on the
 * composer surface. Listed here so the contract is documented in one place.
 *
 * @typedef {(
 *   | 'setReady'
 *   | 'setCloudSync'
 *   | 'setPortfolioNotes'
 *   | 'setReviewingEvent'
 *   | 'setReviewForm'
 *   | 'setLastUpdate'
 *   | 'setPortfolios'
 *   | 'setActivePortfolioId'
 *   | 'setViewMode'
 *   | 'setShowReversal'
 *   | 'setScanQuery'
 *   | 'setScanFilter'
 *   | 'setSortBy'
 *   | 'setExpandedStock'
 *   | 'setRelayPlanExpanded'
 *   | 'setFilterType'
 *   | 'setCatalystFilter'
 *   | 'setDailyExpanded'
 *   | 'setTab'
 *   | 'setExpandedNews'
 *   | 'setResearchTarget'
 *   | 'setResearchResults'
 *   | 'setAnalyzing'
 *   | 'setAnalyzeStep'
 *   | 'setResearching'
 *   | 'setStressTesting'
 *   | 'setStressResult'
 *   | 'setShowPortfolioManager'
 * )} AllowedComposerSetterKey
 */

/**
 * Helper: assert at type-check time that an object literal contains no
 * forbidden keys. Returns the value unchanged at runtime (zero-cost).
 *
 * Usage in a composer:
 *
 *   return assertNoStoreSetters({
 *     setReady,
 *     setCloudSync,
 *     // setHoldings: foo,   // <- TS error if uncommented
 *   })
 *
 * @template {Record<string, any>} T
 * @param {WithoutStoreSetters<T>} value
 * @returns {WithoutStoreSetters<T>}
 */
export function assertNoStoreSetters(value) {
  return value
}

/**
 * Common runtime utilities passed through every composer.
 *
 * @typedef {object} RuntimeBag
 * @property {(message?: string, durationMs?: number) => void} flashSaved
 * @property {(message: string | Record<string, any>) => Promise<boolean>} requestAppConfirmation
 */

export {}
