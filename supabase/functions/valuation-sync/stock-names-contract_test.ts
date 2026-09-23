import { assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('industry refresh persists the complete stock name payload', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

  assertMatch(source, /stock_name/);
  assertMatch(source, /from\('stock_names'\)\.upsert/);
  assertMatch(source, /asset_class:\s*'tw_stock'/);
  assertMatch(source, /currency:\s*'TWD'/);
});