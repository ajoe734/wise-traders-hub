import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import {
  queryClient,
  queryPersister,
  PERSISTED_QUERY_PREFIXES,
} from "@/lib/queryClient";
import { useSignalRealtimeInvalidation } from "@/hooks/useSignalRealtimeInvalidation";
import { useAttributionTracking } from "@/hooks/useAttributionTracking";

// Portal pages
import Index from "./pages/Index";
import Experts from "./pages/Experts";
import ExpertProfile from "./pages/ExpertProfile";
import PlanDetail from "./pages/PlanDetail";
import Pricing from "./pages/Pricing";
import Legal from "./pages/Legal";
import Checkout from "./pages/Checkout";
import CheckupCheckout from "./pages/CheckupCheckout";
import FreeCheckupPage from "./pages/FreeCheckup";
import { CheckupModeProvider } from "./checkup/contexts/CheckupModeContext";

import NotFound from "./pages/NotFound";

// Checkup module pages
import { PortfolioLayout } from "./checkup/pages/PortfolioLayout";
import {
  HoldingsPage,
  EventsPage,
  DailyPage,
  ResearchPage,
  TradePage,
  LogPage,
  NewsPage,
  OverviewPage,
} from "./checkup/pages/index.js";

// Auth pages
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import LineCallback from "./pages/auth/LineCallback";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

// Account pages
import AccountProfile from "./pages/account/Profile";
import MyRemittanceOrders from "./pages/account/MyRemittanceOrders";

// App pages (aggregated member view)
import AppHome from "./pages/app/AppHome";
import AppSignals from "./pages/app/Signals";
import AppJournals from "./pages/app/Journals";
import AppSignalDetail from "./pages/app/SignalDetail";
import AppJournalDetail from "./pages/app/JournalDetail";
import AppAccount from "./pages/app/Account";

import AppExplore from "./pages/app/Explore";
import AppExpertDetail from "./pages/app/ExpertDetail";
import AppCheckout from "./pages/app/AppCheckout";

// Admin pages (expert backend)
import AdminDashboard from "./pages/admin/Dashboard";
import AdminSignals from "./pages/admin/Signals";
import AdminSignalEditor from "./pages/admin/SignalEditor";
import AdminSubscribers from "./pages/admin/Subscribers";
import AdminProfile from "./pages/admin/Profile";
import AdminPerformance from "./pages/admin/Performance";
import AdminReasonTemplates from "./pages/admin/ReasonTemplates";
import AdminSignalTemplates from "./pages/admin/SignalTemplates";
import AdminAnnouncements from "./pages/admin/Announcements";
import AdminPlans from "./pages/admin/Plans";

// Company pages (internal backend)
import CompanyDashboard from "./pages/company/Dashboard";
import CompanyAnalysts from "./pages/company/Analysts";
import CompanySubscribers from "./pages/company/Subscribers";
import CompanyRevenue from "./pages/company/Revenue";

import CompanyPayments from "./pages/company/Payments";

import CompanyAnnouncements from "./pages/company/Announcements";
import CompanyAuditLogs from "./pages/company/AuditLogs";
import CompanySystemJobs from "./pages/company/SystemJobs";
import CompanyFunctionLogs from "./pages/company/FunctionLogs";
import CompanyKnowledgeBase from "./pages/company/KnowledgeBase";
import CompanyPlans from "./pages/company/Plans";
import CompanyRemittance from "./pages/company/Remittance";
import CompanyPaymentSettings from "./pages/company/PaymentSettings";
import CompanyReferralChannels from "./pages/company/ReferralChannels";
import CompanyCheckupUsage from "./pages/company/CheckupUsage";
import CompanyMissingPrices from "./pages/company/MissingPrices";
import CompanyMetaOverrides from "./pages/company/MetaOverrides";
import AccountNotifications from "./pages/account/Notifications";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { SmartHomeRedirect } from "./components/SmartHomeRedirect";
import { ScrollToTop } from "./components/ScrollToTop";
import { PendingRemittanceGuard } from "./components/PendingRemittanceGuard";

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
          <Routes>
            {/* Portal (public) */}
            <Route path="/" element={<SmartHomeRedirect><Index /></SmartHomeRedirect>} />
            <Route path="/experts" element={<Experts />} />
            <Route path="/expert/:slug" element={<ExpertProfile />} />
            <Route path="/plan/:slug/:planId" element={<PlanDetail />} />
            <Route path="/checkout/:slug/:planId" element={<Checkout />} />
            <Route path="/checkout/checkup/:planId" element={<CheckupCheckout />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/free-checkup" element={<CheckupModeProvider><FreeCheckupPage /></CheckupModeProvider>} />
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

            {/* Account (aggregated view) */}
            <Route path="/account/subscriptions" element={<Navigate to="/app/account" replace />} />
            <Route path="/account/profile" element={<ProtectedRoute><AccountProfile /></ProtectedRoute>} />
            <Route path="/account/remittance" element={<ProtectedRoute><MyRemittanceOrders /></ProtectedRoute>} />
            <Route path="/account/notifications" element={<ProtectedRoute><AccountNotifications /></ProtectedRoute>} />

            {/* App pages (aggregated member view) */}
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
            {/* SystemDetail removed - no trading_systems table */}
            <Route path="/app/system/:id" element={<Navigate to="/app" replace />} />

            {/* Company (internal backend) */}
            <Route path="/company" element={<ProtectedRoute requiredRole="company_admin"><CompanyDashboard /></ProtectedRoute>} />
            <Route path="/company/analysts" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnalysts /></ProtectedRoute>} />
            <Route path="/company/subscribers" element={<ProtectedRoute requiredRole="company_admin"><CompanySubscribers /></ProtectedRoute>} />
            <Route path="/company/revenue" element={<ProtectedRoute requiredRole="company_admin"><CompanyRevenue /></ProtectedRoute>} />
            
            <Route path="/company/payments" element={<ProtectedRoute requiredRole="company_admin"><CompanyPayments /></ProtectedRoute>} />
            
            <Route path="/company/announcements" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnnouncements /></ProtectedRoute>} />
            <Route path="/company/audit-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyAuditLogs /></ProtectedRoute>} />
            <Route path="/company/system-jobs" element={<ProtectedRoute requiredRole="company_admin"><CompanySystemJobs /></ProtectedRoute>} />
            <Route path="/company/function-logs" element={<ProtectedRoute requiredRole="company_admin"><CompanyFunctionLogs /></ProtectedRoute>} />
            <Route path="/company/knowledge-base" element={<ProtectedRoute requiredRole="company_admin"><CompanyKnowledgeBase /></ProtectedRoute>} />
            <Route path="/company/plans" element={<ProtectedRoute requiredRole="company_admin"><CompanyPlans /></ProtectedRoute>} />
            {/* Legacy routes — redirect to unified plan management */}
            <Route path="/company/plan-review" element={<Navigate to="/company/plans" replace />} />
            <Route path="/company/plan-splits" element={<Navigate to="/company/plans" replace />} />
            <Route path="/company/remittance" element={<ProtectedRoute requiredRole="company_admin"><CompanyRemittance /></ProtectedRoute>} />
            <Route path="/company/payment-settings" element={<ProtectedRoute requiredRole="company_admin"><CompanyPaymentSettings /></ProtectedRoute>} />
            <Route path="/company/referral-channels" element={<ProtectedRoute requiredRole="company_admin"><CompanyReferralChannels /></ProtectedRoute>} />
            <Route path="/company/checkup-usage" element={<ProtectedRoute requiredRole="company_admin"><CompanyCheckupUsage /></ProtectedRoute>} />
            <Route path="/company/missing-prices" element={<ProtectedRoute requiredRole="company_admin"><CompanyMissingPrices /></ProtectedRoute>} />
            <Route path="/company/meta-overrides" element={<ProtectedRoute requiredRole="company_admin"><CompanyMetaOverrides /></ProtectedRoute>} />

            {/* Admin (expert backend) */}
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

            {/* Legacy /me routes - redirect */}
            <Route path="/me" element={<Navigate to="/app/account" replace />} />
            <Route path="/me/*" element={<Navigate to="/app/account" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
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
