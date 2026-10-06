import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BriefcaseBusiness, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMemberSubscriptions, type MemberSubscriptionRow } from '@/hooks/useMemberSubscriptions';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';
import { useStockIndustryMap } from '@/checkup/hooks/useStockIndustryMap';
import { getMultiMeta, UNCLASSIFIED } from '@/checkup/lib/stockMetaMulti.js';
import { CURRENCY_SYMBOL, formatMoneyByCurrency, formatPriceByCurrency, normalizeCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';

type SortMode = 'weight' | 'industry' | 'currency';

function ExpertHoldings({ sub, sort }: { sub: MemberSubscriptionRow; sort: SortMode }) {
  const bundle = useExpertHoldingsBundle(sub.expert_id);
  const currencyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of bundle.openPositions) {
      const c = normalizeCurrency(row.currency ?? bundle.currency);
      const value = row.current_price == null ? 0 : row.current_price * Number(row.base_quantity ?? row.quantity);
      totals.set(c, (totals.get(c) ?? 0) + value);
    }
    return totals;
  }, [bundle.currency, bundle.openPositions]);
  const rows = useMemo(() => bundle.openPositions.map((row) => {
    const currency = normalizeCurrency(row.currency ?? bundle.currency);
    const marketValue = row.current_price == null ? null : row.current_price * Number(row.base_quantity ?? row.quantity);
    const total = currencyTotals.get(currency) ?? 0;
    const industry = row.asset_class === 'tw_stock' ? (getMultiMeta(row.symbol, {}, null).primaryIndustry || UNCLASSIFIED) : UNCLASSIFIED;
    return { row, currency, marketValue, weight: marketValue != null && total > 0 ? marketValue / total * 100 : null, industry };
  }).sort((a, b) => {
    if (sort === 'industry') return a.industry.localeCompare(b.industry, 'zh-TW') || a.row.symbol.localeCompare(b.row.symbol);
    if (sort === 'currency') return a.currency.localeCompare(b.currency) || (b.weight ?? -1) - (a.weight ?? -1);
    return (b.weight ?? -1) - (a.weight ?? -1) || a.row.symbol.localeCompare(b.row.symbol);
  }), [bundle.currency, bundle.openPositions, currencyTotals, sort]);

  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0" data-testid={`member-holdings-${sub.expert_id}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h2 className="text-base font-bold text-foreground">{sub.expert.name}</h2><p className="text-xs text-muted-foreground">{sub.expert.role === 'mentor' ? '實戰導師' : '分析師'} · {rows.length} 檔</p></div>
        <Button asChild size="sm" variant="ghost"><Link to={`/app/expert/${sub.expert.slug}`}>老師頁<ChevronRight className="ml-1 h-4 w-4" /></Link></Button>
      </div>
      {bundle.loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />載入持股中</div> : null}
      {!bundle.loading && bundle.isError ? <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 p-4 text-sm"><CircleAlert className="h-4 w-4 text-destructive" />這位老師的持股讀取失敗</div> : null}
      {!bundle.loading && !bundle.isError && !bundle.projection.showNumbers ? <div className="rounded-md border border-border bg-muted/20 p-4"><p className="text-sm font-bold">{bundle.projection.badge || '資料檢核中'}</p><p className="mt-1 text-xs text-muted-foreground">數量、價位與持倉比例暫不顯示。</p></div> : null}
      {!bundle.loading && !bundle.isError && bundle.projection.showNumbers && rows.length === 0 ? <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">目前沒有未平倉持股。</p> : null}
      {!bundle.loading && !bundle.isError && bundle.projection.showNumbers && rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ row, currency, marketValue, weight, industry }) => (
            <article key={row.id} className="min-w-0 rounded-md border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs text-muted-foreground">{row.symbol}</p><h3 className="mt-1 break-words text-base font-bold text-foreground">{row.name || row.symbol}</h3></div><span className="shrink-0 text-xs text-muted-foreground">{currency}</span></div>
              <p className="mt-3 truncate text-xs text-muted-foreground">{industry}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">現價</dt><dd className="mt-1 font-mono tabular-nums">{row.current_price == null ? '報價更新中' : `${CURRENCY_SYMBOL[currency]}${formatPriceByCurrency(row.current_price, currency)}`}</dd></div>
                <div className="text-right"><dt className="text-xs text-muted-foreground">同幣別比例</dt><dd className="mt-1 font-mono font-bold tabular-nums">{weight == null ? '—' : `${weight.toFixed(1)}%`}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">持倉市值</dt><dd className="mt-1 font-mono tabular-nums">{marketValue == null ? '—' : formatMoneyByCurrency(marketValue, currency)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function MemberHoldings() {
  const { data: subscriptions = [], isLoading, isError } = useMemberSubscriptions();
  const [expert, setExpert] = useState('all');
  const [sort, setSort] = useState<SortMode>('weight');
  useStockIndustryMap();
  const visible = expert === 'all' ? subscriptions : subscriptions.filter((sub) => sub.expert_id === expert);
  return (
    <UnifiedAppLayout>
      <SEO title="持股總覽 | legendflow" description="已訂閱老師的目前持股總覽。" path="/app/holdings" noindex />
      <main className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
        <header className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-primary" /><h1 className="text-xl font-bold text-foreground">持股總覽</h1></div><p className="mt-1 text-sm text-muted-foreground">不同幣別分開計算持倉比例。</p></div><Button asChild size="sm" variant="outline"><Link to="/app"><ArrowLeft className="mr-1 h-4 w-4" />戰情室</Link></Button></header>
        {subscriptions.length > 0 ? <Tabs value={expert} onValueChange={setExpert}><TabsList className="h-auto max-w-full justify-start overflow-x-auto"><TabsTrigger value="all">全部老師</TabsTrigger>{subscriptions.map((sub) => <TabsTrigger key={sub.expert_id} value={sub.expert_id}>{sub.expert.name}</TabsTrigger>)}</TabsList></Tabs> : null}
        <div className="flex flex-wrap gap-2" aria-label="排序方式">{(['weight','industry','currency'] as const).map((mode) => <Button key={mode} size="sm" variant={sort === mode ? 'default' : 'outline'} onClick={() => setSort(mode)} className={cn('h-8', sort === mode && 'font-bold')}>{mode === 'weight' ? '持倉比例' : mode === 'industry' ? '產業' : '幣別'}</Button>)}</div>
        {isLoading ? <div className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />載入訂閱持股</div> : null}
        {!isLoading && isError ? <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">訂閱資料讀取失敗，請稍後重試。</div> : null}
        {!isLoading && !isError && subscriptions.length === 0 ? <div className="rounded-md border border-border bg-muted/20 p-6 text-center"><p className="font-bold text-foreground">目前沒有有效訂閱</p><Button asChild className="mt-4"><Link to="/app/explore">探索老師</Link></Button></div> : null}
        <div className="space-y-6">{visible.map((sub) => <ExpertHoldings key={sub.expert_id} sub={sub} sort={sort} />)}</div>
      </main>
    </UnifiedAppLayout>
  );
}