import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  readGa4Config, validateRange, parseBatchResponse, classifyGoogleError, runGa4Report, buildBatchRequest, GA4_SCOPE,
} from '../../../supabase/functions/_shared/ga4ReportCore';

let SA_JSON = '';
beforeAll(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  SA_JSON = JSON.stringify({ client_email: 'ga4-reader@proj.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` });
});
const env = (o: Record<string, string>) => (n: string) => o[n];

describe('readGa4Config', () => {
  it('兩個 secret 都缺時列出確切名稱', () => {
    const r = readGa4Config(env({}));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe('NOT_CONFIGURED'); expect(r.missing).toEqual(['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON']); }
  });
  it('G- 評估 ID 不可當資源 ID', () => {
    const r = readGa4Config(env({ GA4_PROPERTY_ID: 'G-ABC123', GA4_SERVICE_ACCOUNT_JSON: SA_JSON }));
    expect(!r.ok && r.status).toBe('INVALID_CONFIG');
  });
  it('JSON 壞掉為 INVALID_CONFIG', () => {
    const r = readGa4Config(env({ GA4_PROPERTY_ID: '123456789', GA4_SERVICE_ACCOUNT_JSON: '{bad' }));
    expect(!r.ok && r.status).toBe('INVALID_CONFIG');
  });
});

describe('validateRange', () => {
  it('拒絕非 YYYY-MM-DD、不存在日期、倒序與超過 400 天', () => {
    expect(validateRange('2026/10/01', '2026-10-02').ok).toBe(false);
    expect(validateRange('2026-02-30', '2026-03-01').ok).toBe(false);
    expect(validateRange('2026-10-05', '2026-10-01').ok).toBe(false);
    expect(validateRange('2025-01-01', '2026-10-01').ok).toBe(false);
    expect(validateRange('2026-10-01', '2026-10-20').ok).toBe(true);
  });
});

describe('parseBatchResponse', () => {
  it('缺的日子補 0，總數取 GA 去重 TOTAL 而非每日相加', () => {
    const body = { reports: [
      { metadata: { timeZone: 'Asia/Taipei' }, rows: [{ dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '5' }, { value: '6' }, { value: '9' }] }, { dimensionValues: [{ value: '20261003' }], metricValues: [{ value: '4' }, { value: '4' }, { value: '7' }] }],
        totals: [{ metricValues: [{ value: '8' }, { value: '10' }, { value: '16' }] }] },
      { rows: [{ dimensionValues: [{ value: '/pricing' }], metricValues: [{ value: '10' }, { value: '6' }] }] },
    ] };
    const r = parseBatchResponse(body, '123456789', '2026-10-01', '2026-10-03');
    expect(r.status).toBe('OK');
    expect(r.report.daily.map(d => d.users)).toEqual([5, 0, 4]);
    expect(r.report.totals).toEqual({ users: 8, sessions: 10, pageViews: 16 });
    expect(r.report.timeZone).toBe('Asia/Taipei');
    expect(r.report.topPages).toEqual([{ path: '/pricing', pageViews: 10, users: 6 }]);
  });
  it('完全沒資料為 NO_DATA', () => {
    expect(parseBatchResponse({ reports: [{}, {}] }, '1', '2026-10-01', '2026-10-01').status).toBe('NO_DATA');
  });
});

describe('classifyGoogleError', () => {
  it('API 停用 / 無權限 / 找不到資源 分開', () => {
    expect(classifyGoogleError(403, { error: { message: 'Google Analytics Data API has not been used in project 1', details: [{ reason: 'SERVICE_DISABLED' }] } }).status).toBe('API_DISABLED');
    expect(classifyGoogleError(403, { error: { message: 'User does not have sufficient permissions' } }).status).toBe('PERMISSION_DENIED');
    expect(classifyGoogleError(404, { error: { message: 'not found' } }).status).toBe('PROPERTY_NOT_FOUND');
    expect(classifyGoogleError(500, { error: { message: 'boom' } }).status).toBe('QUERY_ERROR');
  });
});

describe('runGa4Report', () => {
  const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
  it('缺設定時不呼叫 Google', async () => {
    let calls = 0;
    const r = await runGa4Report(env({}), { startDate: '2026-10-01', endDate: '2026-10-02' }, async () => { calls++; return ok({}); });
    expect(r.status).toBe('NOT_CONFIGURED');
    expect(calls).toBe(0);
  });
  it('以唯讀 scope 換 token，回傳不含 token', async () => {
    const urls: string[] = [];
    let scope = '';
    const r = await runGa4Report(env({ GA4_PROPERTY_ID: '123456789', GA4_SERVICE_ACCOUNT_JSON: SA_JSON }), { startDate: '2026-10-01', endDate: '2026-10-01' }, async (url, init) => {
      urls.push(url);
      if (url.includes('oauth2')) {
        const a = new URLSearchParams(String(init.body)).get('assertion')!;
        scope = JSON.parse(Buffer.from(a.split('.')[1], 'base64url').toString()).scope;
        return ok({ access_token: 'secret-token' });
      }
      expect(JSON.parse(String(init.body))).toEqual(buildBatchRequest('2026-10-01', '2026-10-01'));
      return ok({ reports: [{ rows: [{ dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '1' }, { value: '1' }, { value: '2' }] }], totals: [{ metricValues: [{ value: '1' }, { value: '1' }, { value: '2' }] }] }, { rows: [] }] });
    });
    expect(scope).toBe(GA4_SCOPE);
    expect(urls[1]).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports');
    expect(r.status).toBe('OK');
    expect(JSON.stringify(r)).not.toContain('secret-token');
    expect(JSON.stringify(r)).not.toContain('PRIVATE KEY');
  });
  it('token 交換失敗為 AUTH_FAILED', async () => {
    const r = await runGa4Report(env({ GA4_PROPERTY_ID: '123456789', GA4_SERVICE_ACCOUNT_JSON: SA_JSON }), { startDate: '2026-10-01', endDate: '2026-10-01' }, async () => ok({ error: 'invalid_grant', error_description: 'Invalid JWT' }, 400));
    expect(r.status).toBe('AUTH_FAILED');
  });
  it('API 停用狀態原樣回報', async () => {
    const r = await runGa4Report(env({ GA4_PROPERTY_ID: '123456789', GA4_SERVICE_ACCOUNT_JSON: SA_JSON }), { startDate: '2026-10-01', endDate: '2026-10-01' }, async (url) =>
      url.includes('oauth2') ? ok({ access_token: 't' }) : ok({ error: { message: 'API has not been used', details: [{ reason: 'SERVICE_DISABLED' }] } }, 403));
    expect(r.status).toBe('API_DISABLED');
  });
});
