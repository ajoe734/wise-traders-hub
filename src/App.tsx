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
import AppSystemDetail from "./pages/app/SystemDetail";
import AppAccount from "./pages/app/Account";
// Holdings page removed - integrated into AppHome
import AppPerformance from "./pages/app/Performance";
import AppCourses from "./pages/app/Courses";
import AppLibrary from "./pages/app/Library";
import AppExplore from "./pages/app/Explore";
import AppExpertDetail from "./pages/app/ExpertDetail";
import AppCheckout from "./pages/app/AppCheckout";


// Admin pages (expert backend)
import AdminDashboard from "./pages/admin/Dashboard";
import AdminSignals from "./pages/admin/Signals";
import AdminSubscribers from "./pages/admin/Subscribers";
import AdminProfile from "./pages/admin/Profile";
import AdminPerformance from "./pages/admin/Performance";

// LINE Mini-App pages (per expert)
import LineHome from "./pages/line/Home";
import LineSignals from "./pages/line/Signals";
import LineSignalDetail from "./pages/line/SignalDetail";
import LineTeaching from "./pages/line/Teaching";
import LineTrades from "./pages/line/Trades";
import LinePerformance from "./pages/line/Performance";
import LineXai from "./pages/line/Xai";
import LineDiagnosis from "./pages/line/Diagnosis";
import LineAccount from "./pages/line/Account";
import LineHistory from "./pages/line/History";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
        <BrowserRouter>
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
            <Route path="/account/profile" element={<AccountProfile />} />

            {/* App pages (aggregated member view) */}
            <Route path="/app" element={<AppHome />} />
            
            <Route path="/app/signals" element={<AppSignals />} />
            <Route path="/app/journals" element={<AppJournals />} />
            <Route path="/app/signal/:id" element={<AppSignalDetail />} />
            <Route path="/app/journal/:id" element={<AppJournalDetail />} />
            <Route path="/app/system/:id" element={<AppSystemDetail />} />
            <Route path="/app/account" element={<AppAccount />} />
            {/* Signals Mode pages */}
            <Route path="/app/holdings" element={<Navigate to="/app" replace />} />
            <Route path="/app/performance" element={<AppPerformance />} />
            {/* Learning Mode pages */}
            <Route path="/app/courses" element={<AppCourses />} />
            <Route path="/app/library" element={<AppLibrary />} />
            {/* Explore page */}
            <Route path="/app/explore" element={<AppExplore />} />
            <Route path="/app/expert/:slug" element={<AppExpertDetail />} />
            <Route path="/app/checkout/:slug/:planId" element={<AppCheckout />} />

            {/* Admin (expert backend) */}
            <Route path="/admin/:expertSlug" element={<AdminDashboard />} />
            <Route path="/admin/:expertSlug/signals" element={<AdminSignals />} />
            <Route path="/admin/:expertSlug/subscribers" element={<AdminSubscribers />} />
            <Route path="/admin/:expertSlug/profile" element={<AdminProfile />} />
            <Route path="/admin/:expertSlug/performance" element={<AdminPerformance />} />

            {/* LINE Mini-App (per expert) */}
            <Route path="/line/:expertSlug" element={<Navigate to="home" replace />} />
            <Route path="/line/:expertSlug/home" element={<LineHome />} />
            <Route path="/line/:expertSlug/signals" element={<LineSignals />} />
            <Route path="/line/:expertSlug/signal/:signalId" element={<LineSignalDetail />} />
            <Route path="/line/:expertSlug/teaching" element={<LineTeaching />} />
            <Route path="/line/:expertSlug/trades" element={<LineTrades />} />
            <Route path="/line/:expertSlug/performance" element={<LinePerformance />} />
            <Route path="/line/:expertSlug/xai" element={<LineXai />} />
            <Route path="/line/:expertSlug/diagnosis" element={<LineDiagnosis />} />
            <Route path="/line/:expertSlug/history" element={<LineHistory />} />
            <Route path="/line/:expertSlug/account" element={<LineAccount />} />

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
