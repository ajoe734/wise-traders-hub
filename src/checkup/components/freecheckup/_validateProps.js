/**
 * Dev-only runtime props validator for freecheckup/* tab 元件。
 *
 * 目的：抽出大型 tab 元件後，避免上游 FreeCheckup.jsx 改動時漏傳 prop / 傳錯型別，
 * 卻只在執行時某條冷路徑才炸（例如點到某個 button 才呼叫 undefined callback）。
 *
 * - 只在 import.meta.env.DEV === true 時執行（production build 完全不跑）
 * - 每個 (component, prop) 只警告一次，不洗 console
 * - 不丟 throw、不擋畫面：只 console.error，行為與原本一致
 *
 * Schema 格式：
 *   { propName: 'function' | 'object' | 'array' | 'string' | 'number' |
 *               'boolean' | 'node' | 'any',
 *     optional?: boolean }
 *
 * 'node' 接受 React node（string / number / element / array / boolean / null / undefined）
 * 'any'  只檢查 required（不檢查型別）
 */

const warned = new Set();

const isDev =
  typeof import.meta !== 'undefined' && import.meta && import.meta.env
    ? import.meta.env.DEV === true
    : false;

function actualType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function typeMatches(expected, value) {
  if (expected === 'any') return true;
  if (expected === 'node') {
    // React node 太鬆，這裡只擋掉明顯錯（plain object 不合法 child）
    const t = actualType(value);
    return (
      t === 'string' ||
      t === 'number' ||
      t === 'boolean' ||
      t === 'undefined' ||
      t === 'null' ||
      t === 'array' ||
      t === 'object' /* React element */
    );
  }
  return actualType(value) === expected;
}

export function validateProps(componentName, props, schema) {
  if (!isDev) return;
  if (!props || !schema) return;

  for (const key of Object.keys(schema)) {
    const rule = schema[key];
    const expected = typeof rule === 'string' ? rule : rule.type;
    const optional = typeof rule === 'object' && rule.optional === true;
    const value = props[key];

    // 缺漏
    if (value === undefined) {
      if (optional) continue;
      const tag = `${componentName}:${key}:missing`;
      if (warned.has(tag)) continue;
      warned.add(tag);
      // eslint-disable-next-line no-console
      console.error(
        `[${componentName}] required prop "${key}" is missing (undefined). ` +
          `Check the parent component's prop wiring.`
      );
      continue;
    }

    // 型別
    if (value === null) {
      // null 視為「明示空」：如果 required 也接受 null（多數場景如 dailyReport）
      continue;
    }
    if (!typeMatches(expected, value)) {
      const tag = `${componentName}:${key}:type`;
      if (warned.has(tag)) continue;
      warned.add(tag);
      // eslint-disable-next-line no-console
      console.error(
        `[${componentName}] prop "${key}" expected ${expected}, got ${actualType(value)}.`
      );
    }
  }

  // 額外的 prop（非錯誤，但有助於發現重複命名 / 多餘耦合）
  for (const key of Object.keys(props)) {
    if (key in schema) continue;
    if (key === 'children') continue;
    const tag = `${componentName}:${key}:extra`;
    if (warned.has(tag)) continue;
    warned.add(tag);
    // eslint-disable-next-line no-console
    console.warn(
      `[${componentName}] unknown prop "${key}" (not in schema). ` +
        `Either add it to the schema or remove from parent.`
    );
  }
}

/** 測試/熱重載時清空已警告集合 */
export function _resetValidationWarnings() {
  warned.clear();
}
