/**
 * Unit test — mergeExpertIntoListCaches()
 *
 * 行為合約（src/hooks/useExpert.ts）：
 *  1. 對於每個 ['experts', ...] cache，若 list 內存在相同 slug 的 row，
 *     就用新的 expert 物件 patch 進 list；不存在則跳過該 cache。
 *  2. 若該位置上的 row 與新 expert byte-identical (JSON 同形)，
 *     不可呼叫 setQueryData（避免無意義 re-render）。
 *  3. 多個 list cache 同時存在（不同 user / visibility）時，所有
 *     含該 slug 的 list 都要被 patch；非 ['experts'] 前綴的 cache 不能被動。
 *  4. 非陣列值（例如還在 loading 的 cache 是 undefined / null）必須跳過。
 */
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { mergeExpertIntoListCaches } from '@/hooks/useExpert';
import type { PersonWithPlans } from '@/types';

function person(over: Partial<PersonWithPlans> = {}): PersonWithPlans {
  return {
    id: 'e-alpha',
    slug: 'alpha',
    name: 'Alpha',
    role: 'advisor',
    avatarUrl: undefined,
    bio: '',
    description: '',
    styleTags: [],
    markets: [],
    strategySummary: '',
    backtestReturn1y: null,
    backtestMaxDrawdown: null,
    backtestAnnualReturn: null,
    startingCapital: null,
    riskPreference: null,
    operationCycle: null,
    strategyName: null,
    plans: [],
    tradingSystems: [],
    ...over,
  } as PersonWithPlans;
}

describe('mergeExpertIntoListCaches', () => {
  it('找不到 slug：所有 list cache 維持不變、setQueryData 不被呼叫', () => {
    const qc = new QueryClient();
    const listA = [person({ slug: 'other-1' }), person({ slug: 'other-2' })];
    qc.setQueryData(['experts', 'u1', 'default'], listA);

    const spy = vi.spyOn(qc, 'setQueryData');
    spy.mockClear();

    mergeExpertIntoListCaches(qc, person({ slug: 'alpha', bio: 'new' }));

    expect(spy).not.toHaveBeenCalled();
    expect(qc.getQueryData(['experts', 'u1', 'default'])).toBe(listA);
  });

  it('byte-identical：命中 slug 但內容相同 → 不可呼叫 setQueryData', () => {
    const qc = new QueryClient();
    const existing = person({ slug: 'alpha', bio: 'same' });
    const list = [existing, person({ slug: 'other' })];
    qc.setQueryData(['experts', 'u1', 'default'], list);

    const spy = vi.spyOn(qc, 'setQueryData');
    spy.mockClear();

    // 用一個 *結構相同但 reference 不同* 的物件
    mergeExpertIntoListCaches(qc, person({ slug: 'alpha', bio: 'same' }));

    expect(spy).not.toHaveBeenCalled();
    // list reference 完全不動
    expect(qc.getQueryData(['experts', 'u1', 'default'])).toBe(list);
  });

  it('差異命中：用新物件 patch 該 row，list reference 改變但其他 row 維持 reference', () => {
    const qc = new QueryClient();
    const other = person({ slug: 'other' });
    const stale = person({ slug: 'alpha', bio: 'stale' });
    const list = [stale, other];
    qc.setQueryData(['experts', 'u1', 'default'], list);

    const fresh = person({ slug: 'alpha', bio: 'fresh' });
    mergeExpertIntoListCaches(qc, fresh);

    const next = qc.getQueryData<PersonWithPlans[]>(['experts', 'u1', 'default'])!;
    expect(next).not.toBe(list); // 新 array
    expect(next[0]).toBe(fresh); // 用注入的 expert 物件取代
    expect(next[0].bio).toBe('fresh');
    expect(next[1]).toBe(other); // 其他位置 reference 不動
  });

  it('多個 list cache：所有含該 slug 的 list 都被 patch；非 [experts] 前綴的 cache 不動', () => {
    const qc = new QueryClient();
    const listGuest = [person({ slug: 'alpha', bio: 'guest-old' })];
    const listUser1 = [person({ slug: 'alpha', bio: 'u1-old' }), person({ slug: 'beta' })];
    const listNoMatch = [person({ slug: 'gamma' })];
    const unrelated = [person({ slug: 'alpha', bio: 'subscription-row' })];

    qc.setQueryData(['experts', 'guest', 'default'], listGuest);
    qc.setQueryData(['experts', 'u1', 'default'], listUser1);
    qc.setQueryData(['experts', 'u2', 'default'], listNoMatch);
    qc.setQueryData(['expert-subscription-stats', 'alpha'], unrelated);

    const fresh = person({ slug: 'alpha', bio: 'fresh' });
    mergeExpertIntoListCaches(qc, fresh);

    expect(qc.getQueryData<PersonWithPlans[]>(['experts', 'guest', 'default'])?.[0].bio).toBe('fresh');
    expect(qc.getQueryData<PersonWithPlans[]>(['experts', 'u1', 'default'])?.[0].bio).toBe('fresh');
    // 無 slug 命中的 list 維持原 reference
    expect(qc.getQueryData(['experts', 'u2', 'default'])).toBe(listNoMatch);
    // 非 ['experts'] 前綴的 cache 不可被動
    expect(qc.getQueryData(['expert-subscription-stats', 'alpha'])).toBe(unrelated);
  });

  it('非陣列 / 空值的 cache 必須跳過，不可丟錯', () => {
    const qc = new QueryClient();
    qc.setQueryData(['experts', 'u1', 'default'], null);
    qc.setQueryData(['experts', 'u2', 'default'], undefined);
    qc.setQueryData(['experts', 'u3', 'default'], { not: 'an-array' });
    qc.setQueryData(['experts', 'u4', 'default'], [person({ slug: 'alpha', bio: 'old' })]);

    expect(() => mergeExpertIntoListCaches(qc, person({ slug: 'alpha', bio: 'new' }))).not.toThrow();

    expect(qc.getQueryData<PersonWithPlans[]>(['experts', 'u4', 'default'])?.[0].bio).toBe('new');
  });
});
