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
    description: '10 年交易經驗，擅長短線與當沖操作。每週透過 T+7 修煉派週記，完整拆解一週的操作邏輯、風險控管與事後檢討，幫助學員建立正確的交易觀念。',
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
    slug: 'zhao-pengbo',
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
    slug: 'zhao-pengbo-mentor',
    name: '趙彭博',
    role: PersonRole.MENTOR,
    avatarUrl: '/images/experts/zhao-pengbo.png',
    bio: '漲停8招創始人，專精短線當沖教學，透過修煉派週記分享操作心法',
    description: '「漲停8招」選股系統創始人，獨創「4有」同步指標。每週透過 T+7 修煉派週記，完整拆解一週的操作邏輯、漲停股篩選心法與事後檢討，幫助學員建立完整的短線交易框架。',
    styleTags: ['當沖', '短線', '漲停', '教學'],
    markets: ['台股'],
    riskTolerance: '積極',
    timeframe: '極短期',
  },
  // 林修齊 - 實戰導師
  {
    id: 'person-7',
    slug: 'lin-xiuqi',
    name: '林修齊',
    role: PersonRole.MENTOR,
    avatarUrl: '/images/experts/lin-xiuqi.png',
    bio: '價值投資教學',
    description: '15年投資經驗，專注於教授價值投資策略。從基本面分析到長期持有，幫助學員建立穩健的投資框架，在波動市場中保持理性決策。',
    styleTags: ['價值投資', '長線'],
    markets: ['台股', '美股'],
    riskTolerance: '保守',
    timeframe: '長期',
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
  // 林修齊 - 價值投資教學系統
  {
    id: 'system-7',
    personId: 'person-7',
    name: '價值投資心法 – 長線佈局',
    description: '從基本面分析出發，挑選被低估的優質企業，長期持有等待價值回歸。',
    styleTags: ['價值投資', '基本面', '長線'],
    markets: ['台股', '美股'],
    riskProfile: '保守',
    holdingPeriod: '半年至數年',
    teachingIntro: '本系統專注於教授價值投資的核心理念與實踐方法。透過深入的基本面分析，找出被市場低估的優質企業，並以合理價格建立部位，耐心持有直到市場認知修正。',
    teachingSections: [
      {
        title: '選股框架',
        bullets: [
          '營收與獲利連續成長 3 年以上',
          '本益比低於同業平均或歷史中位數',
          '自由現金流為正且穩定',
          '具護城河（品牌、技術、規模優勢）'
        ]
      },
      {
        title: '買進與持有策略',
        bullets: [
          '股價低於內在價值 20% 以上時開始建倉',
          '分 3-4 批進場，降低時機風險',
          '單一標的不超過總資金 15%',
          '持有期間定期追蹤財報與產業變化'
        ]
      },
      {
        title: '賣出條件',
        bullets: [
          '基本面出現結構性惡化',
          '股價達到合理估值上緣',
          '發現更具價值的替代標的',
          '不因短期市場波動而賣出'
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
  // 林修齊 - 實戰導師方案
  {
    id: 'plan-10',
    personId: 'person-7',
    systemId: 'system-7',
    planType: PlanType.MENTOR_WEEKLY_JOURNAL,
    name: '修煉派 學習方案',
    description: '每週分享價值投資實戰案例，包含選股邏輯、估值分析與持有策略。所有內容至少延遲 7 天。',
    priceMonthly: 799,
    priceYearly: 7990,
    isActive: true,
  },
];

// Subscriptions (for demo user)
export const subscriptions: Subscription[] = [
  {
    id: 'sub-4',
    userId: 'user-1',
    planId: 'plan-7', // 趙彭博 投顧分析師 L1
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2024-11-15'),
    endDate: new Date('2025-11-15'),
    renewMode: 'AUTO',
  },
  {
    id: 'sub-5',
    userId: 'user-1',
    planId: 'plan-9', // 趙彭博 實戰導師 Weekly Journal
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2024-11-20'),
    endDate: new Date('2025-11-20'),
    renewMode: 'AUTO',
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
  // 趙彭博 投顧分析師 - 漲停8招即時訊號
  {
    id: 'signal-zhao-1',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '漲停8招 – 台股當沖',
    instrument: '3661.TW',
    action: SignalAction.BUY,
    priceHint: '約 185-190',
    reasonSummary: '世芯-KY 4有指標全亮，開盤跳空突破前高，量能爆發，鎖定漲停潛力股。',
    reasonDetail: '世芯今日開盤即強勢表態，9:05 成交量已達昨日全日量的 60%，符合「有漲」指標。委買量大幅超越委賣量近 3 倍（有人），且觀察到散戶買超訊號（有人買）與外資連續三日買超（有大人買）。技術面上突破近期整理區間上緣，屬於「第一招：量價突破型」進場時機。AI 晶片設計題材持續發酵，CoWoS 先進封裝訂單滿載。',
    timeTrade: oneHourAgo,
    timeVisible: oneHourAgo,
    createdAt: oneHourAgo,
    riskNotes: [
      '當沖操作，必須盤中嚴格監控，收盤前務必出場',
      '若跌破開盤價 3%，立即停損出場',
      '今日若大盤急跌 > 1.5%，優先減碼保護資金'
    ],
    positionNotes: [
      '本次進場為單筆資金的 100%（當沖不留倉）',
      '第一目標價：漲停鎖定（+10%）',
      '若無法攻上漲停，尾盤前 30 分鐘全數出場'
    ],
    learningPoints: [
      '這筆示範「4有同步」的選股邏輯，四個指標同時確認',
      '開盤5分鐘是判斷當日強弱的關鍵觀察期',
      '量價齊揚是漲停股最基本的特徵'
    ]
  },
  {
    id: 'signal-zhao-2',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '漲停8招 – 台股當沖',
    instrument: '6409.TW',
    action: SignalAction.BUY,
    priceHint: '約 320-328',
    reasonSummary: '旭隼洗盤結束型態確認，主力重新進場，技術面突破頸線壓力。',
    reasonDetail: '旭隼經過兩週的震盪洗盤後，今日帶量站上頸線壓力區（約 318），符合「第四招：洗盤結束型」進場條件。觀察籌碼面，主力持股比例回升至高點，「有大人買」訊號明確。委買委賣比例維持健康，散戶買盤也開始進場。儲能題材持續看好，法人目標價上調。',
    timeTrade: threeHoursAgo,
    timeVisible: threeHoursAgo,
    createdAt: threeHoursAgo,
    riskNotes: [
      '停損設在頸線下方 3%（約 308）',
      '若量能萎縮無法突破前高，需提高警覺',
      '盤中若出現大單倒貨，優先減碼'
    ],
    positionNotes: [
      '可留倉操作，預計持有 1-3 天',
      '第一目標：前波高點 350（+10%）',
      '若明日開高可加碼 50%'
    ],
    learningPoints: [
      '洗盤結束型的關鍵在於辨識「假跌破」',
      '主力洗盤目的是甩掉浮額，累積低成本籌碼',
      '突破後的量能確認非常重要'
    ]
  },
  {
    id: 'signal-zhao-3',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '漲停8招 – 台股當沖',
    instrument: '2498.TW',
    action: SignalAction.EXIT,
    priceHint: '約 1150-1180',
    reasonSummary: '宏達電達到第一目標價，獲利出場鎖定利潤。',
    reasonDetail: '宏達電自昨日進場後，今日開盤即跳空上漲，盤中最高觸及 1195，已達到預設的 +8% 目標區間。觀察到量能雖大但上檔賣壓漸增，且委賣開始大於委買，主力有出貨跡象。依照紀律先行獲利了結，保護利潤。',
    timeTrade: yesterday,
    timeVisible: yesterday,
    createdAt: yesterday,
    riskNotes: [
      '獲利出場不留戀，紀律執行是當沖核心',
      '後續若再符合進場條件可重新評估',
      '今日已完成獲利目標，建議休息觀望'
    ],
    positionNotes: [
      '本筆交易獲利約 +7.5%',
      '全數出場，不留任何部位',
      '累計本週勝率 3/4（75%）'
    ],
    learningPoints: [
      '達標出場不猜頂，讓紀律保護你的獲利',
      '「有人賣」出現時就是減碼訊號',
      '短線操作重點在於累積小勝而非追求大賺'
    ]
  },
  {
    id: 'signal-zhao-4',
    personId: 'person-5',
    systemId: 'system-5',
    planType: PlanType.ANALYST_SIGNAL_L1,
    strategyName: '漲停8招 – 台股當沖',
    instrument: '3443.TW',
    action: SignalAction.BUY,
    priceHint: '約 750-765',
    reasonSummary: '創意電子均線糾結後向上突破，4有指標轉強，第三招型態確認。',
    reasonDetail: '創意電子過去一週均線收斂糾結（5MA、10MA、20MA 幾乎重疊），今日帶量向上噴出，符合「第三招：均線糾結突破」型態。IC 設計族群資金回流，外資連兩日買超（有大人買），盤中委買明顯大於委賣（有人），股價強勢突破所有短均（有漲）。ASIC 設計服務需求持續成長。',
    timeTrade: twoDaysAgo,
    timeVisible: twoDaysAgo,
    createdAt: twoDaysAgo,
    riskNotes: [
      '停損設在均線糾結區下方（約 720，-5%）',
      '若大盤轉弱，IC 設計股通常跌幅較大',
      '盤中密切觀察量能是否持續'
    ],
    positionNotes: [
      '首次進場 50%，留空間加碼',
      '若站穩 780 可加碼至 100%',
      '目標價：前波高點 850（+12%）'
    ],
    learningPoints: [
      '均線糾結代表多空平衡，突破後容易有大行情',
      '等待突破確認再進場，不提前猜測方向',
      '這種型態適合留倉操作，不必當沖出場'
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
  // 趙彭博 實戰導師 - T+7 修煉派週記
  {
    id: 'journal-zhao-1',
    personId: 'person-6',
    systemId: 'system-6',
    weekStart: weekStartTwoWeeksAgo,
    weekEnd: weekEndTwoWeeksAgo,
    title: '漲停8招修煉派週記：5漲停3停損，單週報酬+12.3%',
    summary: '本週市場情緒回溫，電子股資金回流明顯，「4有」指標多次同步確認，共捕捉到 5 支漲停股。其中 3 筆完美鎖定漲停，2 筆盤中攻漲停後回落獲利出場，另有 3 筆因指標背離而停損。整體執行紀律良好，關鍵在於嚴守「盤中不追高」原則。',
    learningPoints: [
      '4有指標同步確認的標的勝率明顯較高（本週 5/5）',
      '開盤15分鐘內的量能決定當日走勢，沒量就不要硬做',
      '連續獲利後容易放鬆警惕，第6筆就踩雷 — 紀律不能因順境而鬆懈',
      '週五尾盤不留倉是正確決定，避免週末消息面風險'
    ],
    trades: [
      {
        id: 'trade-zhao-1',
        date: weekStartTwoWeeksAgo,
        instrument: '3661.TW',
        action: SignalAction.BUY,
        reason: '世芯 4有同步，開盤強勢突破型',
        outcome: '漲停 +10%'
      },
      {
        id: 'trade-zhao-2',
        date: weekStartTwoWeeksAgo,
        instrument: '6409.TW',
        action: SignalAction.BUY,
        reason: '旭隼洗盤結束型，主力重新進場',
        outcome: '獲利 +6.8%'
      },
      {
        id: 'trade-zhao-3',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 24 * 60 * 60 * 1000),
        instrument: '2498.TW',
        action: SignalAction.BUY,
        reason: '宏達電均線糾結突破，VR題材',
        outcome: '漲停 +10%'
      },
      {
        id: 'trade-zhao-4',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
        instrument: '3443.TW',
        action: SignalAction.BUY,
        reason: '創意電子量價突破，IC設計資金回流',
        outcome: '獲利 +5.2%'
      },
      {
        id: 'trade-zhao-5',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
        instrument: '6547.TW',
        action: SignalAction.BUY,
        reason: '高端疫苗消息面刺激，量能爆發',
        outcome: '停損 -2.5%（量能不持續）'
      },
      {
        id: 'trade-zhao-6',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
        instrument: '2618.TW',
        action: SignalAction.BUY,
        reason: '長榮航觀光股輪動，嘗試介入',
        outcome: '停損 -3.0%（主力出貨）'
      },
      {
        id: 'trade-zhao-7',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
        instrument: '3529.TW',
        action: SignalAction.BUY,
        reason: '力旺 IP 矽智財題材，第一招型態',
        outcome: '漲停 +10%'
      },
      {
        id: 'trade-zhao-8',
        date: new Date(weekStartTwoWeeksAgo.getTime() + 4 * 24 * 60 * 60 * 1000),
        instrument: '3324.TW',
        action: SignalAction.BUY,
        reason: '雙鴻散熱題材，AI伺服器需求',
        outcome: '停損 -2.8%（大盤急跌拖累）'
      },
    ]
  },
  {
    id: 'journal-zhao-2',
    personId: 'person-6',
    systemId: 'system-6',
    weekStart: weekStartThreeWeeksAgo,
    weekEnd: weekEndThreeWeeksAgo,
    title: '漲停8招修煉派週記：盤整週的紀律操作，少做多看',
    summary: '本週大盤陷入狹幅盤整，成交量萎縮明顯，不符合漲停操作的最佳環境。全週僅進行 3 筆交易，嚴格執行「沒有 4有同步就不動手」的原則。雖然只抓到 1 支漲停，但成功避開多次假突破陷阱。這週的重點是：不做也是一種紀律。',
    learningPoints: [
      '大盤量縮時，漲停股數量減少，勝率也會下降',
      '強迫自己在沒訊號時休息，比勉強進場更重要',
      '這週只有1支漲停但沒虧損，保住本金就是勝利',
      '「4有」指標的價值在於它會告訴你「不要做」'
    ],
    trades: [
      {
        id: 'trade-zhao-9',
        date: weekStartThreeWeeksAgo,
        instrument: '2303.TW',
        action: SignalAction.BUY,
        reason: '聯電開盤強勢，4有中3有確認',
        outcome: '獲利 +3.5%（未攻漲停，保守出場）'
      },
      {
        id: 'trade-zhao-10',
        date: new Date(weekStartThreeWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
        instrument: '2454.TW',
        action: SignalAction.BUY,
        reason: '聯發科量價配合，試單',
        outcome: '漲停 +10%'
      },
      {
        id: 'trade-zhao-11',
        date: new Date(weekStartThreeWeeksAgo.getTime() + 4 * 24 * 60 * 60 * 1000),
        instrument: '3037.TW',
        action: SignalAction.BUY,
        reason: '欣興 ABF 題材，量能放大',
        outcome: '平盤出場 +0.3%（攻擊力道不足）'
      },
    ]
  },
  // 週記 3 - 洗盤手法教學
  {
    id: 'journal-zhao-3',
    personId: 'person-6',
    systemId: 'system-6',
    weekStart: new Date(weekStartThreeWeeksAgo.getTime() - 7 * 24 * 60 * 60 * 1000),
    weekEnd: new Date(weekEndThreeWeeksAgo.getTime() - 7 * 24 * 60 * 60 * 1000),
    title: '漲停8招修煉派週記：解析主力洗盤手法，3個經典型態實戰',
    summary: '本週專注於「洗盤結束型」的識別教學。透過 3 檔實際操作案例，詳細拆解主力洗盤的常見手法，以及如何在洗盤結束時精準介入。包含成功案例與失敗檢討，幫助學員建立完整的型態識別能力。',
    learningPoints: [
      '洗盤的三大特徵：量縮、假跌破、籌碼不鬆動',
      '洗盤結束的關鍵訊號：量能突然放大 + 收長紅',
      '如何區分「洗盤」與「真正出貨」',
      '錯誤示範：過早進場的代價與正確等待時機',
      '「有大人買」指標在洗盤末期的特殊表現'
    ],
    trades: [
      {
        id: 'trade-zhao-12',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 7 * 24 * 60 * 60 * 1000),
        instrument: '3443.TW',
        action: SignalAction.BUY,
        reason: '創意連續3日量縮後突然放量突破，洗盤結束型態確認',
        outcome: '漲停 +10%',
        detailedAnalysis: '開盤前觀察到前三日成交量萎縮至5日均量的40%，但籌碼面顯示主力持股不減反增。9:02 開盤跳空高開2.5%，9:05 成交量已達前日全日量的60%，確認「有人」指標觸發。9:08 突破前高壓力位，「4有」同步亮燈，果斷進場。',
        lessonsLearned: '洗盤的關鍵不是看股價跌多少，而是看籌碼是否鬆動。本案例籌碼集中度反而上升，是典型的洗盤訊號。'
      },
      {
        id: 'trade-zhao-13',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 6 * 24 * 60 * 60 * 1000),
        instrument: '6409.TW',
        action: SignalAction.BUY,
        reason: '旭隼假跌破5日線後快速收復，主力吸籌完畢',
        outcome: '獲利 +7.2%',
        detailedAnalysis: '前日收盤跌破5日線，散戶恐慌賣出，但當日開盤直接跳空站回。這是典型的「假跌破洗盤」手法，目的是把信心不足的散戶甩下車。9:15 確認站穩後進場，10:30 攻擊漲停未果但維持高檔，尾盤獲利了結。',
        lessonsLearned: '假跌破後的快速收復是強烈的多頭訊號，但要等站穩確認再進場，不要急於抄底。'
      },
      {
        id: 'trade-zhao-14',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 5 * 24 * 60 * 60 * 1000),
        instrument: '2379.TW',
        action: SignalAction.BUY,
        reason: '瑞昱連續震盪洗盤後突破，誤判為洗盤結束',
        outcome: '停損 -3.2%（實為出貨）',
        detailedAnalysis: '技術型態看似洗盤結束，但忽略了大戶連續3日賣超的警訊。「有大人買」指標實際上是紅燈，我因為過度自信而選擇忽略。進場後股價緩跌，達到停損點果斷出場。',
        lessonsLearned: '這筆是本週最重要的失敗案例。任何一個「4有」指標亮紅燈都不應該進場，即使其他指標都是綠燈。紀律是獲利的基礎。'
      },
      {
        id: 'trade-zhao-15',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 4 * 24 * 60 * 60 * 1000),
        instrument: '3661.TW',
        action: SignalAction.BUY,
        reason: '世芯洗盤5日後爆量長紅，4有同步確認',
        outcome: '漲停 +10%',
        detailedAnalysis: '這是本週最漂亮的一筆操作。連續5日量縮整理，股價在均線附近窄幅震盪。今日9:01開盤即放量突破，「4有」指標0.5秒內全部亮燈。9:02進場，9:25鎖漲停，持有至收盤。',
        lessonsLearned: '耐心等待「4有」同步確認是關鍵。寧可少賺也不要因為衝動而虧損。'
      },
    ]
  },
  // 週記 4 - 大盤急跌防守策略
  {
    id: 'journal-zhao-4',
    personId: 'person-6',
    systemId: 'system-6',
    weekStart: new Date(weekStartThreeWeeksAgo.getTime() - 14 * 24 * 60 * 60 * 1000),
    weekEnd: new Date(weekEndThreeWeeksAgo.getTime() - 14 * 24 * 60 * 60 * 1000),
    title: '漲停8招修煉派週記：大盤急跌時的防守策略與機會識別',
    summary: '本週大盤下跌超過 300 點，是測試紀律的最佳時機。本篇週記分享：如何在恐慌中保持冷靜、辨識真正的恐慌底部訊號、以及急跌後的反彈操作策略。包含本週全部 6 筆交易的完整覆盤。',
    learningPoints: [
      '急跌時的第一原則：先觀察，不要接刀',
      '恐慌量出現後，等待縮量確認才是進場時機',
      '急跌後的反彈往往是最肥的肉，但要有紀律只做一天',
      '本週停損 2 筆但避開更大跌幅，守住紀律就是獲利',
      '大盤弱勢時只做強勢股，絕不碰補跌股'
    ],
    trades: [
      {
        id: 'trade-zhao-16',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 14 * 24 * 60 * 60 * 1000),
        instrument: '觀望',
        action: SignalAction.EXIT,
        reason: '大盤開低走低，全日觀望不進場',
        outcome: '零交易（正確決策）',
        detailedAnalysis: '開盤大盤跳空下跌150點，恐慌情緒蔓延。雖然盤中有多檔股票觸發「有漲」指標，但「有大人買」全面紅燈。嚴格執行「4有不同步就不做」的原則，全日零交易。',
        lessonsLearned: '空手也是一種持倉。在不確定的環境中保護本金是第一優先。'
      },
      {
        id: 'trade-zhao-17',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 13 * 24 * 60 * 60 * 1000),
        instrument: '2330.TW',
        action: SignalAction.BUY,
        reason: '台積電盤中翻紅，資金避風港效應',
        outcome: '獲利 +2.8%',
        detailedAnalysis: '大盤持續弱勢，但台積電逆勢走強。9:30 確認「4有」指標亮燈後小量進場（僅正常倉位的50%）。由於是弱勢盤中操作，設定更嚴格的停損（2%）。午盤後獲利了結，不貪心。',
        lessonsLearned: '弱勢中做強勢股可以，但要降低倉位並提早獲利了結。'
      },
      {
        id: 'trade-zhao-18',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 12 * 24 * 60 * 60 * 1000),
        instrument: '3037.TW',
        action: SignalAction.BUY,
        reason: '欣興嘗試抄底，誤判底部',
        outcome: '停損 -2.5%',
        detailedAnalysis: '看到連續下跌後的長下影線，誤以為是底部訊號。但進場後股價繼續走弱，「有人買」指標從綠轉紅。果斷在達到停損點時出場，事後證明股價又跌了5%。',
        lessonsLearned: '永遠不要試圖抄底。下影線不代表底部，要等站穩再說。這筆虧損提醒我：紀律停損讓我少虧了一半。'
      },
      {
        id: 'trade-zhao-19',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 11 * 24 * 60 * 60 * 1000),
        instrument: '6770.TW',
        action: SignalAction.BUY,
        reason: '力積電恐慌量後反彈，短線搶反彈',
        outcome: '漲停 +10%',
        detailedAnalysis: '前日出現恐慌性賣壓，成交量放大至10日均量的3倍。今日開盤直接跳空高開，「4有」同步確認。這是典型的「恐慌後反彈」型態，果斷進場。10:15鎖漲停。',
        lessonsLearned: '恐慌量出現後的隔日反彈往往很強，但要注意這是短線操作，不能戀戰。'
      },
      {
        id: 'trade-zhao-20',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 11 * 24 * 60 * 60 * 1000),
        instrument: '3661.TW',
        action: SignalAction.BUY,
        reason: '世芯同日搶反彈，IC設計龍頭',
        outcome: '獲利 +6.5%',
        detailedAnalysis: '與力積電同日操作，同樣是恐慌後反彈型態。由於已經有一筆滿倉，這筆只做半倉。攻擊漲停未果，午盤後見好就收。',
        lessonsLearned: '同時操作兩檔時要控制總曝險，不能兩檔都滿倉。'
      },
      {
        id: 'trade-zhao-21',
        date: new Date(weekStartThreeWeeksAgo.getTime() - 10 * 24 * 60 * 60 * 1000),
        instrument: '2618.TW',
        action: SignalAction.BUY,
        reason: '長榮航跟風搶反彈，貪心多做一筆',
        outcome: '停損 -2.0%',
        detailedAnalysis: '前兩日的成功讓我有點飄了，看到長榮航開盤強勢就進場，忽略了「有大人買」指標沒有確認。結果主力是借反彈出貨，股價快速回落。',
        lessonsLearned: '連續獲利後最容易放鬆警惕。這筆虧損是貪心的代價，提醒自己永遠要遵守「4有」紀律。'
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
  // 只返回用戶已訂閱專家的訊號
  const userSubs = getUserSubscriptions(userId);
  const subscribedPersonIds = userSubs
    .filter(s => s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2)
    .map(s => s.person.id);
  
  const now = new Date();
  return signals
    .filter(s => s.timeVisible <= now && subscribedPersonIds.includes(s.personId))
    .map(signal => ({
      ...signal,
      person: people.find(p => p.id === signal.personId)!,
      system: tradingSystems.find(s => s.id === signal.systemId)!,
    }))
    .sort((a, b) => b.timeTrade.getTime() - a.timeTrade.getTime());
}

export function getJournalsForUser(userId: string): JournalWithPerson[] {
  // 只返回用戶已訂閱導師的週記
  const userSubs = getUserSubscriptions(userId);
  const subscribedPersonIds = userSubs
    .filter(s => s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL)
    .map(s => s.person.id);
  
  return weeklyJournals
    .filter(j => subscribedPersonIds.includes(j.personId))
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
