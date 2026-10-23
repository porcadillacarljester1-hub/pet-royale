import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdminStore } from "@/store/adminStore";
import { ThemeStyles } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ChevronLeft, MailCheck, Eye, EyeOff,
  ShieldCheck, ShieldX, Lock, AlertTriangle, TriangleAlert,
  KeyRound, Check,
} from "lucide-react";

type Step = "login" | "code" | "forgot" | "reset-code" | "new-password";
type AuthState = "idle" | "checking" | "granted" | "denied";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const ATTEMPTS_KEY = "pr_auth_attempts";
const LOCKED_UNTIL_KEY = "pr_auth_locked_until";

const PASSWORD_RULES = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /\d/.test(p) },
  { label: "One symbol, like ! or @", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const BTN =
  "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[17px] font-bold " +
  "text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_-4px_hsl(var(--primary)/.4)] transition " +
  "hover:brightness-110 disabled:opacity-40 disabled:shadow-none";
const H1 = "text-[34px] font-bold leading-[1.15] tracking-[-.02em] text-[hsl(var(--foreground))]";
const H1_STEP = "text-[30px] font-bold leading-[1.15] tracking-[-.02em] text-[hsl(var(--foreground))]";
const SUB = "mt-2 text-[15px] leading-snug text-[hsl(var(--muted-foreground))]";
const BACK =
  "-ml-2.5 mb-3 flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--primary))] " +
  "transition hover:bg-[hsl(var(--muted))]";
const LABEL = "mb-2 block text-[14px] font-bold text-[hsl(var(--foreground))]";
const LINK =
  "min-h-11 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline " +
  "disabled:text-[hsl(var(--muted-foreground))] disabled:no-underline";

function FloatField({
  id, label, error, right, labelRight, onFocus, onBlur, ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: boolean;
  right?: ReactNode;
  labelRight?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const floated = focused || String(input.value ?? "").length > 0;

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error || undefined}
          {...input}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          className={
            "pr-field peer h-[58px] w-full rounded-2xl border-[1.5px] bg-[hsl(var(--card))] px-4 pb-1.5 pt-[22px] text-[17px] font-medium " +
            "text-[hsl(var(--foreground))] outline-none transition border-[hsl(var(--card-border))] " +
            "focus:border-[hsl(var(--primary))] disabled:opacity-40 " +
            (right ? "pr-14 " : "") +
            (error ? "!border-[hsl(var(--destructive))]" : "")
          }
        />
        <label
          htmlFor={id}
          className={
            "pr-float pointer-events-none absolute left-[17px] transition-all duration-150 motion-reduce:transition-none " +
            (floated
              ? "top-[15px] -translate-y-1/2 text-[12px] font-bold " +
                (error ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--primary))]")
              : "top-[29px] -translate-y-1/2 text-[17px] font-medium text-[hsl(var(--muted-foreground))]")
          }
        >
          {label}
        </label>
        {right}
      </div>
      {labelRight && <div className="flex justify-end">{labelRight}</div>}
    </div>
  );
}

function EyeButton({
  shown, onClick, disabled,
}: { shown: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
    >
      {shown ? <Eye size={22} aria-hidden="true" /> : <EyeOff size={22} aria-hidden="true" />}
    </button>
  );
}

function ErrorSlot({ message }: { message: string | null }) {

  return (
    <div className="min-h-[56px] pt-2">
      {message && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-[hsl(var(--destructive)/.12)] px-3.5 py-3">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]" />
          <p className="text-[14px] font-medium leading-snug text-[hsl(var(--destructive))]">{message}</p>
        </div>
      )}
    </div>
  );
}

function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <div className="mb-7 flex gap-2" role="img" aria-label={`Step ${step} of 2`}>
      <span className="h-1.5 flex-1 rounded-full bg-[hsl(var(--primary))]" />
      <span
        className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
          step === 2 ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--card-border))]"
        }`}
      />
    </div>
  );
}

function readLockout() {
  const until = Number(sessionStorage.getItem(LOCKED_UNTIL_KEY) || 0);
  return until > Date.now() ? until : 0;
}

function recordAuthEvent(email: string, event: string) {
  void (supabase as any).from("auth_events").insert([{
    email: email.trim().toLowerCase(),
    event,
    user_agent: navigator.userAgent.slice(0, 300),
  }]);
}

const SK = "animate-pulse rounded-xl bg-[hsl(var(--muted))] motion-reduce:animate-none";

function WorkspaceSkeleton() {
  return (
    <div
      className="fixed inset-0 z-[300] flex bg-[hsl(var(--background))]"
      style={{ animation: "pr-overlay-in 180ms ease-out" }}
      role="status"
      aria-live="assertive"
      aria-busy="true"
    >
      <span className="sr-only">You&apos;re in. Opening your workspace.</span>

      {/* Progress bar along the top edge */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-[hsl(var(--muted))]">
        <div
          className="h-full bg-gradient-to-r from-[#F4B223] to-[#E8821E]"
          style={{ animation: "pr-bar 1000ms cubic-bezier(.4,0,.2,1) forwards" }}
        />
      </div>

      {/* Sidebar */}
      <aside aria-hidden="true" className="hidden w-64 shrink-0 flex-col gap-3 border-r border-[hsl(var(--border)/.7)] p-5 md:flex">
        <div className="mb-4 flex items-center gap-3">
          <div className={`${SK} h-11 w-11 !rounded-full`} />
          <div className={`${SK} h-4 w-28`} />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className={`${SK} h-6 w-6 !rounded-lg`} style={{ animationDelay: `${i * 70}ms` }} />
            <div className={`${SK} h-4`} style={{ width: `${62 + ((i * 17) % 30)}%`, animationDelay: `${i * 70}ms` }} />
          </div>
        ))}
      </aside>

      {/* Main */}
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-[hsl(var(--border)/.7)] px-5 md:px-8">
          <div className={`${SK} h-5 w-40`} />
          <div className="flex items-center gap-3">
            <div className={`${SK} hidden h-10 w-56 !rounded-full sm:block`} />
            <div className={`${SK} h-10 w-10 !rounded-full`} />
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-hidden p-5 md:space-y-6 md:p-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] p-4 md:p-5">
                <div className={`${SK} h-3.5 w-24`} style={{ animationDelay: `${i * 90}ms` }} />
                <div className={`${SK} mt-4 h-8 w-20`} style={{ animationDelay: `${i * 90}ms` }} />
                <div className={`${SK} mt-3 h-3 w-32`} style={{ animationDelay: `${i * 90}ms` }} />
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr] md:gap-6">
            <div className="rounded-2xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] p-5">
              <div className={`${SK} h-4 w-36`} />
              <div className="mt-6 flex h-44 items-end gap-3 md:h-56">
                {[45, 70, 38, 82, 58, 92, 66, 50, 76, 40].map((h, i) => (
                  <div key={i} className={`${SK} flex-1 !rounded-md`} style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            </div>
            <div className="hidden rounded-2xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] p-5 lg:block">
              <div className={`${SK} h-4 w-28`} />
              <div className="mt-5 space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`${SK} h-10 w-10 shrink-0 !rounded-full`} style={{ animationDelay: `${i * 80}ms` }} />
                    <div className="flex-1 space-y-2">
                      <div className={`${SK} h-3.5 w-3/4`} style={{ animationDelay: `${i * 80}ms` }} />
                      <div className={`${SK} h-3 w-1/2`} style={{ animationDelay: `${i * 80}ms` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="hidden rounded-2xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] p-5 md:block">
            <div className={`${SK} h-4 w-32`} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className={`${SK} h-4 w-1/5`} style={{ animationDelay: `${i * 80}ms` }} />
                  <div className={`${SK} h-4 w-2/5`} style={{ animationDelay: `${i * 80}ms` }} />
                  <div className={`${SK} h-4 w-1/5`} style={{ animationDelay: `${i * 80}ms` }} />
                  <div className={`${SK} ml-auto h-6 w-20 !rounded-full`} style={{ animationDelay: `${i * 80}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Status pill, floating over the skeleton */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4"
        style={{ animation: "pr-fade-up 320ms ease-out 120ms both" }}
      >
        <div className="flex items-center gap-2.5 rounded-full bg-[hsl(145_42%_88%)] px-5 py-3 shadow-[0_10px_30px_-8px_rgb(0_0_0/.35)]">
          <ShieldCheck size={18} className="text-[hsl(145_42%_27%)]" />
          <span className="text-[15px] font-bold text-[hsl(145_42%_27%)]">You&apos;re in</span>
          <span className="text-[15px] text-[hsl(145_42%_27%)]/80">Opening your workspace…</span>
        </div>
      </div>
    </div>
  );
}

function AccessOverlay({ state }: { state: AuthState }) {
  if (state === "granted") return <WorkspaceSkeleton />;
  if (state !== "denied") return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[hsl(var(--background)/.97)] backdrop-blur-[3px]"
      style={{ animation: "pr-overlay-in 180ms ease-out" }}
      role="status"
      aria-live="assertive"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)]"
        style={{ animation: "pr-shake 420ms cubic-bezier(.36,.07,.19,.97)" }}
      >
        <ShieldX size={30} className="text-[hsl(var(--destructive))]" />
      </div>

      <p
        className="mt-5 text-[22px] font-bold tracking-[-.01em] text-[hsl(var(--destructive))]"
        style={{ animation: "pr-fade-up 320ms ease-out 120ms both" }}
      >
        Access denied
      </p>
    </div>
  );
}

const SKELETON = "animate-pulse bg-white/15 motion-reduce:animate-none";

function useImageReady() {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (ref.current?.complete) setReady(true);
  }, []);
  return { ready, ref, markReady: () => setReady(true) };
}

function Lettering({
  src, alt, className, fallbackClassName, skeletonHeight,
}: { src: string; alt: string; className: string; fallbackClassName: string; skeletonHeight: string }) {
  const [failed, setFailed] = useState(false);
  const { ready, ref, markReady } = useImageReady();
  if (failed) return <p className={fallbackClassName}>{alt}</p>;
  return (
    <>
      {!ready && <div aria-hidden="true" className={`${className} ${skeletonHeight} rounded-full ${SKELETON}`} />}
      <img
        ref={ref}
        src={src}
        alt={alt}
        onLoad={markReady}
        onError={() => setFailed(true)}
        className={`${className} ${ready ? "" : "hidden"}`}
      />
    </>
  );
}

const TORN = {
  trCream: "1036,-4 1044,3 1055,6 1060,18 1072,21 1080,29 1089,36 1099,40 1105,51 1115,56 1127,59 1134,68 1145,72 1152,81 1160,89 1168,96 1178,102 1186,109 1199,110 1207,118 1215,125 1225,131 1234,138 1242,145 1250,154 1259,160 1267,167 1280,169 1286,180 1296,184 1307,188 1314,197 1325,200 1329,215 1342,215 1351,221 1357,231 1370,232 1378,240 1385,250 1394,257 1406,258 1416,264 1423,273 1431,281 1442,285 1448,295 1470,-20 1020,-30",
  trGold: "1040,-10 1047,-0 1058,3 1069,7 1075,17 1087,19 1096,25 1098,42 1110,45 1121,49 1133,51 1142,57 1150,65 1158,73 1166,80 1175,86 1185,92 1191,103 1201,108 1212,110 1219,120 1230,124 1239,130 1248,137 1254,147 1263,154 1277,154 1282,165 1295,167 1299,179 1313,180 1319,189 1330,193 1338,201 1346,210 1356,215 1366,219 1371,231 1384,232 1393,238 1399,249 1412,250 1420,257 1427,268 1441,266 1446,279 1454,286 1470,-20 1020,-30",
  brCream: "1448,648 1439,654 1431,662 1426,673 1414,676 1406,684 1401,694 1393,702 1384,709 1374,714 1365,721 1358,729 1352,740 1343,746 1331,750 1326,761 1317,767 1310,776 1300,781 1291,787 1285,798 1279,808 1266,810 1260,820 1250,825 1244,835 1230,837 1229,851 1214,852 1211,865 1206,876 1191,876 1184,885 1175,891 1169,902 1157,905 1151,914 1146,926 1470,945 1470,640",
  brGold: "1455,655 1444,659 1437,668 1434,681 1423,686 1415,694 1407,701 1395,704 1383,708 1379,719 1371,728 1362,734 1356,744 1347,751 1342,762 1332,767 1325,776 1313,779 1310,792 1301,799 1291,805 1283,812 1271,816 1265,826 1257,833 1250,842 1243,850 1232,855 1226,866 1213,868 1209,879 1199,885 1194,896 1184,901 1176,909 1165,914 1161,925 1147,927 1470,945 1470,640",
  blCream: "-26,739 -15,743 -7,751 1,759 9,766 22,767 29,776 40,778 47,788 55,796 65,801 74,808 85,810 94,818 102,825 108,836 121,836 129,844 139,850 149,854 156,863 166,868 176,873 186,878 194,885 203,891 212,898 222,903 230,910 239,917 249,922 257,930 264,939 276,942 -40,965",
  blGold: "-28,742 -18,747 -12,758 -5,766 6,770 12,781 26,781 34,788 44,792 52,800 62,806 69,814 78,821 89,825 95,835 107,837 115,845 123,853 133,858 138,870 149,873 161,875 169,883 178,889 190,892 198,899 207,905 214,915 227,916 236,922 244,929 249,941 262,942 272,948 -40,965",
};

function GeometricBackdrop() {
  const fade = "radial-gradient(ellipse at 42% 52%, #000 0%, transparent 72%)";
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id="pr-halftone" width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="4.5" cy="4.5" r="1.7" fill="#C97F00" opacity=".55" />
          </pattern>
        </defs>
        <polygon points="900,-20 1460,-20 1460,470 1190,470" fill="#0C3675" opacity=".55" />
        <polygon points="-20,540 560,380 700,920 -20,920" fill="#082752" opacity=".7" />
        <polygon points="1010,330 1250,560 1010,790 770,560" fill="#0E417F" opacity=".32" />
        <polygon points="900,-20 1460,-20 1460,470 1190,470" transform="translate(-26 30)" fill="none" stroke="#F4B223" strokeWidth="3" opacity=".9" />
        <polygon points="-20,540 560,380 700,920 -20,920" transform="translate(26 -24)" fill="none" stroke="#F4B223" strokeWidth="3" opacity=".8" />
        <polygon points="1010,330 1250,560 1010,790 770,560" transform="translate(30 20)" fill="none" stroke="#F4B223" strokeWidth="2" opacity=".6" />
        <polygon points="860,0 920,0 1440,520 1440,455" fill="#2A5CB8" opacity=".65" />
        <polygon points="0,0 200,0 0,120" fill="#F4B223" />
        <polygon points="0,0 120,0 0,72" fill="#E8821E" />

        {([
          [TORN.trCream, TORN.trGold],
          [TORN.brCream, TORN.brGold],
          [TORN.blCream, TORN.blGold],
        ] as const).map(([cream, gold], i) => (
          <g key={i}>
            <polygon points={cream} fill="#F3EAD2" opacity=".92" />
            <polygon points={gold} fill="#F7B500" />
            <polygon points={gold} fill="url(#pr-halftone)" />
          </g>
        ))}
      </svg>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[.55]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,.16) 1.2px, transparent 1.5px)",
          backgroundSize: "26px 26px",
          WebkitMaskImage: fade,
          maskImage: fade,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          WebkitMaskImage: "radial-gradient(ellipse at 40% 50%, #000 0%, transparent 78%)",
          maskImage: "radial-gradient(ellipse at 40% 50%, #000 0%, transparent 78%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[10%] left-[40%] h-[130%] w-[110px] rotate-[24deg]"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,.07), rgba(255,255,255,0))" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[10%] left-[48%] h-[130%] w-[30px] rotate-[24deg]"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,.06), rgba(255,255,255,0))" }}
      />
    </>
  );
}

const CONDENSED = "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow', sans-serif";
const BEBAS = { fontFamily: CONDENSED } as const;

const D_MAIN = "260,15 410,165 260,315 110,165";
const D_MAIN_IN = "260,38 387,165 260,292 133,165";
const D_LEFT = "52,121 96,165 52,209 8,165";
const D_RIGHT = "468,121 512,165 468,209 424,165";

function GoldFrame({ points }: { points: string }) {
  return (
    <>
      <polygon points={points} fill="none" stroke="#7a4a00" strokeWidth="13" strokeLinejoin="miter" />
      <polygon points={points} fill="none" stroke="url(#pr-gold)" strokeWidth="9" strokeLinejoin="miter" />
      <polygon points={points} fill="none" stroke="url(#pr-dots)" strokeWidth="9" strokeLinejoin="miter" />
    </>
  );
}

function Spark({ cx, cy, h }: { cx: number; cy: number; h: number }) {
  return (
    <polygon
      points={`${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`}
      fill="url(#pr-gold)"
    />
  );
}

function CrestOrnament() {
  return (
    <svg
      viewBox="0 0 520 330"
      role="img"
      aria-label="Pet Royale crest"
      className="block max-w-full drop-shadow-[0_16px_28px_rgba(2,10,30,.5)]"
      style={{ height: "min(420px, 44vh)", width: "auto", aspectRatio: "520 / 330" }}
    >
      <defs>
        <linearGradient id="pr-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD84D" />
          <stop offset=".55" stopColor="#F4A81A" />
          <stop offset="1" stopColor="#E8821E" />
        </linearGradient>
        <linearGradient id="pr-navy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1650A8" />
          <stop offset="1" stopColor="#0a2a5a" />
        </linearGradient>
        <pattern id="pr-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.3" fill="#8a5a00" opacity=".45" />
        </pattern>
        <pattern id="pr-dots-gold" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="1.5" fill="#F4B223" opacity=".5" />
        </pattern>
        <radialGradient id="pr-glow">
          <stop offset=".5" stopColor="#F4B223" stopOpacity=".3" />
          <stop offset="1" stopColor="#F4B223" stopOpacity="0" />
        </radialGradient>
        <clipPath id="pr-crest-clip">
          <circle cx="260" cy="165" r="105" />
        </clipPath>
      </defs>

      <polygon points={D_LEFT} fill="#0b3070" />
      <polygon points={D_LEFT} fill="url(#pr-dots-gold)" />
      <GoldFrame points={D_LEFT} />
      <polygon points={D_RIGHT} fill="#0b3070" />
      <polygon points={D_RIGHT} fill="url(#pr-dots-gold)" />
      <GoldFrame points={D_RIGHT} />

      <polygon points={D_MAIN} fill="url(#pr-navy)" />
      <polygon points={D_MAIN_IN} fill="none" stroke="#F4B223" strokeWidth="1.5" opacity=".4" />
      <GoldFrame points={D_MAIN} />

      <Spark cx={452} cy={48} h={15} />
      <Spark cx={70} cy={288} h={15} />
      <Spark cx={488} cy={288} h={9} />
      <Spark cx={30} cy={50} h={9} />

      <circle cx="260" cy="165" r="150" fill="url(#pr-glow)" />
      <circle cx="260" cy="165" r="119" fill="none" stroke="#F4B223" strokeWidth="1.5" opacity=".6" />
      <image
        href="/assets/pet-royale-logo.png"
        x="155"
        y="60"
        width="210"
        height="210"
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#pr-crest-clip)"
      />
      <circle cx="260" cy="165" r="107" fill="none" stroke="#F4B223" strokeWidth="5" />
    </svg>
  );
}

function BrandTitle() {
  return (
    <svg
      viewBox="0 0 600 150"
      role="img"
      aria-label="Pet Royale' Clinic and Veterinary Services"
      className="mt-4 block max-w-full drop-shadow-[0_4px_10px_rgba(0,0,0,.45)]"
      style={{ height: "min(150px, 17vh)", width: "auto", aspectRatio: "600 / 150" }}
    >
      <defs>
        <linearGradient id="pr-title" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E4F5FF" />
          <stop offset=".42" stopColor="#8FD0FF" />
          <stop offset="1" stopColor="#F7B500" />
        </linearGradient>
        <linearGradient id="pr-title-2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8FD0FF" stopOpacity=".5" />
          <stop offset="1" stopColor="#F7B500" stopOpacity=".3" />
        </linearGradient>
        <pattern id="pr-title-dots" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1" fill="#0a2a5a" opacity=".38" />
        </pattern>
      </defs>
      <g aria-hidden="true" fontFamily={CONDENSED}>
        <text x="0" y="80" fontSize="84" textLength="600" lengthAdjust="spacingAndGlyphs" fill="url(#pr-title)">
          {"PET ROYALE' CLINIC"}
        </text>
        <text x="0" y="80" fontSize="84" textLength="600" lengthAdjust="spacingAndGlyphs" fill="url(#pr-title-dots)">
          {"PET ROYALE' CLINIC"}
        </text>
        <text
          x="0"
          y="134"
          fontSize="40"
          textLength="600"
          lengthAdjust="spacing"
          fill="url(#pr-title-2)"
          stroke="#F7B500"
          strokeWidth="1.6"
        >
          AND VETERINARY SERVICES
        </text>
      </g>
    </svg>
  );
}

function BrandPanel() {
  return (
    <div className="relative flex min-w-0 flex-col items-center text-center">
      <CrestOrnament />
      <BrandTitle />

      <div aria-hidden="true" className="mt-5 hidden w-[300px] max-w-full items-center gap-3 md:flex">
        <span className="h-px flex-1 bg-gradient-to-r from-[#F4B223]/0 to-[#F4B223]" />
        <span className="h-2 w-2 rotate-45 bg-[#F4B223]" />
        <span className="h-px flex-1 bg-gradient-to-l from-[#F4B223]/0 to-[#F4B223]" />
      </div>

      <div className="hidden md:block">
        <Lettering
          src="/assets/pet-royale-tagline.png"
          alt="We Care For You and Your Pets"
          className="relative mt-3.5 w-[260px]"
          fallbackClassName="relative mt-3.5 text-[15px] italic text-white/80"
          skeletonHeight="h-4"
        />
      </div>

    </div>
  );
}

function CodeInput({
  value, onChange, onComplete, disabled, invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (index: number, digit: string) => {
    const next = value.split("");
    next[index] = digit;
    const joined = next.join("").slice(0, 6);
    onChange(joined);

    if (digit && index < 5) refs.current[index + 1]?.focus();
    if (joined.length === 6 && !joined.includes(" ")) {
      refs.current[index]?.blur();
      onComplete(joined);
    }
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (value[index]) {
        const next = value.split("");
        next[index] = "";
        onChange(next.join("").trimEnd());
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        const next = value.split("");
        next[index - 1] = "";
        onChange(next.join("").trimEnd());
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    onChange(digits);
    refs.current[Math.min(digits.length, 5)]?.focus();
    if (digits.length === 6) onComplete(digits);
  };

  return (
    <div
      className="flex justify-between gap-2"
      style={{ animation: invalid ? "pr-code-shake 420ms cubic-bezier(.36,.07,.19,.97)" : undefined }}
    >
      {Array.from({ length: 6 }).map((_, i) => {
        const filled = !!value[i];
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            name={i === 0 ? "one-time-code" : undefined}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            inputMode="numeric"
            maxLength={1}
            disabled={disabled}
            value={value[i] || ""}
            onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, "").slice(-1))}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            autoFocus={i === 0}
            aria-label={`Digit ${i + 1} of 6`}
            className={`pr-field h-14 w-full rounded-2xl border-2 text-center text-[24px] font-bold tabular-nums text-[hsl(var(--foreground))] outline-none transition-all duration-150 disabled:opacity-40 ${
              invalid
                ? "border-[hsl(var(--destructive))] bg-[hsl(var(--card))]"
                : filled
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--card))]"
                  : "border-transparent bg-[hsl(var(--muted))] focus:border-[hsl(var(--primary))] focus:bg-[hsl(var(--card))]"
            }`}
            style={filled && !invalid ? { animation: "pr-digit 220ms cubic-bezier(.22,1,.36,1)" } : undefined}
          />
        );
      })}
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAdminStore((s) => s.login);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning, team" : hour < 18 ? "Good afternoon, team" : "Good evening, team";

  const returnTo = (() => {
    const from = (location.state as { from?: unknown } | null)?.from;
    return typeof from === "string" && from.startsWith("/") &&
      !from.startsWith("//") && !from.startsWith("/login")
      ? from
      : "/start";
  })();

  const [step, setStep] = useState<Step>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("idle");
  const loading = authState === "checking";
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<{ email?: boolean; password?: boolean }>({});
  const [capsLock, setCapsLock] = useState(false);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [attempts, setAttempts] = useState(() => Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0));
  const [lockedUntil, setLockedUntil] = useState(readLockout);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const passwordOk = PASSWORD_RULES.every((r) => r.test(newPassword));
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const locked = lockedUntil > Date.now();

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  useEffect(() => {
    if (!locked) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        sessionStorage.removeItem(LOCKED_UNTIL_KEY);
        sessionStorage.removeItem(ATTEMPTS_KEY);
        setLockedUntil(0);
        setAttempts(0);
        setError(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locked, lockedUntil]);

  const registerFailure = () => {
    const next = attempts + 1;
    setAttempts(next);
    sessionStorage.setItem(ATTEMPTS_KEY, String(next));
    if (next >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS;
      sessionStorage.setItem(LOCKED_UNTIL_KEY, String(until));
      setLockedUntil(until);
    }
    return next;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      setBadFields({ email: !email.trim(), password: !password });
      return;
    }

    setBadFields({});
    setAuthState("checking");

    try {
      const result = await login(email.trim(), password);

      if (result.success) {
        sessionStorage.removeItem(ATTEMPTS_KEY);
        sessionStorage.removeItem(LOCKED_UNTIL_KEY);
        recordAuthEvent(email, "password_ok");

        await supabase.auth.signOut();

        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: false },
        });

        if (otpError) {
          setError("Couldn't send your code. Please try again in a moment.");
          setAuthState("idle");
          return;
        }

        setPassword("");
        setCode("");
        setCodeError(null);
        setResendIn(60);
        setStep("code");
        setAuthState("idle");
        return;
      }

      if (result.code === "inactive" || result.code === "no_access") {
        setError(result.error ?? "This account can't sign in. Please contact the clinic owner.");
        setBadFields({});
        setAuthState("idle");
        return;
      }

      const used = registerFailure();
      const remaining = MAX_ATTEMPTS - used;
      recordAuthEvent(email, remaining <= 0 ? "locked_out" : "password_failed");

      setBadFields({ email: true, password: true });
      setError(
        remaining <= 0
          ? "Too many failed attempts. Signing in is locked for five minutes."
          : remaining <= 2
            ? `That didn't match. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left before this is locked.`
            : "That email and password don't match."
      );

      setAuthState("denied");
      window.setTimeout(() => setAuthState("idle"), 900);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setAuthState("idle");
    }
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    void verifyCode(code);
  };

  const verifyCode = async (raw: string) => {
    setCodeError(null);
    const clean = raw.replace(/\D/g, "");
    if (clean.length !== 6) {
      setCodeError("Enter the six-digit code from your email.");
      return;
    }

    setVerifying(true);
    setAuthState("checking");

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: clean,
      type: "email",
    });

    setVerifying(false);

    if (error) {
      recordAuthEvent(email, "otp_failed");
      setCodeError("That code didn't work. It may have expired — request a new one.");
      setAuthState("denied");
      window.setTimeout(() => setAuthState("idle"), 900);
      return;
    }

    recordAuthEvent(email, "otp_ok");
    setAuthState("granted");
    window.setTimeout(() => navigate(returnTo, { replace: true }), 1100);
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setResending(true);
    setCodeError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    setResending(false);
    if (error) {
      setCodeError("Couldn't send another code. Try again shortly.");
      return;
    }
    setResendIn(60);
  };

  const handleResendReset = async () => {
    if (resendIn > 0) return;
    setResending(true);
    setResetError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: resetEmail.trim(),
      options: { shouldCreateUser: false },
    });

    setResending(false);
    if (error) {
      setResetError("Couldn't send another code. Try again shortly.");
      return;
    }
    setResendIn(60);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!resetEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError("Enter a valid email address.");
      return;
    }

    setResetLoading(true);
    try {
  
      const { error } = await supabase.auth.signInWithOtp({
        email: resetEmail.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;

      setResetCode("");
      setStep("reset-code");
      setResendIn(60);
    } catch {
      setResetError("Couldn't send that code. Please try again in a moment.");
    } finally {
      setResetLoading(false);
    }
  };

  const verifyResetCode = async (raw: string) => {
    const clean = raw.replace(/\D/g, "");
    if (clean.length !== 6) return;

    setResetError(null);
    setSavingPassword(true);

    const { error } = await supabase.auth.verifyOtp({
      email: resetEmail.trim(),
      token: clean,
      type: "email",
    });

    setSavingPassword(false);

    if (error) {
      setResetError("That code didn't work. It may have expired — request a new one.");
      setAuthState("denied");
      window.setTimeout(() => setAuthState("idle"), 900);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setStep("new-password");
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!PASSWORD_RULES.every((r) => r.test(newPassword))) {
      setResetError("That password doesn't meet all the requirements below.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("Those passwords don't match.");
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      setResetError(error.message);
      return;
    }

    await (supabase as any).rpc("complete_password_change");

    recordAuthEvent(resetEmail, "otp_ok");
    setAuthState("granted");
    window.setTimeout(() => navigate(returnTo, { replace: true }), 1100);
  };

  const abandonReset = async () => {
    await supabase.auth.signOut();
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setResetError(null);
    setStep("login");
  };

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const ring =
    authState === "denied" ? "hsl(var(--destructive))"
    : authState === "granted" ? "hsl(145 42% 45%)"
    : "#F4B223";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[hsl(var(--primary))]">
      <ThemeStyles />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_600px_at_18%_40%,rgb(255_255_255/.09),transparent_70%)]"
      />
      <GeometricBackdrop />

      <style>{`
        button:focus-visible {
          outline: 2px solid hsl(var(--primary));
          outline-offset: 2px;
        }
        /* Focus on a field is shown by its navy border alone. This clears
           any outline or glow a global stylesheet adds to inputs. */
        .pr-field:-webkit-autofill + .pr-float {
          top: 15px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
        }
        .pr-field:focus, .pr-field:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        @keyframes pr-overlay-in {
          from { opacity: 0 }
          to   { opacity: 1 }
        }
        @keyframes pr-fade-up {
          from { opacity: 0; transform: translateY(6px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes pr-ring {
          0%   { transform: scale(.7); opacity: 0 }
          55%  { transform: scale(1.08); opacity: 1 }
          100% { transform: scale(1); opacity: 1 }
        }
        @keyframes pr-shake {
          0%, 100% { transform: translateX(0) }
          15%      { transform: translateX(-9px) }
          30%      { transform: translateX(8px) }
          45%      { transform: translateX(-6px) }
          60%      { transform: translateX(4px) }
          80%      { transform: translateX(-2px) }
        }
        @keyframes pr-digit {
          0%   { transform: scale(.88) }
          60%  { transform: scale(1.04) }
          100% { transform: scale(1) }
        }
        @keyframes pr-code-shake {
          0%, 100% { transform: translateX(0) }
          20%      { transform: translateX(-7px) }
          40%      { transform: translateX(6px) }
          60%      { transform: translateX(-4px) }
          80%      { transform: translateX(3px) }
        }
        @keyframes pr-bar {
          from { width: 0 }
          to   { width: 100% }
        }
        @keyframes pr-card-shake {
          0%, 100% { transform: translateX(0) }
          20%      { transform: translateX(-5px) }
          40%      { transform: translateX(5px) }
          60%      { transform: translateX(-3px) }
          80%      { transform: translateX(2px) }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="pr-ring"], [style*="pr-shake"], [style*="pr-card-shake"],
          [style*="pr-digit"], [style*="pr-code-shake"] {
            animation: none !important;
          }
        }
      `}</style>

      <div
        className="relative flex min-h-screen items-center justify-center px-4 pb-14 pt-8"
        style={{
          animation: authState === "denied"
            ? "pr-card-shake 420ms cubic-bezier(.36,.07,.19,.97)"
            : undefined,
        }}
      >
        <AccessOverlay state={authState} />

        <div className="relative z-10 grid w-full max-w-[1180px] items-center gap-8 md:grid-cols-[1fr_480px] md:gap-[72px]">
        <BrandPanel />

        {/* Sign-in card */}
        <div
          className="relative rounded-[28px] bg-[hsl(var(--background))] p-7 transition-shadow duration-200 sm:p-10"
          style={{
            boxShadow: `0 0 0 6px hsl(var(--primary)), 0 0 0 9px ${ring}, 0 30px 60px -20px rgb(0 0 0/.6)`,
          }}
        >
          <div
            aria-hidden="true"
            className="-mx-7 -mt-7 mb-7 h-1.5 rounded-t-[28px] bg-gradient-to-r from-[#F4B223] to-[#E8821E] sm:-mx-10 sm:-mt-10 sm:mb-8"
          />
          <div className="w-full">

          {step === "login" && (
            <>
              <StepBar step={1} />
              <div className="mb-2.5 flex items-center gap-2 text-[12px] font-bold tracking-[.14em] text-[#7a5c0c]">
                <span aria-hidden="true" className="h-2 w-2 rotate-45 bg-[#F4B223]" />
                STAFF PORTAL
              </div>
              <h1 className={H1}>{greeting}</h1>
              <p className={SUB}>
                Authorized staff only. After your password, we email you a code.
              </p>

              <form onSubmit={handleLogin} className="mt-8">
                <div className="space-y-4">
                  <FloatField
                    id="email"
                    name="email"
                    type="email"
                    label="Email address"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                    disabled={locked}
                    error={badFields.email}
                  />

                  <FloatField
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                    onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                    disabled={locked}
                    error={badFields.password}
                    labelRight={
                      <button
                        type="button"
                        onClick={() => { setStep("forgot"); setResetEmail(email); setResetError(null); }}
                        className="flex min-h-11 items-center text-[14px] font-bold text-[hsl(var(--primary))] hover:underline"
                      >
                        Forgot password?
                      </button>
                    }
                    right={
                      <EyeButton
                        shown={showPassword}
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={locked}
                      />
                    }
                  />
                </div>

                <div className="min-h-[56px]">
                  {error ? (
                    <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-[hsl(var(--destructive)/.12)] px-3.5 py-3">
                      <TriangleAlert size={17} className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]" />
                      <p className="text-[14px] font-medium leading-snug text-[hsl(var(--destructive))]">{error}</p>
                    </div>
                  ) : capsLock ? (
                    <p className="flex items-center gap-1.5 pt-2 text-[14px] font-medium text-[hsl(40_80%_35%)]">
                      <AlertTriangle size={15} /> Caps lock is on
                    </p>
                  ) : null}
                </div>

                {locked ? (
                  <div className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[hsl(var(--muted))] text-[15px] font-bold text-[hsl(var(--muted-foreground))]">
                    <Lock size={17} />
                    <span className="tabular-nums">{mmss}</span>
                    <span className="font-medium">until you can try again</span>
                  </div>
                ) : (
                  <button type="submit" disabled={loading || !email.trim() || !password} className={BTN}>
                    {loading
                      ? <><Loader2 size={18} className="animate-spin" /> Checking…</>
                      : "Continue"}
                  </button>
                )}
              </form>
            </>
          )}

          {step === "code" && (
            <>
              <StepBar step={2} />

              <button
                onClick={() => { setStep("login"); setCode(""); setCodeError(null); }}
                className={BACK}
                aria-label="Back"
              >
                <ChevronLeft size={28} strokeWidth={2.2} />
              </button>

              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <KeyRound size={22} className="text-[hsl(var(--primary))]" />
              </span>

              <h1 className={`mt-5 ${H1_STEP}`}>Enter your code</h1>
              <p className={SUB}>
                We sent six digits to{" "}
                <span className="break-all font-bold text-[hsl(var(--foreground))]">{email.trim()}</span>. It
                expires in a few minutes.
              </p>

              <form onSubmit={handleVerify} className="mt-8">
                <label className={LABEL}>Verification code</label>

                <CodeInput
                  value={code}
                  onChange={(next) => { setCode(next); if (codeError) setCodeError(null); }}
                  onComplete={(full) => void verifyCode(full)}
                  disabled={verifying}
                  invalid={!!codeError}
                />

                <ErrorSlot message={codeError} />

                <button type="submit" disabled={verifying || code.length !== 6} className={BTN}>
                  {verifying
                    ? <><Loader2 size={18} className="animate-spin" /> Verifying…</>
                    : "Verify"}
                </button>
              </form>

              <button
                onClick={handleResend}
                disabled={resendIn > 0 || resending}
                className={`mt-2 w-full text-center ${LINK}`}
              >
                {resending
                  ? "Sending…"
                  : resendIn > 0
                    ? `Send another code in ${resendIn}s`
                    : "Didn't get it? Send another code"}
              </button>
            </>
          )}

          {step === "forgot" && (
            <>
              <button
                onClick={() => { setStep("login"); setResetError(null); }}
                className={BACK}
                aria-label="Back"
              >
                <ChevronLeft size={28} strokeWidth={2.2} />
              </button>

              <h1 className={H1_STEP}>Reset password</h1>
              <p className={SUB}>
                We&apos;ll email a six-digit code. Enter it here and you can set a
                new password straight away.
              </p>

              <form onSubmit={handleReset} className="mt-8">
                <FloatField
                  id="reset-email"
                  name="email"
                  type="email"
                  label="Email address"
                  autoComplete="username"
                  value={resetEmail}
                  onChange={(e) => { setResetEmail(e.target.value); if (resetError) setResetError(null); }}
                  autoFocus
                  error={!!resetError}
                />

                <ErrorSlot message={resetError} />

                <button type="submit" disabled={resetLoading} className={BTN}>
                  {resetLoading
                    ? <><Loader2 size={18} className="animate-spin" /> Sending…</>
                    : "Send code"}
                </button>
              </form>
            </>
          )}

          {step === "reset-code" && (
            <>
              <button
                onClick={() => { setStep("forgot"); setResetError(null); }}
                className={BACK}
                aria-label="Back"
              >
                <ChevronLeft size={28} strokeWidth={2.2} />
              </button>

              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <MailCheck size={22} className="text-[hsl(var(--primary))]" />
              </span>

              <h1 className={`mt-5 ${H1_STEP}`}>Enter your code</h1>
              <p className={SUB}>
                We sent six digits to{" "}
                <span className="break-all font-bold text-[hsl(var(--foreground))]">{resetEmail.trim()}</span>.
              </p>

              <div className="mt-8">
                <label className={LABEL}>Verification code</label>

                <CodeInput
                  value={resetCode}
                  onChange={(next) => { setResetCode(next); if (resetError) setResetError(null); }}
                  onComplete={(full) => void verifyResetCode(full)}
                  disabled={savingPassword}
                  invalid={!!resetError}
                />

                <ErrorSlot message={resetError} />

                <button
                  onClick={() => void verifyResetCode(resetCode)}
                  disabled={savingPassword || resetCode.length !== 6}
                  className={BTN}
                >
                  {savingPassword
                    ? <><Loader2 size={18} className="animate-spin" /> Checking…</>
                    : "Continue"}
                </button>
              </div>

              <button
                onClick={handleResendReset}
                disabled={resendIn > 0 || resending}
                className={`mt-2 w-full text-center ${LINK}`}
              >
                {resending
                  ? "Sending…"
                  : resendIn > 0
                    ? `Send another code in ${resendIn}s`
                    : "Didn't get it? Send another code"}
              </button>
            </>
          )}

          {step === "new-password" && (
            <>
              <button
                onClick={() => void abandonReset()}
                className={BACK}
                aria-label="Cancel"
              >
                <ChevronLeft size={28} strokeWidth={2.2} />
              </button>

              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <KeyRound size={22} className="text-[hsl(var(--primary))]" />
              </span>

              <h1 className={`mt-3 ${H1_STEP}`}>Set a new password</h1>
              <p className={SUB}>Use something you don&apos;t use anywhere else.</p>

              <form onSubmit={handleSetPassword} className="mt-5">
                <FloatField
                  id="new-password"
                  name="new-password"
                  type={showNew ? "text" : "password"}
                  label="New password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); if (resetError) setResetError(null); }}
                  autoFocus
                  right={<EyeButton shown={showNew} onClick={() => setShowNew((v) => !v)} />}
                />

                <ul className="mt-2 space-y-1" aria-label="Password requirements">
                  {PASSWORD_RULES.map((r) => {
                    const ok = r.test(newPassword);
                    return (
                      <li
                        key={r.label}
                        className={`flex items-center gap-2 text-[14px] ${
                          ok ? "font-medium text-[hsl(145_42%_27%)]" : "text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {ok
                          ? <Check size={15} aria-hidden="true" />
                          : <span className="h-[15px] w-[15px] rounded-full border border-current opacity-50" aria-hidden="true" />}
                        {r.label}
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-3">
                  <FloatField
                    id="confirm-password"
                    name="confirm-password"
                    type={showNew ? "text" : "password"}
                    label="Confirm password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); if (resetError) setResetError(null); }}
                    error={!!confirmPassword && newPassword !== confirmPassword}
                  />
                </div>

                <ErrorSlot message={resetError} />

                <button
                  type="submit"
                  disabled={savingPassword || !passwordOk || !confirmPassword}
                  className={BTN}
                >
                  {savingPassword
                    ? <><Loader2 size={18} className="animate-spin" /> Saving…</>
                    : "Save and sign in"}
                </button>
              </form>
            </>
          )}

          {(!secure || (attempts > 0 && !locked)) && (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] pt-4">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                {!secure && (
                  <>
                    <TriangleAlert size={15} className="text-[hsl(40_80%_45%)]" />
                    <span className="text-[hsl(40_80%_35%)]">Not a secure connection</span>
                  </>
                )}
              </span>

              {attempts > 0 && !locked && (
                <span className="text-[13px] font-medium tabular-nums text-[hsl(var(--muted-foreground))]">
                  {attempts}/{MAX_ATTEMPTS} attempts
                </span>
              )}
            </div>
          )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
