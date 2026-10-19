import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAppointmentsInRange, fetchStaffDirectory, staffDisplayName, type Appointment,
} from "@/api/appointments";
import { fetchProducts } from "@/api/products";
import { fetchInventory } from "@/api/inventory";
import { Link } from "react-router-dom";
import {
  CalendarDays, CalendarCheck, Check, Clock3, X,
  ChevronRight, AlertTriangle, PawPrint, CreditCard, Package, Plus, Search,
  type LucideIcon,
} from "lucide-react";

/* Layout and look follow the dashboard design: soft filled status chips, 40px
   round avatars, a segmented filter with search, and cards with small radii.
   Logic, queries and routes are unchanged. */

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(Number(n)).toLocaleString("en-PH")}`;

/* Capitalizes the first letter of each word without touching the rest ("dos" -> "Dos"). */
const titleCase = (s?: string | null) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function fmtPhone(phone?: string | null) {
  if (!phone) return "—";
  const match = phone.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  return match ? `+63 ${match[1]} ${match[2]} ${match[3]}` : phone;
}

function serviceLines(service?: string | null) {
  const label = (service || "").replace(/\s+/g, " ").trim();
  const lineBreaks: Record<string, string[]> = {
    "confinement & emergency care": ["Confinement &", "Emergency Care"],
    "veterinary check-ups": ["Veterinary", "Check-ups"],
    "veterinary check-ups and consultations": ["Veterinary", "Check-ups"],
    "minor & major surgeries": ["Minor & Major", "Surgeries"],
    "vaccination & deworming": ["Vaccination &", "Deworming"],
  };
  return lineBreaks[label.toLowerCase()] ?? [label];
}

/* Both widgets are a glance view, not the full table. */
const WIDGET_PAGE_SIZE = 5;

/* Statuses that count as "happening today". Cancelled and null statuses are
   left out, so the schedule list and its tabs always agree. */
const COUNTS_TODAY: string[] = ["incoming", "confirmed", "completed"];

/* How often the dashboard re-reads the database, so a screen left open all
   day stays current and rolls over to the next day after midnight. */
const REFRESH_MS = 60_000;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* Same fields as the Appointments table, with its Source and Action fields
   left out because dashboard rows link to the appointment list. */
const ROW_COLS = "lg:grid-cols-[minmax(108px,.8fr)_minmax(150px,1.1fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_minmax(130px,1fr)_minmax(150px,1fr)]";
const ROW_COLS_RECENT = "lg:grid-cols-[minmax(118px,.85fr)_minmax(150px,1.1fr)_minmax(145px,1fr)_minmax(140px,1fr)_minmax(125px,.9fr)_minmax(92px,.65fr)_minmax(140px,1fr)]";

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) {
  if (!iso) return "No date";
  const clean = iso.length > 10 ? iso.slice(0, 10) : iso;
  const d = new Date(clean + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", opts);
}
const SHORT_DATE: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

/* Times are stored as text, so "10:30 AM" sorts before "9:00 AM" on a
   plain string compare. Parse before sorting. */
function timeToMinutes(t?: string | null) {
  if (!t) return 9999;
  // 24-hour text such as "15:30" or "15:30:00" (older rows, other clients).
  const h24 = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (h24) return parseInt(h24[1]) * 60 + parseInt(h24[2]);
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/* "03:30 PM", "3:30 pm" and "15:30" all show the same way. */
function fmtSlot(t?: string | null) {
  if (!t) return "";
  const mins = timeToMinutes(t);
  if (mins === 9999) return t;
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}

function slotPassed(date: string, time: string) {
  const now = new Date();
  const today = toLocalISO(now);
  const clean = date.length > 10 ? date.slice(0, 10) : date;
  if (clean < today) return true;
  if (clean > today) return false;
  return timeToMinutes(time) <= now.getHours() * 60 + now.getMinutes();
}

function assignedStaffLabel(apt: Appointment, staffMap: Record<string, string>) {
  if (apt.assigned_staff_id) return staffMap[apt.assigned_staff_id] || "Unknown staff";
  if (apt.assigned_staff_name) return apt.assigned_staff_name;
  return null;
}

/* ── Status chips: soft filled, one colour per status ── */
const PILL: Record<string, string> = {
  Completed: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]",
  Confirmed: "bg-[hsl(168_35%_89%)] text-[hsl(168_38%_24%)]",
  Pending: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
  Cancelled: "bg-[hsl(12_70%_93%)] text-[hsl(12_58%_36%)]",
};

const PILL_ICON: Record<string, React.ElementType> = {
  Completed: Check, Confirmed: CalendarCheck, Pending: Clock3, Cancelled: X,
};

const STATUS_LABEL: Record<string, string> = {
  incoming: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled",
};

function Pill({ label }: { label: string }) {
  const Icon = PILL_ICON[label];
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold ${
        PILL[label] ?? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
      }`}
    >
      {Icon && <Icon size={13} strokeWidth={3} aria-hidden="true" />}
      {label}
    </span>
  );
}

/* Status pill with "Confirmed by <staff>" or "Added by <staff>" under it,
   so it is clear what the name means. A long name wraps onto a second line
   instead of being cut off with "…". */
function StatusCell({
  status, attribution,
}: { status: string; attribution?: { label: string; name: string } | null }) {
  return (
    <>
      <Pill label={STATUS_LABEL[status] || status} />
      {attribution ? (
        <p className="mt-1 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]" title={`${attribution.label} ${attribution.name}`}>
          <span className="block">{attribution.label}</span>
          <span className="block break-words font-semibold text-[hsl(var(--foreground))]">{attribution.name}</span>
        </p>
      ) : null}
    </>
  );
}

/* Round avatar in the navy ring: the pet's photo, or its initials when it
   has none. Name and species beside it. */
function PatientCell({
  name, species, age, gender, photo,
}: {
  name?: string | null; species?: string | null; age?: string | number | null;
  gender?: string | null; photo?: string | null;
}) {
  const details = [
    species,
    age !== null && age !== undefined && age !== "" ? typeof age === "number" ? `${age} yrs` : age : null,
    gender,
  ].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-[hsl(var(--primary))]">
        {photo ? (
          <img src={photo} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[hsl(43_85%_93%)] text-[14px] font-extrabold text-[hsl(var(--primary))]">
            {(name || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-[14px] font-bold leading-snug">{name}</p>
        <p className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{details}</p>
      </div>
    </div>
  );
}

function DateTimeCell({
  time, date, flag,
}: { time?: string | null; date?: string | null; flag?: { label: string; cls: string } | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">{safeDate(date, { month: "short", day: "numeric" })}</p>
      <p className="text-[14px] font-extrabold tabular-nums">{time ? fmtSlot(time) : "—"}</p>
      {flag && (
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[13px] font-bold ${flag.cls}`}>
          {flag.label}
        </span>
      )}
    </div>
  );
}

const TABLE_HEAD =
  "hidden gap-4 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--muted)/.55)] px-6 py-[11px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] lg:grid";

const ROW_BASE =
  "grid gap-3 border-b border-[hsl(var(--border)/.7)] px-5 py-3.5 transition last:border-0 hover:bg-[hsl(var(--muted)/.45)] lg:items-center lg:gap-4 lg:px-6";

const PANEL =
  "-mx-5 overflow-hidden rounded-none border border-[hsl(var(--border))] bg-white sm:-mx-8 lg:-mx-10";

function Pager({
  page, totalPages, onChange,
}: {
  page: number; totalPages: number; onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const btn = `h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`;
  return (
    <div className="flex items-center gap-2">
      <button disabled={page === 1} onClick={() => onChange(page - 1)} className={btn}>Previous</button>
      <span className="px-1 text-[14px] font-bold" aria-live="polite">{page} / {totalPages}</span>
      <button disabled={page === totalPages} onClick={() => onChange(page + 1)} className={btn}>Next</button>
    </div>
  );
}

/* ── Skeletons ──
   Grey placeholders in the same shapes and sizes as the real content, shown
   while the dashboard data loads, so the page doesn't jump when it arrives. */
function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-full bg-[hsl(var(--muted))] motion-reduce:animate-none ${className}`}
    />
  );
}

/* Rows shaped like the schedule and recent-visits tables. `heads` are the
   real column titles, so the columns line up with the finished table.
   `recent` adds the Billing column. */
function TableSkeleton({
  cols, heads, rows = WIDGET_PAGE_SIZE, recent = false,
}: { cols: string; heads: string[]; rows?: number; recent?: boolean }) {
  const widths = ["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5"];
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className={`${TABLE_HEAD} ${cols}`}>
        {heads.map((h) => <span key={h}>{h}</span>)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`grid gap-3 border-b border-[hsl(var(--border)/.7)] px-5 py-3.5 last:border-0 lg:items-center lg:gap-4 lg:px-6 ${cols}`}
        >
          <div className="space-y-1.5">
            <Bar className="h-4 w-16" />
            {recent && <Bar className="h-3 w-20" />}
          </div>
          <div className="flex items-center gap-3">
            <Bar className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className={`h-4 ${widths[i % widths.length]}`} />
              <Bar className="h-3 w-1/3" />
            </div>
          </div>
          <Bar className={`h-4 ${widths[(i + 2) % widths.length]}`} />
          <Bar className={`h-4 ${widths[(i + 1) % widths.length]}`} />
          <div className="space-y-1.5">
            <Bar className={`h-4 ${widths[(i + 3) % widths.length]}`} />
            <Bar className="h-3 w-1/2" />
          </div>
          {recent && <Bar className="h-4 w-16" />}
          <div className="hidden space-y-1 lg:block">
            <Bar className="h-7 w-24" />
            <Bar className="h-3 w-32 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* One soft track with a navy tab for the chosen view, each with its count.
   A tab with nothing in it is dimmed so the useful tabs stand out. */
function SegmentedTabs<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; count: number }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-10 max-w-full gap-0 overflow-x-auto rounded-xl bg-white p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={`flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] font-semibold transition ${FOCUS_RING} ${
              active
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {o.label}
            <span
              className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
                active ? "bg-white/20" : "bg-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
              } ${o.count === 0 && !active ? "opacity-50" : ""}`}
            >
              {o.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* Peso sign and amount, no circle behind it. */
function TotalCell({ total }: { total?: number }) {
  if (total === undefined) {
    return <span className="text-[14px] text-[hsl(var(--muted-foreground))]" aria-label="Not billed">—</span>;
  }
  return (
    <p className="flex items-center gap-1.5 text-[14px] font-extrabold tabular-nums" aria-label={peso(total)}>
      <span aria-hidden="true" className="text-[14px] font-extrabold leading-none text-[hsl(43_72%_40%)]">₱</span>
      <span aria-hidden="true">{peso(total).slice(1)}</span>
    </p>
  );
}

/* Panel shown in place of a table when its data couldn't be read, so a
   failed query never looks like "nothing booked". */
function LoadFailed({ what }: { what: string }) {
  return (
    <div className="p-14 text-center">
      <AlertTriangle className="mx-auto text-[hsl(12_58%_42%)]" aria-hidden="true" />
      <p className="mt-3 text-[15px] font-bold">Couldn&apos;t load {what}</p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">
        Use &quot;Try again&quot; at the top of the page.
      </p>
    </div>
  );
}

async function fetchDashboard() {
  const todayStr = toLocalISO(new Date());
  const weekAgo = toLocalISO(new Date(Date.now() - 7 * 86_400_000));
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(24, 0, 0, 0)).toISOString();

  const [
    todayApptsRaw, pendingRes, paymentsRes, weekRes,
  ] = await Promise.all([
    fetchAppointmentsInRange(todayStr, todayStr),
    /* Awaiting confirmation counts every date, not just today. */
    (supabase as any)
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "incoming"),
    /* Money taken today, read from `payments` rather than invoices. */
    (supabase as any)
      .from("payments")
      .select("amount")
      .gte("paid_at", dayStart)
      .lt("paid_at", dayEnd),
    /* The week's patient activity: appointments only. Days before today:
       today's visits are already in Today's schedule, and without an upper
       bound, future bookings would fill the limit and push out real visits. */
    (supabase as any)
      .from("appointments")
      .select("id, pet_id, pet_name, pet_species, pet_age, pet_gender, client_id, client_name, client_phone, service, assigned_staff_id, assigned_staff_name, assigned_staff_role, requested_date, scheduled_time, status, confirmed_by_staff_id, created_by_staff_id")
      .gte("requested_date", weekAgo)
      .lt("requested_date", todayStr)
      .in("status", ["confirmed", "completed"])
      .order("requested_date", { ascending: false })
      .limit(50),
  ]);

  /* Supabase returns { data: null, error } instead of throwing. Without this
     check a failed query would show as zero payments or no visits. */
  const failed = [pendingRes, paymentsRes, weekRes].find((r: any) => r.error);
  if (failed) throw failed.error;

  const todayAppts = [...todayApptsRaw].sort(
    (a, b) => timeToMinutes(a.scheduled_time) - timeToMinutes(b.scheduled_time)
  );

  const takenToday = (paymentsRes.data || [])
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  /* What each of those visits was billed, for the Total column. An
     appointment can have more than one invoice, so the amounts are added. */
  const weekActivity: any[] = weekRes.data || [];
  const weekTotals: Record<string, number> = {};
  const weekIds = weekActivity.map((r) => r.id);
  if (weekIds.length > 0) {
    const { data: invs, error: invErr } = await (supabase as any)
      .from("invoices")
      .select("appointment_id, total_amount")
      .in("appointment_id", weekIds);
    if (invErr) throw invErr;
    (invs || []).forEach((i: any) => {
      if (i.appointment_id) {
        weekTotals[i.appointment_id] = (weekTotals[i.appointment_id] ?? 0) + Number(i.total_amount || 0);
      }
    });
  }

  /* Load current owner and pet details just like the Appointments table.
     Appointment snapshots can be empty or stale for these profile fields. */
  const petPhotos: Record<string, string> = {};
  const petProfiles: Record<string, { age: number | null; gender: string | null }> = {};
  const petIds = Array.from(new Set(
    [...todayAppts, ...weekActivity].map((a: any) => a.pet_id).filter(Boolean)
  )) as string[];
  if (petIds.length > 0) {
    for (let i = 0; i < petIds.length; i += 100) {
      const { data: pets, error } = await (supabase as any)
        .from("pets").select("id, photo_url, age, gender").in("id", petIds.slice(i, i + 100));
      if (error) throw error;
      (pets || []).forEach((p: any) => {
        if (p.photo_url) petPhotos[p.id] = p.photo_url;
        petProfiles[p.id] = { age: p.age ?? null, gender: p.gender ?? null };
      });
    }
  }

  const ownerPhones: Record<string, string | null> = {};
  const ownerIds = Array.from(new Set(
    [...todayAppts, ...weekActivity].map((a: any) => a.client_id).filter(Boolean)
  )) as string[];
  if (ownerIds.length > 0) {
    for (let i = 0; i < ownerIds.length; i += 100) {
      const { data: owners, error } = await (supabase as any)
        .from("clients")
        .select("id, phone")
        .in("id", ownerIds.slice(i, i + 100))
        .is("deleted_at", null);
      if (error) throw error;
      (owners || []).forEach((owner: { id: string; phone: string | null }) => {
        ownerPhones[owner.id] = owner.phone;
      });
    }
  }

  return {
    todayAppts,
    petPhotos,
    petProfiles,
    ownerPhones,
    pendingCount: pendingRes.count ?? 0,
    takenToday,
    weekActivity,
    weekTotals,
  };
}

/* Completed visits with no invoice: care delivered that nobody has charged for. */
async function fetchUnbilled() {
  const { data: completed, error: apptErr } = await (supabase as any)
    .from("appointments")
    .select("id, pet_name")
    .eq("status", "completed")
    .order("requested_date", { ascending: false })
    .limit(50);
  if (apptErr) throw apptErr;
  const ids = (completed || []).map((a: any) => a.id);
  if (ids.length === 0) return [];
  const { data: invoices, error: invErr } = await (supabase as any)
    .from("invoices").select("appointment_id").in("appointment_id", ids);
  if (invErr) throw invErr;
  const billed = new Set((invoices || []).map((i: any) => i.appointment_id));
  return (completed || []).filter((a: any) => !billed.has(a.id));
}

/* Items that need reordering: Out plus Low, in Pet Essentials (products) and
   Supplies (inventory). Same rule as the Inventory screen: stock of 10 or
   fewer. Keep LOW_STOCK_THRESHOLD equal to the one in Inventory.tsx. */
const LOW_STOCK_THRESHOLD = 10;
async function fetchLowStockCount() {
  const [products, supplies] = await Promise.all([fetchProducts(), fetchInventory()]);
  return [...products, ...supplies].filter(
    (i: any) => Number(i.stock ?? 0) <= LOW_STOCK_THRESHOLD
  ).length;
}

/* A figure card that links to the screen it summarises: label with an icon,
   a big value and a caption ending in a chevron. The cards sit in one strip
   with hairline dividers. `tone` marks something to act on: a small dot beside
   the label and the number's colour, amber for warning and red for danger. */
function StatCard({
  label, value, caption, to, icon: Icon, tone, className = "", loading = false,
}: {
  label: string; value: string; caption: string; to: string; icon: LucideIcon;
  tone?: "warn" | "danger"; className?: string; loading?: boolean;
}) {
  const dot = tone === "danger" ? "bg-[hsl(12_58%_46%)]" : tone === "warn" ? "bg-[hsl(40_75%_48%)]" : "";
  const numberCls = tone === "danger"
    ? "text-[hsl(12_58%_36%)]"
    : tone === "warn"
      ? "text-[hsl(40_70%_30%)]"
      : "text-[hsl(var(--foreground))]";
  const base = `flex min-w-0 flex-col gap-2 border-b border-[hsl(var(--border))] bg-white px-4 py-4 sm:px-5 sm:py-5 lg:border-r lg:last:border-r-0 ${className}`;

  /* While loading the card keeps its label and icon and shows bars where the
     number and caption will be, at the same heights. Not a link until it has
     data. */
  if (loading) {
    return (
      <div role="status" aria-busy="true" className={base}>
        <span className="sr-only">Loading {label}</span>
        <span aria-hidden="true" className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[hsl(var(--muted-foreground))]">
          <span className="min-w-0 break-words leading-snug">{label}</span><Icon size={16} className="shrink-0" />
        </span>
        <Bar className="h-[32px] w-20 rounded-xl" />
        <Bar className="h-3.5 w-28" />
      </div>
    );
  }
  return (
    <Link to={to} className={`transition hover:bg-[hsl(var(--muted)/.45)] ${FOCUS_RING} ${base}`}>
      <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[hsl(var(--muted-foreground))]">
        <span className="flex min-w-0 items-center gap-2">
          {dot && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
          <span className="min-w-0 break-words leading-snug">{label}</span>
        </span>
        <Icon size={16} aria-hidden="true" className="shrink-0 text-[hsl(var(--muted-foreground)/.7)]" />
      </span>
      {/* Larger peso amounts use a slightly smaller size to keep the figures legible. */}
      <span
        className={`block min-w-0 break-words font-bold leading-[1.1] tracking-[-.02em] tabular-nums ${
          value.length > 9 ? "text-[24px]" : value.length > 7 ? "text-[28px]" : "text-[32px]"
        } ${numberCls}`}
      >
        {value}
      </span>
      <span className="flex min-w-0 items-start gap-0.5 text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">
        <span className="min-w-0 break-words">{caption}</span><ChevronRight size={13} strokeWidth={2.5} aria-hidden="true" className="mt-0.5 shrink-0" />
      </span>
    </Link>
  );
}

type ScheduleFilter = "all" | "todo" | "done";

function minutesNow() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export default function Dashboard() {
  const {
    data, isLoading: dashLoading, isError, refetch,
  } = useQuery({
    queryKey: ["dashboard-data"], queryFn: fetchDashboard, refetchInterval: REFRESH_MS,
  });
  const { data: unbilled = [] } = useQuery({
    queryKey: ["unbilled"], queryFn: fetchUnbilled, refetchInterval: REFRESH_MS,
  });
  /* Kept separate from the main dashboard query: if the inventory table
     can't be read, only the Low stock card shows "—" and the rest of the
     page still loads. */
  const lowStockQuery = useQuery({
    queryKey: ["low-stock-count"], queryFn: fetchLowStockCount, refetchInterval: REFRESH_MS,
  });
  const lowStockCount = lowStockQuery.data ?? 0;

  /* Names and job titles for the Service and Status columns, as in Appointments. */
  const { data: staffDirectory = [], isLoading: staffLoading } = useQuery({
    queryKey: ["staff-directory"],
    queryFn: fetchStaffDirectory,
  });
  /* The tables wait for the staff names too, so rows don't flash "Unknown staff". */
  const isLoading = dashLoading || staffLoading;

  const staffMap = useMemo(
    () => Object.fromEntries(staffDirectory.map((s) => [s.id, staffDisplayName(s)])),
    [staffDirectory]
  );
  const jobMap = useMemo(
    () => Object.fromEntries(
      staffDirectory.map((s) => [s.id, [s.job_title, s.secondary_title].filter(Boolean).join(" · ")])
    ),
    [staffDirectory]
  );

  const [schedulePage, setSchedulePage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [scheduleQuery, setScheduleQuery] = useState("");

  const todayAppointments = data?.todayAppts ?? [];

  /* "Next up" means chronologically next, not just the first pending row.
     The clock ticks every minute so it doesn't freeze at page load. */
  const [nowMinutes, setNowMinutes] = useState(minutesNow);
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(minutesNow()), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const isOpen = (a: any) => a.status === "confirmed" || a.status === "incoming";
  const nextUp = todayAppointments.find(
    (a) => isOpen(a) && timeToMinutes(a.scheduled_time) >= nowMinutes
  );

  /* Today's schedule lists every visit that is actually happening today
     (pending, confirmed and completed). Cancelled visits aren't happening,
     so they're left out. The header line below carries the day's count. */
  const scheduleAll = todayAppointments.filter((a) => COUNTS_TODAY.includes(a.status));
  const todoCount = scheduleAll.filter(isOpen).length;
  const doneCount = scheduleAll.filter((a) => a.status === "completed").length;
  const searchText = scheduleQuery.trim().toLowerCase();
  const scheduleAppointments = scheduleAll.filter((a) =>
    (scheduleFilter === "all" || (scheduleFilter === "todo" ? isOpen(a) : a.status === "completed")) &&
    (!searchText ||
      [a.pet_name, a.client_name, a.client_phone, a.service, assignedStaffLabel(a, staffMap)]
        .filter(Boolean).join(" ").toLowerCase().includes(searchText))
  );
  const scheduleTotalPages = Math.max(1, Math.ceil(scheduleAppointments.length / WIDGET_PAGE_SIZE));
  const scheduleCurrentPage = Math.min(schedulePage, scheduleTotalPages);
  const scheduleRows = scheduleAppointments.slice(
    (scheduleCurrentPage - 1) * WIDGET_PAGE_SIZE, scheduleCurrentPage * WIDGET_PAGE_SIZE
  );
  const pickFilter = (f: ScheduleFilter) => { setScheduleFilter(f); setSchedulePage(1); };

  /* Recent visits: things that actually happened or are booked in (confirmed,
     completed), newest first. Same-day rows are ordered by time because the
     time is stored as text. */
  const activityAppointments = (data?.weekActivity ?? [])
    .filter((row: any) => row.status === "confirmed" || row.status === "completed")
    .sort((a: any, b: any) =>
      (b.requested_date ?? "").localeCompare(a.requested_date ?? "") ||
      timeToMinutes(b.scheduled_time) - timeToMinutes(a.scheduled_time)
    );
  const activityTotalPages = Math.max(1, Math.ceil(activityAppointments.length / WIDGET_PAGE_SIZE));
  const activityCurrentPage = Math.min(activityPage, activityTotalPages);
  const activityRows = activityAppointments.slice(
    (activityCurrentPage - 1) * WIDGET_PAGE_SIZE, activityCurrentPage * WIDGET_PAGE_SIZE
  );

  const pendingCount = data?.pendingCount ?? 0;

  /* Match the Appointments status attribution layout. */
  const attribution = (row: any) => {
    const id = row.confirmed_by_staff_id || row.created_by_staff_id;
    const name = id ? staffMap[id] : "";
    if (!name) return null;
    return { label: row.confirmed_by_staff_id ? "Confirmed by" : "Added by", name };
  };

  /* True when the first load failed and there is nothing to show yet. */
  const failedWithNoData = isError && !data;

  const todayLabel = new Date().toLocaleDateString("en-PH", {
    weekday: "long", month: "long", day: "numeric",
  });

  const sectionHead = "flex flex-wrap items-center gap-4 px-5 py-4";
  const sectionLink = `ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-2 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline ${FOCUS_RING}`;
  const footer = "flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-5 py-3.5";

  return (
    <AdminLayout
      title="Dashboard"
      subtitle={todayLabel}
    >
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-5 pb-8 sm:px-8 lg:px-10">
        {isError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[hsl(12_58%_42%)] bg-[hsl(12_58%_96%)] px-4 py-3.5"
          >
            <p className="text-[14px] font-bold text-[hsl(12_58%_32%)]">
              The dashboard couldn&apos;t load. Figures may be missing or out of date.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className={`h-10 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
            >
              Try again
            </button>
          </div>
        )}

        {unbilled.length > 0 && (
          <Link
            to="/appointments"
            className={`flex items-start gap-3 rounded-[10px] border border-[hsl(40_55%_75%)] bg-[hsl(40_70%_93%)] px-4 py-3 text-[hsl(40_70%_26%)] transition hover:bg-[hsl(40_70%_90%)] ${FOCUS_RING}`}
          >
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">
                {unbilled.length} completed {unbilled.length === 1 ? "visit hasn't" : "visits haven't"} been billed
              </p>
              <p className="text-[13px]">
                {unbilled.slice(0, 3).map((a: any) => a.pet_name).join(", ")}
                {unbilled.length > 3 && ` and ${unbilled.length - 3} more`}
              </p>
            </div>
            <ChevronRight size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {/* ── Key daily metrics link to the screen where staff can act ── */}
        <section aria-label="Today at a glance" className="-mx-5 grid grid-cols-1 border-t border-[hsl(var(--border))] sm:-mx-8 sm:grid-cols-2 lg:-mx-10 lg:grid-cols-4">
          <StatCard
            label="Today's appointments"
            icon={CalendarDays}
            loading={dashLoading}
            value={data ? String(scheduleAll.length) : "—"}
            caption="Scheduled for today"
            to="/appointments"
          />
          <StatCard
            label="Pending confirmation"
            icon={Clock3}
            loading={dashLoading}
            value={data ? String(pendingCount) : "—"}
            caption="Requests needing a decision"
            to="/appointments"
            tone={data && pendingCount > 0 ? "warn" : undefined}
          />
          <StatCard
            label="Low stock"
            icon={Package}
            loading={lowStockQuery.isLoading}
            value={lowStockQuery.isError ? "—" : String(lowStockCount)}
            caption={lowStockQuery.isError ? "Couldn't read inventory" : "Items below reorder level"}
            to="/inventory"
            tone={!lowStockQuery.isError && lowStockCount > 0 ? "danger" : undefined}
          />
          <StatCard
            label="Taken today"
            icon={CreditCard}
            loading={dashLoading}
            value={data ? pesoShort(data.takenToday) : "—"}
            caption="Payments received today"
            to="/billing"
          />
        </section>

        {/* ── Today's schedule ── */}
        <section className={PANEL} aria-labelledby="schedule-title">
          <div className="flex items-center gap-3 px-5 py-4 max-[600px]:flex-col max-[600px]:items-stretch">
            <div className="min-w-0 shrink-0 max-[600px]:w-full">
              <h2 id="schedule-title" className="text-[17px] font-extrabold leading-6">Today&apos;s schedule</h2>
              {isLoading ? (
                <Bar className="mt-2 h-4 w-44" />
              ) : failedWithNoData ? (
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Not available right now</p>
              ) : (
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                  {scheduleAll.length === 0
                    ? "No appointments scheduled today"
                    : `${todoCount} still to go · ${doneCount} completed`}
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-center gap-2 max-[600px]:w-full max-[600px]:flex-wrap">
              {isLoading ? (
                <div aria-hidden="true" className="flex min-w-0 flex-nowrap items-center justify-center gap-2 max-[600px]:flex-wrap">
                  <Bar className="h-10 w-[200px] max-w-full rounded-xl" />
                  <Bar className="h-10 w-[180px] max-w-full rounded-[10px]" />
                </div>
              ) : !failedWithNoData ? (
                <>
                  <SegmentedTabs<ScheduleFilter>
                    label="Show appointments"
                    value={scheduleFilter}
                    onChange={pickFilter}
                    options={[
                      { key: "all", label: "All", count: scheduleAll.length },
                      { key: "todo", label: "Still to go", count: todoCount },
                      { key: "done", label: "Completed", count: doneCount },
                    ]}
                  />
                  <label className="flex h-10 min-w-[130px] w-[clamp(130px,24vw,280px)] shrink items-center gap-2 rounded-[10px] border border-[hsl(var(--card-border))] bg-white px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)]">
                    <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                    <input
                      type="search"
                      value={scheduleQuery}
                      onChange={(e) => { setScheduleQuery(e.target.value); setSchedulePage(1); }}
                      placeholder="Search patient, owner or service"
                      aria-label="Search schedule"
                      className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
                    />
                  </label>
                </>
              ) : null}
              <Link
                to="/appointments?new=1"
                aria-label="Add a walk-in appointment"
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_12px_rgb(5_31_66/.25)] transition hover:opacity-90 ${FOCUS_RING}`}
              >
                <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
                Walk-in
              </Link>
            </div>
          </div>

          {isLoading ? (
            <TableSkeleton cols={ROW_COLS} heads={["Date & Time", "Patient", "Owner", "Service", "Staff", "Status"]} />
          ) : failedWithNoData ? (
            <LoadFailed what="today's schedule" />
          ) : scheduleAll.length === 0 ? (
            <div className="p-14 text-center">
              <CalendarDays className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-bold">Nothing booked today</p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">Bookings from the mobile app appear here.</p>
            </div>
          ) : scheduleAppointments.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-[15px] font-bold">
                {searchText
                  ? "No appointments match this search"
                  : scheduleFilter === "todo" ? "All caught up for today" : "Nothing completed yet"}
              </p>
              <p className="mt-1 text-[14px] text-[hsl(var(--muted-foreground))]">
                {searchText ? "Try a different name or service." : "Try a different tab."}
              </p>
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={`${TABLE_HEAD} ${ROW_COLS}`}>
                <span>Date &amp; Time</span>
                <span>Patient</span>
                <span>Owner</span>
                <span>Service</span>
                <span>Staff</span>
                <span>Status</span>
              </div>
              {scheduleRows.map((apt) => {
                const active = isOpen(apt);
                const passed =
                  active && !!apt.requested_date && !!apt.scheduled_time &&
                  slotPassed(apt.requested_date, apt.scheduled_time);
                const flag = passed
                  ? apt.status === "incoming"
                    ? { label: "Time passed", cls: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" }
                    : { label: "Needs closing", cls: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" }
                  : nextUp?.id === apt.id
                    ? { label: "Next", cls: "bg-[hsl(var(--accent)/.2)] text-[hsl(var(--foreground))]" }
                    : null;
                const staff = assignedStaffLabel(apt, staffMap);
                const job = apt.assigned_staff_id ? jobMap[apt.assigned_staff_id] : apt.assigned_staff_role;
                const ownerPhone = apt.client_phone || (apt.client_id ? data?.ownerPhones?.[apt.client_id] : null);
                const pet = apt.pet_id ? data?.petProfiles?.[apt.pet_id] : undefined;
                return (
                  <Link key={apt.id} to="/appointments" className={`${ROW_BASE} ${ROW_COLS} ${FOCUS_RING}`}>
                    <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
                      <DateTimeCell time={apt.scheduled_time} date={apt.requested_date} flag={flag} />
                      <span className="min-w-0 lg:hidden"><StatusCell status={apt.status} attribution={attribution(apt)} /></span>
                    </div>
                    <PatientCell
                      name={apt.pet_name}
                      species={apt.pet_species}
                      age={apt.pet_age ?? pet?.age}
                      gender={apt.pet_gender ?? pet?.gender}
                      photo={apt.pet_id ? data?.petPhotos?.[apt.pet_id] : undefined}
                    />
                    <div className="min-w-0">
                      <p className="break-words text-[14px] font-semibold leading-snug">{titleCase(apt.client_name)}</p>
                      <p className="mt-0.5 break-words text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                        {fmtPhone(ownerPhone)}
                      </p>
                    </div>
                    <p className="min-w-0 break-words text-[14px] font-bold leading-snug" title={apt.service}>
                      {serviceLines(apt.service).map((line) => <span key={line} className="block">{line}</span>)}
                    </p>
                    <div className="min-w-0">
                      <p
                        title={[staff, job].filter(Boolean).join(" · ") || "No staff assigned"}
                        className={`break-words text-[12.5px] leading-snug ${
                          !staff && active
                            ? "font-bold text-[hsl(40_70%_30%)]"
                            : "text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {staff || "Unassigned"}
                      </p>
                      {job && <p className="break-words text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">{job}</p>}
                    </div>
                    <div className="hidden min-w-0 lg:block">
                      <StatusCell status={apt.status} attribution={attribution(apt)} />
                    </div>
                  </Link>
                );
              })}
              <div className={footer}>
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                  Showing <strong className="text-[hsl(var(--foreground))]">{scheduleAppointments.length}</strong> of {scheduleAll.length}
                </p>
                <Pager page={scheduleCurrentPage} totalPages={scheduleTotalPages} onChange={setSchedulePage} />
              </div>
            </>
          )}
        </section>

        {/* ── Recent visits ── */}
        <section className={PANEL} aria-labelledby="activity-title">
          <div className={sectionHead}>
            <div>
              <h2 id="activity-title" className="text-[17px] font-extrabold leading-6">Recent visits</h2>
              <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Appointments over the last seven days, before today</p>
            </div>
            <Link to="/appointments" className={sectionLink}>
              View all <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {isLoading ? (
            <TableSkeleton
              cols={ROW_COLS_RECENT}
              heads={["Date & Time", "Patient", "Owner", "Service", "Staff", "Billing", "Status"]}
              recent
            />
          ) : failedWithNoData ? (
            <LoadFailed what="recent visits" />
          ) : activityAppointments.length === 0 ? (
            <div className="p-14 text-center">
              <PawPrint className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-bold">Nothing recorded this week</p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">
                Appointments appear here as they&apos;re confirmed and completed.
              </p>
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={`${TABLE_HEAD} ${ROW_COLS_RECENT}`}>
                <span>Date &amp; Time</span>
                <span>Patient</span>
                <span>Owner</span>
                <span>Service</span>
                <span>Staff</span>
                <span>Billing</span>
                <span>Status</span>
              </div>
              {activityRows.map((row: any) => {
                const total = data?.weekTotals?.[row.id];
                const staff = assignedStaffLabel(row, staffMap);
                const job = row.assigned_staff_id ? jobMap[row.assigned_staff_id] : row.assigned_staff_role;
                const ownerPhone = row.client_phone || (row.client_id ? data?.ownerPhones?.[row.client_id] : null);
                const pet = row.pet_id ? data?.petProfiles?.[row.pet_id] : undefined;
                return (
                  <Link key={row.id} to="/appointments" className={`${ROW_BASE} ${ROW_COLS_RECENT} ${FOCUS_RING}`}>
                    <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
                      <DateTimeCell time={row.scheduled_time} date={row.requested_date} />
                      <span className="min-w-0 lg:hidden"><StatusCell status={row.status} attribution={attribution(row)} /></span>
                    </div>
                    <PatientCell
                      name={row.pet_name}
                      species={row.pet_species}
                      age={row.pet_age ?? pet?.age}
                      gender={row.pet_gender ?? pet?.gender}
                      photo={data?.petPhotos?.[row.pet_id]}
                    />
                    <div className="min-w-0">
                      <p className="break-words text-[14px] font-semibold leading-snug">{titleCase(row.client_name)}</p>
                      <p className="mt-0.5 break-words text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                        {fmtPhone(ownerPhone)}
                      </p>
                    </div>
                    <p className="min-w-0 break-words text-[14px] font-bold leading-snug" title={row.service}>
                      {serviceLines(row.service).map((line) => <span key={line} className="block">{line}</span>)}
                    </p>
                    <div className="min-w-0">
                      <p className="break-words text-[12.5px] leading-snug">{staff || "Unassigned"}</p>
                      {job && <p className="break-words text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">{job}</p>}
                    </div>
                    <div className="min-w-0"><TotalCell total={total} /></div>
                    <div className="hidden min-w-0 lg:block">
                      <StatusCell status={row.status} attribution={attribution(row)} />
                    </div>
                  </Link>
                );
              })}
              <div className={footer}>
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{activityAppointments.length} total</p>
                <Pager page={activityCurrentPage} totalPages={activityTotalPages} onChange={setActivityPage} />
              </div>
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
