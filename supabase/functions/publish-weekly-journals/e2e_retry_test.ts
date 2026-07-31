/**
 * e2e_retry_test.ts — 端到端整合測試：發布流程重試。
 *
 * 用一個「有狀態的假資料庫」把整條 runPublishPipeline 跑起來
 * （scope → mark published → sync → LINE push → 站內通知），
 * 驗證兩件事：
 *   1. 同一週記（同一組訊號）不論 runner 重跑幾次、或 90s abort 後補跑，
 *      每位訂閱者只會收到一次 LINE 週記與一次提前開放站內通知。
 *   2. 提前開放通知的教學連結是合法可打開的內部相對路徑（/app/expert/:slug）。
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { runPublishPipeline } from './pipeline.ts';
import type { PendingSignal, PublishPort } from './port.ts';
import { validateNotificationLink } from '../_shared/routes.ts';

// ── 假資料庫（跨多次 run 保留狀態，收據具唯一鍵語意）────────────────────
interface DbSignal extends PendingSignal { published_at: string | null }

interface Db {
  experts: Array<{ id: string; user_id: string; name: string; slug: string; asset_class: string }>;
  signals: DbSignal[];
  bindings: Array<{ line_user_id: string; user_id: string }>;
  subs: Array<{ user_id: string; plan_id: string; canceled_at: string | null; expires_at: string }>;
  planIds: string[];
  /** unique(dedupe_key, recipient) */
  receipts: Set<string>;
  notifications: Array<{ user_id: string; title: string; body: string; type: string; link: string }>;
  /** 每次 multicast 實際送達的 line_user_id（含重複，用來抓重送）*/
  delivered: string[];
  /** 模擬 90s abort：第 N 次 multicast 拋錯 */
  abortOnMulticast: number | null;
  multicastCalls: number;
}

const signal = (over: Partial<DbSignal> = {}): DbSignal => ({
  id: over.id ?? crypto.randomUUID(),
  expert_id: 'e1',
  instrument: '2330 台積電',
  action: 'buy',
  price_hint: 1000,
  quantity: 1000,
  quantity_unit: '股',
  reason_summary: '法說會後基本面轉強',
  reason_detail: '分三批建倉',
  risk_notes: '跌破月線停損',
  learning_points: '停損先寫下來再進場',
  teaching_topic: '如何在法說會後建立部位',
  overall_summary: '本週偏多操作',
  published_at: null,
  batch_id: 'b1',
  executed_at: null,
  ...over,
});

function makeDb(over: Partial<Db> = {}): Db {
  return {
    experts: [{ id: 'e1', user_id: 'mentor-1', name: '老周', slug: 'zhou', asset_class: 'tw_stock' }],
    signals: [signal({ id: 's1' }), signal({ id: 's2', instrument: '2454 聯發科', action: 'trim' })],
    bindings: [
      { line_user_id: 'L-a', user_id: 'u-a' },
      { line_user_id: 'L-b', user_id: 'u-b' },
    ],
    subs: [
      { user_id: 'u-a', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01' },
      { user_id: 'u-b', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01' },
    ],
    planIds: ['p1'],
    receipts: new Set<string>(),
    notifications: [],
    delivered: [],
    abortOnMulticast: null,
    multicastCalls: 0,
    ...over,
  };
}

function portOf(db: Db): PublishPort {
  return {
    listExperts: () => Promise.resolve(db.experts as any),
    listExpertsByIds: (ids) => Promise.resolve(db.experts.filter((e) => ids.includes(e.id)) as any),
    getExpert: (id) => Promise.resolve((db.experts.find((e) => e.id === id) ?? null) as any),
    // 真實語意：只撈尚未發布的訊號
    listPendingSignals: (ids) =>
      Promise.resolve(
        db.signals.filter((s) => s.published_at === null && (!ids || ids.includes(s.expert_id))),
      ),
    markSignalPublished: (id) => {
      const row = db.signals.find((s) => s.id === id);
      if (!row) return Promise.reject(new Error('not found'));
      row.published_at = '2026-07-31T12:00:00Z';
      return Promise.resolve();
    },
    logUnitLockViolation: () => Promise.resolve(),
    insertNotifications: (rows) => { db.notifications.push(...(rows as any)); return Promise.resolve(); },
    closeOpenTradeSignal: () => Promise.resolve(),
    deleteUserPerformance: () => Promise.resolve(),
    hasOpenTradeRecords: () => Promise.resolve(true),
    hasOpenTradeSignal: () => Promise.resolve(true),
    openTradeSignalWithPerformance: () => Promise.resolve(),
    getLineChannel: () => Promise.resolve({ channel_access_token: 'tok', is_active: true }),
    listActiveBindings: () => Promise.resolve(db.bindings),
    listActiveSubscriptions: (userIds) =>
      Promise.resolve(db.subs.filter((s) => userIds.includes(s.user_id))),
    listExpertPlanIds: () => Promise.resolve(db.planIds),
    calcExpertPerformance: () => Promise.resolve({ win_rate: 66, avg_return: 8 }),
    sendLineMulticast: (_token, to) => {
      db.multicastCalls++;
      if (db.abortOnMulticast === db.multicastCalls) {
        return Promise.reject(new DOMException('The signal has been aborted', 'AbortError'));
      }
      db.delivered.push(...to);
      return Promise.resolve({ ok: true, status: 200 });
    },
    claimPushRecipients: ({ dedupeKey, recipients }) => {
      const claimed: string[] = [];
      for (const r of recipients) {
        const key = `${dedupeKey}|${r}`;
        if (db.receipts.has(key)) continue; // unique 衝突 → 已送過
        db.receipts.add(key);
        claimed.push(r);
      }
      return Promise.resolve(claimed);
    },
    releasePushClaims: (dedupeKey, recipients) => {
      for (const r of recipients) db.receipts.delete(`${dedupeKey}|${r}`);
      return Promise.resolve();
    },
    now: () => new Date('2026-07-31T12:00:00Z'),
  };
}

/** 模擬 runner 重跑同一週記（外部把 published_at 清掉／或 mark 階段重試）。 */
function replayPendingWindow(db: Db) {
  for (const s of db.signals) s.published_at = null;
}

const countOf = (arr: string[], v: string) => arr.filter((x) => x === v).length;

// ── 1. 單純重跑：不會重送 ────────────────────────────────────────────────
Deno.test('e2e 重試：同一週記重跑三次，每位訂閱者只收到一次 LINE 推播', async () => {
  const db = makeDb();
  const port = portOf(db);

  const r1 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r1.published, 2);
  assertEquals(r1.pushed, 2);
  assertEquals(db.delivered.sort(), ['L-a', 'L-b']);

  // runner 重跑（訊號已發布 → 無 pending）
  const r2 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r2.published, 0);
  assertEquals(r2.pushed, 0);

  // 更兇的重跑：連 published_at 都被重放，仍靠收據擋下
  replayPendingWindow(db);
  const r3 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r3.published, 2);
  assertEquals(r3.pushed, 0, '收據已存在，不可重送');

  assertEquals(countOf(db.delivered, 'L-a'), 1);
  assertEquals(countOf(db.delivered, 'L-b'), 1);
});

// ── 2. 90s abort 後補跑：剛好一次 ────────────────────────────────────────
Deno.test('e2e 重試：推播中途 abort → 釋放收據，補跑補送一次且僅一次', async () => {
  const db = makeDb({ abortOnMulticast: 1 });
  const port = portOf(db);

  const r1 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r1.published, 2);
  assertEquals(r1.pushed, 0);
  assertEquals(r1.pushFail, 1, 'abort 應計入 push 失敗');
  assertEquals(db.delivered.length, 0);
  assertEquals(db.receipts.size, 0, 'abort 後收據必須釋放，否則訂閱者永遠收不到');

  // 補跑
  db.abortOnMulticast = null;
  replayPendingWindow(db);
  const r2 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r2.pushed, 2);
  assertEquals(db.delivered.sort(), ['L-a', 'L-b']);

  // 再補跑一次 → 不得重送
  replayPendingWindow(db);
  const r3 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r3.pushed, 0);
  assertEquals(countOf(db.delivered, 'L-a'), 1);
  assertEquals(countOf(db.delivered, 'L-b'), 1);
});

// ── 3. 提前開放：站內通知也冪等，且教學連結可打開 ────────────────────────
Deno.test('e2e 重試：提前開放通知只發一次，教學連結為合法內部路徑', async () => {
  const db = makeDb();
  const port = portOf(db);

  await runPublishPipeline(port, { filterExpertIds: null, force: true });
  replayPendingWindow(db);
  await runPublishPipeline(port, { filterExpertIds: null, force: true });
  replayPendingWindow(db);
  await runPublishPipeline(port, { filterExpertIds: null, force: true });

  assertEquals(db.notifications.length, 2, '兩位訂閱者各一封，重跑不得重發');
  assertEquals(db.notifications.map((n) => n.user_id).sort(), ['u-a', 'u-b']);

  for (const n of db.notifications) {
    assertEquals(validateNotificationLink(n.link), null, `連結不合法：${n.link}`);
    assertEquals(n.link, '/app/expert/zhou');
    assert(n.title.includes('老周'));
  }

  // LINE 週記內容含教學主題與教學重點（教學連結指向的內容來源）
  assertEquals(countOf(db.delivered, 'L-a'), 1);
});

// ── 4. 訊號集合改變才會重推 ──────────────────────────────────────────────
Deno.test('e2e 重試：新增一筆訊號後屬於新週記內容，允許再推一次', async () => {
  const db = makeDb();
  const port = portOf(db);

  await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(db.delivered.length, 2);

  db.signals.push(signal({ id: 's3', instrument: '2317 鴻海', action: 'exit' }));
  replayPendingWindow(db);
  const r2 = await runPublishPipeline(port, { filterExpertIds: null, force: false });
  assertEquals(r2.pushed, 2, '訊號集合改變 → 新 dedupe key');
  assertEquals(countOf(db.delivered, 'L-a'), 2);
});

// ── 5. 缺 slug 時退回通知中心（仍不可 404）─────────────────────────────
Deno.test('e2e 重試：導師無 slug 時提前開放通知退回 /account/notifications', async () => {
  const db = makeDb({
    experts: [{ id: 'e1', user_id: 'mentor-1', name: '老周', slug: '', asset_class: 'tw_stock' }],
  });
  await runPublishPipeline(portOf(db), { filterExpertIds: null, force: true });
  assert(db.notifications.length > 0);
  for (const n of db.notifications) {
    assertEquals(n.link, '/account/notifications');
    assertEquals(validateNotificationLink(n.link), null);
  }
});
