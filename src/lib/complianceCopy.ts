/**
 * 行銷頁（/experts、/expert/:slug、/pricing、首頁橋接）唯一文案資料源。
 *
 * 規則（Plan v2.1 Phase 0 契約）：
 *  - 只描述「會員每週會拿到的結構」，不描述任何個別老師的實際內容、成果或標的。
 *  - 禁用字：推薦、跟單（mentor 文案內）、保證、目標價、下週出手，以及任何
 *    「因法規所以…」的法律結論。
 *  - cadence 句一律由 `nextPublishMomentLabel()` 產生；沒有 assetClass context
 *    時退回 `GENERIC_CADENCE`，不得硬寫週五 20:00。
 *
 * 本檔為純字串 + 純函式，無 DB、無查詢。
 */

import { nextPublishMomentLabel } from '@/lib/publishingWindow';

/** 沒有老師 context（清單頁／首頁）時唯一可用的 cadence 句。 */
export const GENERIC_CADENCE = '每週固定更新';

/** 每週交付結構（三卡）。描述的是「會員每週會得到的結構」，不是節錄。 */
export const DELIVERY_STRUCTURE = [
  {
    key: 'review',
    title: '當週操作復盤',
    desc: '當週已完成的進出場逐筆回顧，含當時的判斷依據與結果對照。',
  },
  {
    key: 'forward',
    title: '下週觀察框架',
    desc: '研究清單、觀察條件、風險情境；是觀察用的框架，不是操作指示。',
  },
  {
    key: 'risk',
    title: '風險與部位條件',
    desc: '部位規模、風險控管條件與情境假設的整理。',
  },
] as const;

/** 結構樣本（遮蔽塊）欄位骨架 — 只有欄位名稱，無任何老師原文。 */
export const SAMPLE_STRUCTURE_FIELDS = [
  '週次區間',
  '當週操作紀錄',
  '判斷依據',
  '結果對照',
  '下週研究清單',
  '觀察條件',
  '風險情境',
] as const;

export const SAMPLE_LOCKED_LABEL = '訂閱後可見';
export const SAMPLE_STRUCTURE_NOTE = '以下為會員每週交付的內容結構，非任何老師的實際內容節錄。';

/** 已核准的過去週記節錄（伺服器端遮罩後的固定快照）。 */
export const REAL_SAMPLE_TITLE = '過去週記節錄';
export const REAL_SAMPLE_NOTE = '以下為這位老師過去已公開週記的節錄，經平台審核與遮罩後公開；教學研究用途，非買賣建議。';
export const REAL_SAMPLE_MASK_NOTE = '價格、數量與比例已隱藏；完整內容為訂閱會員可見。';


/** 公開機制中性敘述（不下法律結論）。 */
export const PUBLISH_MECHANISM_TITLE = '公開機制';
export const PUBLISH_MECHANISM_LINES = [
  '內容依平台固定週次公開；教學研究用途，非買賣建議。',
  '公開時間由平台統一排程，不因個別內容調整。',
  '訂閱後可看到完整的當週復盤與下週觀察框架。',
] as const;

/** 既有免責句（集中供 marketing 頁引用；不改既有已上線合約語句）。 */
export const DISCLAIMER_SHORT = '過去績效不代表未來表現，投資有風險，請謹慎評估。';
export const DISCLAIMER_TEACHING = '教學研究用途，非買賣建議。';

/** Evidence 區 empty 狀態唯一文案（永不顯示假 0）。 */
export const NO_PUBLIC_RECORD = '尚無可公開紀錄';

/** 公開 mentor 方案卡唯一文案；不得回退使用資料庫中的舊行銷文案。 */
export const MENTOR_PLAN_COPY = {
  name: '修煉派',
  label: '每週固定公開｜當週操作復盤＋下週觀察框架',
  features: [
    '當週操作復盤',
    '判斷依據',
    '研究清單、觀察條件、風險情境',
  ],
  note: '內容依平台固定週次公開；教學研究用途，非買賣建議',
} as const;

/** 公開頁不得把誤填於 system_name 的 email 洩漏給訪客。 */
export function publicSystemName(value?: string | null): string {
  const normalized = value?.trim() ?? '';
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
  return normalized && !looksLikeEmail ? normalized : '尚未命名';
}

/** 行銷頁一句交付。 */
export const FUNNEL_ONE_LINER = '每週一次：當週操作復盤 ＋ 下週觀察框架 ＋ 帶回自己的持倉。';

/** 次級 CTA（持股健檢）。 */
export const CHECKUP_SECONDARY_CTA = '把觀察帶回我的持倉';

/**
 * 老師頁 cadence 句。有 assetClass → 由 publishingWindow 產生；否則退回通用句。
 */
export function cadenceLabel(assetClass?: string | null): string {
  if (!assetClass) return GENERIC_CADENCE;
  return `每${nextPublishMomentLabel(assetClass).replace('統一開放發布', '').trim()}`;
}

/** 禁用字清單 — 供 unit test 掃描本檔輸出字串。 */
export const BANNED_TERMS = ['推薦', '跟單', '保證', '目標價', '下週出手', '因法規'] as const;

/** 本檔所有對外文案字串（測試用；新增字串請一併加入）。 */
export function allCopyStrings(): string[] {
  return [
    GENERIC_CADENCE,
    ...DELIVERY_STRUCTURE.flatMap((d) => [d.title, d.desc]),
    ...SAMPLE_STRUCTURE_FIELDS,
    SAMPLE_LOCKED_LABEL,
    SAMPLE_STRUCTURE_NOTE,
    REAL_SAMPLE_TITLE,
    REAL_SAMPLE_NOTE,
    REAL_SAMPLE_MASK_NOTE,

    PUBLISH_MECHANISM_TITLE,
    ...PUBLISH_MECHANISM_LINES,
    DISCLAIMER_SHORT,
    DISCLAIMER_TEACHING,
    NO_PUBLIC_RECORD,
    MENTOR_PLAN_COPY.name,
    MENTOR_PLAN_COPY.label,
    ...MENTOR_PLAN_COPY.features,
    MENTOR_PLAN_COPY.note,
    FUNNEL_ONE_LINER,
    CHECKUP_SECONDARY_CTA,
    cadenceLabel('tw_stock'),
    cadenceLabel('us_stock'),
    cadenceLabel(null),
  ];
}
