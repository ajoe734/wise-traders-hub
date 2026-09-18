import { describe, it, expect } from 'vitest';
import {
  groupSubscriberSpells,
  calcRenewalRate,
  calcActiveShare,
  parseSearch,
  type SpellRow,
} from '@/lib/subscriberAggregation';

const NOW = new Date('2026-09-18T00:00:00Z').getTime();
const d = (iso: string) => new Date(iso).toISOString();

const row = (p: Partial<SpellRow> & { id: string }): SpellRow => ({
  user_id: 'u1',
  kind: 'expert',
  plan_name: '修煉派',
  expert_name: '彥愷',
  status: 'expired',
  started_at: d('2026-06-01'),
  expires_at: d('2026-07-01'),
  ...p,
});

describe('groupSubscriberSpells', () => {
  it('同一人同一老師的多期收成一列，期數與首次訂閱日正確', () => {
    const groups = groupSubscriberSpells([
      row({ id: 'a', started_at: d('2026-06-01'), expires_at: d('2026-07-01') }),
      row({ id: 'b', started_at: d('2026-07-02'), expires_at: d('2026-08-02') }),
      row({ id: 'c', started_at: d('2026-09-01'), expires_at: d('2026-10-01'), status: 'active' }),
    ], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].cycles).toBe(3);
    expect(groups[0].first_started_at).toBe(d('2026-06-01'));
    expect(groups[0].latest.id).toBe('c');
    expect(groups[0].status).toBe('live');
  });

  it('同一人不同老師分開計，健檢與訂閱方案分流', () => {
    const groups = groupSubscriberSpells([
      row({ id: 'a', expert_name: '彥愷' }),
      row({ id: 'b', expert_name: '阿倫' }),
      row({ id: 'c', kind: 'checkup', expert_name: null, plan_name: '健檢' }),
    ], NOW);
    expect(groups).toHaveLength(3);
    expect(groups.filter((g) => g.kind === 'checkup')).toHaveLength(1);
  });

  it('7 天內到期標記為 expiring，已取消為 canceled，到期未續為 churned', () => {
    const [expiring] = groupSubscriberSpells([
      row({ id: 'a', user_id: 'x', status: 'active', started_at: d('2026-09-01'), expires_at: d('2026-09-30') }),
    ], NOW);
    expect(expiring.status).toBe('live');

    const [soon] = groupSubscriberSpells([
      row({ id: 'b', user_id: 'y', status: 'active', started_at: d('2026-09-01'), expires_at: d('2026-09-21') }),
    ], NOW);
    expect(soon.status).toBe('expiring');
    const [canceled] = groupSubscriberSpells([row({ id: 'c', user_id: 'z', status: 'canceled' })], NOW);
    expect(canceled.status).toBe('canceled');
    const [churned] = groupSubscriberSpells([row({ id: 'd', user_id: 'w' })], NOW);
    expect(churned.status).toBe('churned');
  });
});

describe('calcRenewalRate', () => {
  it('到期後 30 天內再開通算續訂', () => {
    const r = calcRenewalRate([
      row({ id: 'a', started_at: d('2026-06-01'), expires_at: d('2026-07-01') }),
      row({ id: 'b', started_at: d('2026-07-10'), expires_at: d('2026-08-10') }),
    ], NOW);
    expect(r).toEqual({ denominator: 2, numerator: 1, rate: 50 });
  });

  it('超過 30 天才回來不算續訂', () => {
    const r = calcRenewalRate([
      row({ id: 'a', started_at: d('2026-06-01'), expires_at: d('2026-07-01') }),
      row({ id: 'b', started_at: d('2026-08-15'), expires_at: d('2026-09-15') }),
    ], NOW);
    expect(r.numerator).toBe(0);
    expect(r.denominator).toBe(2);
  });

  it('仍有效的期間不計入分母；已取消也不計入', () => {
    const r = calcRenewalRate([
      row({ id: 'a', status: 'active', started_at: d('2026-09-01'), expires_at: d('2026-10-01') }),
      row({ id: 'b', status: 'canceled', started_at: d('2026-05-01'), expires_at: d('2026-06-01') }),
    ], NOW);
    expect(r.denominator).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('不同老師之間不互相算成續訂', () => {
    const r = calcRenewalRate([
      row({ id: 'a', expert_name: '彥愷', started_at: d('2026-06-01'), expires_at: d('2026-07-01') }),
      row({ id: 'b', expert_name: '阿倫', started_at: d('2026-07-05'), expires_at: d('2026-08-05') }),
    ], NOW);
    expect(r.numerator).toBe(0);
    expect(r.denominator).toBe(2);
  });
});

describe('calcActiveShare', () => {
  it('分母排除已取消，分子為仍有效', () => {
    const s = calcActiveShare([
      row({ id: 'a', status: 'active', expires_at: d('2026-10-01') }),
      row({ id: 'b' }),
      row({ id: 'c', status: 'canceled' }),
    ], NOW);
    expect(s).toEqual({ denominator: 2, numerator: 1, rate: 50 });
  });
});

describe('parseSearch', () => {
  it('拆出前綴欄位與自由字串', () => {
    const p = parseSearch('email:abc@x.com 老師:彥愷 王小明');
    expect(p.fields.email).toBe('abc@x.com');
    expect(p.fields.expert).toBe('彥愷');
    expect(p.free).toBe('王小明');
  });
  it('未知前綴視為自由字串', () => {
    expect(parseSearch('foo:bar').free).toBe('foo:bar');
  });
});
