import { describe, it, expect } from 'vitest';
import { computeChipsFunnel, formatPct, type ChipsEventRow } from '@/lib/chipsCacheFunnel';

const evt = (
  event_name: string,
  props: Record<string, unknown> = {},
): ChipsEventRow => ({ event_name, event_props: { source: 'drawer_open', ...props } });

describe('computeChipsFunnel', () => {
  it('空輸入時所有比例為 null', () => {
    const s = computeChipsFunnel([]);
    expect(s.drawer_open).toBe(0);
    expect(s.effective_hit_ratio).toBeNull();
    expect(s.l1_hit_ratio).toBeNull();
    expect(s.l2_hit_ratio).toBeNull();
    expect(s.db_compute_ratio).toBeNull();
    expect(s.rollup_ratio).toBeNull();
  });

  it('drawer_open 分母 = L1 hit + fetch_start', () => {
    const rows: ChipsEventRow[] = [
      evt('chips_memory_hit'),
      evt('chips_memory_hit'),
      evt('chips_memory_miss'),
      evt('chips_fetch_start'),
      evt('chips_fetch_done', { edge_cache: 'hit' }),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.l1_hit).toBe(2);
    expect(s.fetch_start).toBe(1);
    expect(s.drawer_open).toBe(3);
  });

  it('effective_hit_ratio = (L1 + L2 + coalesced) / drawer_open', () => {
    // 10 次 drawer_open：L1 4、L2 3、coalesced 1、DB 2
    const rows: ChipsEventRow[] = [
      ...Array(4).fill(0).map(() => evt('chips_memory_hit')),
      ...Array(6).fill(0).map(() => evt('chips_fetch_start')),
      ...Array(3).fill(0).map(() => evt('chips_fetch_done', { edge_cache: 'hit' })),
      evt('chips_fetch_done', { edge_cache: 'coalesced' }),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: 'rollup' }),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: 'raw_fallback' }),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.drawer_open).toBe(10);
    expect(s.l1_hit).toBe(4);
    expect(s.l2_hit).toBe(3);
    expect(s.coalesced).toBe(1);
    expect(s.db_compute).toBe(2);
    expect(s.effective_hit_ratio).toBeCloseTo(0.8, 5);
    expect(s.l1_hit_ratio).toBeCloseTo(0.4, 5);
    expect(s.l2_hit_ratio).toBeCloseTo(0.5, 5); // 3/6
    expect(s.db_compute_ratio).toBeCloseTo(2 / 6, 5);
  });

  it('DB compute 拆解 rollup / raw_fallback / no_data', () => {
    const rows: ChipsEventRow[] = [
      evt('chips_fetch_start'),
      evt('chips_fetch_start'),
      evt('chips_fetch_start'),
      evt('chips_fetch_start'),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: 'rollup' }),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: 'rollup' }),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: 'raw_fallback' }),
      evt('chips_fetch_done', { edge_cache: 'miss', bsr_source: null }),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.db_compute).toBe(4);
    expect(s.db_rollup).toBe(2);
    expect(s.db_raw_fallback).toBe(1);
    expect(s.db_no_data).toBe(1);
    expect(s.rollup_ratio).toBeCloseTo(0.5, 5);
  });

  it('過濾非 drawer_open 來源（manual_refetch/reconnect 不進分母）', () => {
    const rows: ChipsEventRow[] = [
      { event_name: 'chips_memory_hit', event_props: { source: 'manual_refetch' } },
      { event_name: 'chips_fetch_start', event_props: { source: 'reconnect' } },
      evt('chips_memory_hit'),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.drawer_open).toBe(1);
    expect(s.l1_hit).toBe(1);
  });

  it('edge_cache 未知值歸類到 edge_unknown', () => {
    const rows: ChipsEventRow[] = [
      evt('chips_fetch_start'),
      evt('chips_fetch_done', { edge_cache: 'weird_value' }),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.edge_unknown).toBe(1);
    expect(s.db_compute).toBe(0);
  });

  it('errors 計入但不列入 hit', () => {
    const rows: ChipsEventRow[] = [
      evt('chips_fetch_start'),
      evt('chips_fetch_error', { error_code: 'network' }),
    ];
    const s = computeChipsFunnel(rows);
    expect(s.errors).toBe(1);
    expect(s.effective_hit_ratio).toBe(0);
  });
});

describe('formatPct', () => {
  it('null 顯示破折號', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });
  it('顯示一位小數百分比', () => {
    expect(formatPct(0.8)).toBe('80.0%');
    expect(formatPct(0.12345)).toBe('12.3%');
    expect(formatPct(1)).toBe('100.0%');
  });
});
