/**
 * M1 遮罩的「客戶端鏡像」— 僅供後台編輯時的即時提示。
 *
 * 權威判定一律在 DB（public.sample_redact_m1）。此檔任何結果都不得
 * 決定是否核准，也不得用來產生實際公開文字：公開文字只由
 * approve_expert_public_sample() 於伺服器端讀原文、遮罩後寫入。
 */

export type SampleRedactionReason =
  | 'empty_source'
  | 'pii_email'
  | 'pii_phone'
  | 'pii_url_or_line'
  | 'pii_person_name'
  | 'future_instruction'
  | 'unclassified_numeric';

export interface SampleRedactionResult {
  ok: boolean;
  reason: SampleRedactionReason | null;
  text: string;
}

export const SAMPLE_REDACTION_REASON_LABEL: Record<SampleRedactionReason, string> = {
  empty_source: '來源為空白',
  pii_email: '含 email，禁止公開',
  pii_phone: '含電話號碼，禁止公開',
  pii_url_or_line: '含外部連結或社群帳號，禁止公開',
  pii_person_name: '含人名稱謂，禁止公開',
  future_instruction: '含未來操作指示，禁止公開',
  unclassified_numeric: '含無法歸類的數字，禁止公開',
};

const FAIL_RULES: Array<[SampleRedactionReason, RegExp]> = [
  ['pii_email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['pii_phone', /(09\d{8}|\+886\d{6,}|0[2-8]-\d{6,8})/],
  ['pii_url_or_line', /(https?:\/\/|line\.me|t\.me|@[A-Za-z0-9_]{4,})/i],
  ['pii_person_name', /[^\x00-\x7F]{2,3}(老師|先生|小姐|總監|執行長)/],
  ['future_instruction', /(明天|下週|下周|接下來|後續)[^。！!?？]{0,12}(買進|賣出|進場|出場|加碼|減碼|停損|目標價|布局)/],
];

export const PRICE_MASK = '［價格已隱藏］';
export const QTY_MASK = '［數量已隱藏］';
export const RATIO_MASK = '［比例已隱藏］';

export function redactSampleM1(input: string | null | undefined): SampleRedactionResult {
  const raw = input ?? '';
  if (raw.trim() === '') return { ok: false, reason: 'empty_source', text: '' };

  for (const [reason, re] of FAIL_RULES) {
    if (re.test(raw)) return { ok: false, reason, text: '' };
  }

  let t = raw;
  t = t.replace(/\d+(\.\d+)?\s*(元|塊|美元|USD|NT\$)/g, PRICE_MASK);
  t = t.replace(/(價位|成本|均價|報價)\s*[:：]?\s*\d+(\.\d+)?/g, `$1${PRICE_MASK}`);
  t = t.replace(/\d+(\.\d+)?\s*(張|口|股|部位|單位|手)/g, QTY_MASK);
  t = t.replace(/\d+(\.\d+)?\s*%/g, RATIO_MASK);
  t = t.replace(/(全倉|半倉|滿倉)/g, RATIO_MASK);

  if (/\d{5,}/.test(t) || /\d+\.\d{2,}/.test(t)) {
    return { ok: false, reason: 'unclassified_numeric', text: '' };
  }
  return { ok: true, reason: null, text: t };
}

export const SAMPLE_MAX_LENGTH = 1200;

export function truncateSample(text: string): { text: string; truncated: boolean } {
  return text.length > SAMPLE_MAX_LENGTH
    ? { text: text.slice(0, SAMPLE_MAX_LENGTH), truncated: true }
    : { text, truncated: false };
}
