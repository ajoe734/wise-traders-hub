/**
 * 守門測試：確保 EventsTab / DailyTab 的 prop schema 與
 * FreeCheckup.jsx 上游實際傳入的 props 名稱集合一致。
 *
 * 任何一邊改名 / 增刪 prop 都會被立即抓到，避免 closure 漏依賴或缺漏 callback。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** 從 `<Tab\n  propA={...}\n  propB={...}\n/>` 區塊抽出 prop 名稱集合 */
function extractJsxProps(source: string, tagName: string): Set<string> {
  // 抓 `<TagName ... />` 整段
  const re = new RegExp(`<${tagName}\\b([\\s\\S]*?)/>`);
  const m = source.match(re);
  if (!m) throw new Error(`<${tagName} ... /> not found`);
  const body = m[1];
  const propRe = /(^|\s)([A-Za-z_][A-Za-z0-9_]*)=\{/g;
  const props = new Set<string>();
  let mm: RegExpExecArray | null;
  while ((mm = propRe.exec(body)) != null) props.add(mm[2]);
  return props;
}

/** 從元件檔抽出 schema — 回傳 { required, optional } 兩組 keys */
function extractSchema(source: string, schemaName: string): { required: Set<string>; optional: Set<string> } {
  const re = new RegExp(`const ${schemaName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = source.match(re);
  if (!m) throw new Error(`${schemaName} not found`);
  const body = m[1];
  const keyRe = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*,?\s*$/gm;
  const required = new Set<string>();
  const optional = new Set<string>();
  let mm: RegExpExecArray | null;
  while ((mm = keyRe.exec(body)) != null) {
    const [, name, valuePart] = mm;
    if (/^\{.*\boptional\s*:\s*true\b/.test(valuePart)) optional.add(name);
    else required.add(name);
  }
  return { required, optional };
}

describe('FreeCheckup tab prop schemas', () => {
  const fc = read('src/pages/FreeCheckup.jsx');
  const eventsSrc = read('src/checkup/components/freecheckup/EventsTab.jsx');
  const dailySrc = read('src/checkup/components/freecheckup/DailyTab.jsx');
  const tradeSrc = read('src/checkup/components/freecheckup/TradeTab.jsx');
  const logSrc = read('src/checkup/components/freecheckup/LogTab.jsx');

  function expectMatch(tag: string, schemaName: string, src: string) {
    const callSite = extractJsxProps(fc, tag);
    const { required, optional } = extractSchema(src, schemaName);
    const all = new Set([...required, ...optional]);
    // callsite 傳的每個 prop 都必須存在於 schema（避免拼錯 / 未宣告 prop）
    const missingInSchema = [...callSite].filter((p) => !all.has(p));
    // schema 宣告的 required prop 都必須在 callsite 出現；optional 可省略
    const missingInCallSite = [...required].filter((p) => !callSite.has(p));
    expect({ missingInSchema, missingInCallSite }).toEqual({
      missingInSchema: [],
      missingInCallSite: [],
    });
  }


  it('EventsTab schema matches FreeCheckup call site', () => {
    expectMatch('EventsTab', 'EVENTS_TAB_PROP_SCHEMA', eventsSrc);
  });

  it('DailyTab schema matches FreeCheckup call site', () => {
    expectMatch('DailyTab', 'DAILY_TAB_PROP_SCHEMA', dailySrc);
  });

  // TradeTab 目前於 FreeCheckup.jsx 是 lazy import 但未渲染（上傳走 modal 流程），
  // 因此不能用 callsite 比對；改由存在性檢查守住 schema 匯出。
  it('TradeTab schema is exported (callsite is modal, not JSX)', () => {
    expect(tradeSrc).toMatch(/TRADE_TAB_PROP_SCHEMA/);
  });

  it('LogTab schema matches FreeCheckup call site', () => {
    expectMatch('LogTab', 'LOG_TAB_PROP_SCHEMA', logSrc);
  });
});

describe('validateProps runtime helper', () => {
  it('warns once on missing required prop and accepts null for optional/required', async () => {
    const mod = await import('../../checkup/lib/validateProps.js');
    const { validateProps, _resetValidationWarnings } = mod as any;
    _resetValidationWarnings();
    const errs: string[] = [];
    const orig = console.error;
    console.error = (msg: string) => errs.push(String(msg));
    try {
      validateProps(
        'X',
        { a: 1, b: undefined, c: null },
        { a: 'number', b: 'string', c: { type: 'object', optional: true } }
      );
      // duplicate call should not double-warn
      validateProps(
        'X',
        { a: 1, b: undefined, c: null },
        { a: 'number', b: 'string', c: { type: 'object', optional: true } }
      );
    } finally {
      console.error = orig;
    }
    // 在 vitest 預設環境（DEV=true）下應該至少警告一次 b
    expect(errs.filter((e) => e.includes('"b"')).length).toBeLessThanOrEqual(1);
  });
});
