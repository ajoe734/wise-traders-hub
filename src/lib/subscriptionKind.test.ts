import { describe, it, expect } from 'vitest';
import { classifySubscriptions } from './subscriptionKind';

const sub = (id: string, start: string, exp: string, user = 'u', expertId = 'e') =>
  ({ id, user_id: user, expertId, started_at: start, expires_at: exp });

describe('classifySubscriptions', () => {
  it('同老師名下第一次訂閱算新訂', () => {
    expect(classifySubscriptions([sub('a', '2026-09-02T11:00:00Z', '2026-10-02T11:00:00Z')]).a).toEqual({ kind: 'new' });
  });
  it('到期當天或之前開始算續訂', () => {
    const r = classifySubscriptions([
      sub('a', '2026-09-02T11:00:00Z', '2026-10-02T11:00:00Z'),
      sub('b', '2026-10-02T11:00:00Z', '2026-11-02T11:00:00Z'),
    ]);
    expect(r.b).toEqual({ kind: 'renew' });
  });
  it('過期後才訂算回流並顯示隔幾天（邱郁惠 11/02 到期、11/05 續訂 = 3 天）', () => {
    const r = classifySubscriptions([
      sub('a', '2026-10-02T11:19:00Z', '2026-11-02T11:19:00Z'),
      sub('b', '2026-11-05T01:38:00Z', '2026-12-05T01:38:00Z'),
    ]);
    expect(r.b).toEqual({ kind: 'return', gapDays: 3 });
  });
  it('不同老師各自算新訂', () => {
    const r = classifySubscriptions([
      sub('a', '2026-09-02T11:00:00Z', '2026-10-02T11:00:00Z', 'u', 'e1'),
      sub('b', '2026-09-10T11:00:00Z', '2026-10-10T11:00:00Z', 'u', 'e2'),
    ]);
    expect(r.b).toEqual({ kind: 'new' });
  });
});
