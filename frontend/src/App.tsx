import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAdminStore } from "@/store/adminStore";
import { useNotificationStore } from "@/store/notificationStore";
import { realtimeService } from "@/services/realtimeService";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import IdleTimeout from "@/components/IdleTimeout";
import ForcePasswordChange from "@/components/ForcePasswordChange";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Patients from "./pages/Clients";
import Billing from "./pages/Billing";
import Services from "./pages/Services";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import StaffManagement from "./pages/StaffManagement";
import Settings from "./pages/Settings";
import Account from "./pages/Account";
import Notifications from "./pages/Notifications";
import NotFound from "./pages/NotFound";

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
  children,
}: { children: React.ReactNode }) {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const initialized = useAdminStore((s) => s.initialized);
  const resolving = useAdminStore((s) => s.resolving);
  const mustChangePassword = useAdminStore((s) => s.mustChangePassword);
  const location = useLocation();

  if (!initialized || resolving) {
    return ( 
      <div className="fixed inset-0 flex items-center justify-center bg-[hsl(var(--background))]">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  // Remember the page they were after, so signing in again (a timeout,
  // a bookmark, a shared link) brings them back to it.
  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // A new account must replace its temporary password before anything else.
  if (mustChangePassword) return <ForcePasswordChange />;
  return <>{children}</>;
}

/* First screen after signing in. Front desk work lives in Appointments,
   so receptionists and regular staff land there; administrators and the
   owner land on the Dashboard. */
const FRONT_DESK_RE = /receptionist|front\s*desk|secretary/i;
function StartRedirect() {
  const role = useAdminStore((s) => s.role);
  const jobTitle = useAdminStore((s) => s.jobTitle);
  const toAppointments = FRONT_DESK_RE.test(jobTitle ?? "") || role !== "admin";
  return <Navigate to={toAppointments ? "/appointments" : "/dashboard"} replace />;
}

function RealtimeInitializer() {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoggedIn) {
      realtimeService.disconnect();
      return;
    }

    realtimeService.setQueryInvalidator((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
    realtimeService.init();

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
          <IdleTimeout />
          <ErrorBoundary>
            <Routes>
              {/* ── Entry ──
                  There's no landing page: the site opens straight to work.
                  "/" goes to /start. Signed in, that picks their first
                  screen; signed out, ProtectedRoute sends them to /login
                  and brings them back here afterwards. */}
              <Route path="/" element={<Navigate to="/start" replace />} />
              <Route path="/login" element={<Login />} />

              {/* ── Clinic ── */}
              <Route path="/start" element={<ProtectedRoute><StartRedirect /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/appointments" element={<ProtectedRoute><Appointments /></ProtectedRoute>} />
              {/* Patients: three sidebar entries, one page. /clients stays as
                  Pets so existing links keep working. */}
              <Route path="/clients" element={<ProtectedRoute><Patients /></ProtectedRoute>} />
              <Route path="/clients/owners" element={<ProtectedRoute><Patients /></ProtectedRoute>} />
              <Route path="/clients/records" element={<ProtectedRoute><Patients /></ProtectedRoute>} />
              <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
              <Route path="/services" element={<ProtectedRoute><Services /></ProtectedRoute>} />
              {/* Supplies and Pet Essentials were two separate pages;
                  both now live as tabs inside this one route. */}
              {/* Inventory: two sidebar entries, one page. The bare /inventory
                  is kept because notifications link to it with a tab and item
                  in the navigation state; Inventory moves itself to the tab. */}
              <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
              <Route path="/inventory/pet-essentials" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
              <Route path="/inventory/supplies" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

              {/* ── Team access is role-scoped within Staff Management ── */}
              <Route path="/staff" element={<ProtectedRoute><StaffManagement /></ProtectedRoute>} />
              <Route path="/staff/attendance" element={<ProtectedRoute><StaffManagement /></ProtectedRoute>} />
              <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />

              <Route path="/history" element={<Navigate to="/clients" replace />} />
              <Route path="/medical-records" element={<Navigate to="/clients" replace />} />
              {/* Same treatment as /history and /medical-records above
                  — old routes redirect to their new consolidated home
                  rather than 404ing on a stray bookmark or old link. */}
              <Route path="/supplies" element={<Navigate to="/inventory/supplies" replace />} />
              <Route path="/pet-essentials" element={<Navigate to="/inventory/pet-essentials" replace />} />

                <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
