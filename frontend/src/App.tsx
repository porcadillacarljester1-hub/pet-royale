import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAdminStore } from "@/store/adminStore";
import { useNotificationStore } from "@/store/notificationStore";
import { realtimeService } from "@/services/realtimeService";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Patients from "./pages/Clients";
import Billing from "./pages/Billing";
import Services from "./pages/Services";
import Supplies from "./pages/Supplies";
import PetEssentials from "./pages/PetEssentials";
import Reports from "./pages/Reports";
import StaffManagement from "./pages/StaffManagement";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import NotFound from "./pages/NotFound";

/* Two pages are gone from the routes:

   History      — its activity feed moved into Medical Records, which
                  was then folded into Patients. The route pointed at a
                  page listing the same visits Patients now shows.
   MedicalRecords — same story. It duplicated Patients' pet list with a
                  column Appointments already had.

   Both files can be deleted from src/pages. */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function SessionInitializer() {
  useEffect(() => {
    useAdminStore.getState().initialize();
  }, []);
  return null;
}

function ProtectedRoute({
  children, adminOnly = false,
}: { children: React.ReactNode; adminOnly?: boolean }) {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const initialized = useAdminStore((s) => s.initialized);
  const role = useAdminStore((s) => s.role);

  /* Wait for the session check before deciding. Without this, a page
     refresh bounces a signed-in user to /login for the moment before
     the session resolves. */
  if (!initialized) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[hsl(var(--background))]">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (adminOnly && role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RealtimeInitializer() {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const queryClient = useQueryClient();

  /* Depends on isLoggedIn alone.

     It used to also depend on soundEnabled and soundVolume, which meant
     every change to either tore down the realtime connection and rebuilt
     it — dropping subscriptions mid-session for a setting that had
     nothing to do with them. Notification sounds are gone, and so is
     the problem. */
  useEffect(() => {
    if (!isLoggedIn) {
      realtimeService.disconnect();
      return;
    }

    realtimeService.setQueryInvalidator((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
    realtimeService.init();

    // Browser notifications are separate from sound and stay.
    useNotificationStore.getState().requestPermission();

    return () => { realtimeService.disconnect(); };
  }, [isLoggedIn, queryClient]);

  return null;
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SessionInitializer />
        <RealtimeInitializer />

        <BrowserRouter>
          {/* Inside the router: a crash on one page keeps the URL, so
              reloading returns to the same screen rather than the
              dashboard. */}
          <ErrorBoundary>
            <Routes>
              {/* ── Public ── */}
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* ── Clinic ── */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/appointments" element={<ProtectedRoute><Appointments /></ProtectedRoute>} />
              <Route path="/clients" element={<ProtectedRoute><Patients /></ProtectedRoute>} />
              <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
              <Route path="/services" element={<ProtectedRoute><Services /></ProtectedRoute>} />
              <Route path="/supplies" element={<ProtectedRoute><Supplies /></ProtectedRoute>} />
              <Route path="/pet-essentials" element={<ProtectedRoute><PetEssentials /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

              {/* ── Admin only ── */}
              <Route path="/staff" element={<ProtectedRoute adminOnly><StaffManagement /></ProtectedRoute>} />

              {/* Old links to these still exist in bookmarks and in the
                notifications table. Redirect rather than 404. */}
              <Route path="/history" element={<Navigate to="/clients" replace />} />
              <Route path="/medical-records" element={<Navigate to="/clients" replace />} />

                <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
