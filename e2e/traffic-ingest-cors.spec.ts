import { test, expect, request } from '@playwright/test';

// Verify the traffic-ingest CORS contract:
//   - preflight from an allowed origin echoes that origin (not `*`)
//   - Access-Control-Allow-Credentials: true is set
//   - Vary: Origin is set
//   - a POST from the same origin returns the same headers and status 200
//
// This locks in the fix for the sendBeacon regression: navigator.sendBeacon
// forces credentials, and browsers reject responses whose Allow-Origin is `*`.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yqacmrgdjlenbijclngi.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo';

const INGEST_URL = `${SUPABASE_URL}/functions/v1/traffic-ingest`;
const ALLOWED_ORIGIN = 'https://legendflow.tw';
const DISALLOWED_ORIGIN = 'https://evil.example.com';

test.describe('traffic-ingest CORS contract', () => {
  test('preflight from allowed origin echoes origin + credentials', async () => {
    const ctx = await request.newContext();
    const res = await ctx.fetch(INGEST_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(h['access-control-allow-credentials']).toBe('true');
    expect(h['vary']).toContain('Origin');
    await res.body();
  });

  test('POST from allowed origin returns credentials-friendly headers', async () => {
    const ctx = await request.newContext();
    const res = await ctx.fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
      },
      data: JSON.stringify({
        kind: 'event',
        visitor_id: `e2e-cors-${Date.now()}`,
        routes: ['/e2e/cors-check'],
      }),
    });
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(h['access-control-allow-credentials']).toBe('true');
    await res.body();
  });

  test('disallowed origin gets Allow-Origin: null', async () => {
    const ctx = await request.newContext();
    const res = await ctx.fetch(INGEST_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: DISALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    });
    const h = res.headers();
    expect(h['access-control-allow-origin']).toBe('null');
    await res.body();
  });
});
