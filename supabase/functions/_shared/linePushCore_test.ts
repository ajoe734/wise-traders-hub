import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildPromoMessage, classifyLineTargets, htmlToText } from './linePushCore.ts';

Deno.test('htmlToText 拍平 TipTap HTML', () => {
  assertEquals(
    htmlToText('<p>第一段</p><ul><li>甲</li></ul><img src="x">'),
    '第一段\n• 甲\n[圖片]',
  );
  assertEquals(htmlToText(null), '');
  assertEquals(htmlToText('純文字'), '純文字');
});

Deno.test('buildPromoMessage 依 signalCount 切換文案', () => {
  const batch = buildPromoMessage('老周', null, 3) as any;
  assertEquals(batch.altText, '📊 老周 本週發布 3 筆操作 — 立即重新訂閱！');
  const single = buildPromoMessage('老周', null) as any;
  assertEquals(single.altText, '📊 老周 最新績效更新 — 立即重新訂閱跟上操作！');
});

Deno.test('classifyLineTargets 分流並剔除過期', () => {
  const r = classifyLineTargets(
    [
      { user_id: 'u1', line_user_id: 'L1' },
      { user_id: 'u2', line_user_id: 'L2' },
      { user_id: 'u3', line_user_id: 'L3' },
    ],
    [
      { user_id: 'u1', plan_id: 'p1', canceled_at: null },
      { user_id: 'u2', plan_id: 'p1', canceled_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u3', plan_id: 'p1', canceled_at: null, expires_at: '2026-01-01T00:00:00Z' },
    ],
    new Set(['p1']),
    '2026-07-30T00:00:00Z',
  );
  assertEquals(r.subscribedTargets, ['L1']);
  assertEquals(r.canceledTargets, ['L2']);
});
