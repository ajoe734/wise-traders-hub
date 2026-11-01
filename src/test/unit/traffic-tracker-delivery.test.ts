import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('trafficTracker delivery', () => {
  let beacons: Array<Record<string, any>>;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    beacons = [];
    vi.stubGlobal('navigator', { sendBeacon: (_u: string, b: any) => { beacons.push(JSON.parse(b.__text)); return true; } });
    vi.stubGlobal('Blob', class { __text: string; constructor(p: string[]) { this.__text = p.join(''); } } as any);
    localStorage.clear();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('sends the landing page view immediately (in-app browsers close before 2s)', async () => {
    const mod = await import('@/lib/trafficTracker');
    mod.trackEvent('page_view', { path: '/' }); // 未先 init 也必須送出
    expect(beacons.some(b => b.events?.[0]?.name === 'page_view')).toBe(true);
  });

  it('carries the signed-in access token in the body (sendBeacon cannot send headers)', async () => {
    localStorage.setItem(`sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`, JSON.stringify({ access_token: 'tok123' }));
    const mod = await import('@/lib/trafficTracker');
    mod.trackEvent('page_view', { path: '/' });
    expect(beacons.length).toBeGreaterThan(0);
    expect(beacons.every(b => b.access_token === 'tok123')).toBe(true);
  });

  // 短連結 /s/:slug 落地的走訪列：utm_campaign 空時補短連結代號（同一條純規則）。
  describe('短連結走訪列 utm_campaign 補值', () => {
    async function visit(hrefPath: string) {
      window.history.replaceState(null, '', hrefPath);
      const mod = await import('@/lib/trafficTracker');
      mod.initTrafficTracker();
      return beacons.find((b) => b.kind === 'visit');
    }

    it('情況2 有 utm、campaign 空 → 補短連結代號', async () => {
      expect(await visit('/s/sharkgu?utm_source=ig&utm_medium=social')).toMatchObject({
        kind: 'visit', utm_source: 'ig', utm_medium: 'social', utm_campaign: 'sharkgu',
      });
    });

    it('情況3 已填 campaign 維持原值', async () => {
      expect(await visit('/s/master-brcto?utm_campaign=brcto_journal&utm_content=ig')).toMatchObject({
        utm_campaign: 'brcto_journal', utm_content: 'ig',
      });
    });

    it('情況1 完全沒有 utm 時不補（維持 direct）', async () => {
      expect(await visit('/s/sharkgu')).toMatchObject({ utm_source: null, utm_campaign: null });
    });

    it('情況4 其他 utm 原樣保留，不新增不改寫', async () => {
      expect(await visit('/s/sharkgu?utm_source=ig&utm_medium=mia_ig&utm_content=link_in_bio')).toMatchObject({
        utm_source: 'ig', utm_medium: 'mia_ig', utm_content: 'link_in_bio', utm_campaign: 'sharkgu',
      });
    });

    it('非短連結路徑不補', async () => {
      expect(await visit('/expert/sharkgu?utm_source=ig')).toMatchObject({ utm_source: 'ig', utm_campaign: null });
    });
  });
});
