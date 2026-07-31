import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 通知連結守衛（防 404 回歸）。
 *
 * 契約：Edge Function 寫入 `notifications` 時，link 一律由
 * `supabase/functions/_shared/routes.ts` 的 builder 產生，
 * 不可硬寫字串路徑（歷史事故：`/admin/signals` 缺 :expertSlug → 404）。
 */
const FN_ROOT = join(process.cwd(), 'supabase/functions');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.includes('_test')) out.push(full);
  }
  return out;
}

const FILES = walk(FN_ROOT);

describe('notification link contract', () => {
  it('沒有任何 Edge Function 硬寫 notifications.link 字串', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.endsWith('_shared/routes.ts')) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        const m = line.match(/^\s*link:\s*(['"`])(.*?)\1\s*,?\s*$/);
        if (m) offenders.push(`${file.replace(FN_ROOT, '')}:${i + 1} → ${m[0].trim()}`);
      });
    }
    expect(offenders, `硬寫連結請改用 _shared/routes.ts builder：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('所有寫 notifications 的 function 都經過 buildNotificationRow', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const writesNotifications =
        /from\(['"]notifications['"]\)\s*\.\s*insert/.test(src) ||
        /rest\/v1\/notifications/.test(src);
      if (!writesNotifications) continue;
      if (!src.includes('buildNotificationRow')) {
        offenders.push(file.replace(FN_ROOT, ''));
      }
    }
    expect(offenders, `未使用 buildNotificationRow：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('_shared/routes.ts 匯出通知連結 builder 與驗證器', () => {
    const src = readFileSync(join(FN_ROOT, '_shared/routes.ts'), 'utf8');
    for (const name of [
      'accountNotificationsUrl',
      'accountUrl',
      'expertDetailUrl',
      'checkupUrl',
      'adminSignalsUrl',
      'adminCapitalUrl',
      'companyUrl',
      'validateNotificationLink',
      'assertNotificationLink',
      'buildNotificationRow',
    ]) {
      expect(src, `missing export: ${name}`).toContain(name);
    }
  });
});
