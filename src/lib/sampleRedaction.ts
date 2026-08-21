/**
 * M1 正規化＋遮罩的「客戶端鏡像」— 僅供後台編輯時的即時提示。
 *
 * 權威判定一律在 DB（public.sample_normalize_text + public.sample_redact_m1）。
 * 此檔任何結果都不得決定是否核准，也不得用來產生實際公開文字：
 * 公開文字只由 approve_expert_public_sample() 於伺服器端讀原文、正規化、遮罩後寫入。
 */

export type SampleRedactionReason =
  | 'empty_source'
  | 'html_residual'
  | 'pii_email'
  | 'pii_phone'
  | 'pii_url_or_line'
  | 'pii_person_name'
  | 'future_instruction'
  | 'unclassified_numeric'
  | 'residual_contextual_price';

export interface SampleRedactionResult {
  ok: boolean;
  reason: SampleRedactionReason | null;
  text: string;
}

export const SAMPLE_REDACTION_REASON_LABEL: Record<SampleRedactionReason, string> = {
  empty_source: '來源為空白',
  html_residual: '正規化後仍殘留標記，禁止公開',
  pii_email: '含 email，禁止公開',
  pii_phone: '含電話號碼，禁止公開',
  pii_url_or_line: '含外部連結或社群帳號，禁止公開',
  pii_person_name: '含人名稱謂，禁止公開',
  future_instruction: '含未來操作指示，禁止公開',
  unclassified_numeric: '含無法歸類的數字，禁止公開',
  residual_contextual_price: '仍殘留價格語境數字，禁止公開',
};

export const PRICE_MASK = '［價格已隱藏］';
export const QTY_MASK = '［數量已隱藏］';
export const RATIO_MASK = '［比例已隱藏］';

/** HTML -> plain text（deterministic，鏡像 public.sample_normalize_text）。 */
export function normalizeSampleText(input: string | null | undefined): string {
  let t = input ?? '';
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section|article)\s*>/gi, '\n');
  t = t.replace(/<\s*(li|p|div|h[1-6]|tr|blockquote|section|article)(\s[^>]*)?>/gi, '\n');
  t = t.replace(/<[^>]*>/g, '');
  t = t.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  t = t.replace(/[ \t\r]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.replace(/^[\s\n]+|[\s\n]+$/g, '');
}

const FAIL_RULES: Array<[SampleRedactionReason, RegExp]> = [
  ['html_residual', /<\s*\/?\s*[a-z!][^>]*>/i],
  ['pii_email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['pii_phone', /(09\d{8}|\+886\d{6,}|0[2-8]-\d{6,8})/],
  ['pii_url_or_line', /(https?:\/\/|line\.me|t\.me|@[A-Za-z0-9_]{4,})/i],
  ['pii_person_name', /[^\x00-\x7F]{2,3}(老師|先生|小姐|總監|執行長)/],
  ['future_instruction', /(明天|明日|下週|下周|下個交易日|週一|周一|週五前|周五前|本週內|本周內|接下來|後續)[^。！!?？\n]{0,16}(買進|買好|買|賣出|賣|進場|出場|加碼|減碼|停利|停損|布局|佈局|卡位|準備|上攻|操作)/],
  ['future_instruction', /(一定要|務必|必須|建議|請|記得)[^。！!?？\n]{0,14}(買進|賣出|進場|出場|加碼|減碼|停利|停損|執行|布局|佈局|卡位|操作|抱住|追價)/],
];

const PRICE_CONTEXT =
  '價位|成本|均價|報價|目標價|履約價|短履約價|長履約價|停損價|停利價|油價|本金|最大損失|支撐|壓力';

export function redactSampleM1(input: string | null | undefined): SampleRedactionResult {
  const norm = normalizeSampleText(input);
  if (norm.trim() === '') return { ok: false, reason: 'empty_source', text: '' };

  for (const [reason, re] of FAIL_RULES) {
    if (re.test(norm)) return { ok: false, reason, text: '' };
  }

  let t = norm;
  t = t.replace(/\d[\d,]*(\.\d+)?\s*%/g, RATIO_MASK);
  t = t.replace(/(全倉|半倉|滿倉)/g, RATIO_MASK);
  t = t.replace(/\d[\d,]*(\.\d+)?\s*(張|口|股|部位|單位|手)/g, QTY_MASK);
  t = t.replace(/\d[\d,]*(\.\d+)?\s*(元|塊|美元|美金|USD|usd|NT\$|\$)/g, PRICE_MASK);

  const ctx = new RegExp(
    `(${PRICE_CONTEXT})([^0-9\\n]{0,16})\\d[\\d,]*(\\.\\d+)?(\\s*[~～至到-]\\s*\\d[\\d,]*(\\.\\d+)?)?`,
    'g',
  );
  for (let i = 0; i < 4; i += 1) t = t.replace(ctx, `$1$2${PRICE_MASK}`);

  t = t.replace(
    /(跌破|站上|突破|逼近|回測|上看|下看|守住|失守|上|破|至|到)\s*\d[\d,]*(\.\d+)?(\s*[~～]\s*\d[\d,]*(\.\d+)?)?(?![0-9%年月日號檔家人次])/g,
    `$1${PRICE_MASK}`,
  );
  t = t.replace(/\d[\d,]*(\.\d+)?\s*[~～]\s*\d[\d,]*(\.\d+)?/g, PRICE_MASK);
  t = t.replace(/(?<!\d)\d+\.\d+(?!\d)/g, PRICE_MASK);

  const ry = t.replace(/(19|20)\d{2}\s*年?/g, '');
  if (/\d{4,}/.test(ry) || /\d,\d{3}/.test(ry) || /\d+\.\d/.test(t)) {
    return { ok: false, reason: 'unclassified_numeric', text: '' };
  }
  if (new RegExp(`(跌破|站上|突破|逼近|${PRICE_CONTEXT})[^。\\n]{0,12}\\d`).test(t)) {
    return { ok: false, reason: 'residual_contextual_price', text: '' };
  }
  return { ok: true, reason: null, text: t };
}

export const SAMPLE_MAX_LENGTH = 1200;

export function truncateSample(text: string): { text: string; truncated: boolean } {
  return text.length > SAMPLE_MAX_LENGTH
    ? { text: text.slice(0, SAMPLE_MAX_LENGTH), truncated: true }
    : { text, truncated: false };
}
