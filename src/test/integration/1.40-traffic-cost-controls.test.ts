/**
 * 成本收斂回歸（2026-08-30 Cloud cost incident）
 *
 * 紅線：
 *  1. trafficTracker 具名事件必須合併成「單一 POST」，且批次內去重。
 *  2. traffic-ingest 必須支援 body.events[] 批次寫入。
 *  3. chips per-stock debug 遙測預設關閉。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const INGEST_SRC = readFileSync('supabase/functions/traffic-ingest/index.ts', 'utf8');
const CHIPS_SRC = readFileSync('src/checkup/lib/chipsRepository.ts', 'utf8');

describe('traffic-ingest 批次事件契約', () => {
  it('接受 body.events[] 並上限 50 筆', () => {
    expect(INGEST_SRC).toContain('Array.isArray(body.events)');
    expect(INGEST_SRC).toMatch(/body\.events as any\[\]\)\.slice\(0, 50\)/);
  });

  it('批次列仍帶 event_name / is_internal / visitor_id', () => {
    const seg = INGEST_SRC.slice(INGEST_SRC.indexOf('const batched'), INGEST_SRC.indexOf('} else if (event_name)'));
    expect(seg).toContain('event_name: nm');
    expect(seg).toContain('is_internal: isInternalRoute(nr)');
    expect(seg).toContain('visitor_id');
  });
});

describe('chips per-stock 遙測預設關閉', () => {
  it('chips_fetch_start / done 都被 debug 旗標包住，error 不受影響', () => {
    expect(CHIPS_SRC).toContain("localStorage.getItem('lf_chips_debug') === '1'");
    const startIdx = CHIPS_SRC.indexOf("trackEvent('chips_fetch_start'");
    const guardIdx = CHIPS_SRC.lastIndexOf('if (debugTelemetry) {', startIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    const doneIdx = CHIPS_SRC.indexOf("trackEvent('chips_fetch_done'");
    expect(CHIPS_SRC.lastIndexOf('if (debugTelemetry) {', doneIdx)).toBeGreaterThan(-1);
    // 錯誤事件不得被旗標擋掉
    const errIdx = CHIPS_SRC.indexOf("trackEvent('chips_fetch_error'");
    const between = CHIPS_SRC.slice(CHIPS_SRC.lastIndexOf('catch (err)', errIdx), errIdx);
    expect(between).not.toContain('if (debugTelemetry)');
  });
});

describe('trafficTracker 具名事件合併與去重', () => {
  let beacons: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    beacons = [];
    vi.stubGlobal('navigator', {
      sendBeacon: (_url: string, blob: Blob) => {
        // Blob 在 node 環境沒有同步讀取；改用建構時保存的內容
        beacons.push(JSON.parse((blob as any).__text));
        return true;
      },
    });
    vi.stubGlobal('Blob', class {
      __text: string;
      constructor(parts: string[]) { this.__text = parts.join(''); }
    } as unknown as typeof Blob);
    vi.stubGlobal('crypto', { randomUUID: () => 'vid-test' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('30 檔重複事件只送出 1 個 POST，且重複的被去重', async () => {
    const mod = await import('@/lib/trafficTracker');
    mod.initTrafficTracker();
    beacons.length = 0;

    for (let i = 0; i < 30; i++) mod.trackEvent('chips_probe', { stock: String(2300 + i) });
    // 完全相同的三筆 → 只留一筆
    mod.trackEvent('dup_event', { a: 1 });
    mod.trackEvent('dup_event', { a: 1 });
    mod.trackEvent('dup_event', { a: 1 });

    vi.advanceTimersByTime(1000);

    const namedPosts = beacons.filter((b) => Array.isArray((b as any).events));
    expect(namedPosts).toHaveLength(1);
    const events = (namedPosts[0] as any).events as Array<{ name: string }>;
    expect(events.filter((e) => e.name === 'dup_event')).toHaveLength(1);
    expect(events.filter((e) => e.name === 'chips_probe')).toHaveLength(30);
  });
});
