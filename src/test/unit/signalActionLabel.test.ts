import { describe, it, expect } from 'vitest';
import {
  getActionMeta,
  getSignalDisplayInstrument,
  isTeachingSignal,
  SIGNAL_ACTION_META,
} from '@/lib/signalAction';

describe('signalAction — single source of truth', () => {
  it('maps every documented action to its exact label', () => {
    expect(SIGNAL_ACTION_META.buy.label).toBe('買進');
    expect(SIGNAL_ACTION_META.sell.label).toBe('賣出');
    expect(SIGNAL_ACTION_META.add.label).toBe('加碼');
    expect(SIGNAL_ACTION_META.trim.label).toBe('減碼');
    expect(SIGNAL_ACTION_META.exit.label).toBe('平損');
    expect(SIGNAL_ACTION_META.hold.label).toBe('觀察');
    expect(SIGNAL_ACTION_META.teaching.label).toBe('教學');
  });

  it('getActionMeta returns exact meta for every known action', () => {
    (['buy', 'sell', 'add', 'trim', 'exit', 'hold', 'teaching'] as const).forEach((k) => {
      expect(getActionMeta(k)).toEqual(SIGNAL_ACTION_META[k]);
    });
  });

  it('null / undefined / empty renders as 未知, NEVER as 買進', () => {
    for (const v of [null, undefined, '']) {
      const meta = getActionMeta(v as any);
      expect(meta.label).toBe('未知');
      expect(meta.label).not.toBe('買進');
      expect(meta.className).not.toContain('success');
    }
  });

  it('unknown action string preserves raw text but keeps neutral styling', () => {
    const meta = getActionMeta('stop_win');
    expect(meta.label).toBe('stop_win');
    expect(meta.label).not.toBe('買進');
    expect(meta.className).not.toContain('success');
  });

  it('exit signal (bug repro: 4755 三福化) shows 平損, not 買進', () => {
    const meta = getActionMeta('exit');
    expect(meta.label).toBe('平損');
  });

  it('teaching signal shows 教學 badge and "純教學週記" fallback name', () => {
    const s = { action: 'teaching', instrument: '' };
    expect(isTeachingSignal(s)).toBe(true);
    expect(getActionMeta(s.action).label).toBe('教學');
    expect(getSignalDisplayInstrument(s)).toBe('純教學週記');
  });

  it('teaching signal keeps explicit instrument if provided', () => {
    expect(getSignalDisplayInstrument({ action: 'teaching', instrument: '大盤觀察' })).toBe('大盤觀察');
  });

  it('non-teaching signal with blank instrument renders em-dash, not 純教學週記', () => {
    expect(getSignalDisplayInstrument({ action: 'buy', instrument: '   ' })).toBe('—');
    expect(getSignalDisplayInstrument({ action: 'buy', instrument: '4755 三福化' })).toBe('4755 三福化');
  });
});
