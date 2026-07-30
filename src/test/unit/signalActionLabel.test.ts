import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
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

/**
 * A2 — 前台 ↔ Deno 鏡像 parity + 全站靜態守衛。
 * edge function 內任何自製 action 標籤地圖都會在這裡被抓到。
 */
describe('signalAction — Deno 鏡像 parity 與靜態守衛', () => {
  const root = resolve(__dirname, '../../..');
  const denoSrc = readFileSync(
    resolve(root, 'supabase/functions/_shared/signalAction.ts'),
    'utf-8',
  );

  it('Deno 鏡像的每個 label 與前台 SIGNAL_ACTION_META 逐字一致', () => {
    (Object.keys(SIGNAL_ACTION_META) as Array<keyof typeof SIGNAL_ACTION_META>).forEach((k) => {
      const m = new RegExp(`${k}:\\s*'([^']+)'`).exec(denoSrc);
      expect(m, `Deno 鏡像缺少 ${k}`).toBeTruthy();
      expect(m![1]).toBe(SIGNAL_ACTION_META[k].label);
    });
  });

  it('Deno 鏡像的 key 集合與前台完全相同（不多不少）', () => {
    const block = /SIGNAL_ACTION_LABELS[^{]*\{([^}]+)\}/.exec(denoSrc)![1];
    const keys = [...block.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(Object.keys(SIGNAL_ACTION_META).sort());
  });

  it('未知 / 空值不會 fallback 成 買進', () => {
    expect(denoSrc).not.toMatch(/\?\?\s*SIGNAL_ACTION_LABELS\.buy/);
    expect(denoSrc).toContain("UNKNOWN_ACTION_LABEL = '未知'");
  });

  it('edge functions 與前台皆無自製 action 標籤地圖', () => {
    const out = execSync(
      `rg -n --no-heading -S "(buy|sell|add|trim|exit|hold|teaching)\\s*:\\s*['\\"](買進|賣出|加碼|減碼|平損|觀察|教學|續抱)['\\"]" supabase/functions src || true`,
      { cwd: root, encoding: 'utf-8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith('supabase/functions/_shared/signalAction.ts'))
      .filter((l) => !l.startsWith('src/lib/signalAction.ts'))
      .filter((l) => !l.startsWith('src/pages/_adminSignals/actionLabels.ts'))
      .filter((l) => !l.startsWith('src/test/'))
      // 持倉決策標籤（exit/review/hold）非訊號 action 領域
      .filter((l) => !l.startsWith('src/checkup/components/freecheckup/HoldingsDetailPanel.tsx'));
    expect(out, `發現重複的 action 標籤地圖：\n${out.join('\n')}`).toEqual([]);
  });
});
