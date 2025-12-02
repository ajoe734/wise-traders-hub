import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";

// Portal pages
import Index from "./pages/Index";
import Explore from "./pages/Explore";
import PersonProfile from "./pages/PersonProfile";
import Pricing from "./pages/Pricing";
import Legal from "./pages/Legal";
import Checkout from "./pages/Checkout";
import NotFound from "./pages/NotFound";

// Auth pages
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";

// App pages (member area)
import AppHome from "./pages/app/AppHome";
import Signals from "./pages/app/Signals";
import SignalDetail from "./pages/app/SignalDetail";
import Journals from "./pages/app/Journals";
import JournalDetail from "./pages/app/JournalDetail";
import SystemDetail from "./pages/app/SystemDetail";
import Account from "./pages/app/Account";

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
            <Route path="/explore" element={<Explore />} />
            <Route path="/people/:slug" element={<PersonProfile />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/checkout/:planId" element={<Checkout />} />

            {/* Auth */}
            <Route path="/auth/login" element={<Login />} />
            <Route path="/auth/register" element={<Register />} />

            {/* Member App */}
            <Route path="/app" element={<AppHome />} />
            <Route path="/app/signals" element={<Signals />} />
            <Route path="/app/signal/:id" element={<SignalDetail />} />
            <Route path="/app/journals" element={<Journals />} />
            <Route path="/app/journal/:id" element={<JournalDetail />} />
            <Route path="/app/system/:id" element={<SystemDetail />} />
            <Route path="/app/account" element={<Account />} />

            {/* Desktop member center - redirect to app for now */}
            <Route path="/me" element={<AppHome />} />
            <Route path="/me/subscriptions" element={<AppHome />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
