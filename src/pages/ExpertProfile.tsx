import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { ShareButton } from '@/components/ShareButton';
import { buildOgCardUrl } from '@/lib/shareUrl';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle, ArrowRight, Shield, Clock, Check, Loader2, ArrowLeft, Target, TrendingUp, Award, Users, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarUrl } from '@/lib/imageTransform';
import { useExpertDetailBundle } from '@/hooks/useExpert';
import { ExpertFetchError } from '@/components/ExpertFetchError';
import { useEffect } from 'react';
import { track } from '@/lib/analytics/events';
import { preserveUtm, utmCampaignOf } from '@/lib/preserveUtm';
import {
  FUNNEL_ONE_LINER,
  CHECKUP_SECONDARY_CTA,
  DISCLAIMER_SHORT,
  PUBLISH_MECHANISM_TITLE,
  PUBLISH_MECHANISM_LINES,
  MENTOR_PLAN_COPY,
  publicSystemName,
  cadenceLabel,
} from '@/lib/complianceCopy';
import { DeliveryCards } from '@/pages/_expert/DeliveryCards';
import { SampleStructureCard } from '@/pages/_expert/SampleStructureCard';
import { FitCard } from '@/pages/_expert/FitCard';
import { StickyPlanCta } from '@/pages/_expert/StickyPlanCta';
import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';

const ExpertProfile = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, hasRole } = useAuth();
  const fromAccount = searchParams.get('from') === 'account';
  const fromExplore = searchParams.get('from') === 'explore';
  const search = searchParams.toString();
  const utmCampaign = utmCampaignOf(search);
  const funnelSource = searchParams.get('utm_source') || undefined;
  const isPreview = searchParams.get('preview') === '1' && (
    (user?.expertSlug && user.expertSlug === slug) || hasRole('company_admin')
  );

  // Single RPC bundle: expert + plans + subscriber count + my subscribed ids.
  const {
    data: bundle,
    isLoading: bundleLoading,
    isFetched: bundleFetched,
    isError: bundleError,
    error: bundleErrObj,
    refetch: refetchBundle,
    isRefetching: bundleRefetching,
  } = useExpertDetailBundle(slug);
  const expert = bundle?.expert ?? null;
  const dbPlans = expert?.plans ?? [];
  const subscribedPlanIds = bundle?.mySubscribedPlanIds ?? new Set<string>();
  const subscriberCount = bundle?.subscriberCount ?? null;

  const expertNotFound = bundleFetched && !expert;
  const loading = bundleLoading && !expert;

  useEffect(() => {
    if (expert?.id) {
      // 單一 profile view 事件（typed），帶漏斗來源；不再另發 raw 重複事件。
      track('expert_profile_view', {
        expert_slug: expert.slug,
        source: funnelSource,
        utm_campaign: utmCampaign,
      });
    }
  }, [expert?.id, expert?.slug, funnelSource, utmCampaign]);


  // Adapt `PersonWithPlans` → the panel/render shape this file used before.
  const expertInfo = expert
    ? {
        id: expert.id,
        name: expert.name,
        bio: expert.bio || '',
        description: expert.description || '',
        strategySummary: expert.strategySummary || '',
        strategyName: expert.strategyName || '',
        riskPreference: expert.riskPreference || '',
        operationCycle: expert.operationCycle || '',
        avatarUrl: expert.avatarUrl || '/placeholder.svg',
        assetClass: expert.assetClass ?? null,
        role: expert.role,
        styleTags: expert.styleTags || [],
        markets: expert.markets || [],
        backtestReturn1y: expert.backtestReturn1y ?? null,
        backtestMaxDrawdown: expert.backtestMaxDrawdown ?? null,
        backtestAnnualReturn: expert.backtestAnnualReturn ?? null,
        startingCapital: expert.startingCapital ?? null,
      }
    : null;


  // expertNotFound 只在 fetch 已完成且確實沒資料時才成立；fetch 失敗時走 error UI
  if (expertNotFound && !bundleError) {
    return (
      <PortalLayout hideAppEntry hideHeader={!!user}>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此專家</h1>
          <Button asChild><Link to="/experts">返回專家列表</Link></Button>
        </div>
      </PortalLayout>
    );
  }

  if (bundleError && !expertInfo) {
    const backTo = user ? '/app/explore' : '/experts';
    const backLabel = user ? '返回探索專家' : '返回專家列表';
    return (
      <PortalLayout hideAppEntry hideHeader={!!user}>
        <ExpertFetchError
          error={bundleErrObj}
          onRetry={() => refetchBundle()}
          isRetrying={bundleRefetching}
          onBack={() => navigate(backTo)}
          backLabel={backLabel}
        />
      </PortalLayout>
    );
  }

  if (!expertInfo || loading) {
    return (
      <PortalLayout hideAppEntry hideHeader={!!user}>
        <div className="container py-12 flex justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = expertInfo.role === 'advisor';
  const formatPrice = (price: number) => new Intl.NumberFormat('zh-TW').format(price);

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1': return ['即時訊號推播通知', '完整買賣理由說明', '風險與部位控管建議', '交易紀錄完整保存'];
      case 'analyst_signal_diag_l2': return ['等級 1 所有功能', '持股診斷報告', '個人化投資組合建議', '專屬風險評估'];
      case 'mentor_weekly_journal': return [...MENTOR_PLAN_COPY.features];
      default: return [];
    }
  };

  const getPlanLabel = (planType: string) => {
    switch (planType) {
      case 'analyst_signal_l1': return '即時訊號通知';
      case 'analyst_signal_diag_l2': return '訊號 + 持股健檢';
      case 'mentor_weekly_journal': return MENTOR_PLAN_COPY.label;
      default: return '';
    }
  };
  const getPlanNote = (planType: string) => planType === 'mentor_weekly_journal' ? MENTOR_PLAN_COPY.note : '包含具體買賣指示，屬投顧服務。';

  const defaultBack = user ? '/app/explore' : '/experts';
  const defaultBackLabel = user ? '返回探索專家' : '返回專家列表';
  const backButton = fromAccount
    ? <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/app/account')}><ArrowLeft className="h-4 w-4 mr-1" />返回帳號設定</Button>
    : fromExplore
      ? <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/app/explore')}><ArrowLeft className="h-4 w-4 mr-1" />返回探索專家</Button>
      : <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(defaultBack)}><ArrowLeft className="h-4 w-4 mr-1" />{defaultBackLabel}</Button>;

  return (
    <PortalLayout hideAppEntry hideHeader={!!user}>
      <SEO
        title={`${expertInfo?.name ?? '專家'} | legendflow`}
        description={(expertInfo?.bio || `${expertInfo?.name ?? '專家'} 的檔案、操作風格與訂閱方案。`).slice(0, 155)}
        path={`/expert/${slug}`}
        type="profile"
        image={slug ? buildOgCardUrl({ kind: 'expert', slug }) : undefined}
        jsonLd={expertInfo ? {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: expertInfo.name,
          jobTitle: expertInfo.role === 'mentor' ? '實戰導師' : '投顧分析師',
          description: expertInfo.bio || expertInfo.description,
          image: expertInfo.avatarUrl,
          url: `https://legendflow.tw/expert/${slug}`,
        } : undefined}
      />
      {isPreview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-50 px-4 py-2 text-sm flex items-center justify-center gap-3 shadow">
          <Eye className="h-4 w-4" />
          <span className="font-medium">🔍 訂閱者預覽模式</span>
          <span className="opacity-80 hidden sm:inline">此畫面僅自己可見，訂閱按鈕已停用</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-2 h-7 bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100"
            onClick={() => window.close()}
          >
            退出預覽
          </Button>
        </div>
      )}
      <div className="container py-8 md:py-12 space-y-12">
        {backButton}

        {/* ── Hero Section ── */}
        <section className="relative overflow-hidden rounded-2xl">
          <div className={cn(
            "absolute inset-0 opacity-[0.07]",
            isAdvisor ? "gradient-advisor" : "gradient-mentor"
          )} />
          <div className="relative px-6 py-10 md:px-10 md:py-14">
            <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
              <img
                src={avatarUrl(expertInfo.avatarUrl, 320)}
                alt={expertInfo.name}
                loading="eager"
                decoding="async"
                className={cn(
                  "shrink-0 h-32 w-32 md:h-40 md:w-40 rounded-2xl object-cover object-[center_15%] ring-4 shadow-xl",
                  isAdvisor ? "ring-advisor/30" : "ring-mentor/30"
                )}
              />
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-h2 md:text-h1">{expertInfo.name}</h1>
                  <RoleBadge role={expertInfo.role} size="lg" />
                  {slug && (
                    <ShareButton
                      target={{ kind: 'expert', slug }}
                      size="sm"
                      variant="outline"
                      label="分享"
                      shareTitle={`${expertInfo.name}｜legendflow`}
                      shareText={expertInfo.bio || ''}
                      className="ml-auto"
                    />
                  )}
                </div>
                <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
                  {expertInfo.bio}
                </p>
                {/* Quick Stats */}
                <div className="flex flex-wrap gap-4 pt-2">
                  {expertInfo.styleTags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-sm px-3 py-1">{tag}</Badge>
                  ))}
                  {expertInfo.markets.map(market => (
                    <Badge key={market} variant="outline" className="text-sm px-3 py-1">{market}</Badge>
                  ))}
                </div>
                {/* 一句交付 + 主／次 CTA（手機優先） */}
                <p className="text-base text-foreground/90 leading-relaxed max-w-2xl">{FUNNEL_ONE_LINER}</p>
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <Button
                    size="lg"
                    variant={isAdvisor ? ('advisor' as any) : ('mentor' as any)}
                    className="w-full sm:w-auto"
                    onClick={() => {
                      track('expert_subscribe_click', {
                        expert_slug: slug || '',
                        source: 'hero',
                        utm_campaign: utmCampaign,
                      });
                      document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    查看訂閱方案
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
                    <Link to={preserveUtm('/holding-checkup', search)}>{CHECKUP_SECONDARY_CTA}</Link>
                  </Button>
                </div>
                {/* Social Proof */}
                {subscriberCount !== null && subscriberCount > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                    <Users className="h-4 w-4" />
                    <span>已有 <strong className="text-foreground">{subscriberCount}</strong> 人訂閱</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>


        {/* ── 每週交付結構（結構樣本，非節錄） ── */}
        <section aria-label="每週交付">
          <div className="flex items-center gap-2 mb-6">
            <Clock className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">你每週會拿到什麼</h2>
          </div>
          <div className="space-y-4">
            <DeliveryCards
              expertSlug={slug || ''}
              cadence={cadenceLabel(expertInfo.assetClass)}
              utmCampaign={utmCampaign}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <SampleStructureCard expertSlug={slug || ''} utmCampaign={utmCampaign} />
              <FitCard
                riskPreference={expertInfo.riskPreference}
                operationCycle={expertInfo.operationCycle}
                styleTags={expertInfo.styleTags}
              />
            </div>
          </div>
        </section>

        {/* ── 策略簡介 Section ── */}
        {(expertInfo.styleTags.length > 0 || expertInfo.markets.length > 0 || expertInfo.riskPreference || expertInfo.operationCycle || expertInfo.strategyName || expertInfo.strategySummary) && (
          <section>
            <div className="flex items-center gap-2 mb-6">
              <Award className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
              <h2 className="text-h3">策略簡介</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {/* 投資風格 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-muted-foreground font-medium">投資風格</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {expertInfo.styleTags.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">風格標籤</div>
                      <div className="flex flex-wrap gap-1.5">
                        {expertInfo.styleTags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {expertInfo.markets.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">主要市場</div>
                      <div className="flex flex-wrap gap-1.5">
                        {expertInfo.markets.map(m => (
                          <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">風險偏好</div>
                      <div className="text-sm font-medium">{expertInfo.riskPreference || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">操作週期</div>
                      <div className="text-sm font-medium">{expertInfo.operationCycle || '—'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 交易系統 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-muted-foreground font-medium">交易系統</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className={cn(
                    "text-lg font-semibold",
                    publicSystemName(expertInfo.strategyName) === '尚未命名' && "text-muted-foreground",
                  )}>
                    {publicSystemName(expertInfo.strategyName)}
                  </div>
                  {expertInfo.strategySummary && (
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                      {expertInfo.strategySummary}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {/* ── Performance Section ── */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Target className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">績效總覽</h2>
          </div>
          <PerformanceOverviewPanel
            expertId={expertInfo.id}
            startingCapital={expertInfo.startingCapital}
            variant={isAdvisor ? 'advisor' : 'mentor'}
          />
        </section>


        {/* ── Plans Section ── */}
        <section id="plans" className="scroll-mt-20">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">訂閱方案</h2>
          </div>

          {dbPlans.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">目前尚無可訂閱的方案</CardContent></Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {dbPlans.map(plan => {
                const isSubscribed = subscribedPlanIds.has(plan.id);
                const isFollowerType = plan.planType !== 'mentor_weekly_journal';

                return (
                  <Card key={plan.id} className={cn(
                    "relative overflow-hidden border-2 transition-all",
                    isSubscribed
                      ? isFollowerType ? "border-advisor/40 bg-advisor/5" : "border-mentor/40 bg-mentor/5"
                      : isFollowerType ? "border-advisor/20 hover:border-advisor/40 hover:shadow-lg" : "border-mentor/20 hover:border-mentor/40 hover:shadow-lg"
                  )}>
                    <div className={cn("absolute top-0 left-0 right-0 h-1", isFollowerType ? "gradient-advisor" : "gradient-mentor")} />
                    {isSubscribed && (
                      <Badge className={cn("absolute top-3 right-3", isFollowerType ? "bg-advisor text-advisor-foreground" : "bg-mentor text-mentor-foreground")}>
                        <Check className="h-3 w-3 mr-1" />已訂閱
                      </Badge>
                    )}
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.planType === 'mentor_weekly_journal' ? MENTOR_PLAN_COPY.name : plan.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{getPlanLabel(plan.planType)}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {plan.planType !== 'mentor_weekly_journal' && plan.description && <p className="text-muted-foreground text-sm">{plan.description}</p>}
                      <ul className="space-y-2">
                        {(plan.planType === 'mentor_weekly_journal'
                          ? getPlanFeatures(plan.planType)
                          : Array.isArray(plan.features) && plan.features.filter((f: any) => typeof f === 'string' && f.trim()).length > 0
                          ? (plan.features as string[]).filter((f) => typeof f === 'string' && f.trim())
                          : getPlanFeatures(plan.planType)
                        ).map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm">
                            <CheckCircle className={cn("h-4 w-4 shrink-0", isFollowerType ? "text-advisor" : "text-mentor")} />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold">NT$ {formatPrice(plan.priceMonthly)}</span>
                        <span className="text-muted-foreground">/ 月</span>
                      </div>
                      {plan.priceYearly && (
                        <p className="text-xs text-muted-foreground line-through opacity-60">
                          年繳 NT$ {formatPrice(plan.priceYearly)}（省 {Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100)}%）── 尚未開放
                        </p>
                      )}
                      <div className={cn("flex items-start gap-2 p-3 rounded-lg text-sm", isFollowerType ? "bg-advisor/5 text-advisor" : "bg-mentor/5 text-mentor")}>
                        {isFollowerType ? <Shield className="h-4 w-4 mt-0.5 shrink-0" /> : <Clock className="h-4 w-4 mt-0.5 shrink-0" />}
                        <span>{getPlanNote(plan.planType)}</span>
                      </div>
                      {isSubscribed ? (
                        <Button variant="outline" className={cn("w-full", isFollowerType ? "border-advisor text-advisor hover:bg-advisor/10" : "border-mentor text-mentor hover:bg-mentor/10")} disabled>
                          <Check className="h-4 w-4 mr-1" />已訂閱
                        </Button>
                      ) : isPreview ? (
                        <Button variant={isFollowerType ? 'advisor' as any : 'mentor' as any} size="xl" className="w-full" disabled>
                          <Eye className="h-4 w-4 mr-1" />預覽模式：訂閱按鈕已停用
                        </Button>
                      ) : (
                        <Button variant={isFollowerType ? 'advisor' as any : 'mentor' as any} size="xl" className="w-full" asChild>
                          <Link
                            to={preserveUtm(`/checkout/${slug}/${plan.id}`, search)}
                            onClick={() => track('expert_subscribe_click', { expert_slug: slug || '', plan_id: plan.id, source: 'plan_card', utm_campaign: utmCampaign })}
                          >立即訂閱<ArrowRight className="h-4 w-4 ml-2" /></Link>
                        </Button>

                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 公開機制（中性敘述） ── */}
        <section aria-label={PUBLISH_MECHANISM_TITLE}>
          <div className="flex items-center gap-2 mb-4">
            <Shield className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">{PUBLISH_MECHANISM_TITLE}</h2>
          </div>
          <Card>
            <CardContent className="p-5 space-y-2 text-sm text-muted-foreground">
              {PUBLISH_MECHANISM_LINES.map((line) => <p key={line}>{line}</p>)}
            </CardContent>
          </Card>
        </section>

        {/* Compliance Disclaimer */}
        <div className="compliance-disclaimer">
          <p>{DISCLAIMER_SHORT}</p>
        </div>

        {/* 手機 sticky CTA 佔位，避免遮住頁尾 */}
        <div className="h-20 md:hidden" aria-hidden="true" />
      </div>
      {!isPreview && (
        <StickyPlanCta
          to={null}
          label="查看訂閱方案"
          variant={isAdvisor ? 'advisor' : 'mentor'}
          onClick={() => track('expert_subscribe_click', { expert_slug: slug || '', source: 'sticky', utm_campaign: utmCampaign })}
        />
      )}
    </PortalLayout>
  );
};

export default ExpertProfile;
