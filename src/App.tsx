import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import NotFound from "./pages/NotFound.tsx";
import SteppeHotelCRM from "./pages/SteppeHotelCRM.tsx";

const queryClient = new QueryClient();

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<SteppeHotelCRM />} />
      <Route path="/cosmonaut/*" element={<SteppeHotelCRM />} />
      <Route path="/b2b/*" element={<SteppeHotelCRM />} />
      <Route path="/steppe/*" element={<SteppeHotelCRM />} />
      {/* CATCH-ALL ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
