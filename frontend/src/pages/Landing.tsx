import { useNavigate } from "react-router-dom";
import { ThemeStyles, BrandMark } from "@/components/AdminLayout";
import {
  ArrowRight, PawPrint, CalendarDays, FileText, WalletCards, Boxes,
  ChartNoAxesCombined, UsersRound, ShieldCheck, Mail,
} from "lucide-react";

const MODULES = [
  { label: "Appointments", icon: CalendarDays },
  { label: "Patients", icon: UsersRound },
  { label: "Medical records", icon: FileText },
  { label: "Billing", icon: WalletCards },
  { label: "Inventory", icon: Boxes },
  { label: "Reports", icon: ChartNoAxesCombined },
];

const CLINIC_EMAIL = "petroyaleclinic@gmail.com";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <>
      <ThemeStyles />
      <main className="landing-shell flex min-h-[100dvh] flex-col text-[hsl(var(--foreground))]">

        <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
          <BrandMark />
          <button
            onClick={() => navigate("/login")}
            className="flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-[12px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_8px_20px_hsl(var(--primary)/.18)] transition hover:-translate-y-0.5"
          >
            Sign in <ArrowRight size={14} />
          </button>
        </header>

        <div className="mx-auto grid w-full max-w-[1100px] flex-1 items-center gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)] lg:px-10">

          <div className="max-w-[560px]">
            <div className="entrance inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/.16)] bg-[hsl(var(--card)/.5)] px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--primary))]">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
              Staff and administrator access
            </div>

            <h1 className="display-face entrance entrance-delay-1 mt-7 text-[clamp(2.9rem,6.6vw,5.4rem)] leading-[.92] tracking-[-.055em]">
              The clinic,<br />
              <em className="font-medium not-italic text-[hsl(var(--primary))]">in one place.</em>
            </h1>

            <p className="entrance entrance-delay-2 mt-6 max-w-[440px] text-[15.5px] leading-[1.7] text-[hsl(var(--muted-foreground))]">
              Appointments, patient records, billing, inventory and reporting for Pet Royale Clinic
              and Veterinary Services. Sign in to pick up where the day left off.
            </p>

            <div className="entrance entrance-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => navigate("/login")}
                className="flex h-[52px] items-center justify-center gap-3 rounded-2xl bg-[hsl(var(--primary))] px-6 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-[0_13px_28px_hsl(var(--primary)/.2)] transition hover:-translate-y-0.5"
              >
                Sign in to Pet Royale <ArrowRight size={17} />
              </button>
            </div>

            {/* Accounts are created by an administrator through Staff
                Management — there's no self-registration, so the page
                says so rather than leaving someone hunting for a
                sign-up link. */}
            <div className="mt-8 flex items-start gap-2.5 text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
              <span>
                Accounts are created by your clinic administrator. Need access, or trouble signing
                in?{" "}
                <a href={`mailto:${CLINIC_EMAIL}`} className="font-semibold text-[hsl(var(--primary))]">
                  {CLINIC_EMAIL}
                </a>
              </span>
            </div>
          </div>

          {/* What's behind the sign-in — orienting for a new staff
              member, and honest about scope. */}
          <div className="workspace-card entrance entrance-delay-2 rounded-[28px] p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]">
                <PawPrint size={21} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
                  Inside the system
                </p>
                <p className="mt-1 text-sm font-bold">Six connected modules</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              {MODULES.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-center gap-2.5 rounded-2xl bg-[hsl(var(--muted)/.6)] px-3 py-3"
                >
                  <Icon size={15} className="shrink-0 text-[hsl(var(--primary))]" />
                  <span className="truncate text-[12px] font-semibold">{label}</span>
                </div>
              ))}
            </div>

            <p className="mt-6 border-t border-[hsl(var(--border)/.7)] pt-5 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              Pet owners book appointments and browse Pet Essentials in the Pet Royale mobile app.
              Everything they do arrives here.
            </p>
          </div>
        </div>

        <footer className="border-t border-[hsl(var(--border)/.75)] px-5 py-6 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-3 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <Mail size={13} className="text-[hsl(var(--primary))]" />
              {CLINIC_EMAIL}
            </span>
            <span>© {new Date().getFullYear()} Pet Royale Clinic and Veterinary Services</span>
          </div>
        </footer>
      </main>
    </>
  );
}
