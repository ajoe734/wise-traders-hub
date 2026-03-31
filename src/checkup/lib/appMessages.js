export const APP_CONFIRM_DEFAULTS = {
  title: '請確認',
  confirmLabel: '確認',
  cancelLabel: '取消',
}

export const APP_LOADING_MESSAGE = '載入中...'

export const APP_ERROR_BOUNDARY_COPY = {
  header: {
    title: '頂部控制列',
    description: '上方控制列暫時發生錯誤，主內容仍可繼續檢視。',
  },
  overview: { title: '總覽面板' },
  holdings: { title: '持倉面板' },
  watchlist: { title: '觀察名單面板' },
  events: { title: '事件面板' },
  daily: { title: '每日分析面板' },
  research: { title: '深度研究面板' },
  trade: { title: '交易上傳面板' },
  log: { title: '交易紀錄面板' },
  news: { title: '新聞分析面板' },
}

export const APP_LABELS = {
  allFilter: '全部',
  manualEntryFirm: '手動輸入',
  publicReportSource: '公開報告',
  eventAutoClosedAfter90Days: '追蹤已滿 90 天',
}

export const APP_DIALOG_MESSAGES = {
  priceSyncAlreadySynced(timeLabel = 'N/A') {
    return {
      title: '收盤價已同步',
      message:
        `今日收盤價已同步（${timeLabel} 抓取）。\n\n` +
        '確認後會強制重新抓取最新收盤價；取消則繼續使用既有快取。',
      confirmLabel: '強制重抓',
      cancelLabel: '沿用快取',
      tone: 'warning',
    }
  },
  importBackup: {
    title: '匯入本機備份',
    message: '匯入會覆蓋這個瀏覽器目前的本機資料；未包含在備份檔內的項目不會被改動。',
    confirmLabel: '確認匯入',
    cancelLabel: '取消',
    tone: 'warning',
  },
}

export const APP_TOAST_MESSAGES = {
  priceSyncBeforeClose: '⚠️ 收盤價僅在台北時間 13:35 後同步',
  priceSyncMarketClosed: '⚠️ 非交易日，沿用最近收盤價',
  priceSyncAlreadyAttempted: '⚠️ 今日已嘗試同步收盤價，沿用既有快取',
  priceSyncAlreadyDone: '✅ 今日收盤價已同步，避免重複抓取',
  priceSyncUseCache: '✅ 使用既有收盤價快取',
  priceSyncNoTrackedCodes: '⚠️ 目前沒有可同步的股票代碼',
  priceSyncFailedKeepCache: '⚠️ 今日收盤價同步失敗，沿用既有快取',
  priceSyncFailedRetry: '❌ 收盤價同步失敗，請稍後再試',
  priceSyncSyncedPartial(successCount, totalCount) {
    return `✅ 收盤價已同步（${successCount}/${totalCount} 檔成功）`
  },
  priceSyncSyncedAll(totalCount) {
    return `✅ 今日收盤價已同步（${totalCount} 檔）`
  },
  reviewSavedIntegrating: '✅ 復盤已儲存，策略整合中...',
  reviewSaved: '✅ 復盤已儲存',
  reviewBrainUpdated(feedback) {
    return feedback ? `🧠 ${feedback}` : '✅ 策略大腦已更新'
  },
  reversalSaved: '✅ 反轉條件已儲存',
  weeklyReportCopiedClipboard: '✅ 週報素材已複製到剪貼簿',
  weeklyReportCopied: '✅ 週報素材已複製',
  targetUpdated: '✅ 目標價已更新',
  fundamentalsUpdated: '✅ 財報 / 營收資料已更新',
  researchSyncedToDossier: '✅ 研究結果已同步回 dossier',
  researchNoStructuredExtract: 'ℹ️ 這份研究沒有抽到新的財報 / 目標價資料',
  researchSyncFailure(detail) {
    return `⚠️ ${detail}`
  },
  analystReportsFresh: 'ℹ️ 今日報告索引已是最新',
  analystReportsRefreshed(checkedCount, changedCount) {
    return changedCount > 0
      ? `✅ 已刷新 ${checkedCount} 檔公開報告索引（${changedCount} 檔有新資料）`
      : `ℹ️ 已檢查 ${checkedCount} 檔，今日沒有新的公開報告`
  },
  backupNoExportableData: '⚠️ 目前沒有可匯出的本機資料',
  backupExported: '✅ 本機備份已匯出',
  backupExportFailed: '❌ 匯出失敗',
  backupImported(itemCount) {
    return `✅ 已匯入 ${itemCount} 項本機資料`
  },
  backupImportFailed(detail) {
    return `❌ 匯入失敗：${detail}`
  },
}

export const APP_STATUS_MESSAGES = {
  dailyLoadingMarketCache: '讀取收盤價快取...',
  dailyBlindPrediction: '盲測預測中（不含今日漲跌）...',
  dailyAiAnalysis: 'AI 策略分析中（約15-30秒）...',
  stressTesting: '風險壓力測試中...',
  stressTestNoResult: '壓力測試無結果',
  stressTestFailed(detail = '') {
    return `❌ 壓力測試失敗: ${detail}`
  },
  reportRefreshStarting(totalCount) {
    return `正在刷新公開報告索引（0/${totalCount}）...`
  },
  reportRefreshProgress(currentIndex, totalCount, holdingName) {
    return `正在刷新公開報告索引（${currentIndex}/${totalCount}）· ${holdingName}`
  },
  reportRefreshUpdated(newCount) {
    return `新增 ${newCount} 則公開報告`
  },
  reportRefreshNoChanges: '今日無新報告',
  reportRefreshFailed: '刷新失敗',
}

export const APP_ERROR_MESSAGES = {
  backupUnrecognizedData: '備份檔內沒有可識別的資料',
  backupInvalidJson: 'JSON 格式不正確',
  researchSyncTimeout: '同步逾時，稍後再試',
  researchSyncFallback: '同步失敗',
}
