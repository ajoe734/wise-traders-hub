/**
 * A1 — 週界線（Asia/Taipei）單一資料源回歸測試。
 *
 * 守門三件事：
 *  1. `src/lib/taipeiWeek.ts` 的行為正確（分界、跨月、跨年、半開區間）。
 *  2. 與 Deno 端 `supabase/functions/_shared/weekBoundary.ts` 逐字 parity。
 *  3. 靜態守衛：前台不得再用 `startOfWeek(..., { weekStartsOn: 1 })`
 *     這種「瀏覽器本地時區週一」的算法，也不得自行手刻 +8 小時位移。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  taipeiMondayOf,
  taipeiWeekRangeUtc,
  isInTaipeiWeek,
  taipeiWeekDayIso,
  taipeiWeekFridayIso,
  taipeiWeekSundayIso,
  taipeiWeekRangeLabelMD,
  taipeiIsoToDisplayDate,
  formatIsoMD,
  formatIsoYMD,
} from '@/lib/taipeiWeek';
import {
  taipeiMondayOf as denoMondayOf,
  taipeiWeekRangeUtc as denoRangeUtc,
  isInTaipeiWeek as denoInWeek,
} from '../../../supabase/functions/_shared/weekBoundary';

const UTC = (iso: string) => new Date(iso + 'Z');
const ROOT = path.resolve(__dirname, '../../..');

describe('taipeiMondayOf', () => {
  it('Taipei 週一 00:00（= UTC 前一日 16:00）→ 該週一', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T16:00:00'))).toBe('2026-06-08');
  });
  it('Taipei 週一 00:00 前一秒 → 前一週', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T15:59:59'))).toBe('2026-06-01');
  });
  it('週一凌晨 06:00 Taipei（UTC 週日 22:00）→ 本週一，不會被 UTC 拉回上一週', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T22:00:00'))).toBe('2026-06-08');
  });
  it('跨月：Taipei 2026-07-01 → 2026-06-29', () => {
    expect(taipeiMondayOf(UTC('2026-07-01T02:00:00'))).toBe('2026-06-29');
  });
  it('跨年：Taipei 2026-01-01 00:30 → 2025-12-29', () => {
    expect(taipeiMondayOf(UTC('2025-12-31T16:30:00'))).toBe('2025-12-29');
  });
  it('接受 ISO 字串與 epoch 毫秒', () => {
    expect(taipeiMondayOf('2026-06-10T05:00:00Z')).toBe('2026-06-08');
    expect(taipeiMondayOf(UTC('2026-06-10T05:00:00').getTime())).toBe('2026-06-08');
  });
  it('無效輸入 → throw', () => {
    expect(() => taipeiMondayOf('not-a-date')).toThrow();
  });
});

describe('taipeiWeekRangeUtc / isInTaipeiWeek', () => {
  it('週一 00:00+08 → UTC 前一日 16:00，end = +7d', () => {
    const { startIso, endIso } = taipeiWeekRangeUtc('2026-06-08');
    expect(startIso).toBe('2026-06-07T16:00:00.000Z');
    expect(endIso).toBe('2026-06-14T16:00:00.000Z');
  });
  it('半開區間：起點含、終點不含', () => {
    expect(isInTaipeiWeek(UTC('2026-06-07T16:00:00'), '2026-06-08')).toBe(true);
    expect(isInTaipeiWeek(UTC('2026-06-14T15:59:59'), '2026-06-08')).toBe(true);
    expect(isInTaipeiWeek(UTC('2026-06-14T16:00:00'), '2026-06-08')).toBe(false);
  });
  it('格式錯誤 → throw', () => {
    expect(() => taipeiWeekRangeUtc('2026/06/08')).toThrow();
    expect(() => taipeiWeekRangeUtc('')).toThrow();
  });
});

describe('週內日期與顯示標籤（純字串，不受瀏覽器時區影響）', () => {
  it('週五 / 週日 / 任意 offset', () => {
    expect(taipeiWeekFridayIso('2026-06-08')).toBe('2026-06-12');
    expect(taipeiWeekSundayIso('2026-06-08')).toBe('2026-06-14');
    expect(taipeiWeekDayIso('2026-06-29', 4)).toBe('2026-07-03'); // 跨月
    expect(taipeiWeekDayIso('2025-12-29', 6)).toBe('2026-01-04'); // 跨年
  });
  it('區間標籤 MM/DD ~ MM/DD', () => {
    expect(taipeiWeekRangeLabelMD('2026-06-08')).toBe('06/08 ~ 06/12');
    expect(taipeiWeekRangeLabelMD('2025-12-29')).toBe('12/29 ~ 01/02');
  });
  it('formatIsoMD / formatIsoYMD', () => {
    expect(formatIsoMD('2026-06-08')).toBe('06/08');
    expect(formatIsoYMD('2026-06-08')).toBe('2026/06/08');
    expect(formatIsoMD('bad')).toBe('');
  });
  it('taipeiIsoToDisplayDate 的本地欄位等於該曆日', () => {
    const d = taipeiIsoToDisplayDate('2026-06-08');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 8]);
  });
});

describe('parity — 前台實作 vs Deno _shared/weekBoundary', () => {
  const samples = [
    '2026-06-07T15:59:59', '2026-06-07T16:00:00', '2026-06-07T22:00:00',
    '2026-06-08T23:59:00', '2026-07-01T02:00:00', '2025-12-31T16:30:00',
    '2027-01-01T01:00:00', '2026-05-31T16:00:00', '2026-06-14T15:59:59',
  ];
  it('taipeiMondayOf 對所有樣本一致', () => {
    for (const s of samples) {
      expect(taipeiMondayOf(UTC(s))).toBe(denoMondayOf(UTC(s)));
    }
  });
  it('taipeiWeekRangeUtc 與 isInTaipeiWeek 一致', () => {
    for (const s of samples) {
      const wk = denoMondayOf(UTC(s));
      expect(taipeiWeekRangeUtc(wk)).toEqual(denoRangeUtc(wk));
      expect(isInTaipeiWeek(UTC(s), wk)).toBe(denoInWeek(UTC(s), wk));
    }
  });
});

describe('靜態守衛 — 不得再有第二套週界線實作', () => {
  const rg = (pattern: string, dirs: string[]) => {
    try {
      return execFileSync('rg', ['-n', pattern, ...dirs], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean);
    } catch {
      return []; // rg exit 1 = no match
    }
  };

  it('src/ 內不得使用 date-fns startOfWeek', () => {
    const hits = rg('startOfWeek', ['src']).filter(l => !l.startsWith('src/test/'));
    expect(hits, `發現本地時區週一算法：\n${hits.join('\n')}`).toEqual([]);
  });

  it('src/ 內不得自行手刻台北位移來算週界線', () => {
    const hits = rg('TZ_OFFSET_MS|TAIPEI_OFFSET_MS', ['src'])
      .filter(l => !l.startsWith('src/lib/taipeiWeek.ts') && !l.startsWith('src/test/'));
    expect(hits, `發現重複的台北位移常數：\n${hits.join('\n')}`).toEqual([]);
  });

  it('週記相關頁面皆從 @/lib/taipeiWeek 取得週界線', () => {
    const files = [
      'src/pages/app/Journals.tsx',
      'src/pages/app/JournalDetail.tsx',
      'src/components/JournalCard.tsx',
      'src/pages/company/JournalsExport.tsx',
      'src/pages/_signalEditor/JournalPreviewDialog.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, `${f} 未使用共用週界線模組`).toContain("@/lib/taipeiWeek");
    }
  });
});
