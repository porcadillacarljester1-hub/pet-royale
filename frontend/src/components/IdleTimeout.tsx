import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { Clock, LogOut } from "lucide-react";

const IDLE_MS = 30 * 60 * 1000;
const WARN_MS = 2 * 60 * 1000;

/* Real values, restore these:
const IDLE_MS = 15 * 60 * 1000;
const WARN_MS = 2 * 60 * 1000;
*/

const LAST_ACTIVE_KEY = "pr_last_active";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

export default function IdleTimeout() {
  const navigate = useNavigate();
  const isLoggedIn = useAdminStore((s) => s.isLoggedIn);
  const logout = useAdminStore((s) => s.logout);

  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const warningRef = useRef(false);
  useEffect(() => { warningRef.current = warning; }, [warning]);

  const lastActive = useRef(Date.now());

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActive.current = now;
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, String(now));
    } catch {
      // Private browsing can refuse this. The in-memory ref still
      // works; only cross-tab sharing is lost.
    }
  }, []);

  const signOut = useCallback(async () => {
    setWarning(false);
    try {
      await supabase.auth.signOut();
    } finally {
      logout();
      navigate("/login", { replace: true });
    }
  }, [logout, navigate]);

  const staySignedIn = () => {
    markActive();
    setWarning(false);
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setWarning(false);
      return;
    }

    markActive();

    const onActivity = () => {
      // While the warning is up, only the button dismisses it. A stray
      // mouse movement shouldn't cancel a decision someone is about to
      // make — and if they're back at the desk, they'll click it.
      if (!warningRef.current) markActive();
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );

    /* Another tab recording activity counts here too. */
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LAST_ACTIVE_KEY || !e.newValue) return;
      const value = Number(e.newValue);
      if (value > lastActive.current) {
        lastActive.current = value;
        setWarning(false);
      }
    };
    window.addEventListener("storage", onStorage);

    /* Checked on a timer rather than scheduled with setTimeout. A
       laptop that sleeps for an hour doesn't fire pending timeouts on
       wake — it would come back signed in. Comparing against a stored
       timestamp catches that. */
    const tick = setInterval(() => {
      const idleFor = Date.now() - lastActive.current;

      if (idleFor >= IDLE_MS) {
        void signOut();
        return;
      }

      if (idleFor >= IDLE_MS - WARN_MS) {
        setWarning(true);
        setSecondsLeft(Math.ceil((IDLE_MS - idleFor) / 1000));
      } else if (warningRef.current) {
        setWarning(false);
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("storage", onStorage);
      clearInterval(tick);
    };
  }, [isLoggedIn, markActive, signOut]);

  if (!isLoggedIn || !warning) return null;

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  /* Why this is built the way it is:
     - An open Radix dialog (Add walk-in, etc.) puts pointer-events: none on
       <body>, and children inherit it, so clicks on this warning used to fall
       through to the dialog underneath. pointer-events: auto switches it back on.
     - It renders in a portal on <body> so no parent's stacking context can
       trap it under other content, and uses a z-index above every dialog.
     - Radix treats a press or focus outside its dialog as "dismiss", so those
       events stop here instead of closing the dialog behind the warning. */
  return createPortal(
    <div
      style={{ pointerEvents: "auto" }}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[hsl(var(--foreground)/.45)] p-5 backdrop-blur-[2px]"
    >
      <div
        className="workspace-card w-full max-w-[400px] rounded-[26px] p-7"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(40_55%_88%)]">
          <Clock size={22} className="text-[hsl(40_55%_30%)]" />
        </div>

        <h2 id="idle-title" className="display-face mt-5 text-[25px] leading-none">
          Still there?
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          You&apos;ll be signed out in{" "}
          <span className="font-bold tabular-nums text-[hsl(var(--foreground))]">{mmss}</span>{" "}
          because nothing&apos;s been touched for a while. This keeps patient
          records off an unattended screen.
        </p>

        <div className="mt-7 flex gap-2">
          <button
            onClick={() => void signOut()}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            <LogOut size={15} /> Sign Out
          </button>
          <button
            onClick={staySignedIn}
            autoFocus
            className="h-11 flex-[1.4] rounded-xl bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110"
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
