import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { ExpertCard } from '@/components/ExpertCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getAllPeopleWithPlans } from '@/data/mockData';
import { PersonRole } from '@/types';
import { Search, Filter, Shield, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const Experts = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const roleFilter = searchParams.get('role') as 'advisor' | 'coach' | null;
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<string | null>(null);

  const allPeople = getAllPeopleWithPlans();

  const filteredPeople = useMemo(() => {
    return allPeople.filter(person => {
      // Role filter
      if (roleFilter === 'advisor' && person.role !== PersonRole.ADVISOR) return false;
      if (roleFilter === 'coach' && person.role !== PersonRole.MENTOR) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = person.name.toLowerCase().includes(query);
        const matchesBio = person.bio.toLowerCase().includes(query);
        const matchesTags = person.styleTags.some(tag => tag.toLowerCase().includes(query));
        if (!matchesName && !matchesBio && !matchesTags) return false;
      }

      // Market filter
      if (marketFilter && !person.markets.includes(marketFilter)) return false;

      return true;
    });
  }, [allPeople, roleFilter, searchQuery, marketFilter]);

  const setRole = (role: 'advisor' | 'coach' | null) => {
    if (role) {
      setSearchParams({ role });
    } else {
      setSearchParams({});
    }
  };

  const markets = ['台股', '美股'];

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Platform Intro */}
        <div className="mb-8 p-6 bg-gradient-to-r from-primary/5 to-advisor/5 rounded-2xl border">
          <div className="max-w-3xl">
            <h1 className="text-2xl md:text-3xl font-bold mb-3">找到適合你的專家</h1>
            <p className="text-muted-foreground mb-4">
              穩健、風險控管、教育為先。我們提供兩種服務路線：
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-advisor/10 shrink-0">
                  <Shield className="h-5 w-5 text-advisor" />
                </div>
                <div>
                  <p className="font-medium text-advisor">投顧分析師</p>
                  <p className="text-sm text-muted-foreground">持有合法執照，提供即時策略訊號與持股診斷</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mentor/10 shrink-0">
                  <Clock className="h-5 w-5 text-mentor" />
                </div>
                <div>
                  <p className="font-medium text-mentor">實戰導師</p>
                  <p className="text-sm text-muted-foreground">T+7 延遲實戰週記，純教學用途，非投資建議</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-4 mb-8">
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋名稱、風格標籤..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Role Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={roleFilter === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRole(null)}
            >
              全部
            </Button>
            <Button
              variant={roleFilter === 'advisor' ? 'advisor' : 'outline'}
              size="sm"
              onClick={() => setRole('advisor')}
              className={cn(
                roleFilter !== 'advisor' && "hover:border-advisor hover:text-advisor"
              )}
            >
              只看投顧分析師
            </Button>
            <Button
              variant={roleFilter === 'coach' ? 'mentor' : 'outline'}
              size="sm"
              onClick={() => setRole('coach')}
              className={cn(
                roleFilter !== 'coach' && "hover:border-mentor hover:text-mentor"
              )}
            >
              只看實戰導師
            </Button>
          </div>

          {/* Market Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground mr-2">市場：</span>
            <Button
              variant={marketFilter === null ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMarketFilter(null)}
            >
              全部
            </Button>
            {markets.map(market => (
              <Button
                key={market}
                variant={marketFilter === market ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setMarketFilter(market)}
              >
                {market}
              </Button>
            ))}
          </div>
        </div>

        {/* Results */}
        {filteredPeople.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPeople.map(person => (
              <ExpertCard key={person.id} person={person} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">沒有找到符合條件的專家</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setSearchQuery('');
                setMarketFilter(null);
                setSearchParams({});
              }}
            >
              清除篩選條件
            </Button>
          </div>
        )}

        {/* Compliance Note */}
        <div className="mt-12 compliance-disclaimer">
          <p>
            過去績效不代表未來表現，投資有風險，請謹慎評估。
            投顧分析師服務依相關法令辦理；實戰導師內容僅供教學參考，不構成投資建議。
          </p>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Experts;