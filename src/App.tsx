import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CrmProvider } from "@/store/crm-store";
import { AppShell } from "@/components/layout/AppShell";
import Dashboard from "@/pages/Dashboard";
import Inbox from "@/pages/Inbox";
import Pipeline from "@/pages/Pipeline";
import Leads from "@/pages/Leads";
import LeadDetail from "@/pages/LeadDetail";
import Offers from "@/pages/Offers";
import OfferDetail from "@/pages/OfferDetail";
import Tasks from "@/pages/Tasks";
import Calendar from "@/pages/Calendar";
import Guests from "@/pages/Guests";
import GuestDetail from "@/pages/GuestDetail";
import Segments from "@/pages/Segments";
import Campaigns from "@/pages/Campaigns";
import SalesAnalytics from "@/pages/SalesAnalytics";
import SalesWorkspace from "@/pages/SalesWorkspace";
import Performance from "@/pages/Performance";
import FollowUp from "@/pages/FollowUp";
import Classification from "@/pages/Classification";
import DailyReport from "@/pages/DailyReport";
import Reports from "@/pages/Reports";
import ManagementReport from "@/pages/ManagementReport";
import Reputation from "@/pages/Reputation";
import Housekeeping from "@/pages/Housekeeping";
import Maintenance from "@/pages/Maintenance";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const AppRoutes = () => {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="leads" element={<Leads />} />
        <Route path="leads/:leadId" element={<LeadDetail />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/:offerId" element={<OfferDetail />} />
        <Route path="follow-up" element={<FollowUp />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="guests" element={<Guests />} />
        <Route path="guests/:guestId" element={<GuestDetail />} />
        <Route path="classification" element={<Classification />} />
        <Route path="segments" element={<Segments />} />
        <Route path="campaigns" element={<Campaigns />} />
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
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <CrmProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </CrmProvider>
  </QueryClientProvider>
);

export default App;
