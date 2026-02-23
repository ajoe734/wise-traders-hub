// Mock data for Strategy Performance - Complete Data Model
// This data structure is ready for AI multi-persona system to populate

import {
  StrategyExpert,
  StrategySystem,
  PerformanceSummary,
  PerformanceSnapshot,
  EquityPoint,
  Position,
  Trade,
  TradeStats,
  RiskSummary,
  XaiSummary,
  WeeklyReview,
  StrategyPlan,
} from '@/types/strategy';

// ============================================
// Helper: Generate Equity History
// ============================================
function generateEquityHistory(
  startValue: number,
  endValue: number,
  days: number,
  volatility: number = 0.02
): EquityPoint[] {
  const points: EquityPoint[] = [];
  const dailyReturn = Math.pow(endValue / startValue, 1 / days) - 1;
  let equity = startValue;
  let peak = startValue;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  for (let i = 0; i <= days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    // Add some randomness
    const randomFactor = 1 + (Math.random() - 0.5) * volatility;
    equity = equity * (1 + dailyReturn) * randomFactor;
    peak = Math.max(peak, equity);
    const drawdownPct = ((equity - peak) / peak) * 100;
    
    points.push({
      date: date.toISOString().split('T')[0],
      equity: Math.round(equity * 100) / 100,
      benchmarkEquity: Math.round(100 * Math.pow(1.08, i / 365) * 100) / 100,
      drawdownPct: Math.round(drawdownPct * 100) / 100,
    });
  }
  
  return points;
}

// ============================================
// Strategy Systems with Full Performance Data
// ============================================

const chenAdvisorSystem: StrategySystem = {
  id: 'system-chen-1',
  expertId: 'person-1',
  name: '趨勢波段 – 台股',
  level: 'advisor_t1',
  summary: '追蹤台股大盤與個股趨勢，在確認趨勢形成後進場，分批加碼，順勢而為。',
  tags: ['趨勢', '波段', '台股', '中期操作'],
  delayMode: 'realtime',

  performanceSummary: {
    sinceInceptionReturnPct: 68.5,
    annualizedReturnPct: 24.5,
    maxDrawdownPct: -12.3,
    volatilityPct: 16.4,
    sharpeRatio: 1.85,
    winRatePct: 62.5,
    profitFactor: 2.15,
    tradesCount: 48,
    avgHoldingDays: 18,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 5.2, maxDrawdownPct: -3.1, volatilityPct: 12.5, sharpeRatio: 2.1, tradesCount: 4, winRatePct: 75 },
    { period: '3M', cumulativeReturnPct: 12.8, maxDrawdownPct: -5.4, volatilityPct: 14.2, sharpeRatio: 1.9, tradesCount: 11, winRatePct: 64 },
    { period: '6M', cumulativeReturnPct: 18.7, maxDrawdownPct: -8.2, volatilityPct: 15.8, sharpeRatio: 1.75, tradesCount: 22, winRatePct: 59 },
    { period: '1Y', cumulativeReturnPct: 32.4, annualizedReturnPct: 32.4, maxDrawdownPct: -12.3, volatilityPct: 16.4, sharpeRatio: 1.85, bestMonthReturnPct: 8.5, worstMonthReturnPct: -4.2, tradesCount: 48, winRatePct: 62.5 },
    { period: 'YTD', cumulativeReturnPct: 28.6, maxDrawdownPct: -10.1, volatilityPct: 15.2, sharpeRatio: 1.92, tradesCount: 42, winRatePct: 64 },
    { period: 'SI', cumulativeReturnPct: 68.5, annualizedReturnPct: 24.5, maxDrawdownPct: -15.8, volatilityPct: 18.2, sharpeRatio: 1.65, bestMonthReturnPct: 12.3, worstMonthReturnPct: -6.8, tradesCount: 156, winRatePct: 58.3 },
  ],

  equityHistory: generateEquityHistory(100, 168.5, 365, 0.015),

  tradeStats: {
    totalTrades: 48,
    longTrades: 45,
    shortTrades: 3,
    winTrades: 30,
    loseTrades: 18,
    winRatePct: 62.5,
    avgWinPct: 8.5,
    avgLossPct: -4.2,
    maxWinPct: 25.8,
    maxLossPct: -8.5,
    profitFactor: 2.15,
    avgRMultiple: 1.8,
    bestTrade: { tradeId: 'trade-best-1', symbol: '2330.TW', pnlPct: 25.8, pnlAmt: 128000 },
    worstTrade: { tradeId: 'trade-worst-1', symbol: '3008.TW', pnlPct: -8.5, pnlAmt: -42000 },
  },

  riskSummary: {
    riskLevel: '中',
    currentExposurePct: 72,
    grossExposurePct: 72,
    netExposurePct: 72,
    maxSinglePositionPct: 10,
    sectorConcentrationTop: 35,
    var1dPct: 2.1,
    recentAlerts: [
      { id: 'alert-1', level: 'warning', title: '電子股曝險偏高', description: '電子產業佔比達35%，接近40%上限', createdAt: '2024-11-28T10:00:00Z' },
      { id: 'alert-2', level: 'info', title: '整體曝險正常', description: '總曝險72%，位於目標範圍內', createdAt: '2024-11-25T10:00:00Z', resolved: true },
    ],
  },

  xaiSummary: {
    lastUpdate: '2024-11-29T08:00:00Z',
    synopsis: '本策略近期表現優於大盤，主要受惠於正確判斷台積電的突破行情，以及及時減碼獲利了結。目前持股配置偏向電子股，需注意產業集中度風險。',
    keyPoints: [
      '趨勢判斷準確率提升至75%',
      '停損執行紀律良好，平均停損幅度控制在5%以內',
      '加碼時機選擇得當，順勢加碼的成功率達68%',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '量價突破', description: '當股價突破關鍵壓力並伴隨成交量放大，是強烈的趨勢確認訊號', contributionPct: 35, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '均線多頭排列', description: '短中長期均線呈多頭排列，顯示趨勢穩定向上', contributionPct: 25, impact: 'Medium', direction: '正向' },
      { factorId: 'f3', name: '外資動向', description: '外資連續買超是法人認同的重要指標', contributionPct: 20, impact: 'Medium', direction: '正向' },
      { factorId: 'f4', name: '產業利多', description: '產業基本面利多支撐股價上漲動能', contributionPct: 20, impact: 'Medium', direction: '正向' },
    ],
  },

  positions: [
    { symbol: '2330.TW', name: '台積電', side: '多', quantity: 2000, avgPrice: 580, lastPrice: 615, marketValue: 1230000, pnlAmt: 70000, pnlPct: 6.03, weightPct: 25, sector: '半導體' },
    { symbol: '2454.TW', name: '聯發科', side: '多', quantity: 500, avgPrice: 1150, lastPrice: 1285, marketValue: 642500, pnlAmt: 67500, pnlPct: 11.74, weightPct: 13, sector: 'IC設計' },
    { symbol: '2317.TW', name: '鴻海', side: '多', quantity: 5000, avgPrice: 105, lastPrice: 112, marketValue: 560000, pnlAmt: 35000, pnlPct: 6.67, weightPct: 11, sector: '電子代工' },
    { symbol: '2881.TW', name: '富邦金', side: '多', quantity: 8000, avgPrice: 68, lastPrice: 72, marketValue: 576000, pnlAmt: 32000, pnlPct: 5.88, weightPct: 12, sector: '金融' },
    { symbol: '1301.TW', name: '台塑', side: '多', quantity: 3000, avgPrice: 85, lastPrice: 82, marketValue: 246000, pnlAmt: -9000, pnlPct: -3.53, weightPct: 5, sector: '塑化' },
  ],

  recentTrades: [
    { id: 'trade-1', strategyId: 'system-chen-1', expertId: 'person-1', openTime: '2024-11-28T09:30:00Z', symbol: '2330.TW', name: '台積電', side: '買進', quantity: 1000, price: 580, reasonShort: '突破季線壓力，外資連續買超', tags: ['突破', '量增', '外資買超'] },
    { id: 'trade-2', strategyId: 'system-chen-1', expertId: 'person-1', openTime: '2024-11-27T10:15:00Z', symbol: '2454.TW', name: '聯發科', side: '加碼', quantity: 200, price: 1250, reasonShort: '續創新高，5G/AI晶片出貨成長', tags: ['創新高', '基本面利多'] },
    { id: 'trade-3', strategyId: 'system-chen-1', expertId: 'person-1', openTime: '2024-11-25T11:00:00Z', closeTime: '2024-11-27T10:00:00Z', symbol: '3008.TW', name: '大立光', side: '減碼', quantity: 100, price: 2580, pnlAmt: 28000, pnlPct: 12.2, holdingDays: 15, reasonShort: '達目標價位，量能萎縮先獲利了結', tags: ['目標價', '量縮'] },
  ],

  teachingIntro: '本系統專注於捕捉台股的中期波段行情。我們不預測頂底，而是等待趨勢確認後順勢進場，並在趨勢轉弱時逐步出場。重點在於風險控管與部位管理，而非追求單一交易的最大獲利。',
  teachingSections: [
    {
      title: '風險與部位控管',
      bullets: [
        '單一個股部位不超過總資金 10%',
        '同產業曝險不超過 40%',
        '整體持股水位根據大盤位階調整，通常在 50-80%',
        '當回檔超過 7% 時開始減碼，超過 12% 時大幅降低持股',
      ],
    },
    {
      title: '進出場 SOP',
      bullets: [
        '等待突破關鍵均線（如 20MA）並帶量確認',
        '首次進場為預定部位的 30-40%',
        '突破後拉回不破前低則加碼至 60-70%',
        '續創新高且量能配合再加碼至滿倉',
        '跌破 20MA 減碼一半，跌破 60MA 全數出場',
      ],
    },
    {
      title: '常見錯誤與禁止行為',
      bullets: [
        '禁止在下跌趨勢中攤平',
        '不追突破後已漲超過 5% 的標的',
        '不在大盤明顯弱勢時重倉單一個股',
        '避免因「覺得便宜」而提早進場',
      ],
    },
  ],
};

const linAdvisorSystem: StrategySystem = {
  id: 'system-lin-1',
  expertId: 'person-2',
  name: '價值存股 – 高息股',
  level: 'advisor_t1',
  summary: '精選高殖利率且營運穩定的存股標的，長期持有收取股息。',
  tags: ['存股', '價值', '配息', '長期'],
  delayMode: 'realtime',

  performanceSummary: {
    sinceInceptionReturnPct: 42.3,
    annualizedReturnPct: 12.8,
    maxDrawdownPct: -8.5,
    volatilityPct: 8.2,
    sharpeRatio: 1.45,
    winRatePct: 78.5,
    profitFactor: 3.2,
    tradesCount: 28,
    avgHoldingDays: 180,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 1.8, maxDrawdownPct: -1.2, volatilityPct: 5.5, sharpeRatio: 1.8, tradesCount: 2, winRatePct: 100 },
    { period: '3M', cumulativeReturnPct: 4.5, maxDrawdownPct: -2.8, volatilityPct: 6.2, sharpeRatio: 1.6, tradesCount: 5, winRatePct: 80 },
    { period: '6M', cumulativeReturnPct: 8.2, maxDrawdownPct: -4.5, volatilityPct: 7.1, sharpeRatio: 1.5, tradesCount: 10, winRatePct: 80 },
    { period: '1Y', cumulativeReturnPct: 15.6, annualizedReturnPct: 15.6, maxDrawdownPct: -6.8, volatilityPct: 8.2, sharpeRatio: 1.45, bestMonthReturnPct: 3.5, worstMonthReturnPct: -2.1, tradesCount: 18, winRatePct: 78 },
    { period: 'YTD', cumulativeReturnPct: 14.2, maxDrawdownPct: -5.5, volatilityPct: 7.8, sharpeRatio: 1.52, tradesCount: 16, winRatePct: 81 },
    { period: 'SI', cumulativeReturnPct: 42.3, annualizedReturnPct: 12.8, maxDrawdownPct: -8.5, volatilityPct: 9.5, sharpeRatio: 1.35, bestMonthReturnPct: 5.2, worstMonthReturnPct: -3.8, tradesCount: 28, winRatePct: 78.5 },
  ],

  equityHistory: generateEquityHistory(100, 142.3, 365, 0.008),

  tradeStats: {
    totalTrades: 28,
    longTrades: 28,
    shortTrades: 0,
    winTrades: 22,
    loseTrades: 6,
    winRatePct: 78.5,
    avgWinPct: 5.2,
    avgLossPct: -2.8,
    maxWinPct: 15.2,
    maxLossPct: -5.5,
    profitFactor: 3.2,
    avgRMultiple: 2.1,
    bestTrade: { tradeId: 'trade-lin-best', symbol: '2882.TW', pnlPct: 15.2, pnlAmt: 45000 },
    worstTrade: { tradeId: 'trade-lin-worst', symbol: '2801.TW', pnlPct: -5.5, pnlAmt: -16500 },
  },

  riskSummary: {
    riskLevel: '低',
    currentExposurePct: 85,
    grossExposurePct: 85,
    netExposurePct: 85,
    maxSinglePositionPct: 20,
    sectorConcentrationTop: 45,
    var1dPct: 0.8,
    recentAlerts: [
      { id: 'alert-lin-1', level: 'info', title: '金融股配置達標', description: '金融股佔比45%，達到目標配置', createdAt: '2024-11-28T10:00:00Z' },
    ],
  },

  xaiSummary: {
    lastUpdate: '2024-11-29T08:00:00Z',
    synopsis: '存股策略持續穩健運作，今年股息收入約佔總報酬40%。目前配置以金融、電信等高殖利率標的為主，整體組合殖利率約4.8%。',
    keyPoints: [
      '股息再投資策略有效提升長期報酬',
      '選股著重配息穩定性而非一次性高殖利率',
      '分散於金融、電信、傳產等低波動產業',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '殖利率篩選', description: '選擇5年平均殖利率>4%且穩定配息的標的', contributionPct: 40, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '營運穩定度', description: '本業獲利穩定，非依靠業外收入', contributionPct: 30, impact: 'High', direction: '正向' },
      { factorId: 'f3', name: '產業護城河', description: '具備特許權或寡占優勢的產業', contributionPct: 30, impact: 'Medium', direction: '正向' },
    ],
  },

  positions: [
    { symbol: '2412.TW', name: '中華電', side: '多', quantity: 10000, avgPrice: 118, lastPrice: 122, marketValue: 1220000, pnlAmt: 40000, pnlPct: 3.39, weightPct: 20, sector: '電信' },
    { symbol: '2882.TW', name: '國泰金', side: '多', quantity: 15000, avgPrice: 52, lastPrice: 58, marketValue: 870000, pnlAmt: 90000, pnlPct: 11.54, weightPct: 15, sector: '金融' },
    { symbol: '2884.TW', name: '玉山金', side: '多', quantity: 20000, avgPrice: 26, lastPrice: 28, marketValue: 560000, pnlAmt: 40000, pnlPct: 7.69, weightPct: 10, sector: '金融' },
    { symbol: '5880.TW', name: '合庫金', side: '多', quantity: 25000, avgPrice: 28, lastPrice: 29.5, marketValue: 737500, pnlAmt: 37500, pnlPct: 5.36, weightPct: 12, sector: '金融' },
    { symbol: '9904.TW', name: '寶成', side: '多', quantity: 8000, avgPrice: 35, lastPrice: 36.5, marketValue: 292000, pnlAmt: 12000, pnlPct: 4.29, weightPct: 5, sector: '紡織' },
  ],

  recentTrades: [
    { id: 'trade-lin-1', strategyId: 'system-lin-1', expertId: 'person-2', openTime: '2024-11-25T09:30:00Z', symbol: '2412.TW', name: '中華電', side: '買進', quantity: 2000, price: 120, reasonShort: '股價回落至低檔區，殖利率回升至4.5%', tags: ['殖利率提升', '逢低加碼'] },
    { id: 'trade-lin-2', strategyId: 'system-lin-1', expertId: 'person-2', openTime: '2024-11-20T10:00:00Z', symbol: '2882.TW', name: '國泰金', side: '加碼', quantity: 3000, price: 55, reasonShort: '金控股評價偏低，長期配息穩定', tags: ['價值低估', '定期加碼'] },
  ],

  teachingIntro: '本系統專注於建立穩定的被動收入來源。我們挑選殖利率穩定、配息紀錄良好且營運穩健的標的，採用定期定額或逢低加碼的方式累積部位，長期持有並再投資股息。',
  teachingSections: [
    {
      title: '選股條件',
      bullets: [
        '近 5 年平均殖利率 > 4%',
        '配息穩定度高，不會大幅波動',
        '本業獲利穩定，非一次性收益',
        '產業具護城河或政府特許',
      ],
    },
    {
      title: '買進策略',
      bullets: [
        '定期定額為主，每月固定投入',
        '股價跌至歷史低檔區時可加碼',
        '單一標的不超過總存股部位 20%',
        '至少持有 5-8 檔分散風險',
      ],
    },
    {
      title: '注意事項',
      bullets: [
        '不因股價短期下跌而恐慌賣出',
        '配息減少或基本面惡化時需重新評估',
        '避免高殖利率陷阱（一次性配息、借錢配息）',
      ],
    },
  ],
};

const wuMentorSystem: StrategySystem = {
  id: 'system-wu-1',
  expertId: 'person-3',
  name: '短線動能 – 台股',
  level: 'coach_weekly',
  summary: '捕捉短線強勢股的動能行情，快進快出。所有內容延遲一週發布，僅供教學參考。',
  tags: ['短線', '動能', '技術分析', '教學'],
  delayMode: 't7',

  performanceSummary: {
    sinceInceptionReturnPct: 85.2,
    annualizedReturnPct: 35.8,
    maxDrawdownPct: -18.5,
    volatilityPct: 28.5,
    sharpeRatio: 1.25,
    winRatePct: 52.5,
    profitFactor: 1.85,
    tradesCount: 186,
    avgHoldingDays: 3,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 8.5, maxDrawdownPct: -5.2, volatilityPct: 22.5, sharpeRatio: 1.5, tradesCount: 18, winRatePct: 55 },
    { period: '3M', cumulativeReturnPct: 22.5, maxDrawdownPct: -12.8, volatilityPct: 25.2, sharpeRatio: 1.35, tradesCount: 52, winRatePct: 54 },
    { period: '6M', cumulativeReturnPct: 38.2, maxDrawdownPct: -15.5, volatilityPct: 26.8, sharpeRatio: 1.28, tradesCount: 95, winRatePct: 53 },
    { period: '1Y', cumulativeReturnPct: 58.5, annualizedReturnPct: 58.5, maxDrawdownPct: -18.5, volatilityPct: 28.5, sharpeRatio: 1.25, bestMonthReturnPct: 15.2, worstMonthReturnPct: -8.5, tradesCount: 186, winRatePct: 52.5 },
    { period: 'YTD', cumulativeReturnPct: 52.8, maxDrawdownPct: -16.2, volatilityPct: 27.2, sharpeRatio: 1.3, tradesCount: 168, winRatePct: 53 },
    { period: 'SI', cumulativeReturnPct: 85.2, annualizedReturnPct: 35.8, maxDrawdownPct: -22.5, volatilityPct: 32.5, sharpeRatio: 1.15, bestMonthReturnPct: 18.5, worstMonthReturnPct: -12.2, tradesCount: 420, winRatePct: 51.8 },
  ],

  equityHistory: generateEquityHistory(100, 185.2, 365, 0.025),

  tradeStats: {
    totalTrades: 186,
    longTrades: 165,
    shortTrades: 21,
    winTrades: 98,
    loseTrades: 88,
    winRatePct: 52.5,
    avgWinPct: 5.8,
    avgLossPct: -3.2,
    maxWinPct: 28.5,
    maxLossPct: -8.5,
    profitFactor: 1.85,
    avgRMultiple: 1.6,
    bestTrade: { tradeId: 'trade-wu-best', symbol: '3443.TW', pnlPct: 28.5, pnlAmt: 85000 },
    worstTrade: { tradeId: 'trade-wu-worst', symbol: '6547.TW', pnlPct: -8.5, pnlAmt: -25500 },
  },

  riskSummary: {
    riskLevel: '高',
    currentExposurePct: 45,
    grossExposurePct: 45,
    netExposurePct: 38,
    maxSinglePositionPct: 8,
    sectorConcentrationTop: 25,
    var1dPct: 3.5,
    recentAlerts: [
      { id: 'alert-wu-1', level: 'warning', title: '連續虧損提醒', description: '近期連續2筆虧損，建議降低部位', createdAt: '2024-11-22T10:00:00Z' },
      { id: 'alert-wu-2', level: 'info', title: '波動度上升', description: '市場波動加大，已調降單筆風險', createdAt: '2024-11-20T10:00:00Z', resolved: true },
    ],
  },

  xaiSummary: {
    lastUpdate: '2024-11-22T08:00:00Z',
    synopsis: '短線策略近期表現波動較大，主要受市場震盪影響。但嚴守停損紀律，虧損控制在可接受範圍。本週重點教學：如何在震盪市場中減少交易頻率。',
    keyPoints: [
      '嚴格執行 2% 單筆風險上限',
      '震盪市場中降低交易頻率是正確決策',
      '量價突破仍是最有效的進場訊號',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '量價突破', description: '突破前高且成交量放大1.5倍以上', contributionPct: 45, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '均線支撐', description: '5MA向上且股價站穩其上', contributionPct: 25, impact: 'Medium', direction: '正向' },
      { factorId: 'f3', name: '市場氛圍', description: '大盤不在明顯空頭格局時勝率較高', contributionPct: 30, impact: 'Medium', direction: '正向' },
    ],
  },

  positions: [
    { symbol: '3443.TW', name: '創意', side: '多', quantity: 500, avgPrice: 1250, lastPrice: 1380, marketValue: 690000, pnlAmt: 65000, pnlPct: 10.4, weightPct: 15, sector: 'IC設計', note: 'T+7 教學用' },
    { symbol: '6547.TW', name: '高端疫苗', side: '多', quantity: 2000, avgPrice: 125, lastPrice: 118, marketValue: 236000, pnlAmt: -14000, pnlPct: -5.6, weightPct: 5, sector: '生技', note: 'T+7 教學用' },
  ],

  recentTrades: [
    { id: 'trade-wu-1', strategyId: 'system-wu-1', expertId: 'person-3', openTime: '2024-11-21T09:30:00Z', closeTime: '2024-11-22T10:00:00Z', symbol: '3443.TW', name: '創意', side: '買進', quantity: 500, price: 1250, pnlAmt: 65000, pnlPct: 10.4, holdingDays: 1, reasonShort: '突破前高，量能放大2倍，AI概念股領漲', tags: ['突破', '量增', 'AI概念'] },
    { id: 'trade-wu-2', strategyId: 'system-wu-1', expertId: 'person-3', openTime: '2024-11-20T09:30:00Z', closeTime: '2024-11-21T09:00:00Z', symbol: '6547.TW', name: '高端疫苗', side: '停損', quantity: 1000, price: 118, pnlAmt: -7000, pnlPct: -5.6, holdingDays: 1, reasonShort: '跌破停損點，執行紀律出場', tags: ['停損', '紀律'] },
  ],

  teachingIntro: '本系統專注於捕捉短線的動能行情。我們尋找量價齊揚、突破關鍵壓力的強勢股，快速進場並設定嚴格停損。這個系統強調紀律與執行力，不適合猶豫不決的操作風格。',
  teachingSections: [
    {
      title: '風險控管',
      bullets: [
        '單筆交易風險不超過總資金 2%',
        '每日最多進行 3 筆新交易',
        '當日虧損達 3% 時停止交易',
        '連續虧損 3 筆後休息一天',
      ],
    },
    {
      title: '進場條件',
      bullets: [
        '突破近期高點且成交量放大 1.5 倍以上',
        '5MA 向上且股價站穩其上',
        '大盤不在明顯空頭格局',
        '進場後立即設定停損（通常為 3-5%）',
      ],
    },
    {
      title: '出場原則',
      bullets: [
        '達到停損點無條件出場',
        '獲利達 5-10% 可先出一半',
        '隔日開盤跳空下跌直接出場',
        '持有超過 3 天未表態則減碼',
      ],
    },
  ],
};

const huangMentorSystem: StrategySystem = {
  id: 'system-huang-1',
  expertId: 'person-4',
  name: 'ETF 資產配置',
  level: 'coach_weekly',
  summary: '透過美股 ETF 建立全球化的資產配置組合。所有內容延遲一週發布，僅供教學參考。',
  tags: ['ETF', '資產配置', '被動投資', '長期'],
  delayMode: 't7',

  performanceSummary: {
    sinceInceptionReturnPct: 28.5,
    annualizedReturnPct: 9.2,
    maxDrawdownPct: -12.5,
    volatilityPct: 10.5,
    sharpeRatio: 0.85,
    winRatePct: 72.5,
    profitFactor: 2.8,
    tradesCount: 24,
    avgHoldingDays: 365,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 2.1, maxDrawdownPct: -1.5, volatilityPct: 8.5, sharpeRatio: 1.2, tradesCount: 1, winRatePct: 100 },
    { period: '3M', cumulativeReturnPct: 5.8, maxDrawdownPct: -3.2, volatilityPct: 9.2, sharpeRatio: 1.0, tradesCount: 3, winRatePct: 100 },
    { period: '6M', cumulativeReturnPct: 8.5, maxDrawdownPct: -6.5, volatilityPct: 10.1, sharpeRatio: 0.9, tradesCount: 6, winRatePct: 83 },
    { period: '1Y', cumulativeReturnPct: 12.8, annualizedReturnPct: 12.8, maxDrawdownPct: -10.2, volatilityPct: 10.5, sharpeRatio: 0.85, bestMonthReturnPct: 4.5, worstMonthReturnPct: -3.8, tradesCount: 12, winRatePct: 75 },
    { period: 'YTD', cumulativeReturnPct: 11.5, maxDrawdownPct: -8.5, volatilityPct: 10.2, sharpeRatio: 0.88, tradesCount: 10, winRatePct: 80 },
    { period: 'SI', cumulativeReturnPct: 28.5, annualizedReturnPct: 9.2, maxDrawdownPct: -12.5, volatilityPct: 11.5, sharpeRatio: 0.82, bestMonthReturnPct: 6.2, worstMonthReturnPct: -5.5, tradesCount: 24, winRatePct: 72.5 },
  ],

  equityHistory: generateEquityHistory(100, 128.5, 365, 0.01),

  tradeStats: {
    totalTrades: 24,
    longTrades: 24,
    shortTrades: 0,
    winTrades: 18,
    loseTrades: 6,
    winRatePct: 72.5,
    avgWinPct: 3.8,
    avgLossPct: -2.1,
    maxWinPct: 8.5,
    maxLossPct: -4.2,
    profitFactor: 2.8,
    avgRMultiple: 1.5,
    bestTrade: { tradeId: 'trade-huang-best', symbol: 'VTI', pnlPct: 8.5, pnlAmt: 25500 },
    worstTrade: { tradeId: 'trade-huang-worst', symbol: 'BND', pnlPct: -4.2, pnlAmt: -8400 },
  },

  riskSummary: {
    riskLevel: '低',
    currentExposurePct: 95,
    grossExposurePct: 95,
    netExposurePct: 95,
    maxSinglePositionPct: 50,
    sectorConcentrationTop: 50,
    var1dPct: 1.2,
    recentAlerts: [
      { id: 'alert-huang-1', level: 'info', title: '再平衡提醒', description: '債券部位偏離目標5%，建議再平衡', createdAt: '2024-11-25T10:00:00Z' },
    ],
  },

  xaiSummary: {
    lastUpdate: '2024-11-22T08:00:00Z',
    synopsis: 'ETF配置策略持續穩健運作，今年表現略優於60/40基準組合。本月進行了一次再平衡，將美股部位降低5%，增加債券部位以維持目標配置。',
    keyPoints: [
      '被動投資核心在於低成本與分散',
      '再平衡是控制風險的重要工具',
      '長期持有比擇時進出更有效',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '資產配置', description: '股債配置比例根據風險承受度設定', contributionPct: 50, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '定期再平衡', description: '每季檢視，偏離5%以上時再平衡', contributionPct: 30, impact: 'Medium', direction: '正向' },
      { factorId: 'f3', name: '低成本ETF', description: '選擇費用率<0.1%的指數型ETF', contributionPct: 20, impact: 'Medium', direction: '正向' },
    ],
  },

  positions: [
    { symbol: 'VTI', name: 'Vanguard 全美股票ETF', side: '多', quantity: 150, avgPrice: 220, lastPrice: 245, marketValue: 36750, pnlAmt: 3750, pnlPct: 11.36, weightPct: 45, sector: '美股', note: 'T+7 教學用' },
    { symbol: 'VXUS', name: 'Vanguard 國際股票ETF', side: '多', quantity: 200, avgPrice: 58, lastPrice: 62, marketValue: 12400, pnlAmt: 800, pnlPct: 6.9, weightPct: 15, sector: '國際股', note: 'T+7 教學用' },
    { symbol: 'BND', name: 'Vanguard 債券ETF', side: '多', quantity: 180, avgPrice: 75, lastPrice: 73, marketValue: 13140, pnlAmt: -360, pnlPct: -2.67, weightPct: 16, sector: '債券', note: 'T+7 教學用' },
    { symbol: 'VNQ', name: 'Vanguard REITs ETF', side: '多', quantity: 50, avgPrice: 85, lastPrice: 88, marketValue: 4400, pnlAmt: 150, pnlPct: 3.53, weightPct: 5, sector: 'REITs', note: 'T+7 教學用' },
  ],

  recentTrades: [
    { id: 'trade-huang-1', strategyId: 'system-huang-1', expertId: 'person-4', openTime: '2024-11-20T09:30:00Z', symbol: 'BND', name: 'Vanguard 債券ETF', side: '買進', quantity: 30, price: 73, reasonShort: '再平衡：增加債券部位至目標比例', tags: ['再平衡', '定期投入'] },
    { id: 'trade-huang-2', strategyId: 'system-huang-1', expertId: 'person-4', openTime: '2024-11-20T09:30:00Z', symbol: 'VTI', name: 'Vanguard 全美股票ETF', side: '減碼', quantity: 10, price: 245, reasonShort: '再平衡：美股超配，賣出部分獲利', tags: ['再平衡', '獲利了結'] },
  ],

  teachingIntro: '本系統採用被動投資的理念，透過低成本的 ETF 建立全球化的資產配置。我們不試圖擇時，而是透過分散投資與定期再平衡來降低風險、追求長期穩定報酬。',
  teachingSections: [
    {
      title: '核心配置',
      bullets: [
        '美股大盤 ETF（如 VTI、SPY）佔 40-50%',
        '國際市場 ETF（如 VXUS）佔 15-25%',
        '債券 ETF（如 BND、AGG）佔 20-30%',
        '可選配置：REITs、黃金等佔 0-10%',
      ],
    },
    {
      title: '執行方式',
      bullets: [
        '每月定期投入固定金額',
        '每季檢視一次配置比例',
        '偏離目標配置 5% 以上時再平衡',
        '避免頻繁交易產生額外成本',
      ],
    },
    {
      title: '心態建設',
      bullets: [
        '市場下跌時是加碼好時機',
        '不因短期波動改變長期計畫',
        '專注於可控因素：成本、紀律、時間',
      ],
    },
  ],
};

// ============================================
// Weekly Reviews (for Coach/Mentor)
// ============================================
// 趙彭博 - 投顧分析師系統
// ============================================

const zhaoAdvisorSystem: StrategySystem = {
  id: 'system-zhao-pengbo',
  expertId: 'person-5',
  name: '漲停8招 – 台股當沖',
  level: 'advisor_t1',
  summary: '運用獨創「4有」指標系統，捕捉當日漲停潛力股，快進快出。工商時報台股逐洞賽56屆冠軍。',
  tags: ['當沖', '漲停', '短線', '技術分析', '台股'],
  delayMode: 'realtime',

  performanceSummary: {
    sinceInceptionReturnPct: 680,
    annualizedReturnPct: 85.5,
    maxDrawdownPct: -22.8,
    volatilityPct: 35.2,
    sharpeRatio: 2.15,
    winRatePct: 68.5,
    profitFactor: 3.25,
    tradesCount: 441,
    avgHoldingDays: 1.5,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 12.8, maxDrawdownPct: -6.5, volatilityPct: 28.5, sharpeRatio: 2.2, tradesCount: 35, winRatePct: 71 },
    { period: '3M', cumulativeReturnPct: 38.5, maxDrawdownPct: -12.2, volatilityPct: 32.5, sharpeRatio: 2.1, tradesCount: 98, winRatePct: 69 },
    { period: '6M', cumulativeReturnPct: 72.8, maxDrawdownPct: -18.5, volatilityPct: 34.2, sharpeRatio: 2.05, tradesCount: 185, winRatePct: 68 },
    { period: '1Y', cumulativeReturnPct: 125.5, annualizedReturnPct: 125.5, maxDrawdownPct: -22.8, volatilityPct: 35.2, sharpeRatio: 2.15, bestMonthReturnPct: 28.5, worstMonthReturnPct: -12.5, tradesCount: 380, winRatePct: 68.5 },
    { period: 'YTD', cumulativeReturnPct: 98.5, maxDrawdownPct: -20.2, volatilityPct: 33.8, sharpeRatio: 2.18, tradesCount: 320, winRatePct: 69 },
    { period: 'SI', cumulativeReturnPct: 680, annualizedReturnPct: 85.5, maxDrawdownPct: -28.5, volatilityPct: 38.2, sharpeRatio: 2.0, bestMonthReturnPct: 45.2, worstMonthReturnPct: -15.8, tradesCount: 441, winRatePct: 68.5 },
  ],

  equityHistory: generateEquityHistory(100, 780, 365, 0.035),

  tradeStats: {
    totalTrades: 441,
    longTrades: 420,
    shortTrades: 21,
    winTrades: 302,
    loseTrades: 139,
    winRatePct: 68.5,
    avgWinPct: 8.2,
    avgLossPct: -3.5,
    maxWinPct: 45.8,
    maxLossPct: -10.0,
    profitFactor: 3.25,
    avgRMultiple: 2.8,
    bestTrade: { tradeId: 'trade-zhao-best', symbol: '6770.TW', pnlPct: 45.8, pnlAmt: 458000 },
    worstTrade: { tradeId: 'trade-zhao-worst', symbol: '3680.TW', pnlPct: -10.0, pnlAmt: -50000 },
  },

  riskSummary: {
    riskLevel: '高',
    currentExposurePct: 55,
    grossExposurePct: 55,
    netExposurePct: 50,
    maxSinglePositionPct: 15,
    sectorConcentrationTop: 40,
    var1dPct: 4.5,
    recentAlerts: [
      { id: 'alert-zhao-1', level: 'info', title: '今日戰績', description: '今日2勝1負，累積報酬+3.2%', createdAt: '2024-11-29T14:00:00Z' },
      { id: 'alert-zhao-2', level: 'warning', title: '電子股集中', description: '電子股部位達40%，注意產業集中風險', createdAt: '2024-11-28T10:00:00Z' },
    ],
  },

  xaiSummary: {
    lastUpdate: '2024-11-29T14:00:00Z',
    synopsis: '漲停8招策略持續展現高勝率與高報酬特性。本月重點捕捉AI概念股與IC設計族群的漲停機會，「4有」指標觸發準確率維持在85%以上。',
    keyPoints: [
      '「4有」同步訊號觸發時勝率高達78%',
      '嚴格執行2%單筆停損，有效控制風險',
      '盤中快速判斷能力是關鍵成功因素',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '有漲', description: '股價站上均線且盤中表現強勢，突破關鍵價位', contributionPct: 30, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '有人', description: '委買量大於委賣量，買盤積極掛單', contributionPct: 25, impact: 'High', direction: '正向' },
      { factorId: 'f3', name: '有人買', description: '散戶買超訊號，市場人氣聚集', contributionPct: 20, impact: 'Medium', direction: '正向' },
      { factorId: 'f4', name: '有大人買', description: '大戶/法人連續買超，主力進場跡象', contributionPct: 25, impact: 'High', direction: '正向' },
    ],
  },

  positions: [
    { symbol: '6770.TW', name: '力積電', side: '多', quantity: 5000, avgPrice: 38, lastPrice: 42.5, marketValue: 212500, pnlAmt: 22500, pnlPct: 11.84, weightPct: 18, sector: '半導體' },
    { symbol: '3661.TW', name: '世芯-KY', side: '多', quantity: 200, avgPrice: 2850, lastPrice: 3050, marketValue: 610000, pnlAmt: 40000, pnlPct: 7.02, weightPct: 25, sector: 'IC設計' },
    { symbol: '2603.TW', name: '長榮', side: '多', quantity: 3000, avgPrice: 185, lastPrice: 195, marketValue: 585000, pnlAmt: 30000, pnlPct: 5.41, weightPct: 12, sector: '航運' },
    { symbol: '3443.TW', name: '創意', side: '多', quantity: 200, avgPrice: 1420, lastPrice: 1550, marketValue: 310000, pnlAmt: 26000, pnlPct: 9.15, weightPct: 10, sector: 'IC設計' },
    { symbol: '2454.TW', name: '聯發科', side: '多', quantity: 100, avgPrice: 1180, lastPrice: 1285, marketValue: 128500, pnlAmt: 10500, pnlPct: 8.90, weightPct: 8, sector: 'IC設計' },
  ],

  recentTrades: [
    { id: 'trade-zhao-1', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-29T09:15:00Z', closeTime: '2024-11-29T11:30:00Z', symbol: '3443.TW', name: '創意', side: '買進', quantity: 300, price: 1380, pnlAmt: 28500, pnlPct: 6.88, holdingDays: 0, reasonShort: '4有同步觸發，量能放大突破壓力', tags: ['4有', '漲停', '當沖'] },
    { id: 'trade-zhao-2', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-29T09:30:00Z', closeTime: '2024-11-29T10:45:00Z', symbol: '6770.TW', name: '力積電', side: '加碼', quantity: 2000, price: 40, pnlAmt: 5000, pnlPct: 6.25, holdingDays: 0, reasonShort: '開盤強勢表態，委買張數快速增加', tags: ['開盤強勢', '加碼'] },
    { id: 'trade-zhao-3', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-28T09:20:00Z', closeTime: '2024-11-28T09:45:00Z', symbol: '3680.TW', name: '家登', side: '停損', quantity: 500, price: 480, pnlAmt: -12000, pnlPct: -5.0, holdingDays: 0, reasonShort: '跌破停損點，執行紀律出場', tags: ['停損'] },
    { id: 'trade-zhao-4', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-27T09:10:00Z', closeTime: '2024-11-27T10:30:00Z', symbol: '3661.TW', name: '世芯-KY', side: '買進', quantity: 100, price: 2850, pnlAmt: 45000, pnlPct: 10.0, holdingDays: 0, reasonShort: '4有全亮，漲停鎖定', tags: ['4有', '漲停'] },
    { id: 'trade-zhao-5', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-27T13:00:00Z', closeTime: '2024-11-27T13:25:00Z', symbol: '2498.TW', name: '宏達電', side: '買進', quantity: 1000, price: 85, pnlAmt: 8500, pnlPct: 8.5, holdingDays: 0, reasonShort: 'VR題材發酵，量能爆發', tags: ['題材股', '漲停'] },
    { id: 'trade-zhao-6', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-26T09:15:00Z', closeTime: '2024-11-26T10:00:00Z', symbol: '6409.TW', name: '旭隼', side: '買進', quantity: 300, price: 320, pnlAmt: 12000, pnlPct: 7.5, holdingDays: 0, reasonShort: '儲能股洗盤結束，主力進場', tags: ['洗盤結束', '4有'] },
    { id: 'trade-zhao-7', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-26T09:30:00Z', closeTime: '2024-11-26T09:50:00Z', symbol: '3324.TW', name: '雙鴻', side: '停損', quantity: 500, price: 285, pnlAmt: -7000, pnlPct: -2.8, holdingDays: 0, reasonShort: '大盤急跌拖累，停損出場', tags: ['停損'] },
    { id: 'trade-zhao-8', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-25T09:20:00Z', closeTime: '2024-11-25T11:00:00Z', symbol: '3529.TW', name: '力旺', side: '買進', quantity: 200, price: 1850, pnlAmt: 35000, pnlPct: 10.0, holdingDays: 0, reasonShort: 'IP矽智財題材，量價突破', tags: ['漲停', '量價突破'] },
    { id: 'trade-zhao-9', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-25T13:10:00Z', closeTime: '2024-11-25T13:25:00Z', symbol: '2303.TW', name: '聯電', side: '買進', quantity: 5000, price: 52, pnlAmt: 8500, pnlPct: 4.2, holdingDays: 0, reasonShort: '開盤強勢，4有中3有確認', tags: ['4有', '獲利出場'] },
    { id: 'trade-zhao-10', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-22T09:15:00Z', closeTime: '2024-11-22T10:30:00Z', symbol: '2454.TW', name: '聯發科', side: '買進', quantity: 200, price: 1250, pnlAmt: 38000, pnlPct: 10.0, holdingDays: 0, reasonShort: 'IC設計資金回流，量能放大', tags: ['漲停', '量價突破'] },
    { id: 'trade-zhao-11', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-22T09:30:00Z', closeTime: '2024-11-22T09:55:00Z', symbol: '6547.TW', name: '高端疫苗', side: '停損', quantity: 2000, price: 125, pnlAmt: -6500, pnlPct: -2.5, holdingDays: 0, reasonShort: '消息面炒作，量能不持續', tags: ['停損', '假突破'] },
    { id: 'trade-zhao-12', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-21T09:10:00Z', closeTime: '2024-11-21T11:30:00Z', symbol: '3037.TW', name: '欣興', side: '買進', quantity: 500, price: 185, pnlAmt: 15000, pnlPct: 6.5, holdingDays: 0, reasonShort: 'ABF載板需求回溫', tags: ['4有', '獲利出場'] },
    { id: 'trade-zhao-13', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-20T09:15:00Z', closeTime: '2024-11-20T10:45:00Z', symbol: '2382.TW', name: '廣達', side: '買進', quantity: 1000, price: 285, pnlAmt: 25000, pnlPct: 8.8, holdingDays: 0, reasonShort: 'AI伺服器代工龍頭，量價齊揚', tags: ['4有', '漲停'] },
    { id: 'trade-zhao-14', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-20T13:00:00Z', closeTime: '2024-11-20T13:20:00Z', symbol: '2618.TW', name: '長榮航', side: '停損', quantity: 3000, price: 38, pnlAmt: -4800, pnlPct: -3.0, holdingDays: 0, reasonShort: '觀光股輪動結束，主力出貨', tags: ['停損'] },
    { id: 'trade-zhao-15', strategyId: 'system-zhao-pengbo', expertId: 'person-5', openTime: '2024-11-19T09:20:00Z', closeTime: '2024-11-19T11:00:00Z', symbol: '2357.TW', name: '華碩', side: '買進', quantity: 200, price: 485, pnlAmt: 18000, pnlPct: 7.2, holdingDays: 0, reasonShort: 'AI PC題材，均線糾結突破', tags: ['均線突破', '獲利出場'] },
  ],

  teachingIntro: '漲停8招是本人獨創的當沖選股系統，專注於捕捉當日或短期內有漲停潛力的標的。透過「4有」同步指標——有漲、有人、有人買、有大人買，篩選出最具爆發力的飆股。',
  teachingSections: [
    {
      title: '「4有」選股指標',
      bullets: [
        '有漲：股價站上均線、盤中表現強勢、突破關鍵價位',
        '有人：委買量大於委賣量，買盤積極掛單',
        '有人買：散戶買超訊號，市場人氣聚集',
        '有大人買：大戶/法人連續買超，主力進場跡象',
      ],
    },
    {
      title: '漲停8招進場策略',
      bullets: [
        '第一招：量價突破型 – 成交量放大突破壓力區',
        '第二招：開盤強勢型 – 開盤5分鐘內強勢表態',
        '第三招：均線糾結突破 – 均線收斂後向上噴出',
        '第四招：洗盤結束型 – 主力洗盤完畢再啟動',
      ],
    },
    {
      title: '風險控管',
      bullets: [
        '當沖單筆最大虧損 2%，無條件停損',
        '每日停損上限 3%，達標即停止交易',
        '連續虧損 3 筆強制休息一天',
        '獲利達 5% 先出一半，保護利潤',
      ],
    },
  ],
};

// ============================================
// 趙彭博 - 實戰導師系統 (T+7)
// ============================================

const zhaoMentorSystem: StrategySystem = {
  id: 'system-zhao-pengbo-mentor',
  expertId: 'person-6',
  name: '漲停8招 – 實戰教學',
  level: 'coach_weekly',
  summary: '透過 T+7 延遲的實戰案例，完整拆解漲停股的選股邏輯與操作心法。僅供教學參考。',
  tags: ['當沖', '漲停', '教學', '案例分析', 'T+7'],
  delayMode: 't7',

  performanceSummary: {
    sinceInceptionReturnPct: 680,
    annualizedReturnPct: 85.5,
    maxDrawdownPct: -22.8,
    volatilityPct: 35.2,
    sharpeRatio: 2.15,
    winRatePct: 68.5,
    profitFactor: 3.25,
    tradesCount: 441,
    avgHoldingDays: 1.5,
  },

  performanceByPeriod: [
    { period: '1M', cumulativeReturnPct: 12.8, maxDrawdownPct: -6.5, volatilityPct: 28.5, sharpeRatio: 2.2, tradesCount: 35, winRatePct: 71 },
    { period: '3M', cumulativeReturnPct: 38.5, maxDrawdownPct: -12.2, volatilityPct: 32.5, sharpeRatio: 2.1, tradesCount: 98, winRatePct: 69 },
    { period: '6M', cumulativeReturnPct: 72.8, maxDrawdownPct: -18.5, volatilityPct: 34.2, sharpeRatio: 2.05, tradesCount: 185, winRatePct: 68 },
    { period: '1Y', cumulativeReturnPct: 125.5, annualizedReturnPct: 125.5, maxDrawdownPct: -22.8, volatilityPct: 35.2, sharpeRatio: 2.15, bestMonthReturnPct: 28.5, worstMonthReturnPct: -12.5, tradesCount: 380, winRatePct: 68.5 },
    { period: 'YTD', cumulativeReturnPct: 98.5, maxDrawdownPct: -20.2, volatilityPct: 33.8, sharpeRatio: 2.18, tradesCount: 320, winRatePct: 69 },
    { period: 'SI', cumulativeReturnPct: 680, annualizedReturnPct: 85.5, maxDrawdownPct: -28.5, volatilityPct: 38.2, sharpeRatio: 2.0, bestMonthReturnPct: 45.2, worstMonthReturnPct: -15.8, tradesCount: 441, winRatePct: 68.5 },
  ],

  equityHistory: generateEquityHistory(100, 780, 365, 0.035),

  tradeStats: {
    totalTrades: 441,
    longTrades: 420,
    shortTrades: 21,
    winTrades: 302,
    loseTrades: 139,
    winRatePct: 68.5,
    avgWinPct: 8.2,
    avgLossPct: -3.5,
    maxWinPct: 45.8,
    maxLossPct: -10.0,
    profitFactor: 3.25,
    avgRMultiple: 2.8,
    bestTrade: { tradeId: 'trade-zhao-m-best', symbol: '6770.TW', pnlPct: 45.8, pnlAmt: 458000 },
    worstTrade: { tradeId: 'trade-zhao-m-worst', symbol: '3680.TW', pnlPct: -10.0, pnlAmt: -50000 },
  },

  riskSummary: {
    riskLevel: '高',
    currentExposurePct: 55,
    grossExposurePct: 55,
    netExposurePct: 50,
    maxSinglePositionPct: 15,
    sectorConcentrationTop: 40,
    var1dPct: 4.5,
    recentAlerts: [],
  },

  xaiSummary: {
    lastUpdate: '2024-11-22T08:00:00Z',
    synopsis: '本週修煉派週記重點：解析3檔成功捕捉漲停的案例，以及1檔停損出場的失敗案例。透過「4有」指標的實際應用，學習辨識真假突破。',
    keyPoints: [
      '成功案例：創意(3443)的「4有」同步觸發分析',
      '失敗案例：家登(3680)的假突破識別',
      '風控執行：嚴格2%停損的重要性',
    ],
    contributingFactors: [
      { factorId: 'f1', name: '有漲', description: '股價站上均線且盤中表現強勢', contributionPct: 30, impact: 'High', direction: '正向' },
      { factorId: 'f2', name: '有人', description: '委買量大於委賣量', contributionPct: 25, impact: 'High', direction: '正向' },
      { factorId: 'f3', name: '有人買', description: '散戶買超訊號', contributionPct: 20, impact: 'Medium', direction: '正向' },
      { factorId: 'f4', name: '有大人買', description: '大戶/法人買超', contributionPct: 25, impact: 'High', direction: '正向' },
    ],
  },

  positions: [
    { symbol: '6770.TW', name: '力積電', side: '多', quantity: 5000, avgPrice: 38, lastPrice: 42.5, marketValue: 212500, pnlAmt: 22500, pnlPct: 11.84, weightPct: 18, sector: '半導體', note: 'T+7 示範帳戶' },
    { symbol: '3661.TW', name: '世芯-KY', side: '多', quantity: 200, avgPrice: 2850, lastPrice: 3050, marketValue: 610000, pnlAmt: 40000, pnlPct: 7.02, weightPct: 25, sector: 'IC設計', note: 'T+7 示範帳戶' },
    { symbol: '2454.TW', name: '聯發科', side: '多', quantity: 100, avgPrice: 1180, lastPrice: 1285, marketValue: 128500, pnlAmt: 10500, pnlPct: 8.90, weightPct: 12, sector: 'IC設計', note: 'T+7 示範帳戶' },
  ],

  recentTrades: [
    { id: 'trade-zhao-m-1', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-22T09:15:00Z', closeTime: '2024-11-22T11:30:00Z', symbol: '3443.TW', name: '創意', side: '買進', quantity: 300, price: 1380, pnlAmt: 28500, pnlPct: 6.88, holdingDays: 0, reasonShort: '【教學案例】4有同步觸發，量能放大突破壓力', tags: ['4有', '漲停', '成功案例'] },
    { id: 'trade-zhao-m-2', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-21T09:20:00Z', closeTime: '2024-11-21T09:45:00Z', symbol: '3680.TW', name: '家登', side: '停損', quantity: 500, price: 480, pnlAmt: -12000, pnlPct: -5.0, holdingDays: 0, reasonShort: '【教學案例】假突破識別失敗，嚴格執行停損', tags: ['停損', '失敗案例'] },
    { id: 'trade-zhao-m-3', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-20T09:30:00Z', closeTime: '2024-11-20T12:00:00Z', symbol: '6770.TW', name: '力積電', side: '買進', quantity: 3000, price: 42.5, pnlAmt: 45000, pnlPct: 8.8, holdingDays: 0, reasonShort: '【教學案例】開盤強勢，「有人」指標強烈', tags: ['4有', '漲停', '成功案例'] },
    { id: 'trade-zhao-m-4', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-19T09:15:00Z', closeTime: '2024-11-19T10:30:00Z', symbol: '2454.TW', name: '聯發科', side: '買進', quantity: 100, price: 1250, pnlAmt: 15000, pnlPct: 10.0, holdingDays: 0, reasonShort: '【教學案例】4有全亮漲停鎖定', tags: ['4有', '漲停', '成功案例'] },
    { id: 'trade-zhao-m-5', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-18T09:20:00Z', closeTime: '2024-11-18T09:50:00Z', symbol: '6547.TW', name: '高端疫苗', side: '停損', quantity: 2000, price: 125, pnlAmt: -6500, pnlPct: -2.5, holdingDays: 0, reasonShort: '【教學案例】消息面炒作量能不續，紀律停損', tags: ['停損', '失敗案例'] },
    { id: 'trade-zhao-m-6', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-18T09:10:00Z', closeTime: '2024-11-18T11:00:00Z', symbol: '3661.TW', name: '世芯-KY', side: '買進', quantity: 100, price: 2800, pnlAmt: 28000, pnlPct: 10.0, holdingDays: 0, reasonShort: '【教學案例】AI晶片龍頭，4有同步漲停', tags: ['4有', '漲停', '成功案例'] },
    { id: 'trade-zhao-m-7', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-15T09:25:00Z', closeTime: '2024-11-15T10:15:00Z', symbol: '3037.TW', name: '欣興', side: '買進', quantity: 500, price: 185, pnlAmt: 12000, pnlPct: 5.8, holdingDays: 0, reasonShort: '【教學案例】ABF載板回溫，量價突破', tags: ['4有', '獲利出場'] },
    { id: 'trade-zhao-m-8', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-15T13:10:00Z', closeTime: '2024-11-15T13:25:00Z', symbol: '2618.TW', name: '長榮航', side: '停損', quantity: 3000, price: 38, pnlAmt: -4800, pnlPct: -3.0, holdingDays: 0, reasonShort: '【教學案例】輪動股跟單失敗，主力出貨', tags: ['停損', '失敗案例'] },
  ],

  teachingIntro: '本教學系統專注於分享漲停8招的實戰應用。每週透過延遲7天的實戰週記，完整呈現選股過程、進出場時機與事後檢討。所有內容均為歷史案例教學，非即時投資建議。',
  teachingSections: [
    {
      title: '週記教學重點',
      bullets: [
        '每週精選 3-5 檔代表性操作案例',
        '完整記錄「4有」指標觸發條件',
        '詳細解說進場時機與出場邏輯',
        '事後檢討成功與失敗原因',
      ],
    },
    {
      title: '學習目標',
      bullets: [
        '培養盤中快速判斷能力',
        '建立嚴格的停損停利紀律',
        '理解主力操作手法與跡象',
        '掌握當沖與短線的風險控管',
      ],
    },
    {
      title: '注意事項',
      bullets: [
        '所有操作紀錄至少延遲 7 天發布',
        '僅供歷史案例教學，非即時投資建議',
        '當沖風險極高，需自行評估承受能力',
        '建議先以小資金練習，熟悉後再加大部位',
      ],
    },
  ],
};

// ============================================
// Weekly Reviews
// ============================================

export const weeklyReviews: WeeklyReview[] = [
  {
    id: 'review-wu-1',
    expertId: 'person-3',
    strategyId: 'system-wu-1',
    weekStart: '2024-11-18',
    weekEnd: '2024-11-22',
    delayMode: 't7',
    summary: {
      totalReturnPct: 4.8,
      maxDrawdownPct: -3.2,
      tradesCount: 8,
      winRatePct: 62.5,
      bestTrade: { tradeId: 'trade-wu-1', symbol: '3443.TW', pnlPct: 10.4, pnlAmt: 65000 },
      worstTrade: { tradeId: 'trade-wu-2', symbol: '6547.TW', pnlPct: -5.6, pnlAmt: -7000 },
      comment: '本週市場震盪加劇，策略調整為減少交易頻率，專注於高確定性的突破訊號。最成功的交易是創意（3443），抓住AI概念股的動能；最大的失誤是高端疫苗（6547），在訊號不明確時進場導致虧損。教學重點：震盪市場中「少做」比「多做」更重要。',
    },
    equityHistory: generateEquityHistory(100, 104.8, 5, 0.02),
    trades: [
      { id: 'trade-wu-1', strategyId: 'system-wu-1', expertId: 'person-3', openTime: '2024-11-21T09:30:00Z', closeTime: '2024-11-22T10:00:00Z', symbol: '3443.TW', name: '創意', side: '買進', quantity: 500, price: 1250, pnlAmt: 65000, pnlPct: 10.4, holdingDays: 1, reasonShort: '突破前高，量能放大2倍', tags: ['突破', '量增'] },
      { id: 'trade-wu-2', strategyId: 'system-wu-1', expertId: 'person-3', openTime: '2024-11-20T09:30:00Z', closeTime: '2024-11-21T09:00:00Z', symbol: '6547.TW', name: '高端疫苗', side: '停損', quantity: 1000, price: 118, pnlAmt: -7000, pnlPct: -5.6, holdingDays: 1, reasonShort: '跌破停損點，執行紀律出場', tags: ['停損'] },
    ],
  },
  {
    id: 'review-wu-2',
    expertId: 'person-3',
    strategyId: 'system-wu-1',
    weekStart: '2024-11-11',
    weekEnd: '2024-11-15',
    delayMode: 't7',
    summary: {
      totalReturnPct: 6.2,
      maxDrawdownPct: -2.5,
      tradesCount: 10,
      winRatePct: 70,
      bestTrade: { tradeId: 'trade-wu-3', symbol: '2303.TW', pnlPct: 8.5, pnlAmt: 42500 },
      worstTrade: { tradeId: 'trade-wu-4', symbol: '2301.TW', pnlPct: -3.8, pnlAmt: -11400 },
      comment: '本週大盤走勢強勁，策略執行順利。多檔電子股突破表現亮眼，特別是聯電的波段操作。教學重點：順勢操作的重要性，當市場趨勢明確時，應該積極把握機會。',
    },
    equityHistory: generateEquityHistory(100, 106.2, 5, 0.015),
    trades: [],
  },
  {
    id: 'review-huang-1',
    expertId: 'person-4',
    strategyId: 'system-huang-1',
    weekStart: '2024-11-18',
    weekEnd: '2024-11-22',
    delayMode: 't7',
    summary: {
      totalReturnPct: 1.2,
      maxDrawdownPct: -0.8,
      tradesCount: 2,
      winRatePct: 100,
      comment: '本週進行了季度再平衡操作。由於美股今年表現強勁，VTI部位超配，因此賣出部分並增加BND債券部位。教學重點：再平衡不是預測市場走向，而是維持風險水平的紀律動作。',
    },
    equityHistory: generateEquityHistory(100, 101.2, 5, 0.008),
    trades: [
      { id: 'trade-huang-1', strategyId: 'system-huang-1', expertId: 'person-4', openTime: '2024-11-20T09:30:00Z', symbol: 'BND', name: 'Vanguard 債券ETF', side: '買進', quantity: 30, price: 73, reasonShort: '再平衡：增加債券部位', tags: ['再平衡'] },
      { id: 'trade-huang-2', strategyId: 'system-huang-1', expertId: 'person-4', openTime: '2024-11-20T09:30:00Z', symbol: 'VTI', name: 'Vanguard 全美股票ETF', side: '減碼', quantity: 10, price: 245, reasonShort: '再平衡：美股超配', tags: ['再平衡'] },
    ],
  },
  // 趙彭博週記
  {
    id: 'review-zhao-1',
    expertId: 'person-6',
    strategyId: 'system-zhao-pengbo-mentor',
    weekStart: '2024-11-18',
    weekEnd: '2024-11-22',
    delayMode: 't7',
    summary: {
      totalReturnPct: 15.8,
      maxDrawdownPct: -5.2,
      tradesCount: 12,
      winRatePct: 75,
      bestTrade: { tradeId: 'trade-zhao-w-1', symbol: '3443.TW', pnlPct: 12.5, pnlAmt: 75000 },
      worstTrade: { tradeId: 'trade-zhao-w-2', symbol: '3680.TW', pnlPct: -5.0, pnlAmt: -12000 },
      comment: '本週戰績亮眼，成功捕捉3檔漲停股。重點教學：AI概念股創意(3443)的「4有」指標同步觸發分析，以及家登(3680)假突破的識別失敗檢討。當沖最重要的是紀律，不是勝率。',
    },
    equityHistory: generateEquityHistory(100, 115.8, 5, 0.025),
    trades: [
      { id: 'trade-zhao-w-1', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-22T09:15:00Z', closeTime: '2024-11-22T11:30:00Z', symbol: '3443.TW', name: '創意', side: '賣出', quantity: 300, price: 1550, pnlAmt: 75000, pnlPct: 12.5, holdingDays: 0, reasonShort: '4有同步觸發，完美捕捉漲停', tags: ['4有', '漲停', '成功案例'] },
      { id: 'trade-zhao-w-2', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-21T09:20:00Z', closeTime: '2024-11-21T09:45:00Z', symbol: '3680.TW', name: '家登', side: '停損', quantity: 500, price: 480, pnlAmt: -12000, pnlPct: -5.0, holdingDays: 0, reasonShort: '假突破，嚴格執行停損', tags: ['停損', '失敗案例'] },
      { id: 'trade-zhao-w-3', strategyId: 'system-zhao-pengbo-mentor', expertId: 'person-6', openTime: '2024-11-20T09:30:00Z', closeTime: '2024-11-20T12:00:00Z', symbol: '6770.TW', name: '力積電', side: '賣出', quantity: 3000, price: 42.5, pnlAmt: 45000, pnlPct: 8.8, holdingDays: 0, reasonShort: '開盤強勢，「有人」指標強烈', tags: ['4有', '漲停'] },
    ],
  },
];

// ============================================
// Export Strategy Systems Map
// ============================================

export const strategySystems: Record<string, StrategySystem> = {
  'system-chen-1': chenAdvisorSystem,
  'system-lin-1': linAdvisorSystem,
  'system-wu-1': wuMentorSystem,
  'system-huang-1': huangMentorSystem,
  'system-zhao-pengbo': zhaoAdvisorSystem,
  'system-zhao-pengbo-mentor': zhaoMentorSystem,
};

// Helper: Get strategy system by expert slug
export function getStrategySystemByExpertSlug(slug: string): StrategySystem | undefined {
  const expertIdMap: Record<string, string> = {
    'chen-advisor': 'person-1',
    'lin-advisor': 'person-2',
    'wu-mentor': 'person-3',
    'huang-mentor': 'person-4',
    'zhao-pengbo': 'person-5',
    'zhao-pengbo-mentor': 'person-6',
  };
  
  const expertId = expertIdMap[slug];
  if (!expertId) return undefined;
  
  return Object.values(strategySystems).find(s => s.expertId === expertId);
}

// Helper: Get all strategy systems for an expert
export function getStrategySystemsForExpert(expertId: string): StrategySystem[] {
  return Object.values(strategySystems).filter(s => s.expertId === expertId);
}

// Helper: Get weekly reviews for expert
export function getWeeklyReviewsForExpert(expertId: string): WeeklyReview[] {
  return weeklyReviews.filter(r => r.expertId === expertId);
}

// Helper: Get weekly review by ID
export function getWeeklyReviewById(reviewId: string): WeeklyReview | undefined {
  return weeklyReviews.find(r => r.id === reviewId);
}

// ============================================
// Period Performance Data Types & Helpers
// ============================================

export interface StockPerf {
  symbol: string;
  name: string;
  returnPct: number;
}

 export interface StockTradeDetail extends StockPerf {
   entryDate: string;
   entryPrice: number;
   currentPrice: number;
   holdingDays: number;
   quantity?: number;
   marketValue?: number;
   pnlAmt?: number;
   contributionNote: string;
 }
 
export interface PeriodPerformance {
  label: string;        // "2024", "2024-11", "W48"
  date: string;         // 用於排序
  returnPct: number;    // 報酬率
  topStock?: StockPerf; // 最佳個股
  bottomStock?: StockPerf; // 最差個股
   stocks?: StockTradeDetail[]; // 完整個股列表（用於展開）
}

// Mock 個股資料 pool
const stockPool: StockPerf[] = [
  { symbol: '2330.TW', name: '台積電', returnPct: 0 },
  { symbol: '2454.TW', name: '聯發科', returnPct: 0 },
  { symbol: '2317.TW', name: '鴻海', returnPct: 0 },
  { symbol: '2881.TW', name: '富邦金', returnPct: 0 },
  { symbol: '2882.TW', name: '國泰金', returnPct: 0 },
  { symbol: '2412.TW', name: '中華電', returnPct: 0 },
  { symbol: '1301.TW', name: '台塑', returnPct: 0 },
  { symbol: '3008.TW', name: '大立光', returnPct: 0 },
  { symbol: '2308.TW', name: '台達電', returnPct: 0 },
  { symbol: '3443.TW', name: '創意', returnPct: 0 },
  { symbol: '6770.TW', name: '力積電', returnPct: 0 },
  { symbol: '2303.TW', name: '聯電', returnPct: 0 },
];

// 生成隨機個股績效
 function generateRandomStocks(baseReturn: number, periodDate: string): StockTradeDetail[] {
   return stockPool.map(stock => {
     const returnPct = Math.round((baseReturn + (Math.random() - 0.5) * 20) * 10) / 10;
     const entryPrice = Math.round((100 + Math.random() * 500) * 10) / 10;
     const currentPrice = Math.round(entryPrice * (1 + returnPct / 100) * 10) / 10;
     const holdingDays = Math.floor(Math.random() * 60) + 5;
     const quantity = Math.floor(Math.random() * 5 + 1) * 1000;
     
     // 動態生成貢獻說明
     let contributionNote: string;
     if (returnPct > 10) {
       contributionNote = `本期獲利主力，貢獻整體績效約 ${Math.abs(returnPct * 0.15).toFixed(1)}%。股價突破關鍵壓力區後持續走高，外資持續買超支撐。`;
     } else if (returnPct > 0) {
       contributionNote = `穩定貢獻正報酬，符合策略預期。維持原有部位配置，持續觀察趨勢變化。`;
     } else if (returnPct > -5) {
       contributionNote = `小幅回檔整理中，尚在停損線之上。密切關注支撐位守住情況。`;
     } else {
       contributionNote = `本期拖累績效主因，已觸及停損條件。檢討進場時機與部位控管，作為後續教學案例。`;
     }
     
     return {
       ...stock,
       returnPct,
       entryDate: generateEntryDate(periodDate, holdingDays),
       entryPrice,
       currentPrice,
       holdingDays,
       quantity,
       pnlAmt: Math.round((currentPrice - entryPrice) * quantity),
       contributionNote,
     };
   }).sort((a, b) => b.returnPct - a.returnPct);
 }
 
 function generateEntryDate(periodDate: string, holdingDays: number): string {
   const endDate = new Date(periodDate);
   const entryDate = new Date(endDate);
   entryDate.setDate(endDate.getDate() - holdingDays);
   return entryDate.toISOString().split('T')[0];
}

// 生成年度績效數據
function generateYearlyPerformance(system: StrategySystem): PeriodPerformance[] {
  const years = [2022, 2023, 2024, 2025];
  const baseReturns = [12.5, 25.8, 32.4, 8.2];
  
  return years.map((year, idx) => {
     const periodDate = `${year}-12-31`;
     const stocks = generateRandomStocks(baseReturns[idx], periodDate);
    return {
      label: year.toString(),
       date: periodDate,
      returnPct: baseReturns[idx],
      topStock: stocks[0],
      bottomStock: stocks[stocks.length - 1],
      stocks,
    };
  });
}

// 生成月度績效數據
function generateMonthlyPerformance(system: StrategySystem): PeriodPerformance[] {
  const months: PeriodPerformance[] = [];
  const now = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = date.toISOString().slice(0, 7); // "2024-11"
    const monthLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    // 基於 system 績效生成月報酬（加點隨機性）
    const baseReturn = (system.performanceSummary.annualizedReturnPct || 20) / 12;
    const returnPct = Math.round((baseReturn + (Math.random() - 0.5) * 8) * 10) / 10;
     const stocks = generateRandomStocks(returnPct, monthStr);
    
    months.push({
      label: monthLabel,
      date: monthStr,
      returnPct,
      topStock: stocks[0],
      bottomStock: stocks[stocks.length - 1],
      stocks,
    });
  }
  
  return months;
}

// 生成週度績效數據
function generateWeeklyPerformance(system: StrategySystem): PeriodPerformance[] {
  const weeks: PeriodPerformance[] = [];
  const now = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const weekDate = new Date(now);
    weekDate.setDate(weekDate.getDate() - i * 7);
    const weekNum = Math.ceil((weekDate.getDate() + new Date(weekDate.getFullYear(), weekDate.getMonth(), 1).getDay()) / 7);
    const weekLabel = `W${String(52 - i).padStart(2, '0')}`;
    
    const baseReturn = (system.performanceSummary.annualizedReturnPct || 20) / 52;
    const returnPct = Math.round((baseReturn + (Math.random() - 0.5) * 4) * 10) / 10;
     const weekDateStr = weekDate.toISOString().slice(0, 10);
     const stocks = generateRandomStocks(returnPct, weekDateStr);
    
    weeks.push({
      label: weekLabel,
       date: weekDateStr,
      returnPct,
      topStock: stocks[0],
      bottomStock: stocks[stocks.length - 1],
      stocks,
    });
  }
  
  return weeks;
}

// 取得指定維度的績效資料
export function getPerformanceByPeriod(
  expertSlug: string,
  period: 'yearly' | 'monthly' | 'weekly'
): PeriodPerformance[] {
  const system = getStrategySystemByExpertSlug(expertSlug);
  if (!system) return [];
  
  switch (period) {
    case 'yearly':
      return generateYearlyPerformance(system);
    case 'monthly':
      return generateMonthlyPerformance(system);
    case 'weekly':
      return generateWeeklyPerformance(system);
  }
}
