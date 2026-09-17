import { useEffect, useMemo, useRef, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import {
  fetchAppointmentsInRange, confirmAppointment, completeAppointment,
  rescheduleAppointmentAdmin, type Appointment,
} from "@/api/appointments";
import { fetchServices, CATEGORY_ORDER, type Service } from "@/api/services";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CalendarDays, Filter, X, Check, Clock3, CheckCircle2, XCircle,
  MoreHorizontal, Loader2, AlertTriangle, CalendarClock, Receipt,
  CheckSquare, Eye, Search, Plus, Minus, Trash2, Wallet, Lock,
  ShieldCheck, ShieldAlert, ImageOff, Copy, ExternalLink,
} from "lucide-react";

/* ── Status pills ─────────────────────────────────────────────────── */
const PILL: Record<string, string> = {
  Completed: "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]",
  Confirmed: "bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]",
  Pending: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  Cancelled: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]",
};

const PAYMENT_PILL: Record<string, string> = {
  "Fully Paid": "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]",
  "Partially Paid": "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  "Awaiting Payment": "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]",
  "Not billed": "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
};

function Pill({ label, table }: { label: string; table: Record<string, string> }) {
  return (
    <span className={`status-pill ${table[label] ?? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  incoming: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled",
};

const FILTERS = ["All", "Pending", "Confirmed"] as const;

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* requested_date can be null on older rows, and `new Date(null +
   "T00:00:00")` renders as "Invalid Date" rather than failing — so it
   ends up on screen. Guard it. */
function safeDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) {
  if (!iso) return "No date";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", opts);
}

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Times are stored as text, so "10:30 AM" sorts before "9:00 AM" on a
   plain string compare. Parse before sorting. */
function timeToMinutes(t?: string | null) {
  if (!t) return 9999;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/* Ranges computed fresh on each call, not once at module load — a tab
   left open overnight would otherwise still think "Today" is yesterday. */
const RANGES: Record<string, () => { from: Date; to: Date }> = {
  Today: () => {
    const n = new Date();
    return { from: n, to: n };
  },
  "This week": () => {
    const n = new Date();
    const from = new Date(n);
    from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to };
  },
  "This month": () => {
    const n = new Date();
    return {
      from: new Date(n.getFullYear(), n.getMonth(), 1),
      to: new Date(n.getFullYear(), n.getMonth() + 1, 0),
    };
  },
  "This year": () => {
    const n = new Date();
    return { from: new Date(n.getFullYear(), 0, 1), to: new Date(n.getFullYear(), 11, 31) };
  },
};

/* Invoice status per appointment, with what's been paid against it.
   Reads the payments table rather than invoice.status alone, so a
   partial payment shows a real remaining balance. */
async function fetchInvoiceSummary() {
  const { data: invoices } = await (supabase as any)
    .from("invoices").select("id, appointment_id, total_amount, status");

  const ids = (invoices || []).map((i: any) => i.id);
  let paidByInvoice: Record<string, number> = {};

  if (ids.length > 0) {
    const { data: payments } = await (supabase as any)
      .from("payments").select("invoice_id, amount").in("invoice_id", ids);
    (payments || []).forEach((p: any) => {
      paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount || 0);
    });
  }

  const map: Record<string, { id: string; total: number; paid: number; status: string }> = {};
  (invoices || []).forEach((i: any) => {
    if (!i.appointment_id) return;
    map[i.appointment_id] = {
      id: i.id,
      total: Number(i.total_amount || 0),
      paid: paidByInvoice[i.id] || 0,
      status: i.status,
    };
  });
  return map;
}

function StatCard({
  label, value, caption, icon: Icon, accent, delay, active, onClick,
}: {
  label: string; value: number; caption: string; icon: React.ElementType;
  accent: string; delay?: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`workspace-card workspace-rise ${delay ?? ""} rounded-[24px] p-5 text-left transition ${
        onClick ? "hover:-translate-y-0.5" : "cursor-default"
      } ${active ? "ring-2 ring-[hsl(var(--primary)/.45)]" : ""}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-5 text-[29px] font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{caption}</p>
    </button>
  );
}

/* ── Row action menu ──────────────────────────────────────────────────
   The action set changes with status, and confirming locks the booking:

     pending    Confirm · Reschedule · Cancel
     confirmed  Bill · Complete visit
     closed     View invoice

   Once confirmed the slot is committed, so it can't be moved or
   dropped from here. Anything else needs the clinic to speak to the
   owner, and that shouldn't be a menu item. */

/* Three states, and the distinction matters: a reference on file is
   what the client typed, not money the clinic has. Only the tick means
   someone opened the wallet app and checked. */
function PaymentMark({ apt }: { apt: any }) {
  const verified = !!apt.payment_verified_at;
  const claimed = !!apt.payment_reference;

  if (verified) {
    return (
      <span className="status-pill bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]">
        <ShieldCheck size={11} /> Verified
      </span>
    );
  }
  if (claimed) {
    return (
      <span className="status-pill bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]">
        <ShieldAlert size={11} /> Needs checking
      </span>
    );
  }
  return (
    <span className="status-pill bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      No payment
    </span>
  );
}

function RowMenu({
  apt, busy, billed, onConfirm, onComplete, onReschedule, onBilling,
}: {
  apt: Appointment; busy: boolean; billed: boolean;
  onConfirm: () => void; onComplete: () => void;
  onReschedule: () => void; onBilling: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /* Positioned from the button's screen coordinates, with `fixed`
     rather than `absolute`.
     
     An absolutely-positioned menu is clipped by any ancestor with
     overflow hidden, and flips out of view when the row is near the
     bottom of the page — which is why the last row's menu kept losing
     its lower items. Measuring the button and rendering at fixed
     coordinates escapes the table entirely, and lets it open upward
     when there isn't room below. */
  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;

    const MENU_W = 240;
    const MENU_H = 220;
    const GAP = 6;

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_H && rect.top > MENU_H;

    setPos({
      top: openUp ? rect.top - MENU_H - GAP : rect.bottom + GAP,
      left: Math.max(12, rect.right - MENU_W),
    });
  };

  const toggle = () => {
    if (!open) place();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Scrolling or resizing moves the row out from under the menu, so
    // close rather than leaving it floating somewhere wrong.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const run = (fn: () => void) => { setOpen(false); fn(); };
  const item = "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-semibold transition";

  const pending = apt.status === "incoming";
  const confirmed = apt.status === "confirmed";

  return (
    <div className="flex justify-end">
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={busy}
        aria-label={`Actions for ${apt.pet_name}`}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40 ${
          open ? "bg-[hsl(var(--muted))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
        }`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={16} />}
      </button>

      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 240 }}
            className="z-50 overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] py-1.5 shadow-[0_18px_50px_-24px_hsl(175_33%_18%/.5)]"
          >
            {pending && (
              <>
                <button onClick={() => run(onConfirm)} className={`${item} hover:bg-[hsl(var(--muted))]`}>
                  <Check size={15} className="text-[hsl(var(--primary))]" /> Confirm appointment
                </button>
                <button onClick={() => run(onReschedule)} className={`${item} hover:bg-[hsl(var(--muted))]`}>
                  <CalendarClock size={15} className="text-[hsl(var(--muted-foreground))]" /> Reschedule
                </button>
                {/* No cancel here. A client calls off their own booking
                    from the app while it's still pending; the clinic
                    turns one away by rejecting the payment on the
                    confirm dialog, which is the same decision. A
                    standalone cancel would be a third way to reach the
                    same state, with no record of why. */}
              </>
            )}

            {confirmed && (
              <>
                <button onClick={() => run(onBilling)} className={`${item} hover:bg-[hsl(var(--muted))]`}>
                  <Receipt size={15} className="text-[hsl(var(--primary))]" />
                  {billed ? "View invoice" : "Bill this visit"}
                </button>
                <button onClick={() => run(onComplete)} className={`${item} hover:bg-[hsl(var(--muted))]`}>
                  <CheckSquare size={15} className="text-[hsl(var(--muted-foreground))]" /> Complete visit
                </button>
                <div className="my-1.5 h-px bg-[hsl(var(--border)/.7)]" />
                <p className="flex items-start gap-2 px-4 py-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  <Lock size={12} className="mt-0.5 shrink-0" />
                  Confirmed bookings can&apos;t be moved or cancelled here.
                </p>
              </>
            )}

            {!pending && !confirmed && (
              <button onClick={() => run(onBilling)} className={`${item} hover:bg-[hsl(var(--muted))]`}>
                <Eye size={15} className="text-[hsl(var(--muted-foreground))]" /> View invoice
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Appointments() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState("Today");
  const [customFrom, setCustomFrom] = useState(toLocalISO(new Date()));
  const [customTo, setCustomTo] = useState(toLocalISO(new Date()));
  const [filter, setFilter] = useState<typeof FILTERS[number]>("All");
  const [query, setQuery] = useState("");
  const [service, setService] = useState("All services");
  const [busy, setBusy] = useState<string | null>(null);

  const [showReschedule, setShowReschedule] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [billTarget, setBillTarget] = useState<Appointment | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Appointment | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Appointment | null>(null);

  const isDay = range === "Today";

  const { from, to } = useMemo(() => {
    if (range === "Custom") return { from: customFrom, to: customTo };
    const r = RANGES[range]();
    return { from: toLocalISO(r.from), to: toLocalISO(r.to) };
  }, [range, customFrom, customTo]);

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments-range", from, to],
    queryFn: () => fetchAppointmentsInRange(from, to),
  });

  const { data: invoiceSummary = {} } = useQuery({
    queryKey: ["invoice-summary"],
    queryFn: fetchInvoiceSummary,
  });

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => {
      const byDate = (a.requested_date || "").localeCompare(b.requested_date || "");
      return byDate !== 0 ? byDate : timeToMinutes(a.scheduled_time) - timeToMinutes(b.scheduled_time);
    }),
    [appointments]
  );

  const serviceOptions = useMemo(
    () => [...new Set(appointments.map((a) => a.service).filter(Boolean))].sort(),
    [appointments]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((a) => {
      const matchesStatus = filter === "All" || STATUS_LABEL[a.status] === filter;
      const matchesService = service === "All services" || a.service === service;
      const matchesQuery = !q ||
        a.pet_name?.toLowerCase().includes(q) ||
        a.client_name?.toLowerCase().includes(q);
      return matchesStatus && matchesService && matchesQuery;
    });
  }, [sorted, filter, service, query]);

  const hasFilters = !!query || filter !== "All" || service !== "All services";
  const clearFilters = () => { setQuery(""); setFilter("All"); setService("All services"); };

  const counts = useMemo(() => ({
    total: appointments.length,
    pending: appointments.filter((a) => a.status === "incoming").length,
    confirmed: appointments.filter((a) => a.status === "confirmed").length,
    completed: appointments.filter((a) => a.status === "completed").length,
    cancelled: appointments.filter((a) => a.status === "cancelled").length,
  }), [appointments]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments-range"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
  };

  const run = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try { await fn(); toast.success(message); refresh(); }
    catch { toast.error("That didn't work. Please try again."); }
    finally { setBusy(null); }
  };

  const openReschedule = (a: Appointment) => {
    setSelected(a);
    setNewDate(a.requested_date);
    setNewTime(a.scheduled_time || "");
    setShowReschedule(true);
  };

  const handleReschedule = async () => {
    if (!selected || !newDate || !newTime) { toast.error("Set a date and a time."); return; }
    await run(selected.id, () => rescheduleAppointmentAdmin(selected.id, newDate, newTime), "Appointment rescheduled.");
    setShowReschedule(false);
  };

  const dateLabel = safeDate(from, { weekday: "long", month: "long", day: "numeric" });

  const periodLabel = isDay
    ? dateLabel
    : range === "Custom"
      ? `${safeDate(from, { month: "short", day: "numeric" })} – ${safeDate(to, { month: "short", day: "numeric", year: "numeric" })}`
      : range;

  return (
    <AdminLayout title="Appointments" eyebrow={`Schedule · ${periodLabel}`}>
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label={isDay ? "Appointments" : "In this period"} value={counts.total} caption="All statuses"
            icon={CalendarDays} accent="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
            active={filter === "All"} onClick={() => setFilter("All")}
          />
          <StatCard
            label="Awaiting confirmation" value={counts.pending} caption="Needs a decision"
            icon={Clock3} accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" delay="workspace-rise-1"
            active={filter === "Pending"} onClick={() => setFilter("Pending")}
          />
          <StatCard
            label="Confirmed" value={counts.confirmed} caption="Booked in"
            icon={CheckCircle2} accent="bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]" delay="workspace-rise-2"
            active={filter === "Confirmed"} onClick={() => setFilter("Confirmed")}
          />
          <StatCard
            label="Completed" value={counts.completed} caption="Care delivered"
            icon={Check} accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]" delay="workspace-rise-3"
          />
          <StatCard
            label="Cancelled" value={counts.cancelled} caption="Did not go ahead"
            icon={XCircle} accent="bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" delay="workspace-rise-3"
          />
        </div>

        {/* ── Toolbar ── */}
        <div className="workspace-card flex flex-col gap-3 rounded-[24px] p-4 xl:flex-row xl:items-center">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label="Filter by period"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            {Object.keys(RANGES).map((r) => <option key={r}>{r}</option>)}
            <option>Custom</option>
          </select>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient or owner"
              className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-3 text-sm"
            />
          </div>

          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            aria-label="Filter by service"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            <option>All services</option>
            {serviceOptions.map((s) => <option key={s}>{s}</option>)}
          </select>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[hsl(var(--input))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {range === "Custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                From
              </label>
              <input
                type="date" value={customFrom} max={customTo}
                onChange={(e) => { if (e.target.value) setCustomFrom(e.target.value); }}
                aria-label="Period start"
                className="h-10 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-xs font-semibold"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                To
              </label>
              <input
                type="date" value={customTo} min={customFrom}
                onChange={(e) => { if (e.target.value) setCustomTo(e.target.value); }}
                aria-label="Period end"
                className="h-10 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-xs font-semibold"
              />
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="workspace-card rounded-[26px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border)/.72)] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-bold">Schedule</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {hasFilters
                  ? `${filtered.length} of ${appointments.length} shown`
                  : `${filtered.length} appointment${filtered.length === 1 ? "" : "s"} · ${isDay ? dateLabel : periodLabel}`}
              </p>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <Filter size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
              {FILTERS.map((name) => (
                <button
                  key={name}
                  onClick={() => setFilter(name)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    filter === name
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "bg-[hsl(var(--muted)/.6)] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden grid-cols-[100px_1fr_1fr_1fr_130px_130px_110px_50px] gap-4 border-b border-[hsl(var(--border)/.7)] px-6 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] lg:grid">
            <span>Date &amp; time</span>
            <span>Patient</span>
            <span>Owner</span>
            <span>Service</span>
            <span>Payment</span>
            <span>Billing</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-14 text-center">
              <CalendarDays className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">
                {appointments.length === 0
                  ? (isDay ? "Nothing booked for this day" : "Nothing booked in this period")
                  : "No appointments match these filters"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">
                {appointments.length === 0
                  ? "Bookings from the mobile app appear here."
                  : "Try a different name, service or status."}
              </p>
              {hasFilters && appointments.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
                >
                  <X size={14} /> Clear filters
                </button>
              )}
            </div>
          ) : (
            filtered.map((apt) => {
              const inv = invoiceSummary[apt.id];
              const balance = inv ? Math.max(0, inv.total - inv.paid) : 0;
              return (
                <div
                  key={apt.id}
                  className="grid gap-3 border-b border-[hsl(var(--border)/.55)] px-5 py-4 transition last:border-0 hover:bg-[hsl(var(--muted)/.35)] lg:grid-cols-[100px_1fr_1fr_1fr_130px_130px_110px_50px] lg:items-center lg:gap-4 lg:px-6"
                >
                  <div className="flex items-center justify-between lg:block">
                    <div>
                      <p className="text-sm font-bold">{apt.scheduled_time || "—"}</p>
                      <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                        {safeDate(apt.requested_date,
                          isDay ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                    </div>
                    <span className="lg:hidden">
                      <Pill label={STATUS_LABEL[apt.status]} table={PILL} />
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary))] text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">
                      {(apt.pet_name || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{apt.pet_name}</p>
                      <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">{apt.pet_species}</p>
                    </div>
                  </div>

                  <p className="min-w-0 truncate text-xs">{apt.client_name}</p>

                  <p className="min-w-0 truncate text-xs font-semibold">{apt.service}</p>

                  {/* Whether a deposit has been claimed and whether
                      anyone has checked it — so staff can see at a
                      glance which bookings still need verifying,
                      without opening each one. */}
                  <div className="min-w-0">
                    <PaymentMark apt={apt} />
                  </div>

                  {/* Status plus what's left to collect — the number
                      staff actually need at the desk. */}
                  <div className="min-w-0">
                    <Pill label={inv ? inv.status : "Not billed"} table={PAYMENT_PILL} />
                    {inv && balance > 0 && (
                      <p className="mt-1 text-[11px] font-semibold text-[hsl(15_60%_38%)]">
                        {peso(balance)} to collect
                      </p>
                    )}
                  </div>

                  <div className="hidden lg:block">
                    <Pill label={STATUS_LABEL[apt.status]} table={PILL} />
                  </div>

                  <RowMenu
                    apt={apt}
                    busy={busy === apt.id}
                    billed={!!inv}
                    /* Confirming a booking and checking its payment are
                       the same decision, so Confirm opens the proof
                       rather than acting immediately. */
                    onConfirm={() => setVerifyTarget(apt)}
                    /* Opens rather than completing outright — the
                       client is at the desk paying as they leave, and
                       that's the same moment. Sending staff to Billing
                       afterwards means doing one thing in two places. */
                    onComplete={() => setCompleteTarget(apt)}
                    onReschedule={() => openReschedule(apt)}
                    onBilling={() => setBillTarget(apt)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {completeTarget && (
        <CompleteVisitDialog
          appointment={completeTarget}
          invoice={invoiceSummary[completeTarget.id]}
          onClose={() => setCompleteTarget(null)}
          onDone={() => { setCompleteTarget(null); refresh(); }}
        />
      )}

      {verifyTarget && (
        <VerifyPaymentDialog
          appointment={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          onDone={() => { setVerifyTarget(null); refresh(); }}
        />
      )}

      {billTarget && (
        <BillingDialog
          appointment={billTarget}
          existing={invoiceSummary[billTarget.id]}
          onClose={() => setBillTarget(null)}
          onSaved={() => { setBillTarget(null); refresh(); }}
        />
      )}

      {/* ── Reschedule ── */}
      <Dialog open={showReschedule} onOpenChange={(o) => { if (!o) setShowReschedule(false); }}>
        <DialogContent className="max-w-[460px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
                Move the visit
              </p>
              <h2 className="display-face text-[31px] leading-none">Reschedule</h2>
              <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                {selected?.pet_name} · {selected?.service}
              </p>
            </div>
            <button
              onClick={() => setShowReschedule(false)}
              aria-label="Close"
              className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-[13px] font-bold">New date</label>
              <input
                type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-bold">New time</label>
              <input
                value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="e.g. 10:00 AM"
                className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              />
            </div>
          </div>

          <div className="mt-7 flex justify-end gap-2">
            <button
              onClick={() => setShowReschedule(false)}
              className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              Cancel
            </button>
            <button
              onClick={handleReschedule}
              className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))]"
            >
              Save changes <Check size={16} />
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}

/* ══════════════════ Billing ══════════════════
   Staff pick from the billable services catalogue — what was actually
   used during the visit, which nobody could know at booking. The whole
   total is collected in cash at the desk. */

interface LineItem {
  service_id: string;
  service_name: string;
  quantity: number;
  unit_price: number;
}

function BillingDialog({
  appointment, existing, onClose, onSaved,
}: {
  appointment: Appointment;
  existing?: { id: string; total: number; paid: number; status: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["services"], queryFn: fetchServices,
  });

  const [items, setItems] = useState<LineItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [saving, setSaving] = useState(false);

  const readOnly = !!existing;

  // Existing line items, when reopening an invoice already raised.
  const { data: existingItems = [] } = useQuery({
    queryKey: ["invoice-items", existing?.id],
    enabled: !!existing?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("invoice_items").select("*").eq("invoice_id", existing!.id);
      return data || [];
    },
  });

  const total = readOnly
    ? existing!.total
    : items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  /* The deposit was taken at booking and verified before the visit, so
     it's already a payment row against this appointment. Shown here so
     staff see the balance the client actually owes, rather than the
     full total with the deposit charged twice. */
  const deposit = Number((appointment as any).payment_amount || 0);
  const depositVerified = !!(appointment as any).payment_verified_at;
  const depositPaid = depositVerified ? deposit : 0;

  const paidSoFar = readOnly ? existing!.paid : depositPaid;
  const balance = Math.max(0, total - paidSoFar);

  const addItem = (s: Service) => {
    if (items.some((i) => i.service_id === s.id)) {
      toast.error(`${s.name} is already on this invoice.`);
      return;
    }
    /* Weight-tiered and by-assessment services have no single price, so
       they start at zero for staff to fill in — the vet decides on the
       day, and guessing a tier here would put the wrong number on a
       real invoice. */
    const price = s.pricing_type === "flat" && s.price != null ? Number(s.price) : 0;
    setItems([...items, {
      service_id: s.id,
      service_name: s.name,
      quantity: 1,
      unit_price: price,
    }]);
    setSearch("");
  };

  const updateItem = (id: string, patch: Partial<LineItem>) =>
    setItems(items.map((i) => (i.service_id === id ? { ...i, ...patch } : i)));

  const removeItem = (id: string) =>
    setItems(items.filter((i) => i.service_id !== id));

  const visibleServices = services.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q && category === "all") return false; // nothing until they search or filter
    const matchesSearch = !q || s.name.toLowerCase().includes(q);
    const matchesCategory = category === "all" || s.category === category;
    return matchesSearch && matchesCategory && !items.some((i) => i.service_id === s.id);
  }).slice(0, 8);

  const handleSave = async () => {
    if (items.length === 0) {
      toast.error("Add at least one service.");
      return;
    }
    if (items.some((i) => i.unit_price <= 0)) {
      toast.error("Every line needs a price above zero.");
      return;
    }

    setSaving(true);

    const { data: invoice, error: invoiceError } = await (supabase as any)
      .from("invoices")
      .insert([{
        appointment_id: appointment.id,
        total_amount: total,
        status: "Awaiting Payment",
      }])
      .select()
      .single();

    if (invoiceError || !invoice) {
      setSaving(false);
      toast.error("Couldn't create the invoice.");
      return;
    }

    const { error: itemsError } = await (supabase as any)
      .from("invoice_items")
      .insert(items.map((i) => ({
        invoice_id: invoice.id,
        service_id: i.service_id,
        service_name: i.service_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.unit_price * i.quantity,
      })));

    if (itemsError) {
      setSaving(false);
      toast.error("Invoice created but the line items failed to save.");
      return;
    }

    setSaving(false);
    toast.success(
      paidSoFar > 0
        ? `Invoice raised. ${peso(balance)} to collect after the deposit.`
        : `Invoice raised. ${peso(total)} to collect.`
    );
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-[560px] overflow-y-auto rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">

        <div className="mb-6 flex items-start justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              {readOnly ? "Invoice" : "Bill this visit"}
            </p>
            <h2 className="display-face text-[29px] leading-none">{appointment.pet_name}</h2>
            <p className="mt-2 truncate text-sm text-[hsl(var(--muted-foreground))]">
              {appointment.client_name} · {appointment.service}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X size={18} />
          </button>
        </div>

        {readOnly ? (
          <>
            <div className="space-y-2.5">
              {existingItems.map((it: any) => (
                <div key={it.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate">
                    {it.service_name}
                    {it.quantity > 1 && (
                      <span className="text-[hsl(var(--muted-foreground))]"> × {it.quantity}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold">{peso(Number(it.subtotal))}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* ── Service picker ── */}
            <div className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4">
              <p className="mb-3 text-[13px] font-bold">What did the visit use?</p>

              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search services…"
                    className="h-10 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm"
                  />
                </div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  aria-label="Filter by category"
                  className="h-10 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 text-xs font-semibold"
                >
                  <option value="all">All</option>
                  {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--primary))]" />
                </div>
              ) : visibleServices.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {visibleServices.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addItem(s)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[hsl(var(--card))]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">{s.name}</p>
                        <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                          {s.category}
                          {s.pricing_type !== "flat" && " · price set on the day"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-bold">
                          {s.pricing_type === "flat" && s.price != null ? peso(Number(s.price)) : "—"}
                        </span>
                        <Plus size={15} className="text-[hsl(var(--primary))]" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 px-1 text-xs text-[hsl(var(--muted-foreground))]">
                  {search || category !== "all"
                    ? "Nothing matches that."
                    : "Search or pick a category to find services."}
                </p>
              )}
            </div>

            {/* ── Line items ── */}
            <div className="mt-5">
              <p className="mb-3 text-[13px] font-bold">
                On this invoice
                {items.length > 0 && (
                  <span className="ml-1 font-normal text-[hsl(var(--muted-foreground))]">
                    ({items.length})
                  </span>
                )}
              </p>

              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
                  Nothing added yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.service_id}
                      className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border)/.75)] px-3 py-2.5"
                    >
                      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                        {item.service_name}
                      </p>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => updateItem(item.service_id, {
                            quantity: Math.max(1, item.quantity - 1),
                          })}
                          aria-label="Decrease quantity"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                        <button
                          onClick={() => updateItem(item.service_id, { quantity: item.quantity + 1 })}
                          aria-label="Increase quantity"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
                        >
                          <Plus size={13} />
                        </button>
                      </div>

                      <div className="relative shrink-0">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">
                          ₱
                        </span>
                        <input
                          type="number" step="0.01" min="0"
                          value={item.unit_price || ""}
                          onChange={(e) => updateItem(item.service_id, {
                            unit_price: parseFloat(e.target.value) || 0,
                          })}
                          placeholder="0.00"
                          aria-label={`Price for ${item.service_name}`}
                          className={`h-8 w-24 rounded-lg border bg-[hsl(var(--background))] pl-5 pr-2 text-xs font-semibold ${
                            item.unit_price <= 0
                              ? "border-[hsl(var(--destructive))]"
                              : "border-[hsl(var(--input))]"
                          }`}
                        />
                      </div>

                      <button
                        onClick={() => removeItem(item.service_id)}
                        aria-label={`Remove ${item.service_name}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </>
        )}

        {/* ── Totals ── */}
        <div className="mt-6 space-y-2 border-t border-[hsl(var(--border)/.7)] pt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[hsl(var(--muted-foreground))]">Total bill</span>
            <span className="font-bold">{peso(total)}</span>
          </div>

          {paidSoFar > 0 && (
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">
                {readOnly ? "Paid so far" : "Less deposit paid at booking"}
              </span>
              <span className="font-semibold text-[hsl(145_42%_27%)]">
                − {peso(paidSoFar)}
              </span>
            </div>
          )}

          {/* A deposit submitted but never checked isn't money. Saying
              so here stops staff deducting it by eye. */}
          {!readOnly && deposit > 0 && !depositVerified && (
            <div className="flex items-start gap-2 rounded-xl bg-[hsl(40_55%_95%)] px-3 py-2.5">
              <Lock size={13} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
              <p className="text-[11px] leading-relaxed text-[hsl(40_55%_25%)]">
                A {peso(deposit)} deposit was submitted but hasn&apos;t been
                verified, so it isn&apos;t deducted. Check it on the booking first.
              </p>
            </div>
          )}

          <div className="flex items-baseline justify-between border-t border-[hsl(var(--border)/.5)] pt-2.5">
            <span className="text-sm font-bold">Balance to collect</span>
            <span className={`text-xl font-bold tracking-[-.03em] ${
              balance > 0 ? "text-[hsl(15_60%_38%)]" : "text-[hsl(145_42%_27%)]"
            }`}>
              {peso(balance)}
            </span>
          </div>

          {balance > 0 && (
            <p className="flex items-center gap-1.5 pt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              <Wallet size={12} /> Collected in cash at the clinic.
            </p>
          )}
        </div>

        <div className="mt-7 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving || items.length === 0}
              className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              {saving
                ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                : <>Raise invoice <Check size={16} /></>}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════ Verify a reservation payment ══════════════════

   There is no payment provider, so nothing tells the system the money
   arrived. A member of staff opens the clinic's wallet app, finds the
   reference, and says whether it's there.

   The dialog exists to make that check quick and to record who made it.
   It deliberately does NOT try to look like automated verification —
   everything on it is what the client claimed until someone ticks it
   off. */

function VerifyPaymentDialog({
  appointment, onClose, onDone,
}: {
  appointment: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const fullName = useAdminStore((s) => s.fullName);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loadingProof, setLoadingProof] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const reference = appointment.payment_reference as string | null;
  const amount = Number(appointment.payment_amount || 0);
  const alreadyVerified = !!appointment.payment_verified_at;

  /* The bucket is private, so the stored path isn't a URL anyone can
     open. A signed URL is minted here and expires in an hour — long
     enough to look at, short enough that a copied link is useless
     tomorrow. */
  useEffect(() => {
    let active = true;
    (async () => {
      const path = appointment.payment_proof_url;
      if (!path) { setLoadingProof(false); return; }

      const { data } = await supabase.storage
        .from("payment-proofs")
        .createSignedUrl(path, 3600);

      if (!active) return;
      setProofUrl(data?.signedUrl ?? null);
      setLoadingProof(false);
    })();
    return () => { active = false; };
  }, [appointment.payment_proof_url]);

  const handleApprove = async () => {
    setBusy(true);
    const verifiedAt = new Date().toISOString();

    /* Recorded on the appointment rather than just flipping the status,
       so there's an answer to "who said this was paid?" three months
       from now. */
    const { error } = await (supabase as any)
      .from("appointments")
      .update({
        status: "confirmed",
        payment_verified_by: fullName || "Staff",
        payment_verified_at: verifiedAt,
      })
      .eq("id", appointment.id);

    if (error) {
      setBusy(false);
      toast.error("Couldn't confirm that booking.");
      return;
    }

    /* The deposit becomes a real payment at the moment it's verified,
       not when the invoice is raised weeks later. It has no invoice yet
       — the trigger from migration 014 attaches it when one appears,
       and the balance falls out correctly without anyone deducting it
       by hand. */
    if (amount > 0 && !alreadyVerified) {
      const { error: paymentError } = await (supabase as any)
        .from("payments")
        .insert([{
          appointment_id: appointment.id,
          amount,
          kind: "reservation",
          method: "GCash",
          paid_at: verifiedAt,
          recorded_by: fullName || "Staff",
        }]);

      if (paymentError) {
        setBusy(false);
        // The booking is confirmed but the money isn't recorded, which
        // would show as a full balance later. Worth saying plainly.
        toast.error("Booking confirmed, but the deposit wasn't recorded. Add it on the Billing screen.");
        onDone();
        return;
      }
    }

    setBusy(false);
    toast.success(
      amount > 0
        ? `Confirmed. ${peso(amount)} deposit recorded.`
        : "Appointment confirmed."
    );
    onDone();
  };

  const handleReject = async () => {
    setBusy(true);
    const { error } = await (supabase as any)
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointment.id);
    setBusy(false);

    if (error) { toast.error("Couldn't cancel that booking."); return; }
    toast.success("Booking cancelled. The slot is free again.");
    onDone();
  };

  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-[520px] overflow-y-auto rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">

        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              Confirm booking
            </p>
            <h2 className="display-face text-[29px] leading-none">{appointment.pet_name}</h2>
            <p className="mt-2 truncate text-sm text-[hsl(var(--muted-foreground))]">
              {appointment.client_name} · {appointment.service}
            </p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {safeDate(appointment.requested_date, { weekday: "long", month: "long", day: "numeric" })}
              {appointment.scheduled_time && ` · ${appointment.scheduled_time}`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X size={18} />
          </button>
        </div>

        {!reference ? (
          /* No deposit claimed. Confirming is still allowed — plenty of
             bookings are made by phone or in person — but it shouldn't
             look like a payment was checked. */
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] p-5 text-center">
            <Wallet className="mx-auto text-[hsl(var(--muted-foreground))]" size={22} />
            <p className="mt-3 text-sm font-bold">No deposit submitted</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
              This booking came in without a reservation payment. Confirm it if
              the visit is going ahead anyway.
            </p>
          </div>
        ) : (
          <>
            {/* ── What the client says they paid ── */}
            <div className="rounded-2xl border border-[hsl(var(--secondary))] bg-[hsl(var(--secondary)/.28)] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">
                Submitted by the client
              </p>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">Reference</span>
                  <button
                    onClick={() => copy(reference, "Reference")}
                    className="flex min-w-0 items-center gap-2 text-sm font-bold transition hover:text-[hsl(var(--primary))]"
                  >
                    <span className="truncate font-mono">{reference}</span>
                    <Copy size={13} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
                  </button>
                </div>

                {amount > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Amount</span>
                    <span className="text-sm font-bold">{peso(amount)}</span>
                  </div>
                )}


              </div>
            </div>

            {/* ── Screenshot ── */}
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                Screenshot
              </p>

              {loadingProof ? (
                <div className="flex h-40 items-center justify-center rounded-2xl bg-[hsl(var(--muted)/.5)]">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                </div>
              ) : proofUrl ? (
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block overflow-hidden rounded-2xl border border-[hsl(var(--border))]"
                >
                  <img
                    src={proofUrl}
                    alt="Payment screenshot"
                    className="max-h-72 w-full object-contain bg-[hsl(var(--muted)/.4)]"
                  />
                  <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-[hsl(var(--foreground)/.75)] px-2.5 py-1.5 text-[11px] font-bold text-[hsl(var(--primary-foreground))] opacity-0 transition group-hover:opacity-100">
                    Open full size <ExternalLink size={12} />
                  </span>
                </a>
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[hsl(var(--border))]">
                  <ImageOff size={20} className="text-[hsl(var(--muted-foreground))]" />
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    No screenshot uploaded
                  </p>
                </div>
              )}
            </div>

            {/* The one instruction that matters. Without it the dialog
                reads as though the system verified something. */}
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[hsl(var(--muted)/.6)] px-4 py-3">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                Check this reference in the clinic&apos;s wallet app before confirming.
                Nothing here proves the money arrived.
              </p>
            </div>

            {alreadyVerified && (
              <p className="mt-3 flex items-center gap-2 text-[11px] text-[hsl(145_42%_27%)]">
                <ShieldCheck size={13} />
                Already verified by {appointment.payment_verified_by} on{" "}
                {safeDate(appointment.payment_verified_at?.slice(0, 10), {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </p>
            )}
          </>
        )}

        {/* ── Decision ── */}
        {rejecting ? (
          <div className="mt-6 rounded-2xl border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.06)] p-4">
            <p className="text-[13px] font-bold text-[hsl(var(--destructive))]">
              Cancel this booking?
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
              The slot is freed and the client is notified. If they did pay,
              the clinic will need to refund them directly — this doesn&apos;t
              return anything.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRejecting(false)}
                className="h-10 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
              >
                Go back
              </button>
              <button
                onClick={handleReject}
                disabled={busy}
                className="h-10 rounded-xl bg-[hsl(var(--destructive))] px-4 text-xs font-bold text-[hsl(var(--destructive-foreground))] disabled:opacity-60"
              >
                {busy ? "Cancelling…" : "Cancel booking"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-7 flex justify-end gap-2">
            <button
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--destructive)/.4)] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-60"
            >
              {busy
                ? <><Loader2 size={15} className="animate-spin" /> Confirming…</>
                : <>{reference ? "Verified — confirm" : "Confirm booking"} <Check size={16} /></>}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════ Complete a visit ══════════════════

   The client pays at the desk as they leave, which is the same moment
   staff mark the visit done. Splitting those meant completing it here,
   then going to Billing, finding the invoice and recording the payment
   there — two screens for one thing that happens once.

   So this collects the balance and completes the visit together. It
   still allows completing without payment, because sometimes people
   leave owing money — but that's a choice made deliberately rather
   than a step forgotten. */

function CompleteVisitDialog({
  appointment, invoice, onClose, onDone,
}: {
  appointment: any;
  invoice?: { id: string; total: number; paid: number; status: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const fullName = useAdminStore((s) => s.fullName);
  const [collect, setCollect] = useState(true);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = invoice ? Math.max(0, invoice.total - invoice.paid) : 0;
  const hasBalance = balance > 0;

  useEffect(() => {
    // Pre-filled with the full balance, since settling in full is what
    // happens almost every time. Editable for a part payment.
    setAmount(balance > 0 ? String(balance) : "");
  }, [balance]);

  const entered = parseFloat(amount) || 0;
  const overpaying = entered > balance;
  const remaining = Math.max(0, balance - entered);

  const handleComplete = async () => {
    if (collect && hasBalance) {
      if (entered <= 0) { toast.error("Enter the amount collected."); return; }
      if (overpaying) { toast.error("That's more than the balance owing."); return; }
    }

    setBusy(true);

    if (collect && hasBalance && invoice) {
      /* method stays null — the constraint reads that as settled at the
         clinic, which is what this is. The trigger on payments moves
         the invoice to Partially Paid or Fully Paid on its own. */
      const { error: paymentError } = await (supabase as any)
        .from("payments")
        .insert([{
          invoice_id: invoice.id,
          appointment_id: appointment.id,
          amount: entered,
          kind: "balance",
          method: null,
          recorded_by: fullName || "Staff",
        }]);

      if (paymentError) {
        setBusy(false);
        toast.error("Couldn't record that payment. The visit wasn't completed.");
        return;
      }
    }

    try {
      await completeAppointment(appointment.id);
    } catch {
      setBusy(false);
      // The payment landed; only the status didn't. Say which, so
      // nobody records the money twice trying to fix it.
      toast.error(
        collect && hasBalance
          ? "Payment recorded, but the visit couldn't be marked complete."
          : "Couldn't complete that visit."
      );
      onDone();
      return;
    }

    setBusy(false);
    toast.success(
      collect && hasBalance
        ? remaining > 0
          ? `Visit completed. ${peso(entered)} collected, ${peso(remaining)} still owing.`
          : `Visit completed and settled in full.`
        : "Visit completed."
    );
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[460px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">

        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              Complete visit
            </p>
            <h2 className="display-face text-[29px] leading-none">{appointment.pet_name}</h2>
            <p className="mt-2 truncate text-sm text-[hsl(var(--muted-foreground))]">
              {appointment.client_name} · {appointment.service}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X size={18} />
          </button>
        </div>

        {!invoice ? (
          /* Completing an unbilled visit means the clinic delivered
             care and charged nobody. Not blocked — some visits are
             genuinely free — but it shouldn't pass unremarked. */
          <div className="flex items-start gap-3 rounded-2xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_95%)] p-4">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-[hsl(40_55%_25%)]">
                This visit hasn&apos;t been billed
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[hsl(40_55%_30%)]">
                Bill it first if anything was used — once completed it&apos;s
                easy to forget.
              </p>
            </div>
          </div>
        ) : !hasBalance ? (
          <div className="flex items-center gap-3 rounded-2xl bg-[hsl(145_42%_92%)] p-4">
            <Check size={18} className="shrink-0 text-[hsl(145_42%_27%)]" strokeWidth={3} />
            <p className="text-[13px] font-bold text-[hsl(145_42%_27%)]">
              {peso(invoice.total)} already settled in full
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[hsl(var(--muted-foreground))]">Invoice total</span>
                <span className="font-bold">{peso(invoice.total)}</span>
              </div>

              {invoice.paid > 0 && (
                <div className="mt-2 flex items-baseline justify-between text-sm">
                  <span className="text-[hsl(var(--muted-foreground))]">Already paid</span>
                  <span className="font-semibold text-[hsl(145_42%_27%)]">
                    − {peso(invoice.paid)}
                  </span>
                </div>
              )}

              <div className="mt-3 flex items-baseline justify-between border-t border-[hsl(var(--border)/.6)] pt-3">
                <span className="text-sm font-bold">Balance owing</span>
                <span className="text-xl font-bold tracking-[-.03em] text-[hsl(15_60%_38%)]">
                  {peso(balance)}
                </span>
              </div>
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={collect}
                onChange={(e) => setCollect(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-bold">Collecting payment now</p>
                <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Untick if they&apos;re leaving without paying.
                </p>
              </div>
            </label>

            {collect && (
              <div className="mt-4">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                  Amount collected
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[hsl(var(--muted-foreground))]">
                    ₱
                  </span>
                  <input
                    type="number" step="0.01" min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                    className={`h-12 w-full rounded-xl border bg-[hsl(var(--background))] pl-8 pr-3 text-lg font-bold ${
                      overpaying ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))]"
                    }`}
                  />
                </div>

                {/* Fixed-height slot, so a message appearing doesn't
                    shift the button under a cursor already moving. */}
                <div className="min-h-[20px] pt-1.5">
                  {overpaying ? (
                    <p className="text-[11px] text-[hsl(var(--destructive))]">
                      That&apos;s more than the {peso(balance)} owing.
                    </p>
                  ) : remaining > 0 ? (
                    <p className="text-[11px] text-[hsl(40_55%_30%)]">
                      {peso(remaining)} will still be owing.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-7 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
          >
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={busy || (collect && hasBalance && (entered <= 0 || overpaying))}
            className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            {busy
              ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : (
                <>
                  {collect && hasBalance ? "Collect and complete" : "Complete visit"}
                  <Check size={16} />
                </>
              )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
