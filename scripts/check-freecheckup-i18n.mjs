#!/usr/bin/env node
/**
 * FreeCheckup i18n 回歸檢查
 *
 * 範圍：src/pages/FreeCheckup.jsx 持倉看板（正式繁中產品畫面）
 *
 * 規則：
 *   1. 凡是會渲染給使用者看的英文字串（JSX text node、JSX 屬性中的可見字串、
 *      template literal 內非變數的英文文案）都會被掃出來。
 *   2. 通過下列條件之一即不視為違規：
 *      a. 屬於白名單（專有名詞、短金融縮寫、品牌詞、單位）
 *      b. 同行或上一行帶有 `// i18n-allow:<reason>` 或 `{/* i18n-allow:<reason> *\/}` 註解
 *      c. 字串完全由白名單詞 + 標點 + 空白組成（例如 "TODAY P&L"）
 *      d. 字串長度 < 2 或全為符號 / 數字
 *
 * 退出碼：0 = 通過，1 = 違規。
 *
 * 輸出：
 *   - stdout：人類可讀條列報告
 *   - --json <path>：結構化違規報告（給 CI Review API 用）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

const REL_FILE = 'src/pages/FreeCheckup.jsx';
const FILE = resolve(process.cwd(), REL_FILE);
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// ── 白名單（專有名詞 + 短金融縮寫 + 單位 + 平台/品牌 + 區塊標題）──
// 全部以「大小寫不敏感、整字比對」處理；連字號、& 視為字內字元
const ALLOWLIST = new Set(
  [
    // 平台 / 品牌
    'DEMO', 'AI', 'API', 'ETF', 'OA', 'LINE', 'QR', 'URL', 'JSON', 'OK',
    // 市場 / 地區
    'TAIWAN', 'TPE', 'TW', 'US', 'JP',
    // 金融縮寫（短，國際通用）
    'P&L', 'PNL', 'ROI', 'EPS', 'PER', 'PBR', 'YTD', 'MTD', 'QoQ', 'YoY',
    'TGT', 'AVG', 'VOL', 'OHLC', 'IPO', 'EX', 'TWD', 'USD',
    // 單位 / 通用詞
    'NT', 'NTD', 'PCT', 'NA', 'N/A',
    // ── 視覺裝飾用大寫區塊標籤（全大寫、無語意句構，作為設計排版錨點）──
    // 來源：mem://style/checkup/japanese-minimalist-aesthetic 的 Kore-eda 美學規範
    // 新增此類字串請先確認是否屬於「無敘述性、純當分隔錨點」的裝飾標題
    'TODAY', 'VALUE', 'DECISION', 'TARGET', 'TOMORROW', 'THESIS', 'NOTES',
    'PORTFOLIO', 'OVERVIEW', 'MARKET', 'TARGETS',
  ].map((w) => w.toUpperCase())
);

// 額外白名單：完全由 ASCII 數字、符號、空白、單一英文字母組成 → 視為非文案
const NON_PROSE_RE = /^[\s\d.,:;%+\-*/()[\]{}<>=&·•。、，？！?!"'`~|^]*$/;

const isWhitelistedWord = (word) => ALLOWLIST.has(word.toUpperCase());

/**
 * 判斷一個字串是否「不算需要翻譯的英文文案」
 * 通過條件（任一即可）：
 *   1. 全為符號 / 數字 / 空白
 *   2. 所有英文字詞都在白名單
 *   3. 含 CJK 字元（視為中文 / 中英混排，夾雜的英文視為專有名詞）
 *
 * 例如：
 *   "TODAY P&L"            → ✅（白名單）
 *   "THESIS · 進場理由"    → ✅（含 CJK）
 *   "如：台燿 Q1 財報"     → ✅（含 CJK）
 *   "Mark as hold"         → ❌
 *   "Exit Cue · 出場條件"  → ✅（含 CJK；若想擋需走 i18n-allow 反向豁免機制）
 */
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/;
const isAllWhitelisted = (str) => {
  const trimmed = str.trim();
  if (!trimmed) return true;
  if (NON_PROSE_RE.test(trimmed)) return true;
  if (CJK_RE.test(trimmed)) return true; // 含中文 → 視為已本地化
  // 拆出所有英文字詞（允許 & 與 - 在字內）
  const words = trimmed.match(/[A-Za-z][A-Za-z&-]*/g) || [];
  if (words.length === 0) return true;
  return words.every(isWhitelistedWord);
};

/** 該行（或上一行行尾）是否帶有 i18n-allow 豁免註解 */
const hasAllowComment = (lineIdx) => {
  const cur = lines[lineIdx] || '';
  const prev = lineIdx > 0 ? lines[lineIdx - 1] : '';
  const re = /(\/\/\s*i18n-allow\b|\{\s*\/\*\s*i18n-allow\b|\/\*\s*i18n-allow\b)/;
  return re.test(cur) || re.test(prev);
};

/** @type {{file:string,line:number,rule:string,severity:'error',detail:string,snippet:string,suggestion?:string}[]} */
const violations = [];

const buildSuggestion = (text) => {
  return [
    `// 此英文文案會出現在繁中正式畫面，請擇一處理：`,
    `// 1) 翻譯成中文（建議）：將 "${text}" 改為對應中文標籤`,
    `// 2) 加入專有名詞白名單：scripts/check-freecheckup-i18n.mjs 的 ALLOWLIST`,
    `// 3) 加豁免註解（限視覺裝飾、非資訊文案）：`,
    `//    在該行行尾加上 \`// i18n-allow:reason\``,
    `//    或上一行加 \`{/* i18n-allow:reason */}\``,
  ].join('\n');
};

const push = (v) => {
  violations.push({
    file: REL_FILE,
    severity: 'error',
    ...v,
    suggestion: v.suggestion ?? buildSuggestion(v.text),
  });
};

// ── 掃描規則 ──
//
// 因為 FreeCheckup.jsx 是 inline JSX 大檔，我們不做完整 AST，而以「逐行」掃描三類來源：
//   A) JSX text node：>...< 之間的純文字
//   B) JSX 屬性字串（aria-label="..." / title="..." / placeholder="..." / alt="..."）
//   C) 直接寫在 JSX 之中的字串字面量（不含 import / require / 註解 / 變數宣告）
//
// 為避免雜訊，會先排除：
//   - 註解行（以 //, /* 開頭）
//   - import / from 行
//   - 純 className / style key
//   - 樣式值（CSS 屬性如 'flex-end'、color 字、'em' 等）
//   - 屬性名稱（type="button"）

const ATTR_NAMES_TEXTUAL = ['aria-label', 'title', 'placeholder', 'alt'];

// 「會被讀屏器朗讀」或「會被使用者直接看到」的擴充屬性
// - aria-describedby / aria-labelledby 雖然官方語意是「ID 引用」，但實務上常被誤寫為直接文字
//   （錯誤用法仍會被讀屏器朗讀為字面字串），故一併掃描以阻擋這類退化。
// - aria-roledescription / aria-valuetext / aria-placeholder：直接朗讀字串。
// - aria-keyshortcuts：通常為按鍵縮寫（Ctrl+K），靠白名單與 NON_PROSE_RE 過濾雜訊。
const ATTR_NAMES_A11Y = [
  'aria-describedby',
  'aria-labelledby',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'aria-keyshortcuts',
];

// data-* 屬性中常被當「視覺/工具提示文字」使用的子集：
// - data-tooltip / data-tip / data-hint / data-title / data-label / data-text / data-content
//   → 這些常被第三方 tooltip 套件或自家元件直接 render 給使用者看
// 其他一般 data-* 屬性（data-id / data-state / data-testid…）不在此列，避免誤殺。
const DATA_ATTR_NAMES_VISIBLE = [
  'data-tooltip',
  'data-tip',
  'data-hint',
  'data-title',
  'data-label',
  'data-text',
  'data-content',
  'data-message',
  'data-placeholder',
];

// 跳過區段：import / 註解
const isSkipLine = (line) => {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith('//')) return true;
  if (t.startsWith('/*') || t.startsWith('*')) return true;
  if (/^\s*import\b/.test(line)) return true;
  if (/^\s*from\s+['"]/.test(line)) return true;
  return false;
};

// 排除「明顯是樣式值 / 屬性值」的字串
const looksLikeStyleOrAttr = (str) => {
  const s = str.trim();
  if (!s) return true;
  // CSS 值常見樣式
  if (/^(flex|grid|block|inline|none|auto|absolute|relative|fixed|center|left|right|top|bottom|hidden|visible|wrap|nowrap|column|row|space-between|flex-start|flex-end|stretch|baseline|pointer|default|currentColor|transparent|inherit|initial|unset|bold|normal|italic|underline|uppercase|lowercase|capitalize)$/i.test(s))
    return true;
  // 純色 / 數字單位
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return true;
  if (/^[\d.]+(px|em|rem|%|vh|vw|s|ms)?$/i.test(s)) return true;
  if (/^rgba?\(/i.test(s) || /^hsla?\(/i.test(s)) return true;
  // 路徑 / id
  if (/^[/.][\w./-]*$/.test(s)) return true;
  if (/^[a-z][a-zA-Z0-9-]*$/.test(s) && s.length <= 24) return true; // kebab/camel id
  return false;
};

lines.forEach((line, idx) => {
  if (isSkipLine(line)) return;
  if (hasAllowComment(idx)) return;

  // ── A) JSX text node：>...<  ──
  // 為避免把 JS 比較式（a > b && c < d）當成 JSX text，要求左側 `>` 是
  // JSX 標籤的結束符。判斷依據：在 `>` 之前往回找最近的 `<`，那段必須是
  // 合法的 JSX 標籤起始（< 或 </ 後緊接英文字母 / 大寫元件名）。
  const textRe = />([^<{}]+)</g;
  let m;
  while ((m = textRe.exec(line)) !== null) {
    const raw = m[1];
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!/[A-Za-z]/.test(text)) continue;
    if (isAllWhitelisted(text)) continue;
    if (looksLikeStyleOrAttr(text)) continue;

    // 驗證左側 `>` 是 JSX tag 收尾
    const gtPos = m.index; // 指向 `>` 位置
    const prefix = line.slice(0, gtPos);
    const lastLt = prefix.lastIndexOf('<');
    if (lastLt < 0) continue;
    const tagBody = prefix.slice(lastLt);
    // 必須像 <Tag ...> 或 </Tag>，標籤名為英文字母開頭
    if (!/^<\/?[A-Za-z][\w.-]*\b/.test(tagBody)) continue;

    push({
      line: idx + 1,
      rule: 'untranslated-jsx-text',
      text,
      detail:
        `JSX 文字節點含未翻譯英文："${text}"。` +
        `請改為繁中、加入白名單，或於行尾加 \`// i18n-allow:<原因>\` 豁免。`,
      snippet: line.trim().slice(0, 160),
    });
  }

  // ── B) JSX 屬性字串：aria-label="..." 等 ──
  for (const attr of ATTR_NAMES_TEXTUAL) {
    const re = new RegExp(`\\b${attr}=(?:"([^"]+)"|'([^']+)'|\\{["']([^"']+)["']\\})`, 'g');
    let mm;
    while ((mm = re.exec(line)) !== null) {
      const text = (mm[1] || mm[2] || mm[3] || '').trim();
      if (!text) continue;
      if (!/[A-Za-z]/.test(text)) continue;
      if (isAllWhitelisted(text)) continue;
      if (looksLikeStyleOrAttr(text)) continue;
      push({
        line: idx + 1,
        rule: 'untranslated-jsx-attr',
        text,
        detail:
          `JSX 屬性 \`${attr}\` 內含未翻譯英文："${text}"。` +
          `aria-label / title / placeholder / alt 都會被使用者看到或聽到。`,
        snippet: line.trim().slice(0, 160),
      });
    }
  }

  // ── B2) 擴充 a11y 屬性（aria-describedby / aria-roledescription 等）──
  for (const attr of ATTR_NAMES_A11Y) {
    const re = new RegExp(`\\b${attr}=(?:"([^"]+)"|'([^']+)'|\\{["']([^"']+)["']\\})`, 'g');
    let mm;
    while ((mm = re.exec(line)) !== null) {
      const text = (mm[1] || mm[2] || mm[3] || '').trim();
      if (!text) continue;
      if (!/[A-Za-z]/.test(text)) continue;
      // aria-describedby / aria-labelledby 正確值是 ID（kebab/camel），由 looksLikeStyleOrAttr 放行
      if (looksLikeStyleOrAttr(text)) continue;
      if (isAllWhitelisted(text)) continue;
      // 多字英文且含空白才視為「散文」→ 強烈代表是被誤當文案
      const isProse = /\s/.test(text) && /[A-Za-z]{3,}/.test(text);
      if (!isProse) continue;
      push({
        line: idx + 1,
        rule: 'untranslated-a11y-attr',
        text,
        detail:
          `a11y 屬性 \`${attr}\` 內疑似含未翻譯英文文案："${text}"。` +
          `${attr} 的值若為直接朗讀字串，會被輔助科技唸給使用者；若應為 ID 引用，請改用 ID 而非英文句子。`,
        snippet: line.trim().slice(0, 160),
      });
    }
  }

  // ── B3) data-* 視覺屬性（tooltip / hint / label 等常被直接渲染給使用者看）──
  for (const attr of DATA_ATTR_NAMES_VISIBLE) {
    const re = new RegExp(`\\b${attr}=(?:"([^"]+)"|'([^']+)'|\\{["']([^"']+)["']\\})`, 'g');
    let mm;
    while ((mm = re.exec(line)) !== null) {
      const text = (mm[1] || mm[2] || mm[3] || '').trim();
      if (!text) continue;
      if (!/[A-Za-z]/.test(text)) continue;
      if (isAllWhitelisted(text)) continue;
      if (looksLikeStyleOrAttr(text)) continue;
      push({
        line: idx + 1,
        rule: 'untranslated-data-attr',
        text,
        detail:
          `data 屬性 \`${attr}\` 內含未翻譯英文："${text}"。` +
          `這類屬性常被 tooltip / 自家元件直接 render 給使用者看，請翻譯或加 i18n-allow 豁免。`,
        snippet: line.trim().slice(0, 160),
      });
    }
  }

  // ── C) <button>/<option> 標籤「內容區」的字面量字串 ──
  // 只取 `<button …>` 與 `</button>` 之間的「內容」字串，**屬性區（含 style/onClick）排除**，
  // 否則會誤掃到 style 內的 CSS 字串如 "3px 8px"。
  //
  // 額外捕捉：
  //   <button>{cond ? "Save" : "Cancel"}</button>
  //   <option value="x">Apply now</option>
  //
  // 屬性已經由 ATTR_NAMES_TEXTUAL / ATTR_NAMES_A11Y / DATA_ATTR_NAMES_VISIBLE 覆蓋。
  // 找「JSX 開頭標籤」的結束 `>`：必須跳過 `{...}` 內的 `>` 與字串內的 `>`，
  // 否則 style={{padding:"3px 8px",...}} 內的 `=>` 與 `8px"` 的 `>` 會被誤判。
  const findOpenTagEnd = (s, fromIdx) => {
    let depth = 0; // {} 巢狀
    let inStr = null; // ' " ` 任一
    let esc = false;
    for (let i = fromIdx; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth = Math.max(0, depth - 1); continue; }
      if (c === '>' && depth === 0) return i;
    }
    return -1;
  };

  const tagOpenRe = /<(button|option)\b/gi;
  let bm;
  while ((bm = tagOpenRe.exec(line)) !== null) {
    const tag = bm[1].toLowerCase();
    const openTagStart = bm.index;
    const openTagEnd = findOpenTagEnd(line, openTagStart + 1);
    if (openTagEnd < 0) continue;
    const closeStart = line.indexOf(`</${tag}`, openTagEnd);
    if (closeStart < 0) continue;
    const inner = line.slice(openTagEnd + 1, closeStart);
    // 抓出三類英文字面量：
    //   "..."、'...'、`...`（template literal 但不含 ${}）
    const literalRe = /(["'`])((?:\\.|(?!\1).)*?)\1/g;
    let lm;
    while ((lm = literalRe.exec(inner)) !== null) {
      const quote = lm[1];
      const text = lm[2].trim();
      if (!text) continue;
      if (!/[A-Za-z]/.test(text)) continue;
      // template literal 含變數插值 → 跳過（變數內容無法靜態判斷）
      if (quote === '`' && lm[2].includes('${')) continue;
      if (isAllWhitelisted(text)) continue;
      if (looksLikeStyleOrAttr(text)) continue;
      push({
        line: idx + 1,
        rule: 'untranslated-button-literal',
        text,
        detail:
          `<${tag}> 內含字面量英文文案："${text}"。` +
          `按鈕 / 選項文字會直接顯示給使用者，請翻譯或加 i18n-allow 豁免。`,
        snippet: line.trim().slice(0, 160),
      });
    }
  }
});

// ── 輸出 JSON 報告 ──
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        tool: 'check-freecheckup-i18n',
        file: REL_FILE,
        totalLines: lines.length,
        allowlistSize: ALLOWLIST.size,
        passed: violations.length === 0,
        violations,
      },
      null,
      2
    )
  );
}

// ── stdout 報告 ──
if (violations.length === 0) {
  console.log('✅ FreeCheckup i18n 檢查通過');
  console.log(`   • 檢查檔案：${REL_FILE} (${lines.length} 行)`);
  console.log(`   • 白名單：${ALLOWLIST.size} 個專有名詞 / 縮寫`);
  console.log(
    `   • 規則：JSX 文字節點 + JSX 屬性（aria-label/title/placeholder/alt）` +
      ` + a11y 屬性（aria-describedby/labelledby/roledescription/valuetext/placeholder/keyshortcuts）` +
      ` + 視覺 data-* 屬性（data-tooltip/tip/hint/title/label/text/content/message/placeholder）` +
      ` + <button>/<option> 內字面量`
  );
  process.exit(0);
}

console.error('❌ FreeCheckup i18n 檢查失敗（' + violations.length + ' 個未翻譯英文字串）\n');
violations.forEach((v, i) => {
  console.error(`[${i + 1}] ${v.rule}  (${v.file}:${v.line})`);
  console.error(`    ${v.detail}`);
  if (v.snippet) console.error(`    > ${v.snippet}`);
  if (v.suggestion) {
    console.error(`    建議修正：`);
    v.suggestion.split('\n').forEach((s) => console.error(`      ${s}`));
  }
  console.error('');
});
process.exit(1);
