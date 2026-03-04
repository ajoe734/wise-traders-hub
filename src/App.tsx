import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";

// Portal pages
import Index from "./pages/Index";
import Experts from "./pages/Experts";
import ExpertProfile from "./pages/ExpertProfile";
import PlanDetail from "./pages/PlanDetail";
import Pricing from "./pages/Pricing";
import Legal from "./pages/Legal";
import Checkout from "./pages/Checkout";
import NotFound from "./pages/NotFound";

// Auth pages
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";

// Account pages
import AccountProfile from "./pages/account/Profile";

// App pages (aggregated member view)
import AppHome from "./pages/app/AppHome";
import AppSignals from "./pages/app/Signals";
import AppJournals from "./pages/app/Journals";
import AppSignalDetail from "./pages/app/SignalDetail";
import AppJournalDetail from "./pages/app/JournalDetail";
import AppAccount from "./pages/app/Account";
import AppPerformance from "./pages/app/Performance";
import AppExplore from "./pages/app/Explore";
import AppExpertDetail from "./pages/app/ExpertDetail";
import AppCheckout from "./pages/app/AppCheckout";

// Admin pages (expert backend)
import AdminDashboard from "./pages/admin/Dashboard";
import AdminSignals from "./pages/admin/Signals";
import AdminSubscribers from "./pages/admin/Subscribers";
import AdminProfile from "./pages/admin/Profile";
import AdminPerformance from "./pages/admin/Performance";
import AdminReasonTemplates from "./pages/admin/ReasonTemplates";
import AdminSignalTemplates from "./pages/admin/SignalTemplates";

// Company pages (internal backend)
import CompanyDashboard from "./pages/company/Dashboard";
import CompanyAnalysts from "./pages/company/Analysts";
import CompanySubscribers from "./pages/company/Subscribers";
import CompanyRevenue from "./pages/company/Revenue";
import CompanyReview from "./pages/company/Review";
import CompanyPayments from "./pages/company/Payments";

import CompanyAnnouncements from "./pages/company/Announcements";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { ScrollToTop } from "./components/ScrollToTop";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            {/* Portal (public) */}
            <Route path="/" element={<Index />} />
            <Route path="/experts" element={<Experts />} />
            <Route path="/expert/:slug" element={<ExpertProfile />} />
            <Route path="/plan/:slug/:planId" element={<PlanDetail />} />
            <Route path="/checkout/:slug/:planId" element={<Checkout />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/legal" element={<Legal />} />

            {/* Legacy routes - redirect */}
            <Route path="/explore" element={<Navigate to="/experts" replace />} />
            <Route path="/people/:slug" element={<Navigate to="/experts" replace />} />

            {/* Auth */}
            <Route path="/auth/login" element={<Login />} />
            <Route path="/auth/register" element={<Register />} />

            {/* Account (aggregated view) */}
            <Route path="/account/subscriptions" element={<Navigate to="/app/account" replace />} />
            <Route path="/account/profile" element={<ProtectedRoute><AccountProfile /></ProtectedRoute>} />

            {/* App pages (aggregated member view) */}
            <Route path="/app" element={<AppHome />} />
            <Route path="/app/signals" element={<AppSignals />} />
            <Route path="/app/journals" element={<AppJournals />} />
            <Route path="/app/signal/:id" element={<AppSignalDetail />} />
            <Route path="/app/journal/:id" element={<AppJournalDetail />} />
            <Route path="/app/account" element={<AppAccount />} />
            <Route path="/app/holdings" element={<Navigate to="/app" replace />} />
            <Route path="/app/performance" element={<AppPerformance />} />
            <Route path="/app/explore" element={<AppExplore />} />
            <Route path="/app/expert/:slug" element={<AppExpertDetail />} />
            <Route path="/app/checkout/:slug/:planId" element={<AppCheckout />} />
            {/* SystemDetail removed - no trading_systems table */}
            <Route path="/app/system/:id" element={<Navigate to="/app" replace />} />

            {/* Company (internal backend) */}
            <Route path="/company" element={<ProtectedRoute requiredRole="company_admin"><CompanyDashboard /></ProtectedRoute>} />
            <Route path="/company/analysts" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnalysts /></ProtectedRoute>} />
            <Route path="/company/subscribers" element={<ProtectedRoute requiredRole="company_admin"><CompanySubscribers /></ProtectedRoute>} />
            <Route path="/company/revenue" element={<ProtectedRoute requiredRole="company_admin"><CompanyRevenue /></ProtectedRoute>} />
            <Route path="/company/review" element={<ProtectedRoute requiredRole="company_admin"><CompanyReview /></ProtectedRoute>} />
            <Route path="/company/payments" element={<ProtectedRoute requiredRole="company_admin"><CompanyPayments /></ProtectedRoute>} />
            
            <Route path="/company/announcements" element={<ProtectedRoute requiredRole="company_admin"><CompanyAnnouncements /></ProtectedRoute>} />

            {/* Admin (expert backend) */}
            <Route path="/admin/:expertSlug" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signals" element={<ProtectedRoute><AdminSignals /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/subscribers" element={<ProtectedRoute><AdminSubscribers /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/profile" element={<ProtectedRoute><AdminProfile /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/performance" element={<ProtectedRoute><AdminPerformance /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/reason-templates" element={<ProtectedRoute><AdminReasonTemplates /></ProtectedRoute>} />
            <Route path="/admin/:expertSlug/signal-templates" element={<ProtectedRoute><AdminSignalTemplates /></ProtectedRoute>} />

            {/* Legacy /me routes - redirect */}
            <Route path="/me" element={<Navigate to="/account/subscriptions" replace />} />
            <Route path="/me/*" element={<Navigate to="/account/subscriptions" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
