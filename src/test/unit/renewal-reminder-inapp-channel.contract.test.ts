/**
 * 合約測試：會員到期提醒必須有「站內通知」這條不依賴外部服務的通道。
 *
 * 事故背景：到期提醒只有 Email 與 LINE 兩條路。寄信服務金鑰失效（401）後，
 * 所有會員的到期提醒等於完全沒送出去，只有 renewal_email_failed 的失敗紀錄，
 * 會員本人在站內一則通知都收不到。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// 直接沿用 Deno 端的單一資料源（純函式、無 Deno API 依賴）
import { validateNotificationLink } from '../../../supabase/functions/_shared/routes.ts';

const SRC = readFileSync('supabase/functions/email-push-renewal-reminder/index.ts', 'utf8');

describe('email-push-renewal-reminder 站內通知通道', () => {
  it('會寫入 notifications，且 row 由 buildNotificationRow 產生', () => {
    expect(SRC).toContain('buildNotificationRow');
    expect(SRC).toMatch(/from\('notifications'\)\s*\.insert\(row\)/);
  });

  it('站內通知連結不得帶 baseUrl（notifications.link 必須是站內相對路徑）', () => {
    const at = SRC.indexOf("utm_source: 'inapp'");
    expect(at).toBeGreaterThan(-1);
    const call = SRC.slice(SRC.lastIndexOf('renewalUrl(', at), at);
    expect(call).not.toContain('baseUrl');
    // 對照組：Email 那條才允許帶 baseUrl（絕對網址）
    const emailAt = SRC.indexOf("utm_source: 'email'");
    expect(SRC.slice(SRC.lastIndexOf('renewalUrl(', emailAt), emailAt)).toContain('baseUrl');
  });

  it('續訂連結格式通過 notifications.link 驗證', () => {
    expect(validateNotificationLink('/checkout/sharkgu/ab1d8e55?cycle=monthly&utm_source=inapp')).toBeNull();
  });

  it('寄信失敗不得讓整支排程中斷（站內通知仍要送）', () => {
    expect(SRC).not.toMatch(/\}\),\s*\{\s*status:\s*500/);
    expect(SRC).toContain("channels.email = 'failed'");
  });


  it('兩條通道各自獨立 idempotency 與失敗留痕', () => {
    expect(SRC).toContain("subscription.renewal_inapp_sent");
    expect(SRC).toContain("subscription.renewal_inapp_failed");
    expect(SRC).toContain("subscription.renewal_email_sent");
    expect(SRC).toContain("subscription.renewal_email_failed");
  });

  it('沒有 email（LINE 虛擬信箱）不得整筆 continue，站內通知照送', () => {
    expect(SRC).toContain("channels.email = 'skipped_no_email'");
    expect(SRC).not.toMatch(/status: 'skipped_no_email' \}\);\s*continue;/);
  });

  it('關閉 Email 偏好只關 Email，不關站內通知', () => {
    expect(SRC).toContain("channels.email = 'skipped_pref'");
    expect(SRC).toContain('const emailOptOut');
  });
});
