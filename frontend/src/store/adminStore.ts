import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

interface AdminState {
  isLoggedIn: boolean;
  role: string | null;
  email: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  isLoggedIn: false,
  role: null,
  email: null,

  login: async (email, password) => {
    // First try Supabase Auth (admin)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!error && data.user) {
      set({ isLoggedIn: true, email: data.user.email, role: "admin" });
      return true;
    }

    // If not admin, check staff table
    const { data: staffData } = await (supabase as any)
      .from("staff")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .eq("status", "approved")
      .single();

    if (staffData) {
      set({ isLoggedIn: true, email: staffData.email, role: "staff" });
      return true;
    }

    return false;
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ isLoggedIn: false, role: null, email: null });
  },
}));