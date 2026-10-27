import { describe, it, expect } from 'vitest';
import { chunkSymbols, fetchMisResilient, buildExChParts, MIS_MAX_PARTS } from '../../../supabase/functions/_shared/misBatch';

const syms = Array.from({ length: 106 }, (_, i) => String(2300 + i));

describe('MIS 批次查詢（週記現價漏抓根因）', () => {
  it('每批不超過上限，且所有代號都被涵蓋一次', () => {
    const chunks = chunkSymbols(syms);
    for (const c of chunks) expect(c.flatMap(buildExChParts).length).toBeLessThanOrEqual(MIS_MAX_PARTS);
    expect(chunks.flat()).toEqual(syms);
  });

  it('MIS 回「參數不足」時拆批重試，106 檔全部拿到', async () => {
    const fetchFn = async (parts: string[]) => parts.length > 40
      ? { rtmessage: '參數不足', msgArray: [] }
      : { rtmessage: 'OK', msgArray: parts.filter((p) => p.startsWith('tse_')).map((p) => ({ c: p.slice(4, -3), z: '100' })) };
    const { items, failed } = await fetchMisResilient(syms, fetchFn);
    expect(failed).toEqual([]);
    expect(new Set(items.map((i) => i.c)).size).toBe(106);
  });

  it('單一代號仍失敗時列入 failed，不靜默', async () => {
    const fetchFn = async (parts: string[]) => parts.some((p) => p.includes('2464'))
      ? null
      : { rtmessage: 'OK', msgArray: [{ c: 'x' }] };
    const { failed } = await fetchMisResilient(['2464', '2492', '6830'], fetchFn);
    expect(failed).toEqual(['2464']);
  });
});
