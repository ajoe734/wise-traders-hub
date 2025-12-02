import { 
  PersonRole, 
  PlanType, 
  SubscriptionStatus, 
  SignalAction,
  User,
  Person,
  TradingSystem,
  Plan,
  Subscription,
  Signal,
  WeeklyJournal,
  PersonWithPlans,
  SubscriptionWithDetails,
  SignalWithPerson,
  JournalWithPerson
} from '@/types';

// Demo User
export const demoUser: User = {
  id: 'user-1',
  email: 'demo@example.com',
  name: '王小明',
  createdAt: new Date('2024-01-15'),
};

// People (Advisors & Mentors)
export const people: Person[] = [
  {
    id: 'person-1',
    slug: 'chen-advisor',
    name: '陳建宏',
    role: PersonRole.ADVISOR,
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
    bio: '20 年投資經驗，專精台股波段操作',
    description: '曾任券商自營部主管，擁有證券分析師執照。專注於台股中長期波段操作，擅長結合基本面與技術面分析，在多空循環中穩健獲利。',
    styleTags: ['波段', '價值', '中長期'],
    markets: ['台股'],
    riskTolerance: '中性',
    timeframe: '中期',
  },
  {
    id: 'person-2',
    slug: 'lin-advisor',
    name: '林美玲',
    role: PersonRole.ADVISOR,
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&h=150&fit=crop&crop=face',
    bio: '存股專家，專注配息穩定的長期投資',
    description: '15 年金融業資歷，持有投信投顧業務員資格。專注於存股策略，挑選高殖利率且營運穩定的標的，適合追求穩定現金流的投資人。',
    styleTags: ['存股', '配息', '長期'],
    markets: ['台股', '美股'],
    riskTolerance: '保守',
    timeframe: '長期',
  },
  {
    id: 'person-3',
    slug: 'wu-mentor',
    name: '吳志明',
    role: PersonRole.MENTOR,
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face',
    bio: '短線交易教學，分享實戰經驗與檢討',
    description: '10 年交易經驗，擅長短線與當沖操作。每週透過 T+7 實戰週記，完整拆解一週的操作邏輯、風險控管與事後檢討，幫助學員建立正確的交易觀念。',
    styleTags: ['短線', '技術分析', '教學'],
    markets: ['台股'],
    riskTolerance: '積極',
    timeframe: '短期',
  },
  {
    id: 'person-4',
    slug: 'huang-mentor',
    name: '黃雅琪',
    role: PersonRole.MENTOR,
    avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face',
    bio: '美股ETF教學，專注資產配置策略',
    description: '財經部落客，擅長美股 ETF 投資與資產配置。透過實戰週記分享投資組合調整過程，教導學員如何建立長期穩健的投資系統。',
    styleTags: ['ETF', '資產配置', '美股'],
    markets: ['美股'],
    riskTolerance: '中性',
    timeframe: '中長期',
  },
  // 趙彭博 - 投顧分析師角色
  {
    id: 'person-5',
    slug: 'zhao-advisor',
    name: '趙彭博',
    role: PersonRole.ADVISOR,
    avatarUrl: '/images/experts/zhao-pengbo.png',
    bio: '漲停8招創始人，工商時報台股逐洞賽56屆冠軍，累積報酬率680%',
    description: '「漲停8招」選股系統創始人，獨創「4有」同步指標，專精短線當沖與飆股挖掘。工商時報台股逐洞賽56屆冠軍，累積441支漲停板紀錄，總報酬率高達680%。擁有證券分析師執照，提供即時訊號與策略分析。',
    styleTags: ['當沖', '短線', '漲停', '技術分析'],
    markets: ['台股'],
    riskTolerance: '積極',
    timeframe: '極短期',
  },
  // 趙彭博 - 實戰導師角色
  {
    id: 'person-6',
    slug: 'zhao-mentor',
    name: '趙彭博',
    role: PersonRole.MENTOR,
    avatarUrl: '/images/experts/zhao-pengbo.png',
    bio: '漲停8招創始人，專精短線當沖教學，透過實戰週記分享操作心法',
    description: '「漲停8招」選股系統創始人，獨創「4有」同步指標。每週透過 T+7 實戰週記，完整拆解一週的操作邏輯、漲停股篩選心法與事後檢討，幫助學員建立完整的短線交易框架。',
    styleTags: ['當沖', '短線', '漲停', '教學'],
    markets: ['台股'],
    riskTolerance: '積極',
    timeframe: '極短期',
  },
];

// Trading Systems
export const tradingSystems: TradingSystem[] = [
  {
    id: 'system-1',
    personId: 'person-1',
    name: '趨勢波段 – 台股',
    description: '追蹤台股大盤與個股趨勢，在確認趨勢形成後進場，分批加碼，順勢而為。',
    styleTags: ['趨勢', '波段', '台股'],
    markets: ['台股'],
    riskProfile: '中性',
    holdingPeriod: '2-8 週',
    teachingIntro: '本系統專注於捕捉台股的中期波段行情。我們不預測頂底，而是等待趨勢確認後順勢進場，並在趨勢轉弱時逐步出場。重點在於風險控管與部位管理，而非追求單一交易的最大獲利。',
    teachingSections: [
      {
        title: '風險與部位控管',
        bullets: [
          '單一個股部位不超過總資金 10%',
          '同產業曝險不超過 25%',
          '整體持股水位根據大盤位階調整，通常在 50-80%',
          '當回檔超過 7% 時開始減碼，超過 12% 時大幅降低持股'
        ]
      },
      {
        title: '進出場 SOP',
        bullets: [
          '等待突破關鍵均線（如 20MA）並帶量確認',
          '首次進場為預定部位的 30-40%',
          '突破後拉回不破前低則加碼至 60-70%',
          '續創新高且量能配合再加碼至滿倉',
          '跌破 20MA 減碼一半，跌破 60MA 全數出場'
        ]
      },
      {
        title: '常見錯誤與禁止行為',
        bullets: [
          '禁止在下跌趨勢中攤平',
          '不追突破後已漲超過 5% 的標的',
          '不在大盤明顯弱勢時重倉單一個股',
          '避免因「覺得便宜」而提早進場'
        ]
      }
    ]
  },
  {
    id: 'system-2',
    personId: 'person-2',
    name: '價值存股 – 高息股',
    description: '精選高殖利率且營運穩定的存股標的，長期持有收取股息。',
    styleTags: ['存股', '價值', '配息'],
    markets: ['台股', '美股'],
    riskProfile: '保守',
    holdingPeriod: '1 年以上',
    teachingIntro: '本系統專注於建立穩定的被動收入來源。我們挑選殖利率穩定、配息紀錄良好且營運穩健的標的，採用定期定額或逢低加碼的方式累積部位，長期持有並再投資股息。',
    teachingSections: [
      {
        title: '選股條件',
        bullets: [
          '近 5 年平均殖利率 > 4%',
          '配息穩定度高，不會大幅波動',
          '本業獲利穩定，非一次性收益',
          '產業具護城河或政府特許'
        ]
      },
      {
        title: '買進策略',
        bullets: [
          '定期定額為主，每月固定投入',
          '股價跌至歷史低檔區時可加碼',
          '單一標的不超過總存股部位 20%',
          '至少持有 5-8 檔分散風險'
        ]
      },
      {
        title: '注意事項',
        bullets: [
          '不因股價短期下跌而恐慌賣出',
          '配息減少或基本面惡化時需重新評估',
          '避免高殖利率陷阱（一次性配息、借錢配息）'
        ]
      }
    ]
  },
  {
    id: 'system-3',
    personId: 'person-3',
    name: '短線動能 – 台股',
    description: '捕捉短線強勢股的動能行情，快進快出。',
    styleTags: ['短線', '動能', '技術分析'],
    markets: ['台股'],
    riskProfile: '積極',
    holdingPeriod: '1-5 天',
    teachingIntro: '本系統專注於捕捉短線的動能行情。我們尋找量價齊揚、突破關鍵壓力的強勢股，快速進場並設定嚴格停損。這個系統強調紀律與執行力，不適合猶豫不決的操作風格。',
    teachingSections: [
      {
        title: '風險控管',
        bullets: [
          '單筆交易風險不超過總資金 2%',
          '每日最多進行 3 筆新交易',
          '當日虧損達 3% 時停止交易',
          '連續虧損 3 筆後休息一天'
        ]
      },
      {
        title: '進場條件',
        bullets: [
          '突破近期高點且成交量放大 1.5 倍以上',
          '5MA 向上且股價站穩其上',
          '大盤不在明顯空頭格局',
          '進場後立即設定停損（通常為 3-5%）'
        ]
      },
      {
        title: '出場原則',
        bullets: [
          '達到停損點無條件出場',
          '獲利達 5-10% 可先出一半',
          '隔日開盤跳空下跌直接出場',
          '持有超過 3 天未表態則減碼'
        ]
      }
    ]
  },
  {
    id: 'system-4',
    personId: 'person-4',
    name: 'ETF 資產配置',
    description: '透過美股 ETF 建立全球化的資產配置組合。',
    styleTags: ['ETF', '資產配置', '被動投資'],
    markets: ['美股'],
    riskProfile: '中性',
    holdingPeriod: '長期持有',
    teachingIntro: '本系統採用被動投資的理念，透過低成本的 ETF 建立全球化的資產配置。我們不試圖擇時，而是透過分散投資與定期再平衡來降低風險、追求長期穩定報酬。',
    teachingSections: [
      {
        title: '核心配置',
        bullets: [
          '美股大盤 ETF（如 VTI、SPY）佔 40-50%',
          '國際市場 ETF（如 VXUS）佔 20-30%',
          '債券 ETF（如 BND、AGG）佔 20-30%',
          '可選配置：REITs、黃金等佔 0-10%'
        ]
      },
      {
        title: '執行方式',
        bullets: [
          '每月定期投入固定金額',
          '每季檢視一次配置比例',
          '偏離目標配置 5% 以上時再平衡',
          '避免頻繁交易產生額外成本'
        ]
      },
      {
        title: '心態建設',
        bullets: [
          '市場下跌時是加碼好時機',
          '不因短期波動改變長期計畫',
          '專注於可控因素：成本、紀律、時間'
        ]
      }
    ]
  },
  // 趙彭博 - 漲停8招系統（投顧分析師）
  {
    id: 'system-5',
    personId: 'person-5',
    name: '漲停8招 – 台股當沖',
    description: '運用獨創「4有」指標系統，捕捉當日漲停潛力股，快進快出。',
    styleTags: ['當沖', '漲停', '短線', '技術分析'],
    markets: ['台股'],
    riskProfile: '積極',
    holdingPeriod: '當日至數天',
    teachingIntro: '本系統專注於捕捉當日或短期內有漲停潛力的標的。透過獨創「4有」同步指標——有漲、有人、有人買、有大人買，篩選出最具爆發力的飆股，並嚴格執行風控紀律。',
    teachingSections: [
      {
        title: '「4有」選股指標',
        bullets: [
          '有漲：股價站上均線、盤中表現強勢、突破關鍵價位',
          '有人：委買量大於委賣量，買盤積極掛單',
          '有人買：散戶買超訊號，市場人氣聚集',
          '有大人買：大戶/法人連續買超，主力進場跡象'
        ]
      },
      {
        title: '漲停8招進場策略',
        bullets: [
          '第一招：量價突破型 – 成交量放大突破壓力區',
          '第二招：開盤強勢型 – 開盤5分鐘內強勢表態',
          '第三招：均線糾結突破 – 均線收斂後向上噴出',
          '第四招：洗盤結束型 – 主力洗盤完畢再啟動'
        ]
      },
      {
        title: '風險控管',
        bullets: [
          '當沖單筆最大虧損 2%，無條件停損',
          '每日停損上限 3%，達標即停止交易',
          '連續虧損 3 筆強制休息一天',
          '獲利達 5% 先出一半，保護利潤'
        ]
      }
    ]
  },
  // 趙彭博 - 漲停8招系統（實戰導師 T+7）
  {
    id: 'system-6',
    personId: 'person-6',
    name: '漲停8招 – 實戰教學',
    description: '透過 T+7 延遲的實戰案例，完整拆解漲停股的選股邏輯與操作心法。',
    styleTags: ['當沖', '漲停', '教學', '案例分析'],
    markets: ['台股'],
    riskProfile: '積極',
    holdingPeriod: '教學用樣本帳戶',
    teachingIntro: '本教學系統專注於分享漲停8招的實戰應用。每週透過延遲7天的實戰週記，完整呈現選股過程、進出場時機與事後檢討。所有內容均為歷史案例教學，非即時投資建議。',
    teachingSections: [
      {
        title: '週記教學重點',
        bullets: [
          '每週精選 3-5 檔代表性操作案例',
          '完整記錄「4有」指標觸發條件',
          '詳細解說進場時機與出場邏輯',
          '事後檢討成功與失敗原因'
        ]
      },
      {
        title: '學習目標',
        bullets: [
          '培養盤中快速判斷能力',
          '建立嚴格的停損停利紀律',
          '理解主力操作手法與跡象',
          '掌握當沖與短線的風險控管'
        ]
      },
      {
        title: '注意事項',
        bullets: [
          '所有操作紀錄至少延遲 7 天發布',
          '僅供歷史案例教學，非即時投資建議',
          '當沖風險極高，需自行評估承受能力',
          '建議先以小資金練習，熟悉後再加大部位'
        ]
      }
    ]
  },
];

// Plans
export const plans: Plan[] = [
  // Advisor 1 plans
  {
    id: 'plan-1',
    personId: 'person-1',
    systemId: 'system-1',
    planType: PlanType.ANALYST_SIGNAL_L1,
    name: '分析師即時策略訂閱',
    description: '即時策略訊號＋每筆操作的教學解說。訊號會出現在會員 app 的「即時訊號牆」。',
    priceMonthly: 1999,
    priceYearly: 19990,
    isActive: true,
  },
  {
    id: 'plan-2',
    personId: 'person-1',
    systemId: 'system-1',
    planType: PlanType.ANALYST_SIGNAL_DIAG_L2,
    name: '分析師策略＋持股健檢',
    description: '包含即時訊號與教學，加上持股上傳與診斷報告服務。',
    priceMonthly: 3999,
    priceYearly: 39990,
    isActive: true,
  },
  // Advisor 2 plans
  {
    id: 'plan-3',
    personId: 'person-2',
    systemId: 'system-2',
    planType: PlanType.ANALYST_SIGNAL_L1,
    name: '分析師即時策略訂閱',
    description: '即時策略訊號＋每筆操作的教學解說。專注於存股標的的買賣時機。',
    priceMonthly: 1499,
    priceYearly: 14990,
    isActive: true,
  },
  {
    id: 'plan-4',
    personId: 'person-2',
    systemId: 'system-2',
    planType: PlanType.ANALYST_SIGNAL_DIAG_L2,
    name: '分析師策略＋持股健檢',
    description: '包含即時訊號與教學，加上存股組合的健檢與配息規劃建議。',
    priceMonthly: 2999,
    priceYearly: 29990,
    isActive: true,
  },
  // Mentor 1 plan
  {
    id: 'plan-5',
    personId: 'person-3',
    systemId: 'system-3',
    planType: PlanType.MENTOR_WEEKLY_JOURNAL,
    name: '實戰週記教學訂閱（T+7）',
    description: '每週一次，回顧一週前的實戰操作。顯示買賣紀錄、當時理由、事後檢討。所有內容至少延遲 7 天，僅供歷史案例教學。',
    priceMonthly: 999,
    priceYearly: 9990,
    isActive: true,
  },
  // Mentor 2 plan
  {
    id: 'plan-6',
    personId: 'person-4',
    systemId: 'system-4',
    planType: PlanType.MENTOR_WEEKLY_JOURNAL,
    name: '實戰週記教學訂閱（T+7）',
    description: '每週分享 ETF 配置調整過程與市場觀察，所有操作紀錄至少延遲 7 天發布。',
    priceMonthly: 799,
    priceYearly: 7990,
    isActive: true,
  },
  // 趙彭博 - 投顧分析師方案
  {
    id: 'plan-7',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_L1,
    name: '分析師即時策略訂閱',
    description: '即時漲停8招訊號＋每筆操作的4有指標解說。捕捉當日飆股機會。',
    priceMonthly: 2999,
    priceYearly: 29990,
    isActive: true,
  },
  {
    id: 'plan-8',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_DIAG_L2,
    name: '分析師策略＋持股健檢',
    description: '包含即時漲停訊號，加上當沖持股診斷與風險評估服務。',
    priceMonthly: 4999,
    priceYearly: 49990,
    isActive: true,
  },
  // 趙彭博 - 實戰導師方案
  {
    id: 'plan-9',
    personId: 'person-6',
    systemId: 'system-6',
    planType: PlanType.MENTOR_WEEKLY_JOURNAL,
    name: '實戰週記教學訂閱（T+7）',
    description: '每週分享漲停8招實戰案例，包含選股邏輯、進出場時機與事後檢討。所有內容至少延遲 7 天。',
    priceMonthly: 1499,
    priceYearly: 14990,
    isActive: true,
  },
];

// Subscriptions (for demo user)
export const subscriptions: Subscription[] = [
  {
    id: 'sub-1',
    userId: 'user-1',
    planId: 'plan-1', // Advisor 1 L1
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2024-11-01'),
    endDate: new Date('2025-11-01'),
    renewMode: 'AUTO',
  },
  {
    id: 'sub-2',
    userId: 'user-1',
    planId: 'plan-4', // Advisor 2 L2
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2024-10-15'),
    endDate: new Date('2025-10-15'),
    renewMode: 'AUTO',
  },
  {
    id: 'sub-3',
    userId: 'user-1',
    planId: 'plan-5', // Mentor 1 Weekly Journal
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2024-12-01'),
    endDate: new Date('2025-12-01'),
    renewMode: 'MANUAL',
  },
];

// Signals
const today = new Date();
const oneHourAgo = new Date(today.getTime() - 60 * 60 * 1000);
const threeHoursAgo = new Date(today.getTime() - 3 * 60 * 60 * 1000);
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

export const signals: Signal[] = [
  {
    id: 'signal-1',
    personId: 'person-1',
    systemId: 'system-1',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '趨勢波段 – 台股',
    instrument: '2330.TW',
    action: SignalAction.BUY,
    priceHint: '約 580-590',
    reasonSummary: '突破季線壓力，外資連續買超，半導體庫存回補題材持續發酵。',
    reasonDetail: '台積電在經過兩個月的整理後，今日帶量突破季線（60MA）壓力，成交量較前五日均量放大約 1.8 倍。從基本面來看，AI 晶片需求持續強勁，客戶端庫存已降至健康水位，下半年展望正向。技術面上，週 KD 低檔黃金交叉，月線多頭排列，具備中期上漲的條件。',
    timeTrade: oneHourAgo,
    timeVisible: oneHourAgo,
    createdAt: oneHourAgo,
    riskNotes: [
      '目前整體電子股曝險已達策略上限的 70%，本次買進後需注意產業集中度',
      '若大盤出現急跌（跌幅 > 2%），可能需要優先減碼此部位',
      '台積電波動較大盤大，需準備好承受 5-8% 的短期回檔'
    ],
    positionNotes: [
      '本次買進為預定部位的 40%（約總資金 4%）',
      '若後續站穩 600 元並帶量，計畫加碼至 70%',
      '停損設在跌破 560 元（約 -5%）'
    ],
    learningPoints: [
      '這筆操作示範「趨勢確認後進場」的原則，不預測底部',
      '注意我們不是在最低點買進，而是等待明確訊號',
      '分批進場可以降低單一買點的風險'
    ]
  },
  {
    id: 'signal-2',
    personId: 'person-1',
    systemId: 'system-1',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '趨勢波段 – 台股',
    instrument: '2454.TW',
    action: SignalAction.ADD,
    priceHint: '約 1250-1280',
    reasonSummary: '聯發科續創波段新高，5G 與 AI 晶片出貨持續成長，加碼既有部位。',
    reasonDetail: '聯發科在前次買進後穩步上漲，今日再度突破前高，成交量維持健康水準。公司最新法說會釋出正向展望，天璣系列晶片市佔率持續提升，AI 手機晶片需求強勁。技術面維持強勢多頭格局，趨勢延續中。',
    timeTrade: threeHoursAgo,
    timeVisible: threeHoursAgo,
    createdAt: threeHoursAgo,
    riskNotes: [
      '加碼後聯發科部位將達總資金 8%，接近單一個股上限',
      '電子股整體曝險較高，後續新買進需考慮其他產業',
      '股價已較前次買進上漲約 15%，追高風險需注意'
    ],
    positionNotes: [
      '本次加碼 30%，使總部位達到預定的 70%',
      '將停損點上移至成本區（約 1150）',
      '若續漲至 1350，考慮再加碼至滿倉'
    ],
    learningPoints: [
      '這筆示範「順勢加碼」的操作，在趨勢延續中增加部位',
      '注意加碼時同時上移停損，保護既有獲利',
      '加碼不是攤平，是在獲利的基礎上增加曝險'
    ]
  },
  {
    id: 'signal-3',
    personId: 'person-2',
    systemId: 'system-2',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '價值存股 – 高息股',
    instrument: '2412.TW',
    action: SignalAction.BUY,
    priceHint: '約 120-122',
    reasonSummary: '中華電信股價回落至近年低檔區，殖利率回升至 4.5% 以上，啟動存股買進。',
    reasonDetail: '中華電信因市場資金輪動，股價回落至 120 元附近，以預估 5.5 元股息計算，殖利率約 4.6%。公司營運穩健，具備電信業護城河，配息紀錄優良且穩定。目前評價位於歷史相對低檔，適合長期存股。',
    timeTrade: yesterday,
    timeVisible: yesterday,
    createdAt: yesterday,
    riskNotes: [
      '電信股近年受升息環境影響，股價表現較弱',
      '短期內可能持續盤整，需有長期持有的心理準備',
      '若股價跌破 115 元，需重新評估是否減碼'
    ],
    positionNotes: [
      '本次買進為存股組合的 15%',
      '預計在 115-118 區間再加碼一次',
      '這是長期持有部位，不設短期停損'
    ],
    learningPoints: [
      '存股重點在於股息的穩定性，而非股價短期表現',
      '選擇具護城河的產業，降低營運風險',
      '逢低買進可以提高平均殖利率'
    ]
  },
  {
    id: 'signal-4',
    personId: 'person-1',
    systemId: 'system-1',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '趨勢波段 – 台股',
    instrument: '3008.TW',
    action: SignalAction.TRIM,
    priceHint: '約 155-160',
    reasonSummary: '大立光漲幅已達預期目標，且量能萎縮，先獲利了結一半。',
    reasonDetail: '大立光自買進以來已上漲約 20%，近日雖持續上漲但成交量明顯萎縮，顯示追價意願降低。短期乖離率偏高，有回檔整理需求。雖然中期趨勢仍佳，但基於風險控管考量，先減碼一半鎖定部分獲利。',
    timeTrade: twoDaysAgo,
    timeVisible: twoDaysAgo,
    createdAt: twoDaysAgo,
    riskNotes: [
      '減碼後仍保留一半部位，若趨勢續強可再加回',
      '注意市場可能出現獲利回吐賣壓',
      '保留的部位停損設在 145 元'
    ],
    positionNotes: [
      '本次減碼 50%，將部位從滿倉降至半倉',
      '獲利約 20%，實現部分收益',
      '若回檔至 140-145 區間企穩，考慮再加碼'
    ],
    learningPoints: [
      '這筆示範「紀律獲利了結」，不貪心等最高點',
      '量價背離是重要的警訊，需要重視',
      '分批出場可以兼顧獲利與趨勢延續的可能'
    ]
  },
];

// Weekly Journals (for mentors, T+7)
const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
const threeWeeksAgo = new Date(today.getTime() - 21 * 24 * 60 * 60 * 1000);
const weekStartTwoWeeksAgo = new Date(twoWeeksAgo);
weekStartTwoWeeksAgo.setDate(weekStartTwoWeeksAgo.getDate() - weekStartTwoWeeksAgo.getDay() + 1);
const weekEndTwoWeeksAgo = new Date(weekStartTwoWeeksAgo);
weekEndTwoWeeksAgo.setDate(weekEndTwoWeeksAgo.getDate() + 4);

const weekStartThreeWeeksAgo = new Date(threeWeeksAgo);
weekStartThreeWeeksAgo.setDate(weekStartThreeWeeksAgo.getDate() - weekStartThreeWeeksAgo.getDay() + 1);
const weekEndThreeWeeksAgo = new Date(weekStartThreeWeeksAgo);
weekEndThreeWeeksAgo.setDate(weekEndThreeWeeksAgo.getDate() + 4);

export const weeklyJournals: WeeklyJournal[] = [
  {
    id: 'journal-1',
    personId: 'person-3',
    systemId: 'system-3',
    weekStart: weekStartTwoWeeksAgo,
    weekEnd: weekEndTwoWeeksAgo,
    title: '本週重點：電子股反彈操作與停損執行',
    summary: '本週大盤在電子股帶領下反彈，我進行了 5 筆交易，其中 3 筆獲利、2 筆停損。整體而言執行紀律良好，但有一筆因猶豫而擴大虧損，需要檢討。',
    learningPoints: [
      '嚴格執行停損是短線操作的關鍵',
      '量能確認後再進場可提高勝率',
      '避免在尾盤追高，隔日風險較大'
    ],
    trades: [
      {
        id: 'trade-1',
        date: weekStartTwoWeeksAgo,
        instrument: '2303.TW',
        action: SignalAction.BUY,
        reason: '聯電突破短期壓力，量能放大',
        outcome: '獲利 3.5%'
      },
      {
        id: 'trade-2',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 24 * 60 * 60 * 1000),
        instrument: '3037.TW',
        action: SignalAction.BUY,
        reason: '欣興跳空上漲，追蹤 ABF 載板題材',
        outcome: '停損 -2.8%'
      },
      {
        id: 'trade-3',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
        instrument: '2317.TW',
        action: SignalAction.BUY,
        reason: '鴻海站上所有均線，外資連買',
        outcome: '獲利 4.2%'
      },
    ]
  },
  {
    id: 'journal-2',
    personId: 'person-3',
    systemId: 'system-3',
    weekStart: weekStartThreeWeeksAgo,
    weekEnd: weekEndThreeWeeksAgo,
    title: '本週重點：震盪盤整中的觀望與小試',
    summary: '本週大盤陷入狹幅震盪，缺乏明確方向。我減少交易次數，僅進行 2 筆試單，一勝一敗。這週的重點是「不做也是一種操作」。',
    learningPoints: [
      '盤整期間減少交易頻率是正確的',
      '保持耐心等待明確訊號',
      '小部位試單可以保持盤感又控制風險'
    ],
    trades: [
      {
        id: 'trade-4',
        date: weekStartThreeWeeksAgo,
        instrument: '2382.TW',
        action: SignalAction.BUY,
        reason: '廣達小量突破，AI 題材',
        outcome: '獲利 2.1%'
      },
      {
        id: 'trade-5',
        date: new Date(weekStartThreeWeeksAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
        instrument: '6505.TW',
        action: SignalAction.BUY,
        reason: '台塑化反彈測試',
        outcome: '停損 -3.0%'
      },
    ]
  },
  {
    id: 'journal-3',
    personId: 'person-4',
    systemId: 'system-4',
    weekStart: weekStartTwoWeeksAgo,
    weekEnd: weekEndTwoWeeksAgo,
    title: '本週重點：Q3 再平衡與債券部位調整',
    summary: '本週執行了季度再平衡，將股票部位從 72% 降至目標的 65%，增加債券 ETF 部位。另外加碼了國際市場 ETF，提高非美股曝險。',
    learningPoints: [
      '定期再平衡是維持風險水準的關鍵',
      '不需要精準擇時，紀律執行即可',
      '市場波動時正是執行配置策略的好時機'
    ],
    trades: [
      {
        id: 'trade-6',
        date: weekStartTwoWeeksAgo,
        instrument: 'VTI',
        action: SignalAction.TRIM,
        reason: '股票比例過高，執行再平衡',
        outcome: '已完成'
      },
      {
        id: 'trade-7',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 24 * 60 * 60 * 1000),
        instrument: 'BND',
        action: SignalAction.BUY,
        reason: '增加債券配置至目標比例',
        outcome: '已完成'
      },
      {
        id: 'trade-8',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
        instrument: 'VXUS',
        action: SignalAction.BUY,
        reason: '提高國際市場曝險',
        outcome: '已完成'
      },
    ]
  },
];

// Helper functions to get data with relations
export function getPersonWithPlans(personId: string): PersonWithPlans | undefined {
  const person = people.find(p => p.id === personId);
  if (!person) return undefined;
  
  return {
    ...person,
    plans: plans.filter(p => p.personId === personId),
    tradingSystems: tradingSystems.filter(s => s.personId === personId),
  };
}

export function getPersonBySlug(slug: string): PersonWithPlans | undefined {
  const person = people.find(p => p.slug === slug);
  if (!person) return undefined;
  
  return {
    ...person,
    plans: plans.filter(p => p.personId === person.id),
    tradingSystems: tradingSystems.filter(s => s.personId === person.id),
  };
}

export function getAllPeopleWithPlans(): PersonWithPlans[] {
  return people.map(person => ({
    ...person,
    plans: plans.filter(p => p.personId === person.id),
    tradingSystems: tradingSystems.filter(s => s.personId === person.id),
  }));
}

export function getUserSubscriptions(userId: string): SubscriptionWithDetails[] {
  // MVP 展示用：為所有登入用戶返回模擬訂閱資料
  return subscriptions.map(sub => {
    const plan = plans.find(p => p.id === sub.planId)!;
    const person = people.find(p => p.id === plan.personId)!;
    const system = tradingSystems.find(s => s.id === plan.systemId);
    return { ...sub, plan, person, system };
  });
}

export function getSignalsForUser(userId: string): SignalWithPerson[] {
  // MVP 展示用：返回所有投顧分析師的訊號
  return signals
    .filter(s => s.timeVisible <= new Date())
    .map(signal => ({
      ...signal,
      person: people.find(p => p.id === signal.personId)!,
      system: tradingSystems.find(s => s.id === signal.systemId)!,
    }))
    .sort((a, b) => b.timeTrade.getTime() - a.timeTrade.getTime());
}

export function getJournalsForUser(userId: string): JournalWithPerson[] {
  // MVP 展示用：返回所有實戰導師的週記
  return weeklyJournals
    .map(journal => ({
      ...journal,
      person: people.find(p => p.id === journal.personId)!,
      system: tradingSystems.find(s => s.id === journal.systemId),
    }))
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
}

export function getSignalById(signalId: string): SignalWithPerson | undefined {
  const signal = signals.find(s => s.id === signalId);
  if (!signal) return undefined;
  
  return {
    ...signal,
    person: people.find(p => p.id === signal.personId)!,
    system: tradingSystems.find(s => s.id === signal.systemId)!,
  };
}

export function getJournalById(journalId: string): JournalWithPerson | undefined {
  const journal = weeklyJournals.find(j => j.id === journalId);
  if (!journal) return undefined;
  
  return {
    ...journal,
    person: people.find(p => p.id === journal.personId)!,
    system: tradingSystems.find(s => s.id === journal.systemId),
  };
}

export function getSystemById(systemId: string): TradingSystem | undefined {
  return tradingSystems.find(s => s.id === systemId);
}

export function getSystemWithPerson(systemId: string): { system: TradingSystem; person: Person } | undefined {
  const system = tradingSystems.find(s => s.id === systemId);
  if (!system) return undefined;
  
  const person = people.find(p => p.id === system.personId);
  if (!person) return undefined;
  
  return { system, person };
}

export function getPlanById(planId: string): Plan | undefined {
  return plans.find(p => p.id === planId);
}
