/**
 * 持倉看板「已反映程度」清單：尚未反映 → 部分反映 → 已大幅反映 → 無法判斷。
 * 只用文字與字重分級，不用紅綠（紅綠保留給行情漲跌）。
 */
import { usePricedInList } from './usePricedInList';

export default function PricedInList({ holdings, WB }: { holdings: any[] | null | undefined; WB: any }) {
  const { items, loading } = usePricedInList(holdings);
  if (!items.length) return null;
  return (
    <div data-testid="priced-in-list" style={{ margin: '4px 0 10px', border: `1px solid ${WB.hair}`, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.12em', marginBottom: 6 }}>
        已反映程度（現價 ÷ 站牌下車安全帶；近三季＋月營收推估一季）{loading ? '・計算中…' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((i) => (
          <div key={i.code} data-testid={`priced-in-${i.code}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: WB.ink, minWidth: 96 }}>{i.name} {i.code}</span>
            {!i.pricedIn ? <span style={{ fontSize: 11, color: WB.inkMute }}>計算中…</span>
              : i.pricedIn.level === 'unknown' ? <span style={{ fontSize: 11, color: WB.inkSub }}>無法判斷（{i.pricedIn.reason}）</span>
              : <>
                <span style={{ fontSize: 13, fontWeight: i.pricedIn.level === 'heavy' ? 700 : 600, color: i.pricedIn.level === 'heavy' ? WB.accent : WB.ink }}>{i.pricedIn.label}</span>
                <span style={{ fontSize: 12, color: WB.inkSub }}>{Math.round(i.pricedIn.ratioToBelt * 100)}%{i.pricedIn.impliedPercentile != null ? `・隱含倍數落在近一年第 ${Math.round(i.pricedIn.impliedPercentile * 100)}%` : ''}</span>
              </>}
          </div>
        ))}
      </div>
    </div>
  );
}
