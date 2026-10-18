import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as null | { id: string }, rows: [] as any[], fail: false, inserts: 0 }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const q: any = { select: () => q, eq: () => q, limit: () => q,
    then: (resolve: any) => Promise.resolve({ data: state.rows, error: state.fail ? { message: 'offline' } : null }).then(resolve),
    insert: (row: any) => { state.inserts++; if (!state.fail) state.rows.push(row); return Promise.resolve({ error: state.fail ? { message: 'offline' } : null }); },
    update: () => ({ eq: () => ({ is: () => Promise.resolve({}) }) }),
  }; return q;
} } }));
import { useAttributionTracking } from '@/hooks/useAttributionTracking';
describe('anonymous first touch → authenticated persistence', () => {
  beforeEach(() => { state.user = null; state.rows = []; state.fail = false; state.inserts = 0; localStorage.clear(); history.replaceState({}, '', '/s/master-brcto?utm_campaign=brcto_journal&utm_content=ig'); });
  it('persists anonymous source after login with original 30-day expiry, not a legacy update', async () => {
    const hook = renderHook(useAttributionTracking);
    const first = JSON.parse(localStorage.getItem('lf_attr_v1') ?? '{}');
    expect(first.locked_until - Date.now()).toBeGreaterThan(29 * 86400000);
    expect(state.inserts).toBe(0);
    history.replaceState({}, '', '/auth/login'); state.user = { id: 'member' }; hook.rerender();
    await waitFor(() => expect(state.rows).toHaveLength(1));
    expect(state.rows[0]).toMatchObject({ user_id: 'member', utm_campaign: 'brcto_journal', utm_content: 'ig', visitor_id: first.visitor_id, locked_until: new Date(first.locked_until).toISOString() });
    hook.unmount(); renderHook(useAttributionTracking);
    await waitFor(() => expect(state.inserts).toBe(1));
  });
  it('does not replace locked first touch with a new campaign', async () => {
    state.user = { id: 'member' };
    localStorage.setItem('lf_attr_v1', JSON.stringify({ visitor_id: 'v', utm_campaign: 'original', locked_until: Date.now() + 86400000 }));
    renderHook(useAttributionTracking);
    await waitFor(() => expect(state.rows).toHaveLength(1));
    expect(state.rows[0].utm_campaign).toBe('original');
  });
  it('failed persistence can retry on remount', async () => {
    state.user = { id: 'member' }; state.fail = true;
    const hook = renderHook(useAttributionTracking);
    await new Promise(r => setTimeout(r, 20)); hook.unmount(); state.fail = false;
    renderHook(useAttributionTracking);
    await waitFor(() => expect(state.rows).toHaveLength(1));
  });
});