import { beforeEach, describe, expect, it, vi } from 'vitest';

const guards = vi.hoisted(() => ({
  requireCompanyAdmin: vi.fn(),
  requireExpertOwnerOrAdmin: vi.fn(),
}));
vi.mock('../../../supabase/functions/_shared/adminGuard.ts', () => ({
  ...guards,
  authErrorResponse: (error: { status?: number; message?: string }) =>
    new Response(JSON.stringify({ message: error.message }), { status: error.status ?? 500 }),
}));
vi.mock('../../../supabase/functions/_shared/edgeLogger.ts', () => ({
  withLogging: (_name: string, handler: unknown) => handler,
}));
const serve = vi.fn();
vi.stubGlobal('Deno', { serve });

// Exercise the real HTTP dispatch, not a duplicated authorization rule.
await import('../../../supabase/functions/authorize-pdf-export/index.ts');
const handler = serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
const expertId = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown = {}, token = 'verified-owner') => new Request('http://localhost/export', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  guards.requireCompanyAdmin.mockRejectedValue({ status: 403, message: '僅公司管理員' });
  guards.requireExpertOwnerOrAdmin.mockResolvedValue({ userId: 'owner', isOwner: true, isAdmin: false });
});

describe('PDF export HTTP authorization boundaries', () => {
  it('allows the expert owner to export their own factsheet, not via company-admin-only guard', async () => {
    const response = await handler(request({ export_type: 'factsheet', expert_id: expertId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allowed: true, user_id: 'owner' });
    expect(guards.requireExpertOwnerOrAdmin).toHaveBeenCalledWith(expect.any(Request), expertId);
    expect(guards.requireCompanyAdmin).not.toHaveBeenCalled();
  });
  it('allows a company admin through the same scoped factsheet guard', async () => {
    guards.requireExpertOwnerOrAdmin.mockResolvedValue({ userId: 'admin', isOwner: false, isAdmin: true });
    const response = await handler(request({ export_type: 'factsheet', expert_id: expertId }));
    expect(await response.json()).toMatchObject({ allowed: true, user_id: 'admin' });
  });
  it('rejects another expert and ignores caller-supplied owner IDs', async () => {
    guards.requireExpertOwnerOrAdmin.mockRejectedValue({ status: 403, message: '非本人' });
    const response = await handler(request({ export_type: 'factsheet', expert_id: expertId, user_id: 'owner' }, 'other'));
    expect(response.status).toBe(403);
    expect(guards.requireExpertOwnerOrAdmin.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer other');
  });
  it.each([401, 500])('preserves auth/lookup rejection HTTP %s without granting export', async (status) => {
    guards.requireExpertOwnerOrAdmin.mockRejectedValue({ status, message: 'denied' });
    const response = await handler(request({ export_type: 'factsheet', expert_id: expertId }));
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty('allowed', true);
  });
  it.each([{}, { export_type: 'journal' }])('retains company-admin-only authorization for journal/legacy calls %j', async (body) => {
    expect((await handler(request(body))).status).toBe(403);
    expect(guards.requireCompanyAdmin).toHaveBeenCalled();
    expect(guards.requireExpertOwnerOrAdmin).not.toHaveBeenCalled();
  });
  it('still permits legacy journal export for company admins', async () => {
    guards.requireCompanyAdmin.mockResolvedValue('admin');
    expect((await handler(request())).status).toBe(200);
  });
  it.each([{ export_type: 'factsheet' }, { export_type: 'factsheet', expert_id: 'bad' }, { export_type: 'other' }])('rejects invalid scope %j', async (body) => {
    expect((await handler(request(body))).status).toBe(400);
    expect(guards.requireExpertOwnerOrAdmin).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    expect((await handler(new Request('http://localhost/export', { method: 'POST', body: '{' }))).status).toBe(400);
  });
  it('handles preflight and rejects non-POST without invoking guards', async () => {
    expect((await handler(new Request('http://localhost/export', { method: 'OPTIONS' }))).status).toBe(200);
    expect((await handler(new Request('http://localhost/export'))).status).toBe(405);
    expect(guards.requireCompanyAdmin).not.toHaveBeenCalled();
    expect(guards.requireExpertOwnerOrAdmin).not.toHaveBeenCalled();
  });
});