/**
 * Group 1.20 — 公告生命週期
 *
 * 測試範圍：
 *
 *   A. drift-detection：notify_subscribers_on_announcement trigger
 *      公告發布時自動為所有用戶建立通知（4.7-1）。
 *        INSERT 且 status='published' → 觸發通知建立
 *        UPDATE 且 status 從非 published 改為 published → 觸發通知建立
 *        INSERT INTO notifications，包含 profiles + experts + member_subscriptions 的 UNION 收件人
 *        通知 type='info'、title='📢 系統公告'
 *
 *   B. drift-detection：cleanup_old_announcements RPC
 *      以 created_at < NOW() - INTERVAL '7 days' 為門檻刪除舊記錄（4.7-2/4.7-3）。
 *        滿 7 天 → 刪除對應 notifications（type='info' AND title='📢 系統公告'）
 *        滿 7 天 → 刪除 announcements
 *        未滿 7 天 → 不被 INTERVAL '7 days' 條件命中，不刪除
 *
 *   C. drift-detection：cleanup-announcements-cron Edge Function
 *      排程直接委派給 cleanup_old_announcements RPC，本身無業務邏輯（4.7-2/4.7-3）。
 *        呼叫 cleanup_old_announcements RPC
 *        成功時回傳 { success: true, executed_at }
 *        RPC 錯誤時回傳 status 500 + error message
 *
 * 對應測試路徑：
 *   4.7-1：公告發布 trigger → 為所有活躍使用者建立通知
 *   4.7-2：公告發布滿 7 天 → 刪除公告 + 對應通知
 *   4.7-3：公告發布未滿 7 天 → 不刪除（INTERVAL '7 days' 條件未命中）
 *
 * 注意：notify_subscribers_on_announcement 的「所有活躍使用者」
 *       實際上是 profiles UNION experts UNION member_subscriptions，
 *       不是依 is_active / status 做過濾的嚴格活躍判斷。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── drift-detection: notify_subscribers_on_announcement trigger（4.7-1）──────

describe('drift-detection: notify_subscribers_on_announcement trigger 公告通知建立', () => {
  let triggerSrc: string;

  beforeAll(() => {
    triggerSrc = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260411140502_985da410-854a-4da4-954d-9ad37e5199b8.sql',
      ),
      'utf-8',
    );
  });

  it("公告 INSERT 且 status='published' → trigger 觸發條件存在（4.7-1）", () => {
    expect(triggerSrc).toContain("TG_OP = 'INSERT'");
    expect(triggerSrc).toContain("NEW.status = 'published'");
  });

  it("公告 UPDATE 且 status 從非 published 改為 published → trigger 觸發條件存在，含 COALESCE 防重複觸發守護（4.7-1）", () => {
    expect(triggerSrc).toContain("TG_OP = 'UPDATE'");
    expect(triggerSrc).toContain("NEW.status = 'published'");
    // 防止「已發布 → 仍發布」的 UPDATE 重複發送通知：
    // COALESCE(OLD.status::text, '') <> 'published' 守護此條件
    expect(triggerSrc).toContain("COALESCE(OLD.status::text, '') <> 'published'");
  });

  it('trigger 向 notifications 資料表 INSERT 通知記錄（4.7-1）', () => {
    expect(triggerSrc).toContain('INSERT INTO public.notifications');
    expect(triggerSrc).toContain('NEW.title');
  });

  it('收件人為 profiles UNION experts UNION member_subscriptions 三方合集（4.7-1）', () => {
    expect(triggerSrc).toContain('public.profiles');
    expect(triggerSrc).toContain('public.experts');
    expect(triggerSrc).toContain('public.member_subscriptions');
    expect(triggerSrc).toContain('UNION');
  });

  it("通知 type='info'、title='📢 系統公告'、body=公告標題（4.7-1）", () => {
    expect(triggerSrc).toContain("'info'");
    expect(triggerSrc).toContain("'📢 系統公告'");
  });
});

// ── drift-detection: cleanup_old_announcements RPC（4.7-2/4.7-3）────────────

describe('drift-detection: cleanup_old_announcements RPC 舊公告清理', () => {
  let rpcSrc: string;

  beforeAll(() => {
    rpcSrc = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260411141422_0d10b2bd-b610-4598-91b2-38f6d7382e66.sql',
      ),
      'utf-8',
    );
  });

  it("以 created_at < NOW() - INTERVAL '7 days' 嚴格大於門檻刪除逾齡 notifications（4.7-2/4.7-3）", () => {
    expect(rpcSrc).toContain('DELETE FROM public.notifications');
    // 確認比較運算子為 <（嚴格超過 7 天才刪，未滿 7 天不命中）
    expect(rpcSrc).toContain("created_at < NOW() - INTERVAL '7 days'");
  });

  it("以 created_at < NOW() - INTERVAL '7 days' 嚴格大於門檻刪除逾齡 announcements（4.7-2/4.7-3）", () => {
    expect(rpcSrc).toContain('DELETE FROM public.announcements');
    expect(rpcSrc).toContain("created_at < NOW() - INTERVAL '7 days'");
  });

  it("notifications 刪除條件含 type='info' 與 title='📢 系統公告'，避免誤刪其他通知（4.7-2）", () => {
    expect(rpcSrc).toContain("type = 'info'");
    expect(rpcSrc).toContain("title = '📢 系統公告'");
  });
});

// ── drift-detection: cleanup-announcements-cron Edge Function（4.7-2/4.7-3）─

describe('drift-detection: cleanup-announcements-cron 排程 Deno Function', () => {
  let cronSrc: string;

  beforeAll(() => {
    cronSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/cleanup-announcements-cron/index.ts'),
      'utf-8',
    );
  });

  it('排程 function 委派給 cleanup_old_announcements RPC（4.7-2/4.7-3）', () => {
    expect(cronSrc).toContain('cleanup_old_announcements');
    expect(cronSrc).toContain('.rpc(');
  });

  it('執行成功時回傳 { success: true, executed_at }（4.7-2）', () => {
    expect(cronSrc).toContain('success: true');
    expect(cronSrc).toContain('executed_at');
  });

  it('RPC 回傳 error 時以 status 500 回應（4.7-2 error path）', () => {
    expect(cronSrc).toContain('status: 500');
    expect(cronSrc).toContain('error.message');
  });
});

// ── drift-detection: Announcements.tsx / AppHome.tsx 公告讀寫路徑 ──────────

describe('drift-detection: Announcements.tsx / AppHome.tsx 公告讀寫路徑', () => {
  let announceSrc: string;
  let appHomeSrc: string;

  beforeAll(() => {
    announceSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/company/Announcements.tsx'),
      'utf-8',
    );
    appHomeSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/app/AppHome.tsx'),
      'utf-8',
    );
  });

  it("Announcements.tsx togglePublish 更新 status 欄位並同步寫入 published_at（4.7-1 觸發路徑）", () => {
    // togglePublish 將 status 更新為 'published'，同時設定 published_at = now()
    // 這是 notify_subscribers_on_announcement trigger 的實際觸發來源
    expect(announceSrc).toContain('status: newStatus');
    expect(announceSrc).toContain('published_at');
  });

  it("AppHome.tsx 讀取公告時以 status='published' 過濾並以 published_at 排序（4.7-1 可見路徑）", () => {
    expect(appHomeSrc).toContain("'status', 'published'");
    expect(appHomeSrc).toContain('published_at');
  });
});
