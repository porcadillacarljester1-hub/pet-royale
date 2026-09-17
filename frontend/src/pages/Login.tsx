import { useState } from "react";
import { useAdminStore } from "@/store/adminStore";
import { supabase } from "@/integrations/supabase/client";
import staffPetPhoto from "@/assets/pet_royale_staff_pet_login.png";
import { useNavigate } from "react-router-dom";
import {
  LockIcon, MailIcon, EyeIcon, EyeOffIcon, ArrowLeftIcon,
  ArrowRight, MailCheck, AlertCircle, Loader2,
} from "lucide-react";

type Step = "login" | "forgot-email" | "forgot-sent";

const TEAL = "#0F766E";
const NAVY = "#1E3A5F";

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

function ErrorSlot({ message }: { message: string | null }) {
  return (
    <div className="min-h-[52px] mb-1" aria-live="polite">
      {message && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5"
        >
          <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0 mt-px" />
          <p className="text-[13px] leading-snug text-[#B91C1C]">{message}</p>
        </div>
      )}
    </div>
  );
}

const FIELD_BASE =
  "w-full pl-11 py-3 rounded-lg border bg-white text-[15px] text-[#1E293B] placeholder:text-[#94A3B8] " +
  "outline-none transition-[border-color,box-shadow] duration-150";
const FIELD_OK =
  "border-[#CBD5E1] focus:border-[#0F766E] focus:ring-[3px] focus:ring-[#0F766E]/15";
const FIELD_ERR =
  "border-[#DC2626] focus:border-[#DC2626] focus:ring-[3px] focus:ring-[#DC2626]/12";

export default function Login() {
  const [step, setStep] = useState<Step>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: boolean; password?: boolean }>({});

  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const login = useAdminStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errs: { email?: boolean; password?: boolean } = {};
    if (!email.trim()) errs.email = true;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = true;
    if (!password) errs.password = true;

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(
        !email.trim() || !password
          ? "Please enter both your email and password."
          : "That doesn't look like a valid email address."
      );
      return;
    }

    setFieldErrors({});
    setIsLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        navigate("/dashboard");
      } else {
        setFormError(result.error || "Invalid email or password.");
        setFieldErrors({ email: true, password: true });
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!resetEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError("Please enter a valid email address.");
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setStep("forgot-sent");
    } catch {
      setResetError("Couldn't send the reset link. Please try again in a moment.");
    } finally {
      setResetLoading(false);
    }
  };

  const backToLogin = () => {
    setStep("login");
    setResetEmail("");
    setResetError(null);
  };

  return (
    // min-h-screen rather than fixed inset-0: on a short viewport the form
    // stays reachable instead of being clipped with no way to scroll.
    <div className="min-h-screen flex bg-white">

      {/* ============ FORM ============ */}
      <div className="w-full lg:w-[52%] xl:w-[46%] flex flex-col px-6 sm:px-10 lg:px-16 py-8 lg:py-10">

        <header className="flex items-center gap-3 shrink-0">
          <Mark size={34} />
          <div className="min-w-0">
            <p
              className="font-bold text-[17px] leading-tight"
              style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}
            >
              Pet Royale
            </p>
            <p className="text-[11px] text-[#64748B] leading-tight">We care for you and your pets</p>
          </div>
        </header>

        <main className="flex-1 flex flex-col justify-center py-10">
          <div className="w-full max-w-[380px] mx-auto lg:mx-0">

            {/* ── SIGN IN ── */}
            {step === "login" && (
              <>
                <h1
                  className="text-[28px] sm:text-[32px] font-bold leading-[1.15] mb-2.5"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}
                >
                  Sign in to your account
                </h1>
                <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
                  Manage appointments, records and reporting for the clinic.
                </p>

                <ErrorSlot message={formError} />

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-[13px] font-semibold mb-1.5" style={{ color: NAVY }}>
                      Email address
                    </label>
                    <div className="relative">
                      <MailIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-[17px] w-[17px] text-[#94A3B8] pointer-events-none" />
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: false }));
                        }}
                        placeholder="you@clinic.com"
                        autoComplete="email"
                        aria-invalid={!!fieldErrors.email}
                        disabled={isLoading}
                        className={`${FIELD_BASE} pr-4 ${fieldErrors.email ? FIELD_ERR : FIELD_OK} disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]`}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-[13px] font-semibold mb-1.5" style={{ color: NAVY }}>
                      Password
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
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        aria-invalid={!!fieldErrors.password}
                        disabled={isLoading}
                        className={`${FIELD_BASE} pr-11 ${fieldErrors.password ? FIELD_ERR : FIELD_OK} disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={isLoading}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md flex items-center justify-center text-[#94A3B8] hover:text-[#1E293B] hover:bg-[#F1F5F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40 transition-colors disabled:opacity-40"
                      >
                        {showPassword ? <EyeOffIcon className="h-[17px] w-[17px]" /> : <EyeIcon className="h-[17px] w-[17px]" />}
                      </button>
                    </div>
                  </div>

                  {/* "Remember me" was removed: the checkbox state was never
                      read anywhere, and Supabase persists the session either
                      way — so it promised a choice the system doesn't have. */}
                  <div className="flex justify-end pt-0.5">
                    <button
                      type="button"
                      onClick={() => { setStep("forgot-email"); setFormError(null); }}
                      className="text-[13px] font-semibold rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40"
                      style={{ color: TEAL }}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-[46px] rounded-lg text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E] disabled:cursor-not-allowed"
                    style={{ backgroundColor: isLoading ? "#5FA9A2" : TEAL }}
                    onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.backgroundColor = "#0B5D56"; }}
                    onMouseLeave={(e) => { if (!isLoading) e.currentTarget.style.backgroundColor = TEAL; }}
                  >
                    {isLoading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                    ) : (
                      <>Sign in <ArrowRight className="h-4 w-4" /></>
                    )}
                  </button>
                </form>

                <p className="text-[13px] text-[#64748B] mt-7 leading-relaxed">
                  Accounts are created by your clinic administrator. Contact them if you need access.
                </p>
              </>
            )}

            {/* ── FORGOT: ENTER EMAIL ── */}
            {step === "forgot-email" && (
              <>
                <button
                  onClick={backToLogin}
                  className="inline-flex items-center gap-1.5 text-[13.5px] text-[#64748B] hover:text-[#1E293B] mb-7 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to sign in
                </button>

                <h1
                  className="text-[26px] font-bold leading-tight mb-2.5"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}
                >
                  Reset your password
                </h1>
                <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
                  Enter your email and we'll send a link to set a new password.
                </p>

                <ErrorSlot message={resetError} />

                <form onSubmit={handleSendResetLink} noValidate className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-[13px] font-semibold mb-1.5" style={{ color: NAVY }}>
                      Email address
                    </label>
                    <div className="relative">
                      <MailIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-[17px] w-[17px] text-[#94A3B8] pointer-events-none" />
                      <input
                        id="reset-email"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => { setResetEmail(e.target.value); if (resetError) setResetError(null); }}
                        placeholder="you@clinic.com"
                        autoComplete="email"
                        aria-invalid={!!resetError}
                        disabled={resetLoading}
                        className={`${FIELD_BASE} pr-4 ${resetError ? FIELD_ERR : FIELD_OK} disabled:bg-[#F8FAFC]`}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full h-[46px] rounded-lg text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E] disabled:cursor-not-allowed"
                    style={{ backgroundColor: resetLoading ? "#5FA9A2" : TEAL }}
                    onMouseEnter={(e) => { if (!resetLoading) e.currentTarget.style.backgroundColor = "#0B5D56"; }}
                    onMouseLeave={(e) => { if (!resetLoading) e.currentTarget.style.backgroundColor = TEAL; }}
                  >
                    {resetLoading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>) : "Send reset link"}
                  </button>
                </form>
              </>
            )}

            {/* ── FORGOT: SENT ── */}
            {step === "forgot-sent" && (
              <>
                <div className="w-11 h-11 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: "#F0FDFA" }}>
                  <MailCheck className="h-5 w-5" style={{ color: TEAL }} />
                </div>

                <h1
                  className="text-[26px] font-bold leading-tight mb-2.5"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif", color: NAVY }}
                >
                  Check your email
                </h1>
                <p className="text-[#64748B] text-[14.5px] leading-relaxed mb-7">
                  If an account exists for{" "}
                  <span className="font-semibold" style={{ color: NAVY }}>{resetEmail}</span>, we've sent a
                  link to set a new password. It expires in one hour.
                </p>

                <button
                  onClick={backToLogin}
                  className="w-full h-[46px] rounded-lg border border-[#CBD5E1] font-semibold text-[15px] hover:bg-[#F8FAFC] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F766E]"
                  style={{ color: NAVY }}
                >
                  Back to sign in
                </button>
              </>
            )}
          </div>
        </main>

        <footer className="shrink-0 pt-6 border-t border-[#E2E8F0]">
          <p className="text-[12px] text-[#94A3B8]">
            © {new Date().getFullYear()} Pet Royale Clinic and Veterinary Services
          </p>
        </footer>
      </div>

      {/* ============ PHOTO ============ */}
      {/* The two floating cards, the dashed circle and the sparkle are gone.
          One of the cards read "Supabase-backed authentication… role-based
          access control" — developer vocabulary aimed at a receptionist
          trying to sign in, competing with the form for attention. */}
      <div className="hidden lg:block relative flex-1 overflow-hidden bg-[#F8FAFC]">
        <img
          src={staffPetPhoto}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(30,58,95,.72) 0%, rgba(30,58,95,.18) 45%, rgba(30,58,95,0) 75%)" }}
        />
        <blockquote className="absolute bottom-0 left-0 right-0 p-12 xl:p-16">
          <p
            className="text-white text-[22px] xl:text-[26px] leading-snug max-w-[440px]"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Every appointment, record and payment — in one place.
          </p>
          <p className="text-white/65 text-[13.5px] mt-3">Pet Royale Clinic and Veterinary Services</p>
        </blockquote>
      </div>
    </div>
  );
}
