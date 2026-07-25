// PR-10: guardianRules 純函式 golden fixture 對照測試。
// Fixture 由 scripts/record-guardian-golden.mjs 生成；常數變更 PR 必須同時重跑腳本。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideSloAdjustment,
  decideUpstreamThrottle,
} from '../../../supabase/functions/_shared/guardianRules';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../supabase/functions/chips-guardian/__fixtures__/decisions.golden.json'),
    'utf8',
  ),
);

describe('chips-guardian golden fixture (SLO)', () => {
  for (const c of FIXTURE.slo as any[]) {
    it(`slo/${c.name}`, () => {
      const got = decideSloAdjustment(c.input);
      expect(got).toEqual(c.expected);
    });
  }
});

describe('chips-guardian golden fixture (Upstream)', () => {
  for (const c of FIXTURE.upstream as any[]) {
    it(`upstream/${c.name}`, () => {
      const got = decideUpstreamThrottle(c.input);
      expect(got).toEqual(c.expected);
    });
  }
});
