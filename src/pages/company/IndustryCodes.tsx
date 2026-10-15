import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import industryCodesJson from '@/checkup/data/industryCodes.json';
import peerGroupsJson from '@/checkup/data/valuationPeerGroups.json';
import {
  assembleIndustryOverview,
  filterIndustryOverview,
  type IndustryCodeRow,
  type PeerGroupRow,
  type StockNameMap,
} from './_industryCodes/assembleIndustryOverview';

const codes = (industryCodesJson as { codes: IndustryCodeRow[] }).codes;
const groups = (peerGroupsJson as { groups: PeerGroupRow[] }).groups;

const CompanyIndustryCodes = () => {
  const [names, setNames] = useState<StockNameMap>({});
  const [industryCounts, setIndustryCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // stock_names 與 stock_industry_map 皆公開可讀，各約兩三千筆，單次拉齊
      const [namesRes, mapRes] = await Promise.all([
        supabase.from('stock_names').select('symbol,name').limit(5000),
        supabase.from('stock_industry_map').select('symbol,industries').limit(5000),
      ]);
      if (cancelled) return;
      const map: StockNameMap = {};
      for (const row of namesRes.data ?? []) {
        map[String(row.symbol)] = String(row.name ?? '');
      }
      const counts: Record<string, number> = {};
      for (const row of mapRes.data ?? []) {
        const primary = Array.isArray(row.industries) ? String(row.industries[0] ?? '') : '';
        if (primary) counts[primary] = (counts[primary] ?? 0) + 1;
      }
      setNames(map);
      setIndustryCounts(counts);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { sections, customGroups } = useMemo(
    () => assembleIndustryOverview(codes, groups, industryCounts, names),
    [names],
  );

  const filter = useMemo(
    () => filterIndustryOverview(query, sections, customGroups),
    [query, sections, customGroups],
  );
  const searching = query.trim().length > 0;

  const curationBadge = (curation: string) =>
    curation === 'manual' ? (
      <Badge variant="secondary" className="text-[10px]">人工確認</Badge>
    ) : (
      <Badge variant="outline" className="text-[10px]">自動組成</Badge>
    );

  const memberList = (
    members: { symbol: string; name: string; source: 'manual' | 'auto' }[],
    excludes: { symbol: string; name: string }[],
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => (
        <span
          key={m.symbol}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
            m.source === 'manual' ? 'border-border bg-background' : 'border-dashed border-border text-muted-foreground'
          }`}
          title={m.source === 'manual' ? '人工加入' : '自動補齊'}
        >
          <span className="font-medium">{m.symbol}</span>
          <span>{m.name || '—'}</span>
        </span>
      ))}
      {excludes.map((e) => (
        <span
          key={`x-${e.symbol}`}
          className="inline-flex items-center gap-1 rounded border border-destructive/40 px-1.5 py-0.5 text-xs text-destructive line-through"
          title="人工排除"
        >
          <span className="font-medium">{e.symbol}</span>
          <span>{e.name || '—'}</span>
        </span>
      ))}
    </div>
  );

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            to="/company"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="回管理首頁"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-foreground">產業分類與同業名單</h1>
            <p className="text-xs text-muted-foreground">
              125 個產業代碼、{groups.length} 組同業名單。唯讀檢視，調整名單請直接告知。
            </p>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋產業名稱、代碼、股票代號或公司名稱"
            className="pl-9"
          />
        </div>

        {customGroups.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-bold text-foreground">跨產業自訂組</h2>
            {customGroups
              .filter((g) => !searching || filter.customKeys.has(g.key))
              .map((g) => (
                <div key={g.key} className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{g.label}</span>
                    {curationBadge(g.curation)}
                    <span className="text-xs text-muted-foreground">{g.members.length} 檔</span>
                  </div>
                  {memberList(g.members, g.excludes)}
                </div>
              ))}
          </section>
        )}

        {sections.map((section) => {
          const rows = searching ? section.rows.filter((r) => filter.codes.has(r.code)) : section.rows;
          if (rows.length === 0) return null;
          return (
            <section key={section.sectorCode} className="space-y-3">
              <h2 className="text-base font-bold text-foreground">
                {section.sector}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {section.sectorCode}・{rows.length} 個細分產業
                </span>
              </h2>
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.code} className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">{r.code}</code>
                      <span className="font-bold text-foreground">{r.name}</span>
                      {r.retired && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">已停用</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">全市場 {r.stockCount} 檔</span>
                    </div>
                    {r.aliases.length > 0 && (
                      <p className="text-xs text-muted-foreground">別名：{r.aliases.join('、')}</p>
                    )}
                    {r.peerGroup ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>同業名單「{r.peerGroup.label}」</span>
                          {curationBadge(r.peerGroup.curation)}
                          <span>{r.peerGroup.members.length} 檔</span>
                        </div>
                        {memberList(r.peerGroup.members, r.peerGroup.excludes)}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">尚無同業名單</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </CompanyLayout>
  );
};

export default CompanyIndustryCodes;
