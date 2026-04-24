/**
 * Holdings Workbench Design Tokens
 * 集中管理持倉決策工作台的色票、字級與間距
 *
 * 原則：克制色票、優先掃描效率、報酬率視覺主軸
 */

export const HOLDINGS_TOKENS = {
  // ── 色票 ──
  paper: '#EFEDE8', // 頁面背景（溫暖米白）
  surface: '#FFFFFF', // 卡片預設背景
  surfaceSoft: '#F7F5F0', // 次級卡片背景
  ink: '#1E1E1D', // 主文字 / ink 卡背景
  inkMute: '#6B6862', // 次文字
  inkLight: '#9B968D', // metadata、placeholder
  hair: 'rgba(30,30,29,0.08)', // 細線
  hairStrong: 'rgba(30,30,29,0.16)', // 強調分隔線
  accent: '#EC662D', // 強調橘（review 卡 + 小圓點）
  accentSoft: 'rgba(236,102,45,0.06)', // 橘色淡底（accent 卡背景）

  // 漲跌（僅用於數字本身，台股慣例：紅漲綠跌）
  up: '#C0392B',
  down: '#2E7D5B',

  // ── 字級 ──
  fontHeroLarge: 48, // ink 卡報酬率
  fontHeroMedium: 36, // accent 卡報酬率
  fontHeroSmall: 32, // plain 卡報酬率
  fontTitle: 15, // 卡片標題（股名）
  fontMeta: 11, // 標籤、metadata
  fontFootnote: 10.5, // 卡片底部資訊密度行

  // ── 圓角與線條 ──
  radius: 4, // 統一小圓角，避免「卡片感」
  hairWidth: 1,
  accentBarWidth: 2,

  // ── 間距 ──
  cardPaddingY: 16,
  cardPaddingX: 16,
  cardGap: 12,
  sectionGap: 20,
};

/**
 * 取得文字顏色（依漲跌）
 * @param {number} value
 * @returns {string}
 */
export const valueColor = (value) =>
  value > 0 ? HOLDINGS_TOKENS.up : value < 0 ? HOLDINGS_TOKENS.down : HOLDINGS_TOKENS.inkMute;

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
