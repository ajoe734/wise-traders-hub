/**
 * Stage 3B / S3B-0 RED test — canonical terminal code 的唯一映射表
 *
 * 契約（v4.1 §S3B-C/D）：整個系統只能有「一個」canonical terminal code：
 *   DB terminal code      : 'bsr_provider_unsupported'
 *   gate reason           : 'provider_plan_rejected'
 *   前端 provider state   : 'terminal_provider_rejected'
 *   分段新鮮度 seg state   : 'unavailable_unsupported'
 * 並且映射必須是單一模組 `@/checkup/lib/bsrCanonicalCodes` 導出，
 * 前端不得散落字面字串。
 *
 * 目前預期 RED，失敗點：模組 `src/checkup/lib/bsrCanonicalCodes.ts` 尚未建立
 * （S3B-D 才會建），因此 canonical 映射不存在、且各檔仍各自寫死字串。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 動態 specifier：模組尚未建立時只能在 runtime RED，不可讓 tsc 先炸
const CANONICAL_MODULE = '@/checkup/lib/bsrCanonicalCodes';

async function loadModule(): Promise<any> {
  return import(/* @vite-ignore */ CANONICAL_MODULE).catch(() => null);
}

describe('S3B RED · BSR canonical terminal code 映射', () => {
  it('canonical 映射模組必須存在並導出四段一致的代碼', async () => {
    const mod = await loadModule();
    expect(mod, 'RED: @/checkup/lib/bsrCanonicalCodes 不存在 —— canonical 映射尚未實作').not.toBeNull();
    expect(mod?.BSR_TERMINAL_DB_CODE).toBe('bsr_provider_unsupported');
    expect(mod?.BSR_TERMINAL_GATE_REASON).toBe('provider_plan_rejected');
    expect(mod?.BSR_TERMINAL_PROVIDER_STATE).toBe('terminal_provider_rejected');
    expect(mod?.BSR_TERMINAL_SEG_STATE).toBe('unavailable_unsupported');
  });

  it('mapProviderState() 必須把 DB/gate 兩種輸入收斂到同一個 terminal state', async () => {
    const mod = await loadModule();
    expect(mod?.mapProviderState, 'RED: mapProviderState 未導出').toBeTypeOf('function');
    expect(mod?.mapProviderState('bsr_provider_unsupported')).toBe('terminal_provider_rejected');
    expect(mod?.mapProviderState('provider_plan_rejected')).toBe('terminal_provider_rejected');
    expect(mod?.mapProviderState('sync_failed')).not.toBe('terminal_provider_rejected');
    expect(mod?.mapProviderState(null)).not.toBe('terminal_provider_rejected');
  });

  it('前端不得再散落 terminal 字面字串（唯一來源是 canonical 模組）', () => {
    const files = [
      'src/checkup/lib/bsrProviderState.ts',
      'src/checkup/components/freecheckup/ChipsSection.tsx',
    ];
    for (const f of files) {
      let s = '';
      try { s = readFileSync(resolve(process.cwd(), f), 'utf8'); } catch { continue; }
      const literal = /'terminal_provider_rejected'|'bsr_provider_unsupported'/.test(s);
      const imported = /bsrCanonicalCodes/.test(s);
      expect(
        !literal || imported,
        `RED: ${f} 直接寫死 terminal 字面字串且未 import canonical 模組`,
      ).toBe(true);
    }
  });
});
