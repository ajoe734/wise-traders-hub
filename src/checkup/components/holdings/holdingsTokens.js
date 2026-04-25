/**
 * Holdings Workbench Design Tokens
 * 集中管理持倉決策工作台的色票、字級與間距
 *
 * 配色憲法（嚴格三色 + 兩階背景，不混入第四色）
 * ─────────────────────────────────────────────
 *  - accent 橘   #EC662D  唯一強調色：正報酬、urgency dot、accent 卡側條
 *  - ink 黑      #1E1E1D  主數字、卡片標題、強調反白底
 *  - inkMute 灰  #6B6862  次文字、負報酬、metadata
 *  - inkLight    #9B968D  placeholder、單位、disabled、零值
 *  - paper       #EFEDE8  頁面背景
 *  - surface     #FFFFFF  卡片背景
 *
 * 損益方向不靠紅綠，靠「顏色濃淡 + 字重 + 箭頭符號」：
 *   正報酬 → 橘色 + 較粗字重 + ↑（跳出來）
 *   負報酬 → 灰色 + 較細字重 + ↓（沉下去）
 *   這符合「該關注什麼」的決策直覺，而非證券 APP 的紅綠對撞。
 */

export const HOLDINGS_TOKENS = {
  // ── 色票 ──
  paper: '#EFEDE8',
  surface: '#FFFFFF',
  surfaceSoft: '#F7F5F0',
  ink: '#1E1E1D',
  inkMute: '#6B6862',
  inkLight: '#9B968D',
  hair: 'rgba(30,30,29,0.08)',
  hairStrong: 'rgba(30,30,29,0.16)',
  accent: '#EC662D',
  accentSoft: 'rgba(236,102,45,0.06)',

  // 損益語意色（取代過去的紅綠 up/down）
  gain: '#EC662D', // 正報酬 = accent 橘
  loss: '#6B6862', // 負報酬 = inkMute 灰
  flat: '#9B968D', // 零值 = inkLight

  // ── 字級 ──
  fontHeroLarge: 48,
  fontHeroMedium: 36,
  fontHeroSmall: 32,
  fontTitle: 15,
  fontMeta: 11,
  fontFootnote: 10.5,

  // ── 圓角與線條 ──
  radius: 4,
  hairWidth: 1,
  accentBarWidth: 2,

  // ── 間距 ──
  cardPaddingY: 16,
  cardPaddingX: 16,
  cardGap: 12,
  sectionGap: 20,
};

/**
 * 損益顏色：正→橘、負→灰、零→淺灰
 * @param {number} value
 * @returns {string}
 */
export const valueColor = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return HOLDINGS_TOKENS.flat;
  if (value > 0) return HOLDINGS_TOKENS.gain;
  if (value < 0) return HOLDINGS_TOKENS.loss;
  return HOLDINGS_TOKENS.flat;
};

/**
 * 損益字重：正報酬較粗（讓賺錢字「跳出來」），負報酬較細（讓賠錢字「沉下去」）
 * @param {number} value
 * @returns {number}
 */
export const valueWeight = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 400;
  return value > 0 ? 500 : 400;
};

/**
 * 損益方向箭頭符號（取代紅綠視覺）
 * @param {number} value
 * @returns {string}
 */
export const valueArrow = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value > 0) return '↑';
  if (value < 0) return '↓';
  return '';
};

/**
 * 三種卡片變體樣式
 */
export const CARD_VARIANTS = {
  ink: {
    background: HOLDINGS_TOKENS.ink,
    color: HOLDINGS_TOKENS.paper,
    border: 'none',
    accentBar: null,
    span: 2,
    fontHero: HOLDINGS_TOKENS.fontHeroLarge,
    minHeight: 200,
  },
  accent: {
    background: HOLDINGS_TOKENS.surface,
    color: HOLDINGS_TOKENS.ink,
    border: `1px solid ${HOLDINGS_TOKENS.hair}`,
    accentBar: HOLDINGS_TOKENS.accent,
    span: 1,
    fontHero: HOLDINGS_TOKENS.fontHeroMedium,
    minHeight: 168,
  },
  plain: {
    background: HOLDINGS_TOKENS.surface,
    color: HOLDINGS_TOKENS.ink,
    border: `1px solid ${HOLDINGS_TOKENS.hair}`,
    accentBar: null,
    span: 1,
    fontHero: HOLDINGS_TOKENS.fontHeroSmall,
    minHeight: 168,
  },
};
