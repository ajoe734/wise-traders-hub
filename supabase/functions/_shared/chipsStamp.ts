// chipsStamp — 籌碼資料的**版本戳單一資料源**（候選 E）。
//
// 契約：
//   - stamp_ver 由「最新 BSR rollup(as_of_date, updated_at)」＋「最新三大法人 trade_date」組成。
//     任何一邊有新資料寫入，stamp 就會變 → edge memory cache 與前端快取同時自動失效。
//   - 舊版只看 tw_chips_rollup，導致三大法人回補完成後 edge 仍回舊快取；本檔一併修正。
//   - 前端 `?stamp_only=1` 探針與 edge cacheKey 必須用同一個函式，禁止各算各的。
// deno-lint-ignore-file no-explicit-any

export interface ChipsStamp {
  stampVer: string;
  chipsAsOf: string | null;
  instAsOf: string | null;
}

export async function computeChipsStamp(supa: any, stockId: string): Promise<ChipsStamp> {
  const [rollupRes, instRes] = await Promise.all([
    supa
      .from('tw_chips_rollup')
      .select('as_of_date, updated_at')
      .eq('stock_id', stockId)
      .eq('window_days', 5)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supa
      .from('tw_institutional_daily')
      .select('trade_date')
      .eq('stock_id', stockId)
      .order('trade_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rollup = rollupRes?.data ?? null;
  const inst = instRes?.data ?? null;
  const chipsAsOf = rollup?.as_of_date ?? null;
  const instAsOf = inst?.trade_date ?? null;
  const chipsPart = rollup ? `${rollup.as_of_date}:${rollup.updated_at}` : 'v0';
  const instPart = instAsOf ?? 'v0';
  return { stampVer: `${chipsPart}|${instPart}`, chipsAsOf, instAsOf };
}
