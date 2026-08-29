/**
 * T5 — checkup_trade_memos reload 保序（B3）
 *
 * 根因：saveTradeLogToCloud 以「delete 全部 → 整批 insert」寫入，同一批 row 的
 * created_at 相同、id 為隨機 UUID，於是 hydration 的 tie-break 落到亂數 →
 * reload 後順序隨機。修法是 DB 新增 sort_index（寫入時 = tradeLog array index），
 * hydration 一律先看 sort_index。
 *
 * 這裡測 hydration 端的純函式契約：
 *  - 同 created_at + 亂序 UUID 仍完全依 sort_index 還原
 *  - legacy（migration 前，全部 sort_index=0 或缺欄）走 created_at DESC → id DESC
 *  - 帳號合併（兩批各自 0..n 重號）仍 deterministic、不丟列
 *  - reload → delete → replay：重寫後的 sort_index 與 UI 順序一致
 */
import { describe, it, expect } from 'vitest';
import { sortTradeMemoRows, mapTradeMemoRow } from '@/hooks/useFreeCheckupBootstrap';

const SAME_TS = '2026-08-29T02:00:00.000Z';

const row = (over: Record<string, unknown>) => ({
  id: 'id-x',
  created_at: SAME_TS,
  trade_date: '2026/08/29',
  trade_time: '09:00',
  action: '買進',
  code: '2330',
  name: '台積電',
  qty: 1000,
  price: 1100,
  qa: [],
  sort_index: 0,
  ...over,
});

/** 模擬 saveTradeLogToCloud：以 array index 落 sort_index、同一個 created_at、亂序 UUID。 */
const writeRows = (codes: string[], uuids: string[], created = SAME_TS) =>
  codes.map((code, idx) => row({ id: uuids[idx], code, sort_index: idx, created_at: created }));

describe('T5 trade log hydration ordering', () => {
  it('同 created_at + 亂序 UUID 仍依 sort_index 還原原順序', () => {
    const codes = ['2330', '2454', '00637L', 'AMD', '2317'];
    const uuids = ['ff', '0a', '9z', '1b', 'cc'];
    const stored = writeRows(codes, uuids);
    // DB 回傳順序被打亂（PostgREST 無序保證）
    const shuffled = [stored[3], stored[0], stored[4], stored[1], stored[2]];
    expect(sortTradeMemoRows(shuffled).map((r) => r.code)).toEqual(codes);
    expect(sortTradeMemoRows(shuffled).map(mapTradeMemoRow).map((r) => r.code)).toEqual(codes);
  });

  it('legacy rows（無 sort_index / 全 0）退回 created_at DESC → id DESC', () => {
    const legacy = [
      { ...row({ id: 'a', created_at: '2026-08-01T00:00:00.000Z' }), sort_index: undefined },
      { ...row({ id: 'b', created_at: '2026-08-03T00:00:00.000Z' }), sort_index: undefined },
      { ...row({ id: 'c', created_at: '2026-08-03T00:00:00.000Z' }), sort_index: undefined },
    ];
    expect(sortTradeMemoRows(legacy).map((r) => r.id)).toEqual(['c', 'b', 'a']);

    const allZero = legacy.map((r) => ({ ...r, sort_index: 0 }));
    expect(sortTradeMemoRows(allZero).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('帳號合併造成 sort_index 重號時仍 deterministic 且不丟列', () => {
    const a = writeRows(['2330', '2454', '2317'], ['a1', 'a2', 'a3'], '2026-08-20T00:00:00.000Z');
    const b = writeRows(['AMD', 'NVDA'], ['b1', 'b2'], '2026-08-25T00:00:00.000Z');
    const merged = [...b, ...a];

    const once = sortTradeMemoRows(merged).map((r) => r.id);
    const twice = sortTradeMemoRows([...merged].reverse()).map((r) => r.id);
    expect(once).toEqual(twice); // 與輸入順序無關
    expect(once).toHaveLength(5); // 沒有列被吃掉
    // 同 sort_index 時較新的 created_at 在前
    expect(once[0]).toBe('b1');
    expect(once[1]).toBe('a1');
  });

  it('reload → delete → replay：重寫後 sort_index 與 UI 順序一致', () => {
    const codes = ['2330', '2454', '00637L'];
    const stored = writeRows(codes, ['z9', 'a1', 'm5']);
    const hydrated = sortTradeMemoRows(stored).map(mapTradeMemoRow);
    expect(hydrated.map((r) => r.code)).toEqual(codes);

    // 使用者刪掉中間那筆 → 前端 tradeLog 重新排列
    const afterDelete = hydrated.filter((_, i) => i !== 1);
    // replay 寫回（新 UUID、同 created_at），sort_index 依新的 array index
    const rewritten = writeRows(
      afterDelete.map((r) => r.code),
      ['q7', 'b2'],
      '2026-08-29T03:00:00.000Z',
    );
    expect(sortTradeMemoRows([rewritten[1], rewritten[0]]).map((r) => r.code)).toEqual([
      '2330',
      '00637L',
    ]);
    expect(rewritten.map((r) => r.sort_index)).toEqual([0, 1]);
  });
});
