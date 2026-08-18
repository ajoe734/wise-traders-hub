import { describe, it, expect } from 'vitest';
import { SUPABASE_BASE_URL, functionUrl } from '@/lib/supabaseEndpoint';
import { buildOgCardUrl } from '@/lib/shareUrl';

describe('supabase endpoint contract', () => {
  it('resolves from VITE_SUPABASE_URL without trailing slash', () => {
    const env = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
    if (env) expect(SUPABASE_BASE_URL).toBe(env);
    expect(SUPABASE_BASE_URL.endsWith('/')).toBe(false);
  });

  it('functionUrl is always derived from the configured base', () => {
    expect(functionUrl('og-card')).toBe(`${SUPABASE_BASE_URL}/functions/v1/og-card`);
  });

  it('share og-card url never hardcodes a project ref', () => {
    const url = buildOgCardUrl({ kind: 'expert', slug: 'sharkgu' } as never);
    expect(url.startsWith(`${SUPABASE_BASE_URL}/functions/v1/og-card/expert/`)).toBe(true);
  });
});
