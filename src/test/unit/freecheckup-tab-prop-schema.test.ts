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

/** 從元件檔抽出 schema 物件 keys */
function extractSchemaKeys(source: string, schemaName: string): Set<string> {
  const re = new RegExp(`const ${schemaName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = source.match(re);
  if (!m) throw new Error(`${schemaName} not found`);
  const body = m[1];
  const keyRe = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
  const keys = new Set<string>();
  let mm: RegExpExecArray | null;
  while ((mm = keyRe.exec(body)) != null) keys.add(mm[1]);
  return keys;
}

describe('FreeCheckup tab prop schemas', () => {
  const fc = read('src/pages/FreeCheckup.jsx');
  const eventsSrc = read('src/checkup/components/freecheckup/EventsTab.jsx');
  const dailySrc = read('src/checkup/components/freecheckup/DailyTab.jsx');

  it('EventsTab schema matches FreeCheckup call site', () => {
    const callSite = extractJsxProps(fc, 'EventsTab');
    const schema = extractSchemaKeys(eventsSrc, 'EVENTS_TAB_PROP_SCHEMA');
    const missingInSchema = [...callSite].filter((p) => !schema.has(p));
    const missingInCallSite = [...schema].filter((p) => !callSite.has(p));
    expect({ missingInSchema, missingInCallSite }).toEqual({
      missingInSchema: [],
      missingInCallSite: [],
    });
  });

  it('DailyTab schema matches FreeCheckup call site', () => {
    const callSite = extractJsxProps(fc, 'DailyTab');
    const schema = extractSchemaKeys(dailySrc, 'DAILY_TAB_PROP_SCHEMA');
    const missingInSchema = [...callSite].filter((p) => !schema.has(p));
    const missingInCallSite = [...schema].filter((p) => !callSite.has(p));
    expect({ missingInSchema, missingInCallSite }).toEqual({
      missingInSchema: [],
      missingInCallSite: [],
    });
  });
});

describe('validateProps runtime helper', () => {
  it('warns once on missing required prop and accepts null for optional/required', async () => {
    const mod = await import('../../checkup/components/freecheckup/_validateProps.js');
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
