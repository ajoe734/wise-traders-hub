import { describe, it, expect } from 'vitest';
import { bsrHeaderLabel } from '../bsrHeaderLabel';

describe('bsrHeaderLabel — ChipsSection 各狀態文案', () => {
  it('已有 AS OF 實資料 → 不顯示標頭（改由 AS OF 顯示）', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'done' }, true)).toBeNull();
  });

  it('syncStatus 為 null → 不顯示', () => {
    expect(bsrHeaderLabel(null, false)).toBeNull();
    expect(bsrHeaderLabel(undefined, false)).toBeNull();
  });

  it('unsupported_asset_type（ETF/權證） → "ETF／權證無分點資料"', () => {
    const l = bsrHeaderLabel({ eligible: false, ineligible_reason: 'unsupported_asset_type' }, false);
    expect(l).toEqual({ text: 'ETF／權證無分點資料', tone: 'mute' });
  });

  it('missing_instrument → "尚無此代號 metadata"', () => {
    const l = bsrHeaderLabel({ eligible: false, ineligible_reason: 'missing_instrument' }, false);
    expect(l?.text).toBe('尚無此代號 metadata');
    expect(l?.tone).toBe('mute');
  });

  it('其他 ineligible → fallback "此代號不支援分點"', () => {
    const l = bsrHeaderLabel({ eligible: false, ineligible_reason: 'invalid_stock_id' }, false);
    expect(l?.text).toBe('此代號不支援分點');
  });

  it('running → warn "BSR 同步進行中"', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'running' }, false))
      .toEqual({ text: 'BSR 同步進行中', tone: 'warn' });
  });

  it('pending 無 next_run_at → "已排入佇列"', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'pending' }, false))
      .toEqual({ text: '已排入佇列', tone: 'warn' });
  });

  it('pending 帶 next_run_at → "已排入，{時間} 起執行"', () => {
    const l = bsrHeaderLabel({ eligible: true, status: 'pending', next_run_at: '2026-07-23T06:30:00Z' }, false);
    expect(l?.tone).toBe('warn');
    expect(l?.text).toMatch(/^已排入，.+ 起執行$/);
  });

  it('failed 無 next_run_at → "暫時失敗，將自動重試"', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'failed' }, false))
      .toEqual({ text: '暫時失敗，將自動重試', tone: 'warn' });
  });

  it('failed 帶 next_run_at → 顯示重試時間', () => {
    const l = bsrHeaderLabel({ eligible: true, status: 'failed', next_run_at: '2026-07-23T07:00:00Z' }, false);
    expect(l?.text).toMatch(/^暫時失敗，.+ 自動重試$/);
  });

  it('dead → error "多次失敗，請聯繫管理員"', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'dead' }, false))
      .toEqual({ text: '多次失敗，請聯繫管理員', tone: 'error' });
  });

  it('not_queued → mute "尚未排入佇列（自動處理中）"（不再顯示無依據的「自動同步中」）', () => {
    const l = bsrHeaderLabel({ eligible: true, status: 'not_queued' }, false);
    expect(l?.tone).toBe('mute');
    expect(l?.text).toBe('尚未排入佇列（自動處理中）');
    // 明確斷言：不再出現舊的、無依據的「自動同步中」單獨字樣
    expect(l?.text).not.toBe('自動同步中');
  });

  it('done 但無 AS OF → 不顯示標頭（避免誤導）', () => {
    expect(bsrHeaderLabel({ eligible: true, status: 'done' }, false)).toBeNull();
  });
});
