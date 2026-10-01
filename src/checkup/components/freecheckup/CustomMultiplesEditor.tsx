/**
 * CustomMultiplesEditor —— 我的情境試算：使用者自行輸入倍數（只存本機，不寫資料庫，不代表老師或平台）。
 * 只能套在可計算的財報分母；必填來源、日期、假設；結果一律標 MY_SCENARIO_LABEL。無預設倍數、無預設來源。
 */
import { useEffect, useState } from 'react';
import { customMultiplesPrefs, EMPTY_CUSTOM, sanitizeCustomInput } from '@/checkup/lib/drawerPrefs';
import { MY_SCENARIO_LABEL, SCENARIO_BASES, SCENARIO_LABELS, type CustomScenario, type CustomScenarioInput, type ScenarioKey, type ValuationScenario } from '@/checkup/lib/valuationScenario';

export function useCustomMultiples(symbol: string | null | undefined): [CustomScenarioInput | null, (v: CustomScenarioInput | null) => void] {
  // load() 每次回傳新物件，不能直接當 useSyncExternalStore 快照；改用 state + subscribe。
  const [all, setAll] = useState(() => customMultiplesPrefs.load());
  useEffect(() => customMultiplesPrefs.subscribe(setAll), []);
  const code = symbol ? String(symbol).trim() : '';
  const value = code ? all.bySymbol[code] ?? null : null;
  const set = (v: CustomScenarioInput | null) => {
    if (!code) return;
    const next = { ...customMultiplesPrefs.load().bySymbol };
    if (v) next[code] = sanitizeCustomInput(v); else delete next[code];
    customMultiplesPrefs.save({ bySymbol: next });
  };
  return [value, set];
}

const twd = (v: number) => `NT$${v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
const KEYS: ScenarioKey[] = ['pe', 'pb', 'ps'];

export function CustomMultiplesEditor({ WB, symbol, scenario, custom, today }: {
  WB: any; symbol: string; scenario: ValuationScenario | null; custom: CustomScenario; today: string;
}) {
  const [saved, setSaved] = useCustomMultiples(symbol);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomScenarioInput>(saved ?? EMPTY_CUSTOM);
  useEffect(() => { setDraft(saved ?? EMPTY_CUSTOM); }, [symbol, saved]);

  const field = { fontSize: 13, padding: '4px 6px', border: `1px solid ${WB.hair}`, background: 'transparent', color: WB.ink, minWidth: 0, width: '100%', boxSizing: 'border-box' as const };
  const setM = (k: ScenarioKey, side: 'low' | 'high', raw: string) =>
    setDraft((d) => ({ ...d, [k]: { ...d[k], [side]: raw === '' ? null : Number(raw) } }));

  return (
    <div data-testid="custom-multiples" style={{ marginTop: 10, minWidth: 0 }}>
      <button type="button" data-testid="custom-multiples-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, color: WB.inkSub, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
        {open ? '▾' : '▸'} 我的情境試算（僅此裝置）
      </button>
      {custom.status === 'ready' && !open && (
        <div data-testid="custom-multiples-summary" style={{ fontSize: 12, color: WB.inkSub, marginTop: 2, overflowWrap: 'anywhere' }}>
          {MY_SCENARIO_LABEL} {twd(custom.low!)}–{twd(custom.high!)} · 我填的依據 {saved?.source} · {saved?.date}
        </div>
      )}
      {custom.status === 'divergent' && !open && (
        <div data-testid="custom-multiples-summary" style={{ fontSize: 12, color: WB.inkSub, marginTop: 2 }}>我的試算各尺無交集，暫無單一區間</div>
      )}
      {open && (
        <div data-testid="custom-multiples-form" style={{ marginTop: 6, fontSize: 12, color: WB.inkSub, lineHeight: 1.6, minWidth: 0 }}>
          {KEYS.map((k) => {
            const row = scenario?.rows.find((r) => r.key === k);
            const ok = !!row?.basisOk && !!row.basis;
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: WB.ink, overflowWrap: 'anywhere' }}>
                  {SCENARIO_LABELS[k]}
                  <span style={{ display: 'block', fontSize: 11, color: WB.inkSub }}>
                    {ok ? `${SCENARIO_BASES[k]} ${twd(row!.basis!.value)}` : '分母不可用，不可套用'}
                  </span>
                </span>
                <input aria-label={`${SCENARIO_LABELS[k]} 倍數下限`} inputMode="decimal" disabled={!ok} placeholder="下限"
                  value={draft[k].low ?? ''} onChange={(e) => setM(k, 'low', e.target.value)} style={field} />
                <input aria-label={`${SCENARIO_LABELS[k]} 倍數上限`} inputMode="decimal" disabled={!ok} placeholder="上限"
                  value={draft[k].high ?? ''} onChange={(e) => setM(k, 'high', e.target.value)} style={field} />
              </div>
            );
          })}
          <label style={{ display: 'block', marginBottom: 6 }}>我的倍數依據（自填，例如報告名稱或頁碼）
            <input aria-label="我的倍數依據" value={draft.source} maxLength={200} onChange={(e) => setDraft({ ...draft, source: e.target.value })} style={field} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>依據日期（YYYY-MM-DD）
            <input aria-label="依據日期" value={draft.date} maxLength={10} placeholder={today} onChange={(e) => setDraft({ ...draft, date: e.target.value })} style={field} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>我的假設（為何這個倍數適用）
            <textarea aria-label="假設說明" value={draft.assumption} maxLength={400} rows={2} onChange={(e) => setDraft({ ...draft, assumption: e.target.value })} style={{ ...field, resize: 'vertical' }} />
          </label>
          {custom.problems.length > 0 && saved && (
            <div data-testid="custom-multiples-problems" style={{ color: WB.ink, marginBottom: 6 }}>無法套用：{custom.problems.join('、')}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="custom-multiples-save" onClick={() => setSaved(draft)}
              style={{ fontSize: 12, padding: '3px 10px', border: `1px solid ${WB.ink}`, background: 'transparent', color: WB.ink, cursor: 'pointer' }}>套用到價格軸</button>
            <button type="button" data-testid="custom-multiples-clear" onClick={() => { setSaved(null); setDraft(EMPTY_CUSTOM); }}
              style={{ fontSize: 12, padding: '3px 10px', border: `1px solid ${WB.hair}`, background: 'transparent', color: WB.inkSub, cursor: 'pointer' }}>清除</button>
          </div>
          <div style={{ marginTop: 6 }}>
            這是你自己輸入的試算，只存在這台裝置；不是老師發布的觀點，也不是系統算出的合理價。只乘已計算且可用的每股分母；多把尺取交集，無交集就不給單一區間。清除後價格軸上的試算帶會一起消失。
          </div>
        </div>
      )}
    </div>
  );
}
