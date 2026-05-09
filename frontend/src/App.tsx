import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAdminStore } from "@/store/adminStore";
import { useNotificationStore } from "@/store/notificationStore";
import { realtimeService } from "@/services/realtimeService";
import { audioManager } from "@/services/audioManager";
import { useEffect } from "react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StaffManagement from "./pages/StaffManagement";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Appointments from "./pages/Appointments";
import Inventory from "./pages/Inventory";
import History from "./pages/History";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RealtimeInitializer() {
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const { soundEnabled, soundVolume } = useNotificationStore();
  const queryClient = useQueryClient(); // ✅ called inside a component

  useEffect(() => {
    if (isLoggedIn) {
      // ✅ pass queryClient to service before init
      realtimeService.setQueryInvalidator((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
      realtimeService.init();
      audioManager.setEnabled(soundEnabled);
      audioManager.setVolume(soundVolume);
      useNotificationStore.getState().requestPermission();
    } else {
      realtimeService.disconnect();
    }
    return () => {
      realtimeService.disconnect();
    };
  }, [isLoggedIn, soundEnabled, soundVolume, queryClient]);

  return null;
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <RealtimeInitializer />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/staff" element={<ProtectedRoute><StaffManagement /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
            <Route path="/appointments" element={<ProtectedRoute><Appointments /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;