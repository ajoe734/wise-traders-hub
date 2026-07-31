import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toMirror, readDeno, MIRROR_PATH, DENO_PATH } from '../../../scripts/gen-line-push-core-mirror.mjs';
import {
  htmlToText,
  plainifySignal,
  buildPromoMessage,
  classifyLineTargets,
} from '@/lib/linePushCore';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

describe('linePushCore mirror parity', () => {
  it('前台鏡像與 Deno 唯一資料源逐字同步', () => {
    expect(read(MIRROR_PATH)).toBe(toMirror(readDeno()));
  });

  it('相容出口 src/lib/weeklyPublishLogic.ts 已刪除', () => {
    expect(existsSync(resolve(root, 'src/lib/weeklyPublishLogic.ts'))).toBe(false);
  });

  it('三支 edge function 不得再自刻 htmlToText / buildPromoMessage / 分流邏輯', () => {
    // publish-weekly-journals 已拆成多檔（P1），整個目錄一起檢查
    const groups: Array<{ label: string; files: string[] }> = [
      {
        label: 'publish-weekly-journals',
        files: readdirSync(resolve(root, 'supabase/functions/publish-weekly-journals'))
          .filter((f) => f.endsWith('.ts'))
          .map((f) => `supabase/functions/publish-weekly-journals/${f}`),
      },
      { label: 'line-push-signal', files: ['supabase/functions/line-push-signal/index.ts'] },
    ];
    for (const g of groups) {
      const src = g.files.map(read).join('\n');
      expect(src, `${g.label} 仍自刻 htmlToText`).not.toMatch(/function htmlToText/);
      expect(src, `${g.label} 仍自刻 buildPromoMessage`).not.toMatch(/function buildPromoMessage/);
      expect(src, `${g.label} 仍自刻名單分流`).not.toMatch(/const subscribedUserIds = new Set/);
      expect(src, `${g.label} 未引用唯一資料源`).toContain('_shared/linePushCore.ts');
    }

    // signal-ai-assist 的是語意不同的 prompt 壓平器，必須改名避免誤認同源
    const ai = read('supabase/functions/signal-ai-assist/index.ts');
    expect(ai).not.toMatch(/function htmlToText/);
    expect(ai).toContain('flattenHtmlForPrompt');
  });

  it('Deno 端沒有殘留重複實作字串', () => {
    const deno = readDeno();
    expect(deno).toContain('export function buildPromoMessage');
    expect(DENO_PATH).toBe('supabase/functions/_shared/linePushCore.ts');
  });
});

describe('htmlToText', () => {
  it('非 HTML 原樣回傳、空值回空字串', () => {
    expect(htmlToText('純文字')).toBe('純文字');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });

  it('段落、換行、列表、圖片與 entity 都拍平', () => {
    const html = '<p>第一段</p><p>第二<br>段</p><ul><li>甲</li><li>乙</li></ul><img src="x"><p>A&amp;B&nbsp;C</p>';
    expect(htmlToText(html)).toBe('第一段\n第二\n段\n• 甲\n• 乙\n[圖片] A&B C');
  });

  it('連續空行壓成最多兩行', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('plainifySignal 只處理富文字欄位', () => {
    const out = plainifySignal({
      reason_summary: '<p>理由</p>',
      teaching_topic: '<p>主題</p>',
      instrument: '2330 台積電',
      price_hint: 1000,
    });
    expect(out.reason_summary).toBe('理由');
    expect(out.teaching_topic).toBe('主題');
    expect(out.instrument).toBe('2330 台積電');
    expect(out.price_hint).toBe(1000);
  });
});

describe('buildPromoMessage', () => {
  const perf = { win_rate: 66.666, total_return_pct: 12.34, return_1y: 5, total_trades: 9 };

  it('批次情境（有 signalCount）帶筆數副標與 altText', () => {
    const msg: any = buildPromoMessage('老周', perf, 3);
    expect(msg.altText).toBe('📊 老周 本週發布 3 筆操作 — 立即重新訂閱！');
    expect(msg.contents.body.contents[1].text).toBe('本週發布了 3 筆操作紀錄，以下是最新績效表現：');
  });

  it('單筆訊號情境（無 signalCount）用訊號文案', () => {
    const msg: any = buildPromoMessage('彥愷', perf);
    expect(msg.altText).toBe('📊 彥愷 最新績效更新 — 立即重新訂閱跟上操作！');
    expect(msg.contents.body.contents[1].text).toBe('分析師剛發布了新的操作訊號，以下是最新績效表現：');
  });

  it('績效數值一律一位小數，缺值顯示 -', () => {
    const msg: any = buildPromoMessage('X', { win_rate: null, total_return_pct: 12.34, return_1y: null }, 1);
    const rows = msg.contents.body.contents.filter((c: any) => c.type === 'box');
    expect(rows.map((r: any) => r.contents[1].text)).toEqual(['12.3%', '-', '-', '0']);
    expect(rows[0].margin).toBe('lg');
    expect(rows[1].margin).toBe('sm');
  });

  it('沒有績效資料時只剩標題與招回句', () => {
    const msg: any = buildPromoMessage('X', null, 2);
    expect(msg.contents.body.contents.filter((c: any) => c.type === 'box')).toHaveLength(0);
    expect(msg.contents.body.contents.at(-1).text).toBe('想跟上最新操作？立即重新訂閱！');
  });
});

describe('classifyLineTargets', () => {
  const bindings = [
    { user_id: 'u1', line_user_id: 'L1' },
    { user_id: 'u2', line_user_id: 'L2' },
    { user_id: 'u3', line_user_id: 'L3' },
  ];
  const planIds = new Set(['p1']);

  it('未取消 → 訂閱名單；已取消 → 招回名單；無訂閱 → 都不收', () => {
    const r = classifyLineTargets(
      bindings,
      [
        { user_id: 'u1', plan_id: 'p1', canceled_at: null },
        { user_id: 'u2', plan_id: 'p1', canceled_at: '2026-07-01T00:00:00Z' },
      ],
      planIds,
    );
    expect(r.subscribedTargets).toEqual(['L1']);
    expect(r.canceledTargets).toEqual(['L2']);
  });

  it('別的專家方案不算數', () => {
    const r = classifyLineTargets(bindings, [{ user_id: 'u1', plan_id: 'other', canceled_at: null }], planIds);
    expect(r.subscribedTargets).toEqual([]);
    expect(r.canceledTargets).toEqual([]);
  });

  it('expires_at 已過期一律剔除，null 視為無到期日', () => {
    const now = '2026-07-30T00:00:00Z';
    const r = classifyLineTargets(
      bindings,
      [
        { user_id: 'u1', plan_id: 'p1', canceled_at: null, expires_at: '2026-07-01T00:00:00Z' },
        { user_id: 'u2', plan_id: 'p1', canceled_at: null, expires_at: null },
        { user_id: 'u3', plan_id: 'p1', canceled_at: '2026-06-01T00:00:00Z', expires_at: '2026-06-15T00:00:00Z' },
      ],
      planIds,
      now,
    );
    expect(r.subscribedTargets).toEqual(['L2']);
    expect(r.canceledTargets).toEqual([]);
  });
});
