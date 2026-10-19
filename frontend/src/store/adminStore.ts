import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AdminState {
  isLoggedIn: boolean;
  initialized: boolean;
  resolving: boolean;
  id: string | null;
  staffId: string | null;
  role: "admin" | "staff" | null;
  email: string | null;
  fullName: string | null;
  title: string | null;
  jobTitle: string | null;
  // True until a new account has replaced the temporary password it
  // was created with. ProtectedRoute holds them on a "set your
  // password" screen while this is set.
  mustChangePassword: boolean;
  avatarUrl: string | null;
  setAvatarUrl: (url: string) => void;
  login: (email: string, password: string) => Promise<Result>;
  logout: () => void;
  initialize: () => Promise<void>;
}

/* code tells the sign-in screen WHY it failed, so a suspended account
   gets told so instead of "email and password don't match", and isn't
   counted as a wrong-password attempt. */
type Result = {
  success: boolean;
  error?: string;
  code?: "invalid" | "no_access" | "inactive";
};

const LOGGED_OUT = {
  isLoggedIn: false, id: null, staffId: null, role: null,
  email: null, fullName: null, title: null, jobTitle: null,
  mustChangePassword: false, avatarUrl: null,
} as const;

const inflight = new Map<string, Promise<Result>>();

function resolveStaffSession(
  set: (partial: Partial<AdminState>) => void,
  userId: string,
  email: string | null,
): Promise<Result> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  set({ resolving: true });
  const promise = resolveStaffSessionInner(set, userId, email).finally(() => {
    inflight.delete(userId);
    if (inflight.size === 0) set({ resolving: false });
  });
  inflight.set(userId, promise);
  return promise;
}

async function resolveStaffSessionInner(
  set: (partial: Partial<AdminState>) => void,
  userId: string,
  email: string | null,
): Promise<Result> {
  const { data: staffRow, error: staffError } = await (supabase as any)
    .from("staff")
    .select("id, role, status, full_name, avatar_url, title, job_title")
    .eq("user_id", userId)
    .maybeSingle();

  if (staffError || !staffRow) {
    // Valid Supabase Auth session, but no staff record — e.g. a pet-owner
    // account that happens to share the same auth pool.
    await supabase.auth.signOut();
    set({ ...LOGGED_OUT });
    return { success: false, code: "no_access", error: "This account doesn't have dashboard access." };
  }

  if (staffRow.status !== "active") {
    await supabase.auth.signOut();
    set({ ...LOGGED_OUT });
    const message =
      staffRow.status === "invited"
        ? "Your account hasn't been activated yet. Check your email for the invite link."
        : staffRow.status === "suspended"
          ? "Your account is suspended. Please contact the clinic owner."
          : "Your account is not active. Please contact the clinic owner.";
    return { success: false, code: "inactive", error: message };
  }

  // Read on its own so that if the column hasn't been added yet, the
  // worst case is "no forced change" — never a failed sign-in.
  const { data: flagRow } = await (supabase as any)
    .from("staff")
    .select("must_change_password")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: current } = await supabase.auth.getSession();
  if (current.session?.user.id !== userId) {
    return { success: false, error: "Session ended." };
  }

  set({
    isLoggedIn: true,
    id: userId,
    staffId: staffRow.id,
    email: email ?? "",
    fullName: staffRow.full_name,
    title: staffRow.title ?? null,
    jobTitle: staffRow.job_title ?? null,
    mustChangePassword: flagRow?.must_change_password === true,
    avatarUrl: staffRow.avatar_url,
    role: staffRow.role as "admin" | "staff",
  });

  return { success: true };
}

export const useAdminStore = create<AdminState>((set, get) => ({
  isLoggedIn: false,
  initialized: false,
  resolving: false,
  id: null,
  staffId: null,
  role: null,
  email: null,
  fullName: null,
  title: null,
  jobTitle: null,
  mustChangePassword: false,
  avatarUrl: null,

  login: async (email, password) => {
    // Single source of truth: Supabase Auth. There is no separate
    // "staff password" check anymore — see 002_staff_auth_migration.sql
    // for why the old comparison against staff.password was retired.
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      return { success: false, code: "invalid", error: "Invalid email or password." };
    }

    return resolveStaffSession(set, data.user.id, data.user.email ?? email);
  },

  setAvatarUrl: (url: string) => set({ avatarUrl: url }),

  logout: async () => {
    await supabase.auth.signOut();
    set({ ...LOGGED_OUT });
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
      set({ ...LOGGED_OUT });
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
      useAdminStore.setState({ ...LOGGED_OUT });
    }
    return;
  }

  // Session belongs to a different user than what this tab currently has
  // cached — e.g. someone signed in as staff in another tab. Re-resolve
  // so this tab's role/name/access reflects the actual current session.
  if (session.user.id !== state.id) {
    void resolveStaffSession(useAdminStore.setState, session.user.id, session.user.email ?? null);
  }
});

/* ── Suspension watcher ──────────────────────────────────────────────
   Suspending an account changes staff.status and nothing on the
   suspended person's side: their browser already holds a valid
   session and a screen full of loaded data, and this store only
   looked at status when they signed in or reloaded the page. So a
   suspended account kept a working-looking dashboard until it
   happened to refresh.

   While someone is signed in, this re-reads their own staff row:
   every 15 seconds, whenever the tab comes back into view, and
   straight away when the database reports a change to that row
   (needs `staff` in the realtime publication — migration 041; without
   it the 15-second check still catches it). If the row is gone or
   isn't 'active', they're signed out. ProtectedRoute in App.tsx sends
   anyone to /login the moment isLoggedIn turns false and clears the
   query cache, so nothing they'd loaded stays reachable.

   Reading your own row is always allowed (staff_select_own), even
   after suspension, so a suspended account sees status 'suspended'
   rather than an empty result. A request that fails is NOT treated as
   a suspension — a dropped connection must never sign anyone out. */

const STATUS_CHECK_MS = 15_000;
const NOT_ACTIVE_MESSAGE = "Your access has been suspended or removed. Please contact the clinic owner.";

let checking = false;

async function verifyStillActive() {
  const start = useAdminStore.getState();
  if (!start.isLoggedIn || !start.id || checking) return;
  checking = true;
  try {
    // No session at all is the auth listener's job, not this check's.
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return;

    const { data, error } = await (supabase as any)
      .from("staff")
      .select("status")
      .eq("user_id", start.id)
      .maybeSingle();
    if (error) return;

    // Someone may have signed in or out while that request was in flight.
    const now = useAdminStore.getState();
    if (!now.isLoggedIn || now.id !== start.id) return;

    if (!data || data.status !== "active") {
      // State first, so the redirect and cache clear happen at once;
      // the network sign-out follows.
      useAdminStore.setState({ ...LOGGED_OUT });
      toast.error(NOT_ACTIVE_MESSAGE, { duration: 10000 });
      await supabase.auth.signOut().catch(() => undefined);
    }
  } finally {
    checking = false;
  }
}

let watchTimer: ReturnType<typeof setInterval> | null = null;
let watchChannel: any = null;
let watchedId: string | null = null;

const onWake = () => { if (!document.hidden) void verifyStillActive(); };

function stopWatching() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  document.removeEventListener("visibilitychange", onWake);
  window.removeEventListener("focus", onWake);
  if (watchChannel) supabase.removeChannel(watchChannel);
  watchChannel = null;
  watchedId = null;
}

function startWatching(userId: string) {
  stopWatching();
  watchedId = userId;
  watchTimer = setInterval(onWake, STATUS_CHECK_MS);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  // Unique per start — a fixed name can hand back a channel that's
  // still being removed, and adding callbacks to one throws.
  watchChannel = (supabase as any)
    .channel(`staff-status-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "staff", filter: `user_id=eq.${userId}` },
      () => void verifyStillActive(),
    )
    .subscribe();
}

useAdminStore.subscribe((state) => {
  if (state.isLoggedIn && state.id) {
    if (watchedId !== state.id) startWatching(state.id);
  } else if (watchedId) {
    stopWatching();
  }
});