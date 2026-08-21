import { useState, useMemo } from 'react';
import { SEO } from '@/components/SEO';
import { useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { ExpertCard } from '@/components/ExpertCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExpertRole } from '@/types';
import { Search, Filter, Shield, Clock, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useExperts } from '@/hooks/useExpert';
import { ExpertFetchError } from '@/components/ExpertFetchError';
import { Loader2 } from 'lucide-react';
import { track } from '@/lib/analytics/events';
import { FUNNEL_ONE_LINER, DISCLAIMER_TEACHING } from '@/lib/complianceCopy';

const Experts = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const roleFilter = searchParams.get('role') as 'advisor' | 'coach' | null;
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<string | null>(null);

  const { data: allPeople = [], isLoading, isError, error, refetch, isRefetching } = useExperts();

  const filteredPeople = useMemo(() => {
    const filtered = allPeople.filter(person => {
      if (roleFilter === 'advisor' && person.role !== 'advisor') return false;
      if (roleFilter === 'coach' && person.role !== 'mentor') return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = person.name.toLowerCase().includes(query);
        const matchesBio = person.bio.toLowerCase().includes(query);
        const matchesTags = person.styleTags.some(tag => tag.toLowerCase().includes(query));
        if (!matchesName && !matchesBio && !matchesTags) return false;
      }

      if (marketFilter && !person.markets.includes(marketFilter)) return false;

      return true;
    });

    return filtered;
  }, [allPeople, roleFilter, searchQuery, marketFilter]);

  const setRole = (role: 'advisor' | 'coach' | null) => {
    track('experts_filter_change', { dimension: 'role', value: role ?? 'all' });
    if (role) {
      setSearchParams({ role });
    } else {
      setSearchParams({});
    }
  };

  const markets = ['台股', '美股'];

  return (
    <PortalLayout>
      <SEO
        title="專家列表 | 投顧分析師與實戰導師 - legendflow"
        description="瀏覽合法持照投顧分析師與實戰導師。比較風格標籤、專長市場、訂閱方案，找到最適合你的專家。"
        path="/experts"
      />
      <div className="container py-4 md:py-12">
        {/* Compact hero */}
        <div className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-3xl font-bold mb-1.5">找到適合你的老師</h1>
          <p className="text-sm md:text-base text-muted-foreground dark:text-white/60 leading-relaxed">
            {FUNNEL_ONE_LINER}
          </p>
          <p className="text-xs text-muted-foreground dark:text-white/50 mt-1">{DISCLAIMER_TEACHING}</p>
        </div>

        {/* Role disclosure（mobile 預設收合） */}
        <Collapsible open={rolesOpen} onOpenChange={setRolesOpen} className="mb-4 md:mb-6">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid="roles-disclosure-trigger"
              className="flex w-full items-center justify-between rounded-xl border dark:border-white/10 px-4 py-2.5 text-sm font-medium hover:bg-muted/40"
            >
              <span>角色與服務差異</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', rolesOpen && 'rotate-180')} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent data-testid="roles-disclosure-content">
            <div className="grid sm:grid-cols-2 gap-4 rounded-xl border border-t-0 dark:border-white/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-advisor/10 dark:bg-advisor/20 dark:ring-1 dark:ring-advisor/30 shrink-0">
                  <Shield className="h-4 w-4 text-advisor" />
                </div>
                <div>
                  <p className="font-medium text-advisor">投顧分析師</p>
                  <p className="text-sm text-muted-foreground dark:text-white/60">持有合法執照，提供即時策略訊號與持股診斷。</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mentor/10 dark:bg-mentor/20 dark:ring-1 dark:ring-mentor/30 shrink-0">
                  <Clock className="h-4 w-4 text-mentor" />
                </div>
                <div>
                  <p className="font-medium text-mentor">實戰導師</p>
                  <p className="text-sm text-muted-foreground dark:text-white/60">每週固定週次公開當週操作復盤與下週觀察框架；教學研究用途，非買賣建議。</p>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Filters */}
        <div className="space-y-3 mb-5 md:mb-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋名稱、風格標籤..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant={roleFilter === null ? 'default' : 'outline'} size="sm" onClick={() => setRole(null)}>全部</Button>
            <Button variant={roleFilter === 'advisor' ? 'advisor' : 'outline'} size="sm" onClick={() => setRole('advisor')} className={cn(roleFilter !== 'advisor' && "hover:border-advisor hover:text-advisor")}>只看投顧分析師</Button>
            <Button variant={roleFilter === 'coach' ? 'mentor' : 'outline'} size="sm" onClick={() => setRole('coach')} className={cn(roleFilter !== 'coach' && "hover:border-mentor hover:text-mentor")}>只看實戰導師</Button>
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground mr-1">市場：</span>
            <Button variant={marketFilter === null ? 'secondary' : 'ghost'} size="sm" onClick={() => { track('experts_filter_change', { dimension: 'market', value: 'all' }); setMarketFilter(null); }}>全部</Button>
            {markets.map(market => (
              <Button key={market} variant={marketFilter === market ? 'secondary' : 'ghost'} size="sm" onClick={() => { track('experts_filter_change', { dimension: 'market', value: market }); setMarketFilter(market); }}>{market}</Button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-4 mb-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋名稱、風格標籤..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant={roleFilter === null ? 'default' : 'outline'} size="sm" onClick={() => setRole(null)}>全部</Button>
            <Button variant={roleFilter === 'advisor' ? 'advisor' : 'outline'} size="sm" onClick={() => setRole('advisor')} className={cn(roleFilter !== 'advisor' && "hover:border-advisor hover:text-advisor")}>只看投顧分析師</Button>
            <Button variant={roleFilter === 'coach' ? 'mentor' : 'outline'} size="sm" onClick={() => setRole('coach')} className={cn(roleFilter !== 'coach' && "hover:border-mentor hover:text-mentor")}>只看實戰導師</Button>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground mr-2">市場：</span>
            <Button variant={marketFilter === null ? 'secondary' : 'ghost'} size="sm" onClick={() => { track('experts_filter_change', { dimension: 'market', value: 'all' }); setMarketFilter(null); }}>全部</Button>
            {markets.map(market => (
              <Button key={market} variant={marketFilter === market ? 'secondary' : 'ghost'} size="sm" onClick={() => { track('experts_filter_change', { dimension: 'market', value: market }); setMarketFilter(market); }}>{market}</Button>
            ))}
          </div>
        </div>

        {/* Results */}
        {isError && allPeople.length > 0 && (
          <div className="mb-4">
            <ExpertFetchError variant="inline" error={error} onRetry={() => refetch()} isRetrying={isRefetching} />
          </div>
        )}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError && allPeople.length === 0 ? (
          <ExpertFetchError error={error} onRetry={() => refetch()} isRetrying={isRefetching} />
        ) : filteredPeople.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPeople.map(person => (
              <ExpertCard key={person.id} person={person} source="experts_list" />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">沒有找到符合條件的專家</p>
            <Button variant="outline" className="mt-4" onClick={() => { setSearchQuery(''); setMarketFilter(null); setSearchParams({}); }}>
              清除篩選條件
            </Button>
          </div>
        )}

        <div className="mt-12 compliance-disclaimer">
          <p>過去績效不代表未來表現，投資有風險，請謹慎評估。投顧分析師服務依相關法令辦理；實戰導師內容僅供教學參考，不構成投資建議。</p>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Experts;
