export function buildPortfolioTabs({
  urgentCount = 0,
  analyzing = false,
  researching = false,
} = {}) {
  return [
    { k: 'holdings', label: '持倉' },
    { k: 'watchlist', label: '觀察股' },
    { k: 'events', label: `行事曆${urgentCount > 0 ? ' ·' : ''}` },
    { k: 'news', label: '事件分析' },
    { k: 'daily', label: analyzing ? '分析中...' : '收盤分析' },
    { k: 'research', label: researching ? '研究中...' : '深度研究' },
    { k: 'trade', label: '上傳成交' },
    { k: 'log', label: '交易日誌' },
  ]
}
