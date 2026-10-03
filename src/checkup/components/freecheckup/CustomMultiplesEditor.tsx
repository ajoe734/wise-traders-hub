/**
 * CustomMultiplesEditor —— 我的情境試算：使用者自行輸入倍數（只存本機，不寫資料庫，不代表老師或平台）。
 * 只能套在可計算的財報分母；必填來源、日期、假設；結果一律標 MY_SCENARIO_LABEL。無預設倍數、無預設來源。
 */
import { useEffect, useState } from 'react';
import { customMultiplesPrefs, EMPTY_CUSTOM, sanitizeCustomInput } from '@/checkup/lib/drawerPrefs';
import { MY_SCENARIO_LABEL, SCENARIO_BASES, SCENARIO_LABELS, type CustomScenario, type CustomScenarioInput, type ScenarioKey, type ValuationScenario } from '@/checkup/lib/valuationScenario';
import { Button } from '@/components/ui/button';
import { buildForwardEvidence, fmtX, periodOptions } from '@/checkup/lib/forwardValuation';

/** 前瞻／近一年／同業三種證據的可比狀態；接在個人單尺試算上（不產生系統合理價）。 */
export function ForwardEvidencePanel({ WB, scenario, input }: { WB: any; scenario: ValuationScenario | null; input: CustomScenarioInput | null }) {
  const key = input?.primaryKey;
  if (!key) return null;
  const ev = buildForwardEvidence(scenario, key, input);
  const fb = ev.forwardBasis;
  return (
    <div data-testid="forward-evidence" data-key={key} style={{ marginTop: 8, borderLeft: `1px solid ${WB.ink}`, paddingLeft: 10, fontSize: 12, lineHeight: 1.7, color: WB.inkSub, overflowWrap: 'anywhere', minWidth: 0 }}>
      <div data-testid="forward-evidence-basis" data-status={fb.status}>
        <strong style={{ color: WB.ink }}>前瞻分母</strong>：{fb.status === 'missing' ? fb.note
          : <>{fb.period} {SCENARIO_BASES[key]} {twd2(fb.value)} · 來源 {fb.source} · 資料日 {fb.date}{fb.status === 'user' ? '（你填的）' : ''}</>}
      </div>
      <div data-testid="forward-evidence-own">
        <strong style={{ color: WB.ink }}>本身近一年倍數</strong>：
        {ev.ownForward ? <>同期間前瞻快照 {fmtX(ev.ownForward.low)}–{fmtX(ev.ownForward.high)} 倍（中位 {fmtX(ev.ownForward.median)}，{ev.ownForward.note}）；</> : <>同期間前瞻快照未填；</>}
        {ev.ownTtm ? <>TTM {fmtX(ev.ownTtm.low)}–{fmtX(ev.ownTtm.high)} 倍（{ev.ownTtm.n} 期，{ev.ownTtm.from}～{ev.ownTtm.to}）只作歷史背景，不乘前瞻分母</> : <>近一年 TTM 歷史期不足</>}
      </div>
      <div data-testid="forward-evidence-peer">
        <strong style={{ color: WB.ink }}>同業</strong>：{ev.systemPeer.text}
        {ev.userPeer && <span data-testid="forward-evidence-user-peer" data-adjusted={ev.userPeer.adjusted ? '1' : '0'}>；你填的{ev.userPeer.text} · 來源 {ev.userPeer.source}{ev.userPeer.vsUserLow ? ` · ${ev.userPeer.vsUserLow}` : ''}</span>}
      </div>
      {ev.mismatch && <div data-testid="forward-evidence-mismatch" style={{ color: WB.ink, fontWeight: 700 }}>期間不一致：{ev.mismatch}</div>}
      <div data-testid="forward-evidence-probability">{ev.probability}</div>
    </div>
  );
}

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
const twd2 = (v: number) => `NT$${v.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KEYS: ScenarioKey[] = ['pe', 'pb', 'ps'];

const REQUIREMENT_BASIS: Record<ScenarioKey, string> = { pe: '每股獲利', pb: '每股淨值', ps: '每股營收' };
const REQUIREMENT_PERIOD: Record<ScenarioKey, string> = {
  pe: '預期年度或 TTM 口徑，須與你填入的預期分母期間一致',
  pb: '每股淨值口徑',
  ps: '預期年度或 TTM 口徑，須與你填入的預期分母期間一致',
};

export function currentPriceRequirement(price: number | null | undefined, input: CustomScenarioInput | null | undefined): string | null {
  const key = input?.primaryKey;
  const low = input?.multiple.low;
  const high = input?.multiple.high;
  if (!key || !Number.isFinite(price) || Number(price) <= 0 || !Number.isFinite(low) || !Number.isFinite(high) || Number(low) <= 0 || Number(high) < Number(low)) return null;
  return `以你選的 ${Number(low)}–${Number(high)} 倍，現在股價 ${twd2(Number(price))} 需要${REQUIREMENT_BASIS[key]}介於 ${twd2(Number(price) / Number(high))}–${twd2(Number(price) / Number(low))}（${REQUIREMENT_PERIOD[key]}）。這是現價反推要求，不是合理價。`;
}

export function CustomMultiplesEditor({ WB, symbol, scenario, custom, today, price }: {
  WB: any; symbol: string; scenario: ValuationScenario | null; custom: CustomScenario; today: string; price?: number | null;
}) {
  const [saved, setSaved] = useCustomMultiples(symbol);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomScenarioInput>(saved ?? EMPTY_CUSTOM);
  useEffect(() => { setDraft(saved ?? EMPTY_CUSTOM); }, [symbol, saved]);

  const field = { fontSize: 13, padding: '4px 6px', border: `1px solid ${WB.hair}`, background: 'transparent', color: WB.ink, minWidth: 0, width: '100%', boxSizing: 'border-box' as const };
  const setNumber = (key: 'expectedBasis' | 'stressBasis' | 'stressMultiple', raw: string) =>
    setDraft((d) => ({ ...d, [key]: raw === '' ? null : Number(raw) }));
  const setMultiple = (side: 'low' | 'high', raw: string) =>
    setDraft((d) => ({ ...d, multiple: { ...d.multiple, [side]: raw === '' ? null : Number(raw) } }));
  const requirement = currentPriceRequirement(price, open ? draft : saved);

  return (
    <div data-testid="custom-multiples" style={{ marginTop: 10, minWidth: 0 }}>
      <button type="button" data-testid="custom-multiples-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, color: WB.inkSub, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
        {open ? '▾' : '▸'} 我的情境試算（僅此裝置）
      </button>
      {custom.status === 'ready' && !open && (
        <div data-testid="custom-multiples-summary" style={{ fontSize: 12, color: WB.inkSub, marginTop: 2, overflowWrap: 'anywhere' }}>
          {MY_SCENARIO_LABEL} · {custom.key?.toUpperCase()} {custom.low == null ? '—' : twd(custom.low)}–{custom.high == null ? '—' : twd(custom.high)} · 壓力 {custom.stress == null ? '—' : twd(custom.stress)} · {saved?.basisPeriod} 分母 {saved?.expectedBasis == null ? '—' : twd(saved.expectedBasis)}（{saved?.basisSource}） · 我填的倍數依據 {saved?.source} · {saved?.date}
        </div>
      )}
      {custom.status === 'needsReview' && !open && (
        <div data-testid="custom-multiples-legacy" style={{ fontSize: 12, color: WB.ink, marginTop: 4 }}>舊版多尺輸入已保留；請開啟後選一把主要尺並確認預期分母，才會重新套用。</div>
      )}
      {requirement && (
        <div data-testid="custom-current-price-requirement" style={{ marginTop: 6, maxWidth: '100%', fontSize: 13, lineHeight: 1.65, color: WB.ink, overflowWrap: 'anywhere' }}>
          {requirement}
        </div>
      )}
      <ForwardEvidencePanel WB={WB} scenario={scenario} input={open ? draft : saved} />
      {open && (
        <div data-testid="custom-multiples-form" style={{ marginTop: 6, fontSize: 12, color: WB.inkSub, lineHeight: 1.6, minWidth: 0 }}>
          {draft.legacy && <div data-testid="custom-multiples-legacy-detail" style={{ borderLeft: `2px solid ${WB.accent}`, paddingLeft: 8, marginBottom: 10, color: WB.ink }}>舊版內容仍保存在此裝置，未套用。重新儲存後才會改成單尺情境。</div>}
          <div role="group" aria-label="選擇主要尺" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {KEYS.map((k) => {
              const row = scenario?.rows.find((r) => r.key === k);
              const ok = !!row?.basisOk && !!row.basis;
              return <Button key={k} type="button" size="sm" variant={draft.primaryKey === k ? 'secondary' : 'ghost'} disabled={!ok}
                aria-pressed={draft.primaryKey === k} onClick={() => setDraft({ ...draft, primaryKey: k })}>
                {k.toUpperCase()} {ok ? '可用' : '不可用'}
              </Button>;
            })}
          </div>
          {draft.primaryKey && <div style={{ color: WB.ink, marginBottom: 8 }}>
            主要尺：{SCENARIO_LABELS[draft.primaryKey]} · 目前已公布{SCENARIO_BASES[draft.primaryKey]} {scenario?.rows.find((r) => r.key === draft.primaryKey)?.basis?.value != null ? twd(scenario.rows.find((r) => r.key === draft.primaryKey)?.basis?.value as number) : '不可用'}
          </div>}
          <div className="custom-scenario-grid">
            <label>預期每股分母<input aria-label="預期每股分母" inputMode="decimal" value={draft.expectedBasis ?? ''} onChange={(e) => setNumber('expectedBasis', e.target.value)} style={field} /></label>
            <label>倍數下限<input aria-label="倍數下限" inputMode="decimal" value={draft.multiple.low ?? ''} onChange={(e) => setMultiple('low', e.target.value)} style={field} /></label>
            <label>倍數上限<input aria-label="倍數上限" inputMode="decimal" value={draft.multiple.high ?? ''} onChange={(e) => setMultiple('high', e.target.value)} style={field} /></label>
          </div>
          <div className="custom-scenario-grid">
            <label>分母期間<select aria-label="預期分母期間" value={draft.basisPeriod ?? ''} onChange={(e) => setDraft({ ...draft, basisPeriod: e.target.value })} style={field}>
              <option value="">請選</option>
              {periodOptions(today, draft.primaryKey).map((p) => <option key={p} value={p}>{p}</option>)}
            </select></label>
            <label>倍數口徑<select aria-label="倍數口徑" value={draft.multipleKind ?? ''} onChange={(e) => setDraft({ ...draft, multipleKind: (e.target.value || null) as any })} style={field}>
              <option value="">請選</option><option value="forward">同期間前瞻</option><option value="ttm">TTM（已公布）</option>
            </select></label>
            <label>分母資料日<input aria-label="分母資料日" value={draft.basisDate ?? ''} maxLength={10} placeholder={today} onChange={(e) => setDraft({ ...draft, basisDate: e.target.value })} style={field} /></label>
          </div>
          <label style={{ display: 'block', marginBottom: 6 }}>預期分母來源（具名，例如共識機構與日期；已含在共識的成長不要再疊加，單季不要直接乘四）
            <input aria-label="預期分母來源" value={draft.basisSource ?? ''} maxLength={200} onChange={(e) => setDraft({ ...draft, basisSource: e.target.value })} style={field} />
          </label>
          <details data-testid="custom-forward-optional" style={{ marginBottom: 6 }}>
            <summary style={{ cursor: 'pointer', color: WB.ink }}>同業與近一年同口徑倍數（選填）</summary>
            <label style={{ display: 'block', margin: '6px 0' }}>本身近一年同口徑倍數（逗號分隔）
              <input aria-label="本身近一年倍數" value={draft.ownSamples ?? ''} maxLength={200} onChange={(e) => setDraft({ ...draft, ownSamples: e.target.value })} style={field} />
            </label>
            <div className="custom-scenario-grid custom-scenario-grid--stress">
              <label>同業同期間倍數<input aria-label="同業同期間倍數" inputMode="decimal" value={draft.peerMultiple ?? ''} onChange={(e) => setDraft({ ...draft, peerMultiple: e.target.value === '' ? null : Number(e.target.value) })} style={field} /></label>
              <label>同業來源<input aria-label="同業來源" value={draft.peerSource ?? ''} maxLength={200} onChange={(e) => setDraft({ ...draft, peerSource: e.target.value })} style={field} /></label>
            </div>
            <label style={{ display: 'block', marginBottom: 6 }}>折溢價理由（成長／產品／客戶／風險；未填只列未調整參照）
              <input aria-label="折溢價理由" value={draft.peerAdjustment ?? ''} maxLength={400} onChange={(e) => setDraft({ ...draft, peerAdjustment: e.target.value })} style={field} />
            </label>
          </details>
          <div style={{ color: WB.ink, fontWeight: 700, margin: '10px 0 4px' }}>壓力測試</div>
          <div className="custom-scenario-grid custom-scenario-grid--stress">
            <label>較低分母<input aria-label="壓力分母" inputMode="decimal" value={draft.stressBasis ?? ''} onChange={(e) => setNumber('stressBasis', e.target.value)} style={field} /></label>
            <label>較低倍數<input aria-label="壓力倍數" inputMode="decimal" value={draft.stressMultiple ?? ''} onChange={(e) => setNumber('stressMultiple', e.target.value)} style={field} /></label>
          </div>
          <label style={{ display: 'block', marginBottom: 6 }}>我的倍數依據（自填，例如報告名稱或頁碼）
            <input aria-label="我的倍數依據" value={draft.source} maxLength={200} onChange={(e) => setDraft({ ...draft, source: e.target.value })} style={field} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>依據日期（YYYY-MM-DD）
            <input aria-label="依據日期" value={draft.date} maxLength={10} placeholder={today} onChange={(e) => setDraft({ ...draft, date: e.target.value })} style={field} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>我的假設（為何這個倍數適用）
            <textarea aria-label="假設說明" value={draft.assumption} maxLength={400} rows={2} onChange={(e) => setDraft({ ...draft, assumption: e.target.value })} style={{ ...field, resize: 'vertical' }} />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>推翻條件（什麼發生時不再適用）
            <textarea aria-label="推翻條件" value={draft.invalidation} maxLength={400} rows={2} onChange={(e) => setDraft({ ...draft, invalidation: e.target.value })} style={{ ...field, resize: 'vertical' }} />
          </label>
          {custom.problems.length > 0 && saved && (
            <div data-testid="custom-multiples-problems" style={{ color: WB.ink, marginBottom: 6 }}>無法套用：{custom.problems.join('、')}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="button" size="sm" variant="outline" data-testid="custom-multiples-save" onClick={() => setSaved({ ...draft, version: 2, legacy: null })}>套用到價格軸</Button>
            <Button type="button" size="sm" variant="ghost" data-testid="custom-multiples-clear" onClick={() => { setSaved(null); setDraft(EMPTY_CUSTOM); }}>清除</Button>
          </div>
          <div style={{ marginTop: 6 }}>
            這是你自己輸入的單尺情境，只存在這台裝置；不是老師發布的觀點，也不是系統算出的合理價。情境股價＝預期分母 × 倍數；壓力結果＝較低分母 × 較低倍數。清除後價格軸上的試算帶會一起消失。
          </div>
        </div>
      )}
    </div>
  );
}
