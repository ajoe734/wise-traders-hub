import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import {
  queryClient,
  queryPersister,
  PERSISTED_QUERY_PREFIXES,
} from "@/lib/queryClient";
import { useSignalRealtimeInvalidation } from "@/hooks/useSignalRealtimeInvalidation";
import { useAttributionTracking } from "@/hooks/useAttributionTracking";

// All route components are lazy-loaded so the initial bundle stays small
const Index = lazy(() => import("./pages/Index"));
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SmartHomeRedirect } from "./components/SmartHomeRedirect";
import { ScrollToTop } from "./components/ScrollToTop";
import { PendingRemittanceGuard } from "./components/PendingRemittanceGuard";

// Portal pages (lazy)
const Experts = lazy(() => import("./pages/Experts"));
const ExpertProfile = lazy(() => import("./pages/ExpertProfile"));
const PlanDetail = lazy(() => import("./pages/PlanDetail"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Legal = lazy(() => import("./pages/Legal"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckupCheckout = lazy(() => import("./pages/CheckupCheckout"));
const FreeCheckupPage = lazy(() => import("./pages/FreeCheckup"));
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

// Company pages
const CompanyDashboard = lazy(() => import("./pages/company/Dashboard"));
const CompanyAnalysts = lazy(() => import("./pages/company/Analysts"));
const CompanySubscribers = lazy(() => import("./pages/company/Subscribers"));
const CompanyRevenue = lazy(() => import("./pages/company/Revenue"));
const CompanyPayments = lazy(() => import("./pages/company/Payments"));
const CompanyAnnouncements = lazy(() => import("./pages/company/Announcements"));
const CompanyAuditLogs = lazy(() => import("./pages/company/AuditLogs"));
const CompanySystemJobs = lazy(() => import("./pages/company/SystemJobs"));
const CompanyFunctionLogs = lazy(() => import("./pages/company/FunctionLogs"));
const CompanyKnowledgeBase = lazy(() => import("./pages/company/KnowledgeBase"));
const CompanyKnowledgeAudit = lazy(() => import("./pages/company/knowledge-base/KnowledgeAudit"));
const CompanyKnowledgeScheduler = lazy(() => import("./pages/company/knowledge-base/KnowledgeScheduler"));
const CompanyBacktestMonitor = lazy(() => import("./pages/company/BacktestMonitor"));
const CompanyPlans = lazy(() => import("./pages/company/Plans"));
const CompanyRemittance = lazy(() => import("./pages/company/Remittance"));
const CompanyPaymentSettings = lazy(() => import("./pages/company/PaymentSettings"));
const CompanyReferralChannels = lazy(() => import("./pages/company/ReferralChannels"));
const CompanyCheckupUsage = lazy(() => import("./pages/company/CheckupUsage"));
const CompanyMissingPrices = lazy(() => import("./pages/company/MissingPrices"));
const CompanyMetaOverrides = lazy(() => import("./pages/company/MetaOverrides"));
const CompanyUsers = lazy(() => import("./pages/company/Users"));

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
  return null;
};

const RouteFallback = () => (
  <div style={{ minHeight: "60vh" }} aria-busy="true" />
);

const AppShell = () => (
  <AuthProvider>
    <RealtimeBridge />
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
          <AttributionTracker />
          <ScrollToTop />
          <PendingRemittanceGuard />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Portal (public) */}
            <Route path="/" element={<SmartHomeRedirect><Index /></SmartHomeRedirect>} />
            <Route path="/experts" element={<Experts />} />
            <Route path="/expert/:slug" element={<ExpertProfile />} />
            <Route path="/plan/:slug/:planId" element={<PlanDetail />} />
            <Route path="/checkout/:slug/:planId" element={<Checkout />} />
            <Route path="/checkout/checkup/:planId" element={<CheckupCheckout />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/free-checkup" element={<CheckupModeProviderLazy><FreeCheckupPage /></CheckupModeProviderLazy>} />
            <Route path="/legal" element={<Legal />} />

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
            <Route path="/app/system/:id" element={<Navigate to="/app" replace />} />

            {/* Company */}
            <Route path="/company" element={<ProtectedRoute requiredRole="company_admin"><CompanyDashboard /></ProtectedRoute>} />
            <Route path="/company/users" element={<ProtectedRoute requiredRole="company_admin"><CompanyUsers /></ProtectedRoute>} />
            <Route path="/company/analysts" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnalysts /></ProtectedRoute>} />
            <Route path="/company/subscribers" element={<ProtectedRoute requiredRole="company_admin"><CompanySubscribers /></ProtectedRoute>} />
            <Route path="/company/revenue" element={<ProtectedRoute requiredRole="company_admin"><CompanyRevenue /></ProtectedRoute>} />
            <Route path="/company/payments" element={<ProtectedRoute requiredRole="company_admin"><CompanyPayments /></ProtectedRoute>} />
            <Route path="/company/announcements" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnnouncements /></ProtectedRoute>} />
            <Route path="/company/audit-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyAuditLogs /></ProtectedRoute>} />
            <Route path="/company/system-jobs" element={<ProtectedRoute requiredRole="company_admin"><CompanySystemJobs /></ProtectedRoute>} />
            <Route path="/company/function-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyFunctionLogs /></ProtectedRoute>} />
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
            <Route path="/company/missing-prices" element={<ProtectedRoute requiredRole="company_admin"><CompanyMissingPrices /></ProtectedRoute>} />
            <Route path="/company/meta-overrides" element={<ProtectedRoute requiredRole="company_admin"><CompanyMetaOverrides /></ProtectedRoute>} />

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

            {/* Legacy /me routes */}
            <Route path="/me" element={<Navigate to="/app/account" replace />} />
            <Route path="/me/*" element={<Navigate to="/app/account" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </AuthProvider>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    {persistOptions ? (
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <AppShell />
      </PersistQueryClientProvider>
    ) : (
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    )}
  </ThemeProvider>
);

export default App;
