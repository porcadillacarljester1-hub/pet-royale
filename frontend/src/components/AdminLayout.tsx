import { useState, useEffect, useRef, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, CalendarDays, UsersRound, BriefcaseMedical, Boxes,
  ShoppingBag, ChartNoAxesCombined, UserCog,
  Settings, CreditCard, PawPrint, Menu, X, LogOut, Check,
  ChevronDown, KeyRound,
} from "lucide-react";
import { useAdminStore } from "@/store/adminStore";
import { NotificationBell } from "@/components/NotificationBell";

export function ThemeStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap');

      :root {
        --background: 42 32% 93%;
        --foreground: 175 32% 17%;
        --border: 41 23% 83%;
        --input: 41 23% 80%;
        --ring: 174 43% 37%;
        --card: 40 36% 97%;
        --card-foreground: 175 32% 17%;
        --card-border: 41 23% 85%;
        --popover: 40 36% 97%;
        --popover-foreground: 175 32% 17%;
        --primary: 174 43% 31%;
        --primary-foreground: 42 32% 96%;
        --secondary: 86 44% 78%;
        --secondary-foreground: 175 32% 17%;
        --muted: 40 23% 88%;
        --muted-foreground: 173 13% 42%;
        --accent: 15 72% 68%;
        --accent-foreground: 175 32% 17%;
        --destructive: 3 65% 54%;
        --destructive-foreground: 42 32% 96%;
        --radius: 1rem;
      }

      /* The Vite template caps #root and centres its text. Undone here so
         the fix survives even if App.css is still imported. */
      #root {
        max-width: none;
        margin: 0;
        padding: 0;
        text-align: left;
      }

      html { min-width: 320px; background: hsl(var(--background)); }

      body {
        margin: 0;
        font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        -webkit-font-smoothing: antialiased;
      }

      button, input, select, textarea { font: inherit; }

      button:focus-visible, input:focus-visible, select:focus-visible,
      textarea:focus-visible, a:focus-visible {
        outline: 3px solid hsl(var(--accent) / .55);
        outline-offset: 3px;
      }

      /* Fraunces on headings — the serif against the sans is what gives
         the design its character. */
      .display-face {
        font-family: 'Fraunces', Georgia, serif;
        letter-spacing: -.045em;
      }

      .workspace-shell {
        min-height: 100dvh;
        background:
          radial-gradient(circle at 72% -10%, hsl(var(--secondary) / .34), transparent 28rem),
          radial-gradient(circle at -10% 80%, hsl(var(--accent) / .08), transparent 24rem),
          hsl(var(--background));
      }

      .workspace-grid {
        background-image:
          linear-gradient(hsl(var(--border) / .23) 1px, transparent 1px),
          linear-gradient(90deg, hsl(var(--border) / .2) 1px, transparent 1px);
        background-size: 32px 32px;
        mask-image: linear-gradient(to bottom, black, transparent 66%);
        -webkit-mask-image: linear-gradient(to bottom, black, transparent 66%);
      }

      /* Deliberately 88% opaque — cards sit on the textured page
         background and read better slightly translucent. Floating
         menus and popovers must NOT use this class: anything behind
         them shows through. Use an explicit opaque bg instead (see the
         profile dropdown below for the pattern). */
      .workspace-card {
        border: 1px solid hsl(var(--card-border) / .82);
        background: hsl(var(--card) / .88);
        box-shadow:
          0 18px 50px -34px hsl(175 33% 18% / .42),
          0 2px 9px hsl(175 33% 18% / .035);
      }

      .workspace-sidebar {
        background: linear-gradient(180deg, hsl(var(--primary) / .98), hsl(175 43% 25% / .98));
        box-shadow: 18px 0 50px -42px hsl(var(--primary));
      }

      .workspace-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
      .workspace-scroll::-webkit-scrollbar-thumb {
        background: hsl(var(--primary) / .22);
        border-radius: 999px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: .35rem;
        border-radius: 999px;
        padding: .35rem .62rem;
        font-size: .68rem;
        font-weight: 700;
        letter-spacing: .01em;
        white-space: nowrap;
      }

      .modal-backdrop {
        background: hsl(var(--foreground) / .42);
        backdrop-filter: blur(5px);
      }

      @keyframes workspace-rise {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .workspace-rise   { animation: workspace-rise 500ms cubic-bezier(.22,.8,.24,1) both; }
      .workspace-rise-1 { animation-delay: 70ms; }
      .workspace-rise-2 { animation-delay: 130ms; }
      .workspace-rise-3 { animation-delay: 190ms; }

      @keyframes entrance {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .entrance         { animation: entrance 650ms cubic-bezier(.22,.8,.24,1) both; }
      .entrance-delay-1 { animation-delay: 100ms; }
      .entrance-delay-2 { animation-delay: 180ms; }
      .entrance-delay-3 { animation-delay: 260ms; }

      .login-shell {
        position: relative;
        isolation: isolate;
        min-height: 100dvh;
        overflow: hidden;
        background:
          radial-gradient(circle at 8% 18%, hsl(var(--secondary) / .42), transparent 25rem),
          radial-gradient(circle at 94% 88%, hsl(var(--accent) / .13), transparent 25rem),
          hsl(var(--background));
      }

      .soft-card {
        box-shadow:
          0 26px 80px -30px hsl(175 33% 18% / .3),
          0 4px 14px hsl(175 33% 18% / .06);
      }

      .guided-tilt { transform: rotate(1.2deg); }

      .appointment-line { position: relative; }
      .appointment-line::before {
        position: absolute;
        top: 1.8rem; bottom: -1.5rem; left: .7rem;
        width: 1px; content: '';
        background: hsl(var(--primary-foreground) / .19);
      }
      .appointment-line:last-child::before { display: none; }

      .landing-shell {
        position: relative;
        isolation: isolate;
        background:
          radial-gradient(circle at 12% 8%, hsl(var(--secondary) / .38), transparent 28rem),
          radial-gradient(circle at 88% 42%, hsl(var(--accent) / .1), transparent 26rem),
          hsl(var(--background));
      }

      .landing-service { transition: transform .35s cubic-bezier(.22,.8,.24,1), box-shadow .35s ease; }
      .landing-service:hover {
        transform: translateY(-6px);
        box-shadow: 0 26px 60px -34px hsl(175 33% 18% / .4);
      }

      .landing-deep { background: linear-gradient(180deg, hsl(var(--primary)), hsl(175 43% 24%)); }

      @media (prefers-reduced-motion: reduce) {
        .workspace-rise, .entrance { animation: none; }
        .landing-service:hover { transform: none; }
      }
    `}</style>
  );
}

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`relative flex h-10 w-10 items-center justify-center rounded-[14px] shadow-lg ${
          light
            ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"
            : "bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"
        }`}
      >
        <PawPrint size={22} strokeWidth={2.2} />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]">
          <Check size={10} strokeWidth={3} />
        </span>
      </div>
      <div className="leading-tight">
        <p className={`text-[15px] font-bold tracking-[-.02em] ${light ? "text-[hsl(var(--primary-foreground))]" : ""}`}>
          Pet Royale
        </p>
        <p className={`text-[10px] font-bold uppercase tracking-[.18em] ${
          light ? "text-[hsl(var(--primary-foreground)/.55)]" : "text-[hsl(var(--muted-foreground))]"
        }`}>
          Vet Clinic
        </p>
      </div>
    </div>
  );
}

interface NavItem { to: string; label: string; icon: React.ElementType; adminOnly?: boolean }
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/clients", label: "Patients", icon: UsersRound },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/services", label: "Services", icon: BriefcaseMedical },
  { to: "/supplies", label: "Supplies", icon: Boxes },
  { to: "/pet-essentials", label: "Pet Essentials", icon: ShoppingBag },
  { to: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { to: "/staff", label: "Staff Management", icon: UserCog, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings },
];

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function AdminLayout({
  children, title, subtitle, eyebrow, actions,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const role = useAdminStore((s) => s.role);
  const fullName = useAdminStore((s) => s.fullName);
  const email = useAdminStore((s) => s.email);
  const logout = useAdminStore((s) => s.logout);

  const items = NAV.filter((i) => !i.adminOnly || role === "admin");

  useEffect(() => {
    if (!profileOpen) return;
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [profileOpen]);

  const handleLogout = () => { logout(); navigate("/"); };

  return (
    <>
      <ThemeStyles />
      <div className="workspace-shell flex h-screen overflow-hidden text-[hsl(var(--foreground))]">

        <button
          className="fixed left-4 top-3.5 z-40 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-lg lg:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Open navigation"
        >
          <Menu size={19} />
        </button>

        {mobileOpen && (
          <button
            className="fixed inset-0 z-40 bg-[hsl(var(--foreground)/.35)] lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={`workspace-sidebar fixed inset-y-0 left-0 z-50 flex h-full w-[248px] shrink-0 flex-col p-4 text-[hsl(var(--primary-foreground))] transition-transform lg:static lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between pb-1">
            <BrandMark light />
            <button
              className="rounded-xl p-2 text-[hsl(var(--primary-foreground)/.7)] hover:bg-[hsl(var(--primary-foreground)/.1)] lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>

          {/* Only the link list scrolls, if it ever needs to. */}
          <nav className="workspace-scroll mt-5 flex-1 space-y-1 overflow-y-auto" aria-label="Main navigation">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition ${
                    isActive
                      ? "bg-[hsl(var(--primary-foreground)/.14)] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--primary-foreground)/.62)] hover:bg-[hsl(var(--primary-foreground)/.08)] hover:text-[hsl(var(--primary-foreground))]"
                  }`
                }
              >
                <Icon size={17} className="shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* The profile moved back to the header, so this is just a
              sign-out. Having the account in two places was the reason it
              seemed to "disappear" from the header. */}
          <button
            onClick={handleLogout}
            className="mt-3 flex shrink-0 items-center gap-2.5 rounded-xl border border-[hsl(var(--primary-foreground)/.12)] px-3 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground)/.62)] transition hover:bg-[hsl(var(--primary-foreground)/.1)] hover:text-[hsl(var(--primary-foreground))]"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* `relative z-30`: z-index only applies to a positioned
              element, and this header had neither before — so any
              z-index on it (or its children) was silently ignored, and
              it painted beneath the main content wrapper by default.
              z-30 clears both that wrapper and the mobile menu button. */}
          <header className="relative z-30 flex h-16 shrink-0 items-center gap-4 border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--card)/.5)] px-4 pl-16 backdrop-blur-sm sm:px-6 lg:h-[68px] lg:pl-6">
            <div className="min-w-0 flex-1">
              {title && (
                <h1 className="display-face truncate text-[22px] leading-none lg:text-[26px]">{title}</h1>
              )}
              {(eyebrow || subtitle) && (
                <p className="mt-1 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                  {eyebrow || subtitle}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <NotificationBell />

              <div className="mx-1 hidden h-7 w-px bg-[hsl(var(--border))] sm:block" />

              <div ref={profileRef} className="relative">
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  aria-expanded={profileOpen}
                  className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-[hsl(var(--muted))]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">
                    {initials(fullName)}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-[130px] truncate text-[12px] font-bold leading-tight">
                      {fullName || "—"}
                    </span>
                    <span className="block text-[10px] leading-tight text-[hsl(var(--muted-foreground))]">
                      {role === "admin" ? "Administrator" : "Staff"}
                    </span>
                  </span>
                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${profileOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {profileOpen && (
                  /* Fully opaque background, not `workspace-card` (which
                     is 88% translucent by design for cards on the page
                     texture). A floating menu needs a solid backdrop or
                     whatever's behind it shows through. */
                  <div className="absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[0_18px_50px_-24px_hsl(175_33%_18%/.5)]">
                    <div className="border-b border-[hsl(var(--border)/.7)] px-4 py-3">
                      <p className="truncate text-[13px] font-bold">{fullName || "—"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">{email}</p>
                    </div>
                    <div className="p-1.5">
                      <button
                        onClick={() => { setProfileOpen(false); navigate("/settings"); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition hover:bg-[hsl(var(--muted))]"
                      >
                        <Settings size={15} className="text-[hsl(var(--muted-foreground))]" />
                        Account settings
                      </button>
                      <button
                        onClick={() => { setProfileOpen(false); navigate("/settings"); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition hover:bg-[hsl(var(--muted))]"
                      >
                        <KeyRound size={15} className="text-[hsl(var(--muted-foreground))]" />
                        Change password
                      </button>
                      <div className="my-1.5 h-px bg-[hsl(var(--border)/.7)]" />
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.08)]"
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="workspace-scroll relative min-h-0 flex-1 overflow-y-auto">
            <div className="workspace-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
            <div className="relative">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
