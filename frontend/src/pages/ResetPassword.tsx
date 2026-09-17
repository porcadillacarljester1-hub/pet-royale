import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  LockIcon, EyeIcon, EyeOffIcon, Loader2, AlertCircle, CheckCircle2, ArrowLeftIcon,
} from "lucide-react";

const TEAL = "#0F766E";
const NAVY = "#1E3A5F";

/* Formerly AcceptInvite. Email invites were abandoned — admins now create
   staff accounts directly with a password — so the only thing that lands
   here is the password-reset link from the sign-in screen. Renamed to
   match what it actually does; the invite wording it used to show made no
   sense to someone who'd just clicked "forgot my password". */

function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2" y="7" width="36" height="31" rx="10" fill={TEAL} />
      <path d="M11 10 L14.5 13.5 L20 5.5 L25.5 13.5 L29 10 L27.5 16 H12.5 L11 10Z" fill={NAVY} />
      <g fill="#FFFFFF">
        <ellipse cx="20" cy="30.5" rx="6.2" ry="5.2" />
        <ellipse cx="13.4" cy="24.6" rx="2.9" ry="3.5" />
        <ellipse cx="17" cy="20.4" rx="2.5" ry="3.1" />
        <ellipse cx="23" cy="20.4" rx="2.5" ry="3.1" />
        <ellipse cx="26.6" cy="24.6" rx="2.9" ry="3.5" />
      </g>
    </svg>
  );
}

/* Fixed-height slot so showing or clearing an error never shifts the
   form beneath it. */
function ErrorSlot({ message }: { message: string | null }) {
  return (
    <div className="min-h-[52px] mb-1" aria-live="polite">
      {message && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5">
          <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0 mt-px" />
          <p className="text-[13px] leading-snug text-[#B91C1C]">{message}</p>
        </div>
      )}
    </div>
  );
}

const FIELD_BASE =
  "w-full pl-11 py-3 rounded-lg border bg-white text-[15px] text-[#1E293B] placeholder:text-[#94A3B8] " +
  "outline-none transition-[border-color,box-shadow] duration-150 disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]";
const FIELD_OK = "border-[#CBD5E1] focus:border-[#0F766E] focus:ring-[3px] focus:ring-[#0F766E]/15";
const FIELD_ERR = "border-[#DC2626] focus:border-[#DC2626] focus:ring-[3px] focus:ring-[#DC2626]/12";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: boolean; confirm?: boolean }>({});

  useEffect(() => {
    // Guards against this effect running twice (React StrictMode in dev,
    // fast refresh). token_hash is single-use once verifyOtp() is called,
    // so calling it twice burns the token and shows a false "expired"
    // error — exactly the failure mode this page had before.
    let consumed = false;

    const init = async () => {
      if (consumed) return;
      consumed = true;

      const query = new URLSearchParams(window.location.search);
      const tokenHash = query.get("token_hash");
      const type = query.get("type");

      // The token_hash flow: the link carries a hash spent only when we
      // explicitly call verifyOtp() here. Unlike the older
      // /auth/v1/verify links, loading or prefetching the URL doesn't
      // consume it — so link scanners and browser prefetch can't
      // invalidate the link before the person clicks it.
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "recovery" | "invite" | "signup" | "email",
        });
        if (!error) {
          window.history.replaceState(null, "", window.location.pathname);
          setHasSession(true);
          setCheckingSession(false);
          return;
        }
        console.error("verifyOtp failed:", error.message);
      }

      // No token in the URL — e.g. the page was reloaded after the token
      // was consumed. Fall back to whatever session exists.
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setCheckingSession(false);
    };

    init();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errs: { password?: boolean; confirm?: boolean } = {};
    if (password.length < 12) errs.password = true;
    if (password !== confirmPassword) errs.confirm = true;

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(
        password.length < 12
          ? "Password must be at least 12 characters."
          : "Those passwords don't match."
      );
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      // No pre-flight getSession() here: verifyOtp() succeeding on mount
      // is already proof the session belongs to this person, and
      // re-reading it can come back empty for a freshly established
      // recovery session, blocking a valid submit.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // The activate-invite call that used to run here is gone. It
      // flipped a staff row from "invited" to "active" — a status that no
      // longer exists, since migration 004 dropped it and accounts are
      // created active. The call always failed, and its error branch
      // signed people out with "activation failed" after their password
      // had in fact saved correctly.
      await supabase.auth.signOut();
      setDone(true);
    } catch (err: any) {
      setFormError(err.message || "Couldn't set your password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="flex items-center gap-3 px-6 sm:px-10 py-8 shrink-0">
        <Mark size={34} />
        <div className="min-w-0">
          <p className="font-bold text-[17px] leading-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}>
            Pet Royale
          </p>
          <p className="text-[11px] text-[#64748B] leading-tight">We care for you and your pets</p>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>

      <footer className="shrink-0 px-6 sm:px-10 py-6 border-t border-[#E2E8F0]">
        <p className="text-[12px] text-[#94A3B8]">
          © {new Date().getFullYear()} Pet Royale Clinic and Veterinary Services
        </p>
      </footer>
    </div>
  );

  if (checkingSession) {
    return shell(
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: TEAL }} />
      </div>
    );
  }

  if (done) {
    return shell(
      <>
        <div className="w-11 h-11 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: "#ECFDF5" }}>
          <CheckCircle2 className="h-5 w-5" style={{ color: "#047857" }} />
        </div>
        <h1 className="text-[26px] font-bold leading-tight mb-2.5" style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}>
          Password updated
        </h1>
        <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
          You can now sign in with your new password.
        </p>
        <button
          onClick={() => navigate("/login")}
          className="w-full h-[46px] rounded-lg text-white font-semibold text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E]"
          style={{ backgroundColor: TEAL }}
        >
          Go to sign in
        </button>
      </>
    );
  }

  if (!hasSession) {
    return shell(
      <>
        <div className="w-11 h-11 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: "#FEF2F2" }}>
          <AlertCircle className="h-5 w-5" style={{ color: "#B91C1C" }} />
        </div>
        <h1 className="text-[26px] font-bold leading-tight mb-2.5" style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}>
          This link has expired
        </h1>
        {/* Was "Invite link expired or invalid… contact your clinic
            administrator" — but this is a password reset the person
            requested themselves, and they can simply request another. */}
        <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
          Password reset links can only be used once, and expire after an hour.
          Request a new one from the sign-in screen.
        </p>
        <button
          onClick={() => navigate("/login")}
          className="w-full h-[46px] rounded-lg border border-[#CBD5E1] font-semibold text-[15px] hover:bg-[#F8FAFC] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E]"
          style={{ color: NAVY }}
        >
          Back to sign in
        </button>
      </>
    );
  }

  return shell(
    <>
      <button
        onClick={() => navigate("/login")}
        className="inline-flex items-center gap-1.5 text-[13.5px] text-[#64748B] hover:text-[#1E293B] mb-7 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to sign in
      </button>

      <h1 className="text-[28px] font-bold leading-[1.15] mb-2.5" style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}>
        Set a new password
      </h1>
      <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
        Choose a password you'll use to sign in from now on.
      </p>

      <ErrorSlot message={formError} />

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-[13px] font-semibold mb-1.5" style={{ color: NAVY }}>
            New password
          </label>
          <div className="relative">
            <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-[17px] w-[17px] text-[#94A3B8] pointer-events-none" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: false }));
              }}
              placeholder="At least 12 characters"
              autoComplete="new-password"
              aria-invalid={!!fieldErrors.password}
              disabled={loading}
              className={`${FIELD_BASE} pr-11 ${fieldErrors.password ? FIELD_ERR : FIELD_OK}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              disabled={loading}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md flex items-center justify-center text-[#94A3B8] hover:text-[#1E293B] hover:bg-[#F1F5F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40 transition-colors disabled:opacity-40"
            >
              {showPassword ? <EyeOffIcon className="h-[17px] w-[17px]" /> : <EyeIcon className="h-[17px] w-[17px]" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm" className="block text-[13px] font-semibold mb-1.5" style={{ color: NAVY }}>
            Confirm password
          </label>
          <div className="relative">
            <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-[17px] w-[17px] text-[#94A3B8] pointer-events-none" />
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirm) setFieldErrors((f) => ({ ...f, confirm: false }));
              }}
              placeholder="Re-enter your new password"
              autoComplete="new-password"
              aria-invalid={!!fieldErrors.confirm}
              disabled={loading}
              className={`${FIELD_BASE} pr-4 ${fieldErrors.confirm ? FIELD_ERR : FIELD_OK}`}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[46px] rounded-lg text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E] disabled:cursor-not-allowed"
          style={{ backgroundColor: loading ? "#5FA9A2" : TEAL }}
        >
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save new password"}
        </button>
      </form>
    </>
  );
}
