import { useState, useMemo } from 'react';
import { SEO } from '@/components/SEO';
import { useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { ExpertCard } from '@/components/ExpertCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExpertRole } from '@/types';
import { Search, Filter, Shield, Clock } from 'lucide-react';
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
      <div className="container py-8 md:py-12">
        {/* Platform Intro */}
        <div className="mb-6 md:mb-8 p-4 md:p-6 bg-gradient-to-r from-primary/5 to-advisor/5 dark:from-primary/10 dark:to-advisor/10 rounded-2xl border dark:border-white/10">
          <div className="max-w-3xl">
            <h1 className="text-xl md:text-3xl font-bold mb-2">找到適合你的老師</h1>
            <p className="text-sm md:text-base text-muted-foreground dark:text-white/60 mb-3 leading-relaxed">
              {FUNNEL_ONE_LINER}
            </p>
            <p className="text-xs text-muted-foreground dark:text-white/50 mb-4">{DISCLAIMER_TEACHING}</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-advisor/10 dark:bg-advisor/20 dark:ring-1 dark:ring-advisor/30 shrink-0">
                  <Shield className="h-5 w-5 text-advisor" />
                </div>
                <div>
                  <p className="font-medium text-advisor">投顧分析師</p>
                  <p className="text-sm text-muted-foreground dark:text-white/60">持有合法執照，提供即時策略訊號與持股診斷</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mentor/10 dark:bg-mentor/20 dark:ring-1 dark:ring-mentor/30 shrink-0">
                  <Clock className="h-5 w-5 text-mentor" />
                </div>
                <div>
                  <p className="font-medium text-mentor">實戰導師</p>
                  <p className="text-sm text-muted-foreground dark:text-white/60">T+7 延遲修煉派週記，純教學用途，非投資建議</p>
                </div>
              </div>
            </div>
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
