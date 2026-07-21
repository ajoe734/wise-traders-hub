/**
 * line-push-signal · 單位單一資料源合約測試
 *
 * 憲法：
 *   - us_stock  → 「股」（絕不能是「張」）
 *   - us_future → 「口」
 *   - us_option → 「口」
 *   - crypto    → 「顆」
 *   - tw_stock  → 「張」
 *
 * 覆蓋：
 *   1. resolveLinePushQuantityUnit — 純函式所有分支（asset_class 直接指定、
 *      quantity_unit 誤寫為「張」、asset_class 缺值時由 expert.asset_class /
 *      currency=USD 推導）。
 *   2. buildFlexMessage payload — 檢查 publish / update 兩種 pushType 下，
 *      LINE Flex Message body text 與 clipboardText 都不會出現「張」，
 *      同時 alt/text 一定帶到正確單位。
 */
import { assertEquals, assertStringIncludes, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveLinePushQuantityUnit } from './quantityUnit.ts';
import { buildFlexMessage } from './index.ts';

// ---------- 1. resolveLinePushQuantityUnit ----------

Deno.test('resolveLinePushQuantityUnit · asset_class 直接指定 us_stock → 股', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'us_stock', quantity_unit: null }), '股');
});

Deno.test('resolveLinePushQuantityUnit · us_stock + 誤寫「張」→ 覆寫為 股', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'us_stock', quantity_unit: '張' }), '股');
});

Deno.test('resolveLinePushQuantityUnit · us_future → 口', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'us_future', quantity_unit: null }), '口');
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'us_future', quantity_unit: '張' }), '口');
});

Deno.test('resolveLinePushQuantityUnit · us_option → 口', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'us_option', quantity_unit: null }), '口');
});

Deno.test('resolveLinePushQuantityUnit · crypto → 顆', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'crypto', quantity_unit: null }), '顆');
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'crypto', quantity_unit: '張' }), '顆');
});

Deno.test('resolveLinePushQuantityUnit · tw_stock 保留「張」與「股」', () => {
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'tw_stock', quantity_unit: '張' }), '張');
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'tw_stock', quantity_unit: '股' }), '股');
  assertEquals(resolveLinePushQuantityUnit({ asset_class: 'tw_stock', quantity_unit: null }), '張');
});

Deno.test('resolveLinePushQuantityUnit · asset_class 缺 → expertHint.asset_class 接手', () => {
  assertEquals(
    resolveLinePushQuantityUnit({ quantity_unit: '張' }, { asset_class: 'us_stock' }),
    '股',
  );
  assertEquals(
    resolveLinePushQuantityUnit({ quantity_unit: null }, { asset_class: 'us_future' }),
    '口',
  );
});

Deno.test('resolveLinePushQuantityUnit · 全缺 + expertHint.currency=USD → 推導 us_stock', () => {
  assertEquals(
    resolveLinePushQuantityUnit({ quantity_unit: '張' }, { currency: 'USD' }),
    '股',
  );
});

Deno.test('resolveLinePushQuantityUnit · 全缺 → tw_stock/張（唯一容許預設）', () => {
  assertEquals(resolveLinePushQuantityUnit({}, {}), '張');
  assertEquals(resolveLinePushQuantityUnit(null, null), '張');
});

Deno.test('resolveLinePushQuantityUnit · signal.asset_class 優先於 expertHint', () => {
  // 混合帳號情境：expert 是 tw_stock，但某支 signal 是 us_stock
  assertEquals(
    resolveLinePushQuantityUnit(
      { asset_class: 'us_stock', quantity_unit: '張' },
      { asset_class: 'tw_stock' },
    ),
    '股',
  );
});

// ---------- 2. buildFlexMessage payload 檢查 ----------

function walkTexts(node: any, sink: string[]) {
  if (!node) return;
  if (typeof node === 'string') { sink.push(node); return; }
  if (Array.isArray(node)) { for (const n of node) walkTexts(n, sink); return; }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) walkTexts(node[k], sink);
  }
}
function allTexts(flex: any): string {
  const bag: string[] = [];
  walkTexts(flex, bag);
  return bag.join('\n');
}

const usStockSignal = {
  id: 'sig-us-1',
  instrument: 'AAPL',
  action: 'buy',
  price_hint: 185.5,
  quantity: 100,
  quantity_unit: '張', // 上游誤寫，必須被覆寫掉
  reason_summary: null,
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
  overall_summary: null,
  teaching_topic: null,
};

const usFutureSignal = {
  id: 'sig-fut-1',
  instrument: '/ES',
  action: 'buy',
  price_hint: 5000,
  quantity: 2,
  quantity_unit: null,
  reason_summary: null,
  reason_detail: null,
  risk_notes: null,
  learning_points: null,
};

const twStockSignal = {
  id: 'sig-tw-1',
  instrument: '2330',
  action: 'buy',
  price_hint: 1000,
  quantity: 5,
  quantity_unit: '張',
};

Deno.test('buildFlexMessage · us_stock publish payload 只出現「股」，絕無「張」', () => {
  const flex = buildFlexMessage(usStockSignal, 'publish', { asset_class: 'us_stock' });
  const text = allTexts(flex);
  assertStringIncludes(text, '100股');
  assertFalse(text.includes('張'), `payload 不應該出現「張」，實際：\n${text}`);
});

Deno.test('buildFlexMessage · us_stock update payload 也不會回退成「張」', () => {
  const flex = buildFlexMessage(usStockSignal, 'update', { asset_class: 'us_stock' });
  const text = allTexts(flex);
  assertStringIncludes(text, '100股');
  assertFalse(text.includes('張'));
});

Deno.test('buildFlexMessage · signal.quantity_unit=null + expertHint.currency=USD → 印「股」', () => {
  const flex = buildFlexMessage(
    { ...usStockSignal, quantity_unit: null },
    'publish',
    { currency: 'USD' },
  );
  const text = allTexts(flex);
  assertStringIncludes(text, '100股');
  assertFalse(text.includes('張'));
});

Deno.test('buildFlexMessage · us_future payload 顯示「口」', () => {
  const flex = buildFlexMessage(usFutureSignal, 'publish', { asset_class: 'us_future' });
  const text = allTexts(flex);
  assertStringIncludes(text, '2口');
  assertFalse(text.includes('張'));
});

Deno.test('buildFlexMessage · tw_stock payload 仍保留「張」', () => {
  const flex = buildFlexMessage(twStockSignal, 'publish', { asset_class: 'tw_stock' });
  const text = allTexts(flex);
  assertStringIncludes(text, '5張');
});

Deno.test('buildFlexMessage · clipboardText（一鍵複製）也帶正確單位', () => {
  const flex = buildFlexMessage(usStockSignal, 'publish', { asset_class: 'us_stock' });
  // 找到 footer 內 clipboard button 的 clipboardText
  const buttons = flex?.contents?.footer?.contents ?? [];
  const clip = buttons.find((b: any) => b?.action?.type === 'clipboard');
  const clipboardText: string = clip?.action?.clipboardText ?? '';
  assertStringIncludes(clipboardText, '100股');
  assertFalse(clipboardText.includes('張'), `clipboardText 不應該出現「張」：\n${clipboardText}`);
});

Deno.test('buildFlexMessage · takedown 型別不含 quantity 段，也不會誤印單位', () => {
  const flex = buildFlexMessage(usStockSignal, 'takedown', { asset_class: 'us_stock' });
  const text = allTexts(flex);
  assertFalse(text.includes('張'));
  assertFalse(text.includes('100股'), 'takedown bubble 不應該帶數量'); // 只提示已收回
});
