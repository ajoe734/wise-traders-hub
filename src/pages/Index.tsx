import { SEOLite as SEO } from '@/components/SEOLite';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { HeroSection } from '@/pages/_index/HeroSection';
import { ThreeMovesSection } from '@/pages/_index/ThreeMovesSection';
import { JianghuFactionsSection } from '@/pages/_index/JianghuFactionsSection';
import { WarRoomSection } from '@/pages/_index/WarRoomSection';
import { LeaderboardSection } from '@/pages/_index/LeaderboardSection';
import { StockDashboardSection } from '@/pages/_index/StockDashboardSection';
import { HowItWorksSection } from '@/pages/_index/HowItWorksSection';
import { FinalCtaSection } from '@/pages/_index/FinalCtaSection';

// Batch1-#2: idle prefetch moved to centralized prefetchHighTrafficRoutes()
// in src/lib/routePrefetch.ts (invoked from AttributionTracker in App.tsx).

const Index = () => {
  return (
    <PortalLayout>
      <SEO
        title="legendflow | 投顧分析師與實戰導師訂閱平台"
        description="專業投顧分析師即時策略訊號 × 實戰導師 T+7 教學週記。穩健、合規、教育為先，幫助投資人建立屬於自己的投資系統。"
        path="/"
      />
      <HeroSection />
      <ThreeMovesSection />
      <JianghuFactionsSection />
      <WarRoomSection />
      <LeaderboardSection />
      <StockDashboardSection />
      <HowItWorksSection />
      <FinalCtaSection />
    </PortalLayout>
  );
};

export default Index;
