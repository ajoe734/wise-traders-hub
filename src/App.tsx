import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";

// 短連結重導（/s/:slug → /expert/:slug），方便寫在 IG bio。
const ShortExpertRedirect = () => {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/expert/${slug || ''}`} replace />;
};
import { ThemeProvider } from "next-themes";
import { lazy, Suspense, useEffect } from "react";
import { prefetchHighTrafficRoutes } from "@/lib/routePrefetch";
import { AuthProvider } from "@/contexts/AuthContext";
import { DisplayCurrencyProvider } from "@/contexts/DisplayCurrencyContext";
import { ViewAsProvider } from "@/contexts/ViewAsContext";
import { ViewAsBanner } from "@/components/ViewAsBanner";
import {
  queryClient,
  queryPersister,
  PERSISTED_QUERY_PREFIXES,
} from "@/lib/queryClient";

// Expose queryClient on window for E2E tests. Non-sensitive (no secrets),
// guarded behind a single namespaced key. Tests use this to trigger
// invalidateQueries from outside React without UI mutation hooks.
if (typeof window !== "undefined") {
  (window as unknown as { __lfQueryClient?: typeof queryClient }).__lfQueryClient = queryClient;
}

import { useSignalRealtimeInvalidation } from "@/hooks/useSignalRealtimeInvalidation";
import { useAttributionTracking } from "@/hooks/useAttributionTracking";
import { useAutoPageView } from "@/hooks/useAutoPageView";

// Index is eagerly imported — it's the highest-traffic route, so we skip
// the Suspense fallback round-trip to remove the initial loading spinner.
import Index from "./pages/Index";
import Legal from "./pages/Legal";
import DataSources from "./pages/DataSources";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RouteChunkBoundary } from "./components/RouteChunkBoundary";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SmartHomeRedirect } from "./components/SmartHomeRedirect";
import { ScrollToTop } from "./components/ScrollToTop";
import { PerfMetricsTracker } from "./components/PerfMetricsTracker";
import { PendingRemittanceGuard } from "./components/PendingRemittanceGuard";

// Portal pages (lazy)
const Experts = lazy(() => import("./pages/Experts"));
const ExpertProfile = lazy(() => import("./pages/ExpertProfile"));
const PlanDetail = lazy(() => import("./pages/PlanDetail"));
const Pricing = lazy(() => import("./pages/Pricing"));

const Checkout = lazy(() => import("./pages/Checkout"));
const CheckupCheckout = lazy(() => import("./pages/CheckupCheckout"));
const FreeCheckupPage = lazy(() => import("./pages/FreeCheckup"));
const HoldingCheckupDemoEntry = lazy(() => import("./pages/HoldingCheckupDemoEntry"));
const HoldingCardHarnessEntry = lazy(() => import("./pages/HoldingCardHarnessEntry"));
const RangeBandHarnessEntry = lazy(() => import("./pages/RangeBandHarnessEntry"));
const HoldingsTableTargetHarnessEntry = lazy(() => import("./pages/HoldingsTableTargetHarnessEntry"));
const HoldingsDetailPanelVolumeHarnessEntry = lazy(() => import("./pages/HoldingsDetailPanelVolumeHarnessEntry"));
const SignalEditorHarnessEntry = lazy(() => import("./pages/SignalEditorHarnessEntry"));
const EtfDisplayHarnessEntry = lazy(() => import("./pages/EtfDisplayHarnessEntry"));
const SignalPreviewHarnessEntry = lazy(() => import("./pages/SignalPreviewHarnessEntry"));
const SignalFocusHarnessEntry = lazy(() => import("./pages/SignalFocusHarnessEntry"));
const JournalPdfHarnessEntry = lazy(() => import("./pages/JournalPdfHarnessEntry"));
const NotificationLinkHarnessEntry = lazy(() => import("./pages/NotificationLinkHarnessEntry"));
const EarlyPublishCopyHarnessEntry = lazy(() => import("./pages/EarlyPublishCopyHarnessEntry"));
const JournalsExportHarnessEntry = lazy(() => import("./pages/JournalsExportHarnessEntry"));
const JournalsExportUIHarnessEntry = lazy(() => import("./pages/JournalsExportUIHarnessEntry"));
const JournalsExportHeaderDomHarnessEntry = lazy(() => import("./pages/JournalsExportHeaderDomHarnessEntry"));
const ChipsSectionHarnessEntry = lazy(() => import("./pages/ChipsSectionHarnessEntry"));
const JournalAuthoringHarnessEntry = lazy(() => import("./pages/JournalAuthoringHarnessEntry"));
const NotFound = lazy(() => import("./pages/NotFound"));

const CheckupModeProviderLazy = lazy(() =>
  import("./checkup/contexts/CheckupModeContext").then((m) => ({ default: m.CheckupModeProvider }))
);

// Checkup module pages (lazy)
const PortfolioLayout = lazy(() =>
  import("./checkup/pages/PortfolioLayout").then((m) => ({ default: m.PortfolioLayout }))
);
const HoldingsPage = lazy(() => import("./checkup/pages/HoldingsPage.jsx").then((m) => ({ default: m.HoldingsPage })));
const EventsPage = lazy(() => import("./checkup/pages/EventsPage.jsx").then((m) => ({ default: m.EventsPage })));
const DailyPage = lazy(() => import("./checkup/pages/DailyPage.jsx").then((m) => ({ default: m.DailyPage })));
const ResearchPage = lazy(() => import("./checkup/pages/ResearchPage.jsx").then((m) => ({ default: m.ResearchPage })));
const TradePage = lazy(() => import("./checkup/pages/TradePage.jsx").then((m) => ({ default: m.TradePage })));
const LogPage = lazy(() => import("./checkup/pages/LogPage.jsx").then((m) => ({ default: m.LogPage })));
const NewsPage = lazy(() => import("./checkup/pages/NewsPage.jsx").then((m) => ({ default: m.NewsPage })));
const OverviewPage = lazy(() => import("./checkup/pages/OverviewPage.jsx").then((m) => ({ default: m.OverviewPage })));

// Auth pages (lazy)
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const LineCallback = lazy(() => import("./pages/auth/LineCallback"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const OAuthConsent = lazy(() => import("./pages/auth/OAuthConsent"));

// Account pages
const AccountProfile = lazy(() => import("./pages/account/Profile"));
const MyRemittanceOrders = lazy(() => import("./pages/account/MyRemittanceOrders"));
const AccountNotifications = lazy(() => import("./pages/account/Notifications"));

// App pages
const AppHome = lazy(() => import("./pages/app/AppHome"));
const AppSignals = lazy(() => import("./pages/app/Signals"));
const AppJournals = lazy(() => import("./pages/app/Journals"));
const AppSignalDetail = lazy(() => import("./pages/app/SignalDetail"));
const AppJournalDetail = lazy(() => import("./pages/app/JournalDetail"));
const AppAccount = lazy(() => import("./pages/app/Account"));
const AppExplore = lazy(() => import("./pages/app/Explore"));
const AppExpertDetail = lazy(() => import("./pages/app/ExpertDetail"));
const AppCheckout = lazy(() => import("./pages/app/AppCheckout"));
const AppSubscriptions = lazy(() => import("./pages/app/SubscribedExpertsList"));

// Admin pages
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminSignals = lazy(() => import("./pages/admin/Signals"));
const AdminSignalEditor = lazy(() => import("./pages/admin/SignalEditor"));
const AdminSubscribers = lazy(() => import("./pages/admin/Subscribers"));
const AdminProfile = lazy(() => import("./pages/admin/Profile"));
const AdminPerformance = lazy(() => import("./pages/admin/Performance"));
const AdminReasonTemplates = lazy(() => import("./pages/admin/ReasonTemplates"));
const AdminSignalTemplates = lazy(() => import("./pages/admin/SignalTemplates"));
const AdminAnnouncements = lazy(() => import("./pages/admin/Announcements"));
const AdminPlans = lazy(() => import("./pages/admin/Plans"));
const AdminAiStudio = lazy(() => import("./pages/admin/AiStudio"));

// Company pages
const CompanyDashboard = lazy(() => import("./pages/company/Dashboard"));
const CompanyAnalysts = lazy(() => import("./pages/company/Analysts"));
const CompanySubscribers = lazy(() => import("./pages/company/Subscribers"));
const CompanyLinePushHistory = lazy(() => import("./pages/company/LinePushHistory"));
const CompanyRevenue = lazy(() => import("./pages/company/Revenue"));
const CompanyPayments = lazy(() => import("./pages/company/Payments"));
const CompanyAnnouncements = lazy(() => import("./pages/company/Announcements"));
const CompanyAuditLogs = lazy(() => import("./pages/company/AuditLogs"));
const CompanyAccountMerges = lazy(() => import("./pages/company/AccountMerges"));
const CompanySystemJobs = lazy(() => import("./pages/company/SystemJobs"));
const CompanyFunctionLogs = lazy(() => import("./pages/company/FunctionLogs"));
const CompanyPublishBatchStatus = lazy(() => import("./pages/company/PublishBatchStatus"));
const CompanyBsrFailures = lazy(() => import("./pages/company/BsrFailureDashboard"));
const CompanyBsrEffect = lazy(() => import("./pages/company/BsrEffectAnalysis"));
const CompanyBsrTimeline = lazy(() => import("./pages/company/BsrStockTimeline"));
const CompanyBsrBackfill = lazy(() => import("./pages/company/BsrBackfillProgress"));
const CompanyBsrConfig = lazy(() => import("./pages/company/BsrSyncConfig"));
const CompanyBsrOcrMetrics = lazy(() => import("./pages/company/BsrOcrMetrics"));
const CompanyBsrRateLimit = lazy(() => import("./pages/company/BsrRateLimit"));
const CompanyKnowledgeBase = lazy(() => import("./pages/company/KnowledgeBase"));
const CompanyKnowledgeAudit = lazy(() => import("./pages/company/knowledge-base/KnowledgeAudit"));
const CompanyKnowledgeScheduler = lazy(() => import("./pages/company/knowledge-base/KnowledgeScheduler"));
const CompanyBacktestMonitor = lazy(() => import("./pages/company/BacktestMonitor"));
const CompanyPlans = lazy(() => import("./pages/company/Plans"));
const CompanyRemittance = lazy(() => import("./pages/company/Remittance"));
const CompanyPaymentSettings = lazy(() => import("./pages/company/PaymentSettings"));
const CompanyReferralChannels = lazy(() => import("./pages/company/ReferralChannels"));
const CompanyCheckupUsage = lazy(() => import("./pages/company/CheckupUsage"));
const CompanyCheckupQuotaAudit = lazy(() => import("./pages/company/CheckupQuotaAudit"));
const CompanyMissingPrices = lazy(() => import("./pages/company/MissingPrices"));
const CompanyMetaOverrides = lazy(() => import("./pages/company/MetaOverrides"));
const CompanyHoldingsConsistency = lazy(() => import("./pages/company/HoldingsConsistency"));
const CompanySignalDupeAudit = lazy(() => import("./pages/company/SignalDupeAudit"));
const CompanyUsers = lazy(() => import("./pages/company/Users"));
const CompanyMembers = lazy(() => import("./pages/company/Members"));
const ViewAsEntry = lazy(() => import("./pages/app/ViewAsEntry"));
const CompanyPerfMetrics = lazy(() => import("./pages/company/PerfMetrics"));
const CompanyCurrencyDiagnostics = lazy(() => import("./pages/company/CurrencyDiagnostics"));
const CompanyStreamHealth = lazy(() => import("./pages/company/StreamHealth"));
const CompanyStreamHealthTrace = lazy(() => import("./pages/company/StreamHealthTrace"));
const CompanyTraffic = lazy(() => import("./pages/company/Traffic"));
const CompanyOpsHealth = lazy(() => import("./pages/company/OpsHealth"));
const CompanyPaywallAnalytics = lazy(() => import("./pages/company/PaywallAnalytics"));
const CompanyFunnelAnalytics = lazy(() => import("./pages/company/FunnelAnalytics"));
const CompanyConversionCenter = lazy(() => import("./pages/company/ConversionCenter"));
const CompanyUserJourney = lazy(() => import("./pages/company/UserJourney"));
const CompanyAlerts = lazy(() => import("./pages/company/Alerts"));
const CompanyRoasLtv = lazy(() => import("./pages/company/RoasLtv"));
const CompanyAdSpend = lazy(() => import("./pages/company/AdSpend"));
const CompanyExpertRevenue = lazy(() => import("./pages/company/ExpertRevenue"));
const CompanyExpertAiAccessLogs = lazy(() => import("./pages/company/ExpertAiAccessLogs"));
const CompanyAiGatewayUsage = lazy(() => import("./pages/company/AiGatewayUsage"));
const CompanyJournalsExport = lazy(() => import("./pages/company/JournalsExport"));

const RealtimeBridge = () => {
  useSignalRealtimeInvalidation();
  return null;
};

const persistOptions = queryPersister
  ? {
      persister: queryPersister,
      maxAge: 24 * 60 * 60 * 1000, // 24h
      buster: "v1",
      dehydrateOptions: {
        shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) => {
          const head = query.queryKey?.[0];
          return (
            typeof head === "string" &&
            (PERSISTED_QUERY_PREFIXES as readonly string[]).includes(head)
          );
        },
      },
    }
  : null;

const AttributionTracker = () => {
  useAttributionTracking();
  useAutoPageView();
  useEffect(() => {
    prefetchHighTrafficRoutes();
    // Delegated CTA click tracking — fires `home_cta_click` (or data-cta-event)
    // for any element bearing `data-cta` across the app.
    import('@/lib/analytics/ctaClickListener').then(m => m.installCtaClickListener()).catch(() => {});
  }, []);
  return null;
};

const LegacyFreeCheckupRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/holding-checkup${location.search}${location.hash}`} replace />;
};

const LegacyCheckoutRedirect = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const planId = params.get('plan');

  if (!slug || !planId) {
    return <Navigate to="/app/account" replace />;
  }

  params.delete('plan');
  const nextSearch = params.toString();
  return (
    <Navigate
      to={`/app/checkout/${slug}/${planId}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`}
      replace
    />
  );
};

const RouteFallback = () => (
  <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
  </div>
);

const AppShell = () => (
  <AuthProvider>
    <DisplayCurrencyProvider>
    <RealtimeBridge />
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ViewAsProvider>
          <ViewAsBanner />
          <RouteChunkBoundary>
          <AttributionTracker />
          <ScrollToTop />
          <PerfMetricsTracker />
          <PendingRemittanceGuard />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/app/view-as" element={<ViewAsEntry />} />
            {/* Portal (public) */}
            <Route path="/" element={<SmartHomeRedirect><Index /></SmartHomeRedirect>} />
            <Route path="/experts" element={<Experts />} />
            <Route path="/expert/:slug" element={<ExpertProfile />} />
            {/* 短連結（IG bio 友善）：/s/:slug → /expert/:slug */}
            <Route path="/s/:slug" element={<ShortExpertRedirect />} />
            <Route path="/plan/:slug/:planId" element={<PlanDetail />} />
            <Route path="/checkout/:slug/:planId" element={<Checkout />} />
            <Route path="/:slug/checkout" element={<LegacyCheckoutRedirect />} />
            <Route path="/checkout/checkup/:planId" element={<CheckupCheckout />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/holding-checkup" element={<CheckupModeProviderLazy><FreeCheckupPage /></CheckupModeProviderLazy>} />
            {/* Dev/Preview-only demo entry — gated by hostname inside the component. */}
            <Route path="/holding-checkup-demo" element={<HoldingCheckupDemoEntry />} />
            <Route path="/e2e/holding-card-harness" element={<HoldingCardHarnessEntry />} />
            <Route path="/e2e/range-band-harness" element={<RangeBandHarnessEntry />} />
            <Route path="/e2e/holdings-table-target-harness" element={<HoldingsTableTargetHarnessEntry />} />
            <Route path="/e2e/holdings-detail-panel-volume" element={<HoldingsDetailPanelVolumeHarnessEntry />} />
            <Route path="/e2e/signal-editor-harness" element={<SignalEditorHarnessEntry />} />
            <Route path="/e2e/etf-display-harness" element={<EtfDisplayHarnessEntry />} />
            <Route path="/e2e/signal-preview-harness" element={<SignalPreviewHarnessEntry />} />
            <Route path="/e2e/signal-focus-harness" element={<SignalFocusHarnessEntry />} />
            <Route path="/e2e/journal-pdf-harness" element={<JournalPdfHarnessEntry />} />
            <Route path="/e2e/notification-link-harness" element={<NotificationLinkHarnessEntry />} />
            <Route path="/e2e/early-publish-copy-harness" element={<EarlyPublishCopyHarnessEntry />} />
            <Route path="/e2e/journals-export-harness" element={<JournalsExportHarnessEntry />} />
            <Route path="/e2e/journals-export-ui-harness" element={<JournalsExportUIHarnessEntry />} />
            <Route path="/e2e/journals-export-header-dom" element={<JournalsExportHeaderDomHarnessEntry />} />
            <Route path="/e2e/chips-section" element={<ChipsSectionHarnessEntry />} />
            <Route path="/e2e/journal-authoring-harness" element={<JournalAuthoringHarnessEntry />} />
            <Route path="/free-checkup" element={<LegacyFreeCheckupRedirect />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/data-sources" element={<DataSources />} />


            {/* Checkup portfolio routes */}
            <Route path="/portfolio/:portfolioId" element={<PortfolioLayout />}>
              <Route index element={<HoldingsPage />} />
              <Route path="holdings" element={<HoldingsPage />} />
              <Route path="watchlist" element={<Navigate to="../holdings" replace />} />
              <Route path="events" element={<EventsPage />} />
              <Route path="news" element={<NewsPage />} />
              <Route path="daily" element={<DailyPage />} />
              <Route path="research" element={<ResearchPage />} />
              <Route path="trade" element={<TradePage />} />
              <Route path="log" element={<LogPage />} />
            </Route>
            <Route path="/overview" element={<PortfolioLayout />}>
              <Route index element={<OverviewPage />} />
            </Route>

            {/* Legacy routes - redirect */}
            <Route path="/explore" element={<Navigate to="/experts" replace />} />
            <Route path="/people/:slug" element={<Navigate to="/experts" replace />} />

            {/* Auth */}
            <Route path="/auth/login" element={<Login />} />
            <Route path="/auth/register" element={<Register />} />
            <Route path="/auth/line-callback" element={<LineCallback />} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

            {/* Account */}
            <Route path="/account/subscriptions" element={<Navigate to="/app/account" replace />} />
            <Route path="/account/profile" element={<ProtectedRoute><AccountProfile /></ProtectedRoute>} />
            <Route path="/account/remittance" element={<ProtectedRoute><MyRemittanceOrders /></ProtectedRoute>} />
            <Route path="/account/notifications" element={<ProtectedRoute><AccountNotifications /></ProtectedRoute>} />

            {/* App pages */}
            <Route path="/app" element={<ProtectedRoute subscriberOnly><AppHome /></ProtectedRoute>} />
            <Route path="/app/signals" element={<ProtectedRoute subscriberOnly><AppSignals /></ProtectedRoute>} />
            <Route path="/app/journals" element={<ProtectedRoute subscriberOnly><AppJournals /></ProtectedRoute>} />
            <Route path="/app/signal/:id" element={<ProtectedRoute subscriberOnly><AppSignalDetail /></ProtectedRoute>} />
            <Route path="/app/journal/:id" element={<ProtectedRoute subscriberOnly><AppJournalDetail /></ProtectedRoute>} />
            <Route path="/app/account" element={<ProtectedRoute subscriberOnly><AppAccount /></ProtectedRoute>} />
            <Route path="/app/holdings" element={<Navigate to="/app" replace />} />
            <Route path="/app/explore" element={<ProtectedRoute subscriberOnly><AppExplore /></ProtectedRoute>} />
            <Route path="/app/expert/:slug" element={<ProtectedRoute subscriberOnly><AppExpertDetail /></ProtectedRoute>} />
            <Route path="/app/checkout/:slug/:planId" element={<ProtectedRoute subscriberOnly><AppCheckout /></ProtectedRoute>} />
            <Route path="/app/subscriptions" element={<ProtectedRoute subscriberOnly><AppSubscriptions /></ProtectedRoute>} />
            <Route path="/app/system/:id" element={<Navigate to="/app" replace />} />

            {/* Company */}
            <Route path="/company" element={<ProtectedRoute requiredRole="company_admin"><CompanyDashboard /></ProtectedRoute>} />
            <Route path="/company/members" element={<ProtectedRoute requiredRole="company_admin"><CompanyMembers /></ProtectedRoute>} />
            <Route path="/company/users" element={<ProtectedRoute requiredRole="company_admin"><CompanyUsers /></ProtectedRoute>} />
            <Route path="/company/analysts" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnalysts /></ProtectedRoute>} />
            <Route path="/company/journals-export" element={<ProtectedRoute requiredRole="company_admin"><CompanyJournalsExport /></ProtectedRoute>} />
            <Route path="/company/subscribers" element={<ProtectedRoute requiredRole="company_admin"><CompanySubscribers /></ProtectedRoute>} />
            <Route path="/company/line-push-history" element={<ProtectedRoute requiredRole="company_admin"><CompanyLinePushHistory /></ProtectedRoute>} />
            <Route path="/company/revenue" element={<ProtectedRoute requiredRole="company_admin"><CompanyRevenue /></ProtectedRoute>} />
            <Route path="/company/payments" element={<ProtectedRoute requiredRole="company_admin"><CompanyPayments /></ProtectedRoute>} />
            <Route path="/company/announcements" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnnouncements /></ProtectedRoute>} />
            <Route path="/company/audit-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyAuditLogs /></ProtectedRoute>} />
            <Route path="/company/account-merges" element={<ProtectedRoute requiredRole="company_admin"><CompanyAccountMerges /></ProtectedRoute>} />
            <Route path="/company/system-jobs" element={<ProtectedRoute requiredRole="company_admin"><CompanySystemJobs /></ProtectedRoute>} />
            <Route path="/company/function-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyFunctionLogs /></ProtectedRoute>} />
            <Route path="/company/publish-batch-status" element={<ProtectedRoute requiredRole="company_admin"><CompanyPublishBatchStatus /></ProtectedRoute>} />
            <Route path="/company/knowledge-base" element={<ProtectedRoute requiredRole="company_admin"><CompanyKnowledgeBase /></ProtectedRoute>} />
            <Route path="/company/knowledge-audit" element={<ProtectedRoute requiredRole="company_admin"><CompanyKnowledgeAudit /></ProtectedRoute>} />
            <Route path="/company/knowledge-scheduler" element={<ProtectedRoute requiredRole="company_admin"><CompanyKnowledgeScheduler /></ProtectedRoute>} />
            <Route path="/company/backtest-monitor" element={<ProtectedRoute requiredRole="company_admin"><CompanyBacktestMonitor /></ProtectedRoute>} />
            <Route path="/company/plans" element={<ProtectedRoute requiredRole="company_admin"><CompanyPlans /></ProtectedRoute>} />
            <Route path="/company/plan-review" element={<Navigate to="/company/plans" replace />} />
            <Route path="/company/plan-splits" element={<Navigate to="/company/plans" replace />} />
            <Route path="/company/remittance" element={<ProtectedRoute requiredRole="company_admin"><CompanyRemittance /></ProtectedRoute>} />
            <Route path="/company/payment-settings" element={<ProtectedRoute requiredRole="company_admin"><CompanyPaymentSettings /></ProtectedRoute>} />
            <Route path="/company/referral-channels" element={<ProtectedRoute requiredRole="company_admin"><CompanyReferralChannels /></ProtectedRoute>} />
            <Route path="/company/checkup-usage" element={<ProtectedRoute requiredRole="company_admin"><CompanyCheckupUsage /></ProtectedRoute>} />
            <Route path="/company/checkup-quota-audit" element={<ProtectedRoute requiredRole="company_admin"><CompanyCheckupQuotaAudit /></ProtectedRoute>} />
            <Route path="/company/holdings-consistency" element={<ProtectedRoute requiredRole="company_admin"><CompanyHoldingsConsistency /></ProtectedRoute>} />
            <Route path="/company/signal-dupe-audit" element={<ProtectedRoute requiredRole="company_admin"><CompanySignalDupeAudit /></ProtectedRoute>} />
            <Route path="/company/missing-prices" element={<ProtectedRoute requiredRole="company_admin"><CompanyMissingPrices /></ProtectedRoute>} />
            <Route path="/company/meta-overrides" element={<ProtectedRoute requiredRole="company_admin"><CompanyMetaOverrides /></ProtectedRoute>} />
            <Route path="/company/perf-metrics" element={<ProtectedRoute requiredRole="company_admin"><CompanyPerfMetrics /></ProtectedRoute>} />
            <Route path="/company/currency-diagnostics" element={<ProtectedRoute requiredRole="company_admin"><CompanyCurrencyDiagnostics /></ProtectedRoute>} />
            <Route path="/company/stream-health" element={<ProtectedRoute requiredRole="company_admin"><CompanyStreamHealth /></ProtectedRoute>} />
            <Route path="/company/stream-health/trace" element={<ProtectedRoute requiredRole="company_admin"><CompanyStreamHealthTrace /></ProtectedRoute>} />
            <Route path="/company/traffic" element={<ProtectedRoute requiredRole="company_admin"><CompanyTraffic /></ProtectedRoute>} />
            <Route path="/company/ops-health" element={<ProtectedRoute requiredRole="company_admin"><CompanyOpsHealth /></ProtectedRoute>} />
            <Route path="/company/bsr-failures" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrFailures /></ProtectedRoute>} />
            <Route path="/company/bsr-effect" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrEffect /></ProtectedRoute>} />
            <Route path="/company/bsr-timeline" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrTimeline /></ProtectedRoute>} />
            <Route path="/company/bsr-backfill" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrBackfill /></ProtectedRoute>} />
            <Route path="/company/bsr-config" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrConfig /></ProtectedRoute>} />
            <Route path="/company/bsr-ocr-metrics" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrOcrMetrics /></ProtectedRoute>} />
            <Route path="/company/bsr-rate-limit" element={<ProtectedRoute requiredRole="company_admin"><CompanyBsrRateLimit /></ProtectedRoute>} />

            <Route path="/company/paywall-analytics" element={<ProtectedRoute requiredRole="company_admin"><CompanyPaywallAnalytics /></ProtectedRoute>} />
            <Route path="/company/funnel-analytics" element={<ProtectedRoute requiredRole="company_admin"><CompanyFunnelAnalytics /></ProtectedRoute>} />
            <Route path="/company/conversions" element={<ProtectedRoute requiredRole="company_admin"><CompanyConversionCenter /></ProtectedRoute>} />
            <Route path="/company/user-journey/:userId" element={<ProtectedRoute requiredRole="company_admin"><CompanyUserJourney /></ProtectedRoute>} />
            <Route path="/company/alerts" element={<ProtectedRoute requiredRole="company_admin"><CompanyAlerts /></ProtectedRoute>} />
            <Route path="/company/roas-ltv" element={<ProtectedRoute requiredRole="company_admin"><CompanyRoasLtv /></ProtectedRoute>} />
            <Route path="/company/ad-spend" element={<ProtectedRoute requiredRole="company_admin"><CompanyAdSpend /></ProtectedRoute>} />
            <Route path="/company/expert-revenue" element={<ProtectedRoute requiredRole="company_admin"><CompanyExpertRevenue /></ProtectedRoute>} />
            <Route path="/company/expert-ai-access-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyExpertAiAccessLogs /></ProtectedRoute>} />
            <Route path="/company/ai-gateway-usage" element={<ProtectedRoute requiredRole="company_admin"><CompanyAiGatewayUsage /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin/:expertSlug" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signals" element={<ProtectedRoute><AdminSignals /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signals/new" element={<ProtectedRoute><AdminSignalEditor /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signals/edit/:batchId" element={<ProtectedRoute><AdminSignalEditor /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/plans" element={<ProtectedRoute><AdminPlans /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/subscribers" element={<ProtectedRoute><AdminSubscribers /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/profile" element={<ProtectedRoute><AdminProfile /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/performance" element={<ProtectedRoute><AdminPerformance /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/reason-templates" element={<ProtectedRoute><AdminReasonTemplates /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signal-templates" element={<ProtectedRoute><AdminSignalTemplates /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/announcements" element={<ProtectedRoute><AdminAnnouncements /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/ai-studio" element={<ProtectedRoute><AdminAiStudio /></ProtectedRoute>} />

            {/* Legacy /me routes */}
            <Route path="/me" element={<Navigate to="/app/account" replace />} />
            <Route path="/me/*" element={<Navigate to="/app/account" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </RouteChunkBoundary>
        </ViewAsProvider>
      </BrowserRouter>
    </TooltipProvider>
    </DisplayCurrencyProvider>
  </AuthProvider>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <AppErrorBoundary>
      {persistOptions ? (
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AppShell />
        </PersistQueryClientProvider>
      ) : (
        <QueryClientProvider client={queryClient}>
          <AppShell />
        </QueryClientProvider>
      )}
    </AppErrorBoundary>
  </ThemeProvider>
);

export default App;
