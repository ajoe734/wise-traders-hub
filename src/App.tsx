import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import AccountSubscriptions from "./pages/account/Subscriptions";
import AccountProfile from "./pages/account/Profile";

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

const queryClient = new QueryClient();

const App = () => (
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
            <Route path="/account/subscriptions" element={<AccountSubscriptions />} />
            <Route path="/account/profile" element={<AccountProfile />} />

            {/* LINE Mini-App (per expert) */}
            <Route path="/line/:expertSlug/home" element={<LineHome />} />
            <Route path="/line/:expertSlug/signals" element={<LineSignals />} />
            <Route path="/line/:expertSlug/signal/:signalId" element={<LineSignalDetail />} />
            <Route path="/line/:expertSlug/teaching" element={<LineTeaching />} />
            <Route path="/line/:expertSlug/trades" element={<LineTrades />} />
            <Route path="/line/:expertSlug/performance" element={<LinePerformance />} />
            <Route path="/line/:expertSlug/xai" element={<LineXai />} />
            <Route path="/line/:expertSlug/diagnosis" element={<LineDiagnosis />} />
            <Route path="/line/:expertSlug/account" element={<LineAccount />} />

            {/* Legacy /app routes - redirect to experts for now */}
            <Route path="/app" element={<Navigate to="/experts" replace />} />
            <Route path="/app/*" element={<Navigate to="/experts" replace />} />
            <Route path="/me" element={<Navigate to="/account/subscriptions" replace />} />
            <Route path="/me/*" element={<Navigate to="/account/subscriptions" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;