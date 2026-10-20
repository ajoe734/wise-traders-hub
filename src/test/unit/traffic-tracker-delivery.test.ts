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
    mod.initTrafficTracker();
    vi.advanceTimersByTime(0);
    expect(beacons.some(b => Array.isArray(b.routes) && b.routes.length === 1)).toBe(true);
  });

  it('carries the signed-in access token in the body (sendBeacon cannot send headers)', async () => {
    localStorage.setItem(`sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`, JSON.stringify({ access_token: 'tok123' }));
    const mod = await import('@/lib/trafficTracker');
    mod.initTrafficTracker();
    vi.advanceTimersByTime(0);
    expect(beacons.every(b => b.access_token === 'tok123')).toBe(true);
  });
});
