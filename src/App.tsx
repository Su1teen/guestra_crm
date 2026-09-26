import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CrmProvider } from "@/store/crm-store";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import Today from "@/pages/Today";
import RequestsWorkspace from "@/pages/RequestsWorkspace";
import Reservations from "@/pages/Reservations";
import AnalyticsHub from "@/pages/AnalyticsHub";
import Inbox from "@/pages/Inbox";
import LeadDetail from "@/pages/LeadDetail";
import Offers from "@/pages/Offers";
import OfferDetail from "@/pages/OfferDetail";
import Tasks from "@/pages/Tasks";
import Guests from "@/pages/Guests";
import GuestDetail from "@/pages/GuestDetail";
import Segments from "@/pages/Segments";
import Campaigns from "@/pages/Campaigns";
import SalesAnalytics from "@/pages/SalesAnalytics";
import SalesWorkspace from "@/pages/SalesWorkspace";
import Performance from "@/pages/Performance";
import Classification from "@/pages/Classification";
import DailyReport from "@/pages/DailyReport";
import Reports from "@/pages/Reports";
import ManagementReport from "@/pages/ManagementReport";
import Reputation from "@/pages/Reputation";
import Housekeeping from "@/pages/Housekeeping";
import Maintenance from "@/pages/Maintenance";
import NotFound from "./pages/NotFound.tsx";
import Login from "@/pages/Login";
import { LoadingScreen } from "@/components/common/States";

const queryClient = new QueryClient();

const LegacyRedirect = ({ to, view }: { to: string; view?: string }) => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (view) params.set("view", view);
  return <Navigate to={`${to}${params.size ? `?${params}` : ""}`} replace />;
};

const AppRoutes = () => {
  const { status, user } = useAuth();
  if (status === "loading") return <LoadingScreen />;
  if (!user) return <Login />;
  return (
    <CrmProvider>
      <Routes>
        <Route element={<AppShell />}>
        <Route index element={<Today />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="requests" element={<RequestsWorkspace />} />
        <Route path="requests/:leadId" element={<LeadDetail />} />
        <Route path="pipeline" element={<LegacyRedirect to="/requests" view="board" />} />
        <Route path="leads" element={<LegacyRedirect to="/requests" />} />
        <Route path="leads/:leadId" element={<LeadDetail />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/:offerId" element={<OfferDetail />} />
        <Route path="follow-up" element={<LegacyRedirect to="/tasks" view="followups" />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<LegacyRedirect to="/tasks" view="calendar" />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="guests" element={<Guests />} />
        <Route path="guests/:guestId" element={<GuestDetail />} />
        <Route path="classification" element={<Classification />} />
        <Route path="segments" element={<Segments />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="analytics" element={<AnalyticsHub />} />
        <Route path="analytics/sales" element={<SalesWorkspace />} />
        <Route path="analytics/sales/legacy" element={<SalesAnalytics />} />
        <Route path="daily-report" element={<DailyReport />} />
        <Route path="analytics/performance" element={<Performance />} />
        <Route path="reports" element={<Reports />} />
        <Route path="management-report" element={<ManagementReport />} />
        <Route path="reputation" element={<Reputation />} />
        <Route path="housekeeping" element={<Housekeeping />} />
        <Route path="maintenance" element={<Maintenance />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CrmProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
