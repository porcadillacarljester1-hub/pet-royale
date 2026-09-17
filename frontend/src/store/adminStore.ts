import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

interface AdminState {
  isLoggedIn: boolean;
  initialized: boolean;
  id: string | null;
  staffId: string | null;
  role: "admin" | "staff" | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  setAvatarUrl: (url: string) => void;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  initialize: () => Promise<void>;
}

// Shared by login(), initialize(), and the auth-state listener below — this
// is the one place that turns "a Supabase session exists" into "this app
// considers you logged in as admin/staff". Every entry point funnels
// through here so they can never drift out of sync with each other.
async function resolveStaffSession(
  set: (partial: Partial<AdminState>) => void,
  userId: string,
  email: string | null,
): Promise<{ success: boolean; error?: string }> {
  const { data: staffRow, error: staffError } = await supabase
    .from("staff")
    .select("id, role, status, full_name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (staffError || !staffRow) {
    // Valid Supabase Auth session, but no staff record — e.g. a pet-owner
    // account that happens to share the same auth pool.
    await supabase.auth.signOut();
    set({ isLoggedIn: false, id: null, staffId: null, role: null, email: null, fullName: null, avatarUrl: null });
    return { success: false, error: "This account doesn't have dashboard access." };
  }

  if (staffRow.status !== "active") {
    await supabase.auth.signOut();
    set({ isLoggedIn: false, id: null, staffId: null, role: null, email: null, fullName: null, avatarUrl: null });
    const message =
      staffRow.status === "invited"
        ? "Your account hasn't been activated yet. Check your email for the invite link."
        : "Your account is not active. Contact your clinic administrator.";
    return { success: false, error: message };
  }

  set({
    isLoggedIn: true,
    id: userId,
    staffId: staffRow.id,
    email: email ?? "",
    fullName: staffRow.full_name,
    avatarUrl: staffRow.avatar_url,
    role: staffRow.role as "admin" | "staff",
  });

  return { success: true };
}

export const useAdminStore = create<AdminState>((set, get) => ({
  isLoggedIn: false,
  initialized: false,
  id: null,
  staffId: null,
  role: null,
  email: null,
  fullName: null,
  avatarUrl: null,

  login: async (email, password) => {
    // Single source of truth: Supabase Auth. There is no separate
    // "staff password" check anymore — see 002_staff_auth_migration.sql
    // for why the old comparison against staff.password was retired.
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      return { success: false, error: "Invalid email or password." };
    }

    return resolveStaffSession(set, data.user.id, data.user.email ?? email);
  },

  setAvatarUrl: (url: string) => set({ avatarUrl: url }),

  logout: async () => {
    await supabase.auth.signOut();
    set({ isLoggedIn: false, id: null, staffId: null, role: null, email: null, fullName: null, avatarUrl: null });
  },

  // Called once when the app boots (see App.tsx). Checks whatever real
  // Supabase session already exists — e.g. from before a page refresh —
  // and re-derives login state from it, instead of trusting only the
  // in-memory isLoggedIn flag, which resets to false on every reload
  // regardless of whether the underlying session is still valid.
  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      await resolveStaffSession(set, data.session.user.id, data.session.user.email ?? null);
    } else {
      set({ isLoggedIn: false, id: null, staffId: null, role: null, email: null, fullName: null, avatarUrl: null });
    }
    set({ initialized: true });
  },
}));

// Global listener — fires on sign-in, sign-out, and token refresh, and
// critically also fires when another tab changes the shared session
// (Supabase persists the session in localStorage, so signing in as a
// different user in one tab silently changes the session every other
// tab is using too). Without this, a tab's UI can keep showing a stale
// role while its actual queries are already running as someone else.
supabase.auth.onAuthStateChange((event, session) => {
  const state = useAdminStore.getState();

  if (event === "SIGNED_OUT" || !session) {
    if (state.isLoggedIn) {
      useAdminStore.setState({
        isLoggedIn: false,
        id: null,
        staffId: null,
        role: null,
        email: null,
        fullName: null,
        avatarUrl: null,
      });
    }
    return;
  }

  // Session belongs to a different user than what this tab currently has
  // cached — e.g. someone signed in as staff in another tab. Re-resolve
  // so this tab's role/name/access reflects the actual current session.
  if (session.user.id !== state.id) {
    resolveStaffSession(useAdminStore.setState, session.user.id, session.user.email ?? null);
  }
});