import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import {
  fetchAppointmentsInRange, confirmAppointment, completeAppointment,
  rescheduleAppointmentAdmin, createAppointment, assignStaffToAppointment,
  fetchStaffOptions, fetchStaffDirectory, cancelAppointmentAdmin, declineAppointment,
  staffDisplayName, type Appointment, type StaffOption,
} from "@/api/appointments";
import { fetchServices, CATEGORY_ORDER, type Service, type ServiceTier } from "@/api/services";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import PatientChartDialog from "@/components/PatientChartDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import jsPDF from "jspdf";
// jspdf-autotable v4+ must be imported and called as a function.
import autoTable from "jspdf-autotable";
// xlsx-js-style is SheetJS with cell styles and frozen panes. Install: npm i xlsx-js-style
import * as XLSX from "xlsx-js-style";
import {
  Plus, Search, CalendarDays, CalendarCheck, ChevronLeft, ChevronRight, FileSpreadsheet, Download, X, Check,
  Clock3, Loader2, AlertTriangle, ChevronDown, MoreVertical,
} from "lucide-react";
import { RangePicker, clinicNow, clinicToday, daysBetween, fmtDisplay } from "@/components/RangePicker";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

const PILL_ICON: Record<string, React.ElementType> = {
  Completed: Check, "In progress": CalendarCheck, Waiting: Clock3, Cancelled: X,
  Paid: Check, "Not billed": Clock3, "No amount": Clock3, Partial: Clock3, Unpaid: Clock3,
};

/* Soft filled chips, one colour per state: status and billing. */
const SOFT: Record<string, string> = {
  Completed: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]",
  "In progress": "bg-[hsl(168_35%_89%)] text-[hsl(168_38%_24%)]",
  Waiting: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
  Cancelled: "bg-[hsl(12_70%_93%)] text-[hsl(12_58%_36%)]",
  Paid: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]",
  "Not billed": "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
  "No amount": "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
  Partial: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
  Unpaid: "bg-[hsl(12_70%_93%)] text-[hsl(12_58%_36%)]",
};
const MUTED_CHIP = "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";

/* `quiet` shows the neutral grey version (a pending visit has nothing to bill yet). */
function Chip({ label, quiet }: { label: string; quiet?: boolean }) {
  const Icon = PILL_ICON[label];
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold ${
        quiet ? MUTED_CHIP : SOFT[label] ?? MUTED_CHIP
      }`}
    >
      {Icon && <Icon size={13} strokeWidth={3} aria-hidden="true" />}
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  incoming: "Waiting", confirmed: "In progress", completed: "Completed", cancelled: "Cancelled",
};

const FILTERS = ["All", "Waiting", "In progress", "Completed", "Cancelled"] as const;

const PAGE_SIZE = 10;

const HIDDEN_STAFF_IDS = ["2bb0eed8-4c93-458e-8225-9b9881e028f6"];

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function assignedStaffLabel(apt: Appointment, staffMap: Record<string, string>) {
  if (apt.assigned_staff_id) return staffMap[apt.assigned_staff_id] || "Unknown staff";
  if (apt.assigned_staff_name) return apt.assigned_staff_name;
  return null;
}

/* Capitalizes the first letter of each word without touching the rest ("dos" -> "Dos"). */
const titleCase = (s?: string | null) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
const RANGE_STORAGE_KEY = "pet-royale-appointments-range";

function loadStoredRange(): { range: string; customFrom: string; customTo: string } {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.range === "Custom" || p.range in RANGES) return p;
    }
  } catch {
    // sessionStorage unavailable or the stored value was corrupted —
    // fall through to the same default a first visit would get.
  }
  const today = clinicToday();
  return { range: "Today", customFrom: today, customTo: today };
}

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

/* Shows, under the walk-in time grid, the service's length and the reason for
   every crossed-out time. Turn off once the times are confirmed right. */
const SHOW_SLOT_REASONS = false;

const TIME_SLOTS = [
  "08:30 AM", "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM",
  "11:30 AM", "01:00 PM", "01:30 PM", "02:00 PM", "02:30 PM", "03:00 PM",
  "03:30 PM", "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM",
  "06:30 PM",
];

/* ══════════════ What each service allows ══════════════
   The same rules the mobile booking screen follows, so a walk-in or a
   move offers exactly the times an owner could pick: the service's own
   hours and closed day, its start spacing, its break, and how long the
   visit takes. Rows from before migration 041 behave as they always did
   (30 minutes, a 12:00 to 1:00 PM gap). */
interface BookingCat {
  name: string;
  is_active?: boolean;
  opening_time: string;
  last_slot: string;
  closed_day: number;
  slot_minutes?: number;
  duration_minutes?: number;
  break_start?: string | null;
  break_end?: string | null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function colMinutes(v: unknown, fallback: number) {
  if (!v) return fallback;
  const [h, m] = String(v).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
}
const catDuration = (c?: BookingCat) => (Number(c?.duration_minutes) >= 5 ? Number(c!.duration_minutes) : 30);
/* A booking keeps the service name it was saved under, so a stray space or a
   different capital letter ("Grooming " vs "Grooming") must not make its
   length unknown. If two services share a name, the active one wins. */
const normName = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
function findCat(cats: BookingCat[], name?: string | null): BookingCat | undefined {
  const n = normName(name);
  if (!n) return undefined;
  const same = cats.filter((c) => normName(c.name) === n);
  return same.find((c) => c.is_active !== false) ?? same[0];
}
/* The service as the pickers use it: only when it's switched on. */
function activeCat(cats: BookingCat[], name?: string | null): BookingCat | undefined {
  const c = findCat(cats, name);
  return c && c.is_active !== false ? c : undefined;
}
const catStep = (c: BookingCat) => (Number(c.slot_minutes) >= 5 ? Number(c.slot_minutes) : 30);

function catBreak(c: BookingCat): [number, number] | null {
  if (!("break_start" in c)) return [12 * 60, 13 * 60];
  const bs = colMinutes(c.break_start, -1);
  const be = colMinutes(c.break_end, -1);
  return bs >= 0 && be > bs ? [bs, be] : null;
}

/* "08:30 AM", the exact text the app and this screen have always saved. */
function slotText(min: number) {
  const h24 = Math.floor(min / 60) % 24;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

function buildDaySlots(c: BookingCat): string[] {
  const first = colMinutes(c.opening_time, 0);
  const last = colMinutes(c.last_slot, 18 * 60 + 30);
  const step = catStep(c);
  const dur = catDuration(c);
  const br = catBreak(c);
  const out: string[] = [];
  for (let t = first; t <= last; t += step) {
    if (br && t < br[1] && t + dur > br[0]) continue;
    out.push(slotText(t));
  }
  return out;
}

const isClosedDay = (date: string, c: BookingCat) =>
  new Date(`${date}T00:00:00`).getDay() === Number(c.closed_day ?? 0);

async function fetchBookingCats(): Promise<BookingCat[]> {
  const { data, error } = await (supabase as any)
    .from("booking_categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []) as BookingCat[];
}

/* Every service, active or not: a booking made under a service that has
   since been switched off still needs its length to block the right times. */
function useBookingCats() {
  return useQuery({ queryKey: ["booking-cats-all"], queryFn: fetchBookingCats, staleTime: 30_000 });
}

/* Why a time can't be picked for this service on this date, or "". */
function hoursProblem(c: BookingCat, date: string, time: string): string {
  if (isClosedDay(date, c)) return `${c.name} is closed on ${WEEKDAY_NAMES[Number(c.closed_day ?? 0)]}s.`;
  const m = timeToMinutes(time);
  if (!buildDaySlots(c).some((s) => timeToMinutes(s) === m)) {
    return `${fmtSlot(time)} isn't a time ${c.name} offers. It's outside its hours or inside the break.`;
  }
  return "";
}

/* The booking that already holds a start time, if any. This is the rule the
   mobile booking screen follows: a booking holds its own start time, and the
   next start time (one "start every" later) stays open even when the visit
   lasts longer than that. Duration still decides when the last appointment
   ends and how many visits fit in a day, but it does not block other times. */
function findClash(
  rows: DayBooking[],
  start: number,
  opts?: { onlyConfirmed?: boolean },
): DayBooking | undefined {
  return rows.find((r) => {
    if (opts?.onlyConfirmed && r.status !== "confirmed") return false;
    return timeToMinutes(r.scheduled_time) === start;
  });
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

interface DayBooking {
  id: string;
  scheduled_time: string | null;
  status: string;
  pet_name: string | null;
  client_name: string | null;
  assigned_staff_id: string | null;
  service: string | null;
}

/* Every booking that holds a time on one date: anything not cancelled,
   including completed visits. This is the same rule as the database's
   unique index (appointments_no_double_booking) and the app's
   get_taken_times, so the time pickers, the pre-save check, the database
   and the mobile app all agree on which times are taken. A missing status
   counts as active, like the index does. One shared query for the time
   pickers and the pre-save check. */
async function fetchDayBookings(date: string): Promise<DayBooking[]> {
  const { data, error } = await (supabase as any)
    .from("appointments")
    .select("id, scheduled_time, status, pet_name, client_name, assigned_staff_id, service")
    .eq("requested_date", date)
    .or("status.is.null,status.neq.cancelled");
  if (error) throw error;
  return (data || []) as DayBooking[];
}

function useDayBookings(date: string) {
  return useQuery({
    queryKey: ["day-bookings", date],
    enabled: !!date,
    queryFn: () => fetchDayBookings(date),
    // A booking made in the app while the walk-in dialog is open shows up
    // within seconds instead of waiting for the next click.
    refetchInterval: 20_000,
  });
}

/* True when the date and time are already behind us. */
function slotPassed(date: string, time: string) {
  const now = new Date();
  const today = toLocalISO(now);
  if (date < today) return true;
  if (date > today) return false;
  return timeToMinutes(time) <= now.getHours() * 60 + now.getMinutes();
}

/* The one check every action uses before it writes: a fresh read (never
   the cached list) of who holds the slot, plus the passed-time rule.
   Pass `service` and `checkHours` for a time someone is choosing now (a
   walk-in or a move): it must also be inside that service's hours and
   outside its break. A booking only holds its own start time.
   Confirming an existing request doesn't set `checkHours`: a request made
   before the hours changed is still honoured.
   Returns a message to show, or "" when the slot is fine. */
async function slotProblem(
  date: string,
  time: string,
  excludeId?: string,
  opts?: { allowPast?: boolean; onlyConfirmed?: boolean; service?: string; checkHours?: boolean }
): Promise<string> {
  if (!date || !time) return "Pick a date and a time.";
  if (!opts?.allowPast && slotPassed(date, time)) {
    return "That time has already passed. Pick a later time.";
  }
  const [rows, cats] = await Promise.all([
    fetchDayBookings(date),
    opts?.service ? fetchBookingCats() : Promise.resolve([] as BookingCat[]),
  ]);
  const cat = opts?.service ? findCat(cats, opts.service) : undefined;
  if (opts?.checkHours && cat) {
    const p = hoursProblem(cat, date, time);
    if (p) return p;
  }
  const clash = findClash(
    rows.filter((r) => r.id !== excludeId),
    timeToMinutes(time),
    { onlyConfirmed: opts?.onlyConfirmed },
  );
  if (clash) {
    const who = `${clash.pet_name || "another booking"} (${clash.client_name || "unknown owner"})`;
    return `That time is already held by ${who}.`;
  }
  return "";
}

/* The times this service offers on this date, from the same hours, break,
   spacing and duration the mobile app uses, so both sides save identical
   text. Times held by another booking are disabled. excludeId keeps a rescheduled booking from blocking its own
   current slot. */
function TimeSlotSelect({
  date, value, onChange, excludeId, service,
}: {
  date: string; value: string; onChange: (v: string) => void; excludeId?: string; service?: string;
}) {
  const { data: booked = [] } = useDayBookings(date);
  const { data: cats = [] } = useBookingCats();

  const cat = activeCat(cats, service);
  const slots = cat ? buildDaySlots(cat) : TIME_SLOTS;
  const closed = !!(cat && date && isClosedDay(date, cat));
  const others = booked.filter((a) => a.id !== excludeId);
  // An older value saved as "3:30 PM" still lines up with "03:30 PM"
  const current = slots.find((s) => timeToMinutes(s) === timeToMinutes(value)) ?? "";

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className={`${BILL_INPUT} appearance-none pr-10`}
    >
      <option value="">
        {closed ? `Closed on ${WEEKDAY_NAMES[Number(cat!.closed_day ?? 0)]}s` : "Select a time"}
      </option>
      {!closed && slots.map((slot) => {
        const isTaken = !!findClash(others, timeToMinutes(slot));
        const passed = !!date && slotPassed(date, slot);
        return (
          <option key={slot} value={slot} disabled={isTaken || passed}>
            {slot}{isTaken ? " · taken" : passed ? " · passed" : ""}
          </option>
        );
      })}
    </select>
  );
}

/* Floating-label fields: the label sits inside the field and moves up
   once there is something in it, like the sign-in form in the app. */
const FLOAT_BOX =
  "w-full rounded-[16px] border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--card))] text-[16px] font-medium transition focus:border-[hsl(var(--primary))] focus:outline-none";
const FLOAT_LABEL_UP = "pointer-events-none absolute left-4 top-2 text-[13px] font-medium leading-4 text-[hsl(var(--muted-foreground))]";

function FloatInput({
  label, value, onChange, type = "text", className = "", ...rest
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className={`relative ${className}`}>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        aria-label={label}
        className={`peer h-14 ${FLOAT_BOX} px-4 pb-1.5 pt-6`}
      />
      <span
        className="pointer-events-none absolute left-4 top-[16px] text-[16px] leading-6 text-[hsl(var(--muted-foreground))] transition-all peer-focus:top-2 peer-focus:text-[13px] peer-focus:leading-4 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[13px] peer-[:not(:placeholder-shown)]:leading-4"
      >
        {label}
      </span>
    </div>
  );
}

function FloatSelect({
  label, value, onChange, children, className = "",
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={label}
        className={`h-14 appearance-none ${FLOAT_BOX} pb-1 pl-4 pr-10 pt-6`}
      >
        {children}
      </select>
      <span className={FLOAT_LABEL_UP}>{label}</span>
      <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

/* Phone numbers are checked against each country's real mobile format,
   so a made-up number like 12345 or 0000000000 is rejected. Stored as
   +<country code><number> (for example +639171234567). */
const PHONE_COUNTRIES = [
  { code: "PH", name: "Philippines", dial: "63", pattern: /^9\d{9}$/, hint: "e.g. 917 123 4567" },
  { code: "US", name: "United States", dial: "1", pattern: /^[2-9]\d{2}[2-9]\d{6}$/, hint: "10 digits" },
  { code: "CA", name: "Canada", dial: "1", pattern: /^[2-9]\d{2}[2-9]\d{6}$/, hint: "10 digits" },
  { code: "GB", name: "United Kingdom", dial: "44", pattern: /^7\d{9}$/, hint: "e.g. 7400 123456" },
  { code: "AU", name: "Australia", dial: "61", pattern: /^4\d{8}$/, hint: "e.g. 412 345 678" },
  { code: "SG", name: "Singapore", dial: "65", pattern: /^[89]\d{7}$/, hint: "8 digits" },
  { code: "JP", name: "Japan", dial: "81", pattern: /^[789]0\d{8}$/, hint: "e.g. 90 1234 5678" },
  { code: "KR", name: "South Korea", dial: "82", pattern: /^1\d{8,9}$/, hint: "e.g. 10 1234 5678" },
  { code: "AE", name: "United Arab Emirates", dial: "971", pattern: /^5\d{8}$/, hint: "e.g. 50 123 4567" },
  { code: "SA", name: "Saudi Arabia", dial: "966", pattern: /^5\d{8}$/, hint: "e.g. 50 123 4567" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function phoneDigits(raw: string) {
  const d = raw.replace(/\D/g, "");
  return d.startsWith("0") ? d.slice(1) : d;
}

function phoneProblem(countryCode: string, raw: string): string {
  const c = PHONE_COUNTRIES.find((x) => x.code === countryCode) ?? PHONE_COUNTRIES[0];
  const d = phoneDigits(raw);
  if (!c.pattern.test(d)) return `Enter a valid ${c.name} mobile number (${c.hint}).`;
  const tail = d.slice(-7);
  if (
    /^(\d)\1+$/.test(tail) ||
    "01234567890123456789".includes(tail) ||
    "98765432109876543210".includes(tail)
  ) {
    return "That number looks fake. Enter the owner's real number.";
  }
  return "";
}

function normalizePhone(countryCode: string, raw: string) {
  const c = PHONE_COUNTRIES.find((x) => x.code === countryCode) ?? PHONE_COUNTRIES[0];
  return `+${c.dial}${phoneDigits(raw)}`;
}

/* Time grid for one service, built from the same rules as the mobile app.
   A time that's already booked or (today) has already passed can't be
   picked and says so on the tile. */
function TimeSlotGrid({
  date, value, onChange, service,
}: { date: string; value: string; onChange: (v: string) => void; service?: string }) {
  const { data: booked = [] } = useDayBookings(date);
  const { data: cats = [], isLoading } = useBookingCats();

  const cat = activeCat(cats, service);
  const slots = cat ? buildDaySlots(cat) : TIME_SLOTS;
  const closed = !!(cat && date && isClosedDay(date, cat));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = date === toLocalISO(now);
  const current = slots.find((s) => timeToMinutes(s) === timeToMinutes(value)) ?? "";

  if (!service) {
    return <p className="text-[15px] text-[hsl(var(--muted-foreground))]">Choose a service first to see its times.</p>;
  }
  if (isLoading) {
    return <p className="text-[15px] text-[hsl(var(--muted-foreground))]">Loading times…</p>;
  }
  if (closed) {
    return (
      <p role="status" className="rounded-[16px] bg-[hsl(var(--muted))] px-4 py-3 text-[15px] font-semibold">
        {service} is closed on {WEEKDAY_NAMES[Number(cat!.closed_day ?? 0)]}s. Pick another date.
      </p>
    );
  }

  /* Why a time can't be picked, in words. A booking holds its own start
     time, so the next start time is open even if its visit runs longer. */
  const slotReason = (m: number): string => {
    const clash = findClash(booked, m);
    if (clash) return `Held by ${clash.pet_name || "another booking"} at ${fmtSlot(clash.scheduled_time)}`;
    if (isToday && m <= nowMin) return "This time has passed";
    return "";
  };

  const renderSlot = (slot: string) => {
    const m = timeToMinutes(slot);
    const isTaken = !!findClash(booked, m);
    const passed = !isTaken && isToday && m <= nowMin;
    const off = isTaken || passed;
    const on = current === slot;
    return (
      <button
        key={slot}
        type="button"
        disabled={off}
        aria-pressed={on}
        onClick={() => onChange(on ? "" : slot)}
        title={slotReason(m) || undefined}
        className={`h-11 w-full min-w-0 rounded-full border-[1.5px] px-1 text-[14px] font-bold transition ${FOCUS_RING} ${
          on
            ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : off
              ? "cursor-not-allowed border-transparent bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] line-through"
              : "border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"
        }`}
      >
        {fmtSlot(slot)}
      </button>
    );
  };
  const morning = slots.filter((t) => timeToMinutes(t) < 720);
  const afternoon = slots.filter((t) => timeToMinutes(t) >= 720);

  return (
    <div className="space-y-4">
      {morning.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Morning</p>
          <div className="grid grid-cols-5 gap-2">{morning.map(renderSlot)}</div>
        </div>
      )}
      {afternoon.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Afternoon</p>
          <div className="grid grid-cols-5 gap-2">{afternoon.map(renderSlot)}</div>
        </div>
      )}
      {morning.length === 0 && afternoon.length === 0 && (
        <p className="text-[15px] text-[hsl(var(--muted-foreground))]">No times are set up for {service}.</p>
      )}
      {SHOW_SLOT_REASONS && cat && (() => {
        /* Temporary diagnostic: what this screen believes about the service,
           and why each crossed-out time is crossed out. Set
           SHOW_SLOT_REASONS to false once the times are right. */
        const blocked = slots
          .map((s) => ({ s, why: slotReason(timeToMinutes(s)) }))
          .filter((x) => x.why && x.why !== "This time has passed");
        return (
          <div className="rounded-[16px] bg-[hsl(var(--muted))] px-4 py-3 text-[13px] leading-5">
            <p className="font-bold">
              {cat.name}: {catDuration(cat)} min visit, starts every {catStep(cat)} min
            </p>
            {blocked.length === 0 ? (
              <p className="text-[hsl(var(--muted-foreground))]">No time is blocked by another booking.</p>
            ) : (
              blocked.slice(0, 8).map((x) => (
                <p key={x.s} className="text-[hsl(var(--muted-foreground))]">
                  <strong className="text-[hsl(var(--foreground))]">{fmtSlot(x.s)}</strong> · {x.why}
                </p>
              ))
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ── Day strip ──
   The same date picker as the booking screen in the app: one pill per day
   from today, scrolling sideways, with the month on top and previous / next
   week buttons. A service's closed day, and today once its last time has
   gone, are greyed out and can't be picked; today carries a gold dot. */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STRIP_DAYS = 365;
const PILL_STEP = 64; // 56px pill + 8px gap

/* "Mon – Sat" when the closed day is at either end of the week, otherwise
   the closed day by name. */
function openDaysText(closed: number) {
  if (closed === 0) return "Mon – Sat";
  if (closed === 1) return "Tue – Sun";
  return `every day except ${WEEKDAY_NAMES[closed]}`;
}

function DayStrip({
  value, onChange, service,
}: { value: string; onChange: (iso: string) => void; service?: string }) {
  const { data: cats = [] } = useBookingCats();
  const cat = activeCat(cats, service);
  const scroller = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState(0);

  const days = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: STRIP_DAYS }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, []);

  const todayIso = toLocalISO(new Date());
  const todayGone = !!cat && buildDaySlots(cat).every((t) => slotPassed(todayIso, t));

  // Bring the chosen day into view when the strip first appears.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const idx = days.findIndex((d) => toLocalISO(d) === value);
    if (idx > 0) el.scrollLeft = Math.max(0, idx * PILL_STEP - (el.clientWidth - 56) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shift = (weeks: number) =>
    scroller.current?.scrollBy({ left: weeks * 7 * PILL_STEP, behavior: "smooth" });

  const head = days[Math.min(first, days.length - 1)];
  const note = cat
    ? `Open ${openDaysText(Number(cat.closed_day ?? 0))}, ${fmtSlot(slotText(colMinutes(cat.opening_time, 0)))} – ${fmtSlot(
        slotText(colMinutes(cat.last_slot, 18 * 60 + 30) + catDuration(cat)),
      )}`
    : "";

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[16px] font-bold">{MONTH_NAMES[head.getMonth()]} {head.getFullYear()}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            disabled={first === 0}
            aria-label="Previous week"
            className={`flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--border))] disabled:hover:bg-transparent ${FOCUS_RING}`}
          >
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next week"
            className={`flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
          >
            <ChevronRight size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => setFirst(Math.max(0, Math.round(e.currentTarget.scrollLeft / PILL_STEP)))}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((d) => {
          const iso = toLocalISO(d);
          const on = value === iso;
          const off = !!cat && (isClosedDay(iso, cat) || (iso === todayIso && todayGone));
          return (
            <button
              key={iso}
              type="button"
              disabled={off}
              aria-pressed={on}
              aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              onClick={() => onChange(on ? "" : iso)}
              className={`flex h-20 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[20px] border-2 transition ${FOCUS_RING} ${
                on
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)]"
                  : off
                    ? "cursor-not-allowed border-transparent bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] opacity-60"
                    : "border-[hsl(var(--card-border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"
              }`}
            >
              <span className={`text-[12px] leading-4 ${on ? "text-[hsl(var(--primary-foreground)/.85)]" : "text-[hsl(var(--muted-foreground))]"}`}>
                {SHORT_DAYS[d.getDay()]}
              </span>
              <span className="text-[20px] font-bold leading-[26px]">{d.getDate()}</span>
              <span className={`h-[5px] w-[5px] rounded-full ${iso === todayIso && !on ? "bg-[hsl(var(--accent))]" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {note && (
        <p className="mt-1 flex items-center gap-1.5 text-[14px] text-[hsl(var(--muted-foreground))]">
          <Clock3 size={14} aria-hidden="true" /> {note}
        </p>
      )}
    </div>
  );
}

/* Simple inline SVG flags. Emoji flags show up as plain letters ("PH")
   on Windows, so these render the same everywhere. */
const FLAGS: Record<string, React.ReactNode> = {
  PH: <><rect width="24" height="8" fill="#0038A8" /><rect y="8" width="24" height="8" fill="#CE1126" /><path d="M0 0l12 8L0 16z" fill="#fff" /><circle cx="3.6" cy="8" r="1.7" fill="#FCD116" /></>,
  US: <><rect width="24" height="16" fill="#fff" />{Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 2 * (16 / 13)} width="24" height={16 / 13} fill="#B22234" />)}<rect width="10.5" height="8.6" fill="#3C3B6E" /></>,
  CA: <><rect width="24" height="16" fill="#fff" /><rect width="6" height="16" fill="#D80621" /><rect x="18" width="6" height="16" fill="#D80621" /><path d="M12 3.2l1.1 2.2 1.5-.6-.5 3.4 1.4-1 .4 1-2.6 2.4.2 1-2.5-.4v2.4h-1v-2.4l-2.5.4.2-1L7.6 8.2l.4-1 1.4 1-.5-3.4 1.5.6z" fill="#D80621" /></>,
  GB: <><rect width="24" height="16" fill="#012169" /><path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3" /><path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.2" /><path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5" /><path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3" /></>,
  AU: <><rect width="24" height="16" fill="#012169" /><path d="M0 0l12 8M12 0L0 8" stroke="#fff" strokeWidth="1.6" /><path d="M6 0v8M0 4h12" stroke="#fff" strokeWidth="2.6" /><path d="M6 0v8M0 4h12" stroke="#C8102E" strokeWidth="1.4" /><g fill="#fff"><circle cx="6" cy="12" r="1.3" /><circle cx="17" cy="3.5" r=".8" /><circle cx="19.5" cy="7" r=".8" /><circle cx="17" cy="12" r=".8" /><circle cx="14.5" cy="7.5" r=".8" /></g></>,
  SG: <><rect width="24" height="8" fill="#EF3340" /><rect y="8" width="24" height="8" fill="#fff" /><circle cx="5.5" cy="4" r="2.6" fill="#fff" /><circle cx="6.6" cy="4" r="2.4" fill="#EF3340" /><g fill="#fff"><circle cx="9.2" cy="2.4" r=".5" /><circle cx="10.8" cy="3.6" r=".5" /><circle cx="10.2" cy="5.4" r=".5" /><circle cx="8.2" cy="5.4" r=".5" /></g></>,
  JP: <><rect width="24" height="16" fill="#fff" /><circle cx="12" cy="8" r="4.8" fill="#BC002D" /></>,
  KR: <><rect width="24" height="16" fill="#fff" /><circle cx="12" cy="8" r="4" fill="#CD2E3A" /><path d="M8 8a4 4 0 0 0 8 0z" fill="#0047A0" /><g stroke="#000" strokeWidth=".9"><path d="M3.5 3.5l2-1.3M4.3 4.8l2-1.3M18.5 12.5l2-1.3M17.7 11.2l2-1.3M18.5 3.5l2 1.3M17.7 2.2l2 1.3M3.5 12.5l2-1.3M4.3 13.8l2-1.3" /></g></>,
  AE: <><rect width="24" height="5.34" fill="#00732F" /><rect y="5.33" width="24" height="5.34" fill="#fff" /><rect y="10.66" width="24" height="5.34" fill="#000" /><rect width="6" height="16" fill="#FF0000" /></>,
  SA: <><rect width="24" height="16" fill="#006C35" /><rect x="5" y="5" width="14" height="1.6" rx=".8" fill="#fff" /><rect x="6" y="11" width="12" height="1" fill="#fff" /></>,
};

function Flag({ code }: { code: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      className="h-4 w-6 shrink-0 rounded-[3px] shadow-[0_0_0_1px_hsl(var(--foreground)/.15)]"
    >
      {FLAGS[code] ?? <rect width="24" height="16" fill="hsl(var(--muted))" />}
    </svg>
  );
}

/* Replaces the native <select>, which can't show images in its options. */
function PhoneCountrySelect({
  value, onChange,
}: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PHONE_COUNTRIES.find((c) => c.code === value) ?? PHONE_COUNTRIES[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${current.name} +${current.dial}`}
        className={`flex h-11 w-[116px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--background))] text-[15px] font-semibold ${FOCUS_RING}`}
      >
        <Flag code={current.code} />
        +{current.dial}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Country code"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-60 w-64 overflow-y-auto rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] py-1 shadow-[0_18px_50px_-24px_hsl(175_33%_18%/.5)]"
        >
          {PHONE_COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              role="option"
              aria-selected={c.code === value}
              onClick={() => { onChange(c.code); setOpen(false); }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] transition hover:bg-[hsl(var(--muted))] ${
                c.code === value ? "bg-[hsl(var(--muted)/.6)] font-bold" : "font-medium"
              }`}
            >
              <Flag code={c.code} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-[hsl(var(--muted-foreground))]">+{c.dial}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RANGES: Record<string, () => { from: Date; to: Date }> = {
  Today: () => { const n = clinicNow(); return { from: n, to: n }; },
  Tomorrow: () => {
    const n = clinicNow(); n.setDate(n.getDate() + 1);
    return { from: n, to: n };
  },
  // Monday to Sunday, the whole week, including days still to come.
  "This week": () => {
    const n = clinicNow();
    const from = new Date(n);
    from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to };
  },
  // The whole month, first to last day.
  "This month": () => {
    const n = clinicNow();
    return {
      from: new Date(n.getFullYear(), n.getMonth(), 1),
      to: new Date(n.getFullYear(), n.getMonth() + 1, 0),
    };
  },
};


/* Text typed into a search box, made safe to put inside a database filter:
   the wildcard characters (% and _) and the ones that separate filters are
   removed. */
const searchTerm = (raw: string) => raw.replace(/[%_\\",()]/g, " ").replace(/\s+/g, " ").trim();

/* A value for a case-insensitive EXACT match with ilike. Without this, the
   _ in "john_smith@mail.com" means "any one character" and can match a
   different person's email. */
const likeExact = (raw: string) => raw.replace(/[\\%_]/g, (c) => `\\${c}`);

/* One request returns at most 1000 rows, and says nothing when it cuts a
   list off. This reads a list a page at a time until it is all there. Order
   the query by a unique column so no row is skipped or repeated. */
async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/* Dates of every booking still waiting for a decision, whatever date
   range the screen is showing, so a request for next week isn't missed. */
async function fetchPendingDates(): Promise<string[]> {
  const { data } = await (supabase as any)
    .from("appointments").select("requested_date").eq("status", "incoming");
  return (data || []).map((r: any) => r.requested_date).filter(Boolean) as string[];
}

interface InvoiceSummaryRow {
  id: string;
  total: number;
  created_at: string;
  paid_at: string | null;
  /* What has actually been collected on it. */
  paid: number;
}

/* The invoices of the visits on screen, with the payments taken on each.
   Visits go in chunks of 100 (a long list makes the web address too long)
   and rows come a page at a time (one request returns at most 1000). */
async function fetchInvoiceSummary(appointmentIds: string[]) {
  const map: Record<string, InvoiceSummaryRow> = {};
  for (let i = 0; i < appointmentIds.length; i += 100) {
    const ids = appointmentIds.slice(i, i + 100);
    const invoices = await fetchAllPages((from, to) =>
      (supabase as any)
        .from("invoices")
        .select("id, appointment_id, total_amount, created_at, paid_at")
        .in("appointment_id", ids)
        .order("id")
        .range(from, to)
    );
    if (invoices.length === 0) continue;

    const paidByInvoice: Record<string, number> = {};
    const invoiceIds = invoices.map((inv: any) => inv.id as string);
    for (let j = 0; j < invoiceIds.length; j += 100) {
      const payments = await fetchAllPages((from, to) =>
        (supabase as any)
          .from("payments")
          .select("invoice_id, amount")
          .in("invoice_id", invoiceIds.slice(j, j + 100))
          .order("id")
          .range(from, to)
      );
      payments.forEach((p: any) => {
        paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount || 0);
      });
    }

    invoices.forEach((inv: any) => {
      if (!inv.appointment_id) return;
      const row: InvoiceSummaryRow = {
        id: inv.id,
        total: Number(inv.total_amount || 0),
        created_at: inv.created_at,
        paid_at: inv.paid_at ?? null,
        paid: paidByInvoice[inv.id] || 0,
      };
      // Two invoices for one visit should not happen; if it does, the larger one is shown.
      const have = map[inv.appointment_id];
      if (!have || row.total > have.total) map[inv.appointment_id] = row;
    });
  }
  return map;
}

/* Where a visit's invoice stands, worked out the same way as the Billing
   screen, so the two screens never disagree. */
function invoiceLabel(inv?: InvoiceSummaryRow | null): "Not billed" | "No amount" | "Paid" | "Partial" | "Unpaid" {
  if (!inv) return "Not billed";
  const total = Math.round(inv.total * 100);
  const paid = Math.round(inv.paid * 100);
  if (total === 0 && paid === 0) return "No amount";
  if (inv.paid_at || (total > 0 && paid >= total)) return "Paid";
  if (paid > 0) return "Partial";
  return "Unpaid";
}

interface SpeciesOption { id: string; name: string; }

async function fetchSpeciesOptions(): Promise<SpeciesOption[]> {
  const { data, error } = await (supabase as any)
    .from("categories").select("id, name").eq("type", "species").order("sort_order").order("name");
  if (error) throw error;
  return data || [];
}

async function addSpeciesOption(name: string) {
  const { error } = await (supabase as any).from("categories").insert([{ name: name.trim(), type: "species" }]);
  if (error) throw error;
}

async function renameSpeciesOption(id: string, name: string) {
  const { error } = await (supabase as any).from("categories").update({ name: name.trim() }).eq("id", id);
  if (error) throw error;
}

async function deleteSpeciesOption(id: string) {
  const { error } = await (supabase as any).from("categories").delete().eq("id", id);
  if (error) throw error;
}

function ManageSpeciesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: species = [], isLoading } = useQuery({
    queryKey: ["species-options"],
    queryFn: fetchSpeciesOptions,
    enabled: open,
  });
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SpeciesOption | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["species-options"] });
  const close = () => {
    setNewName(""); setEditingId(null); setEditingName(""); setDeleteTarget(null);
    onClose();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (species.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already exists.`);
      return;
    }
    setAdding(true);
    try {
      await addSpeciesOption(name);
      toast.success(`"${name}" added.`);
      setNewName("");
      invalidate();
    } catch (err: any) {
      // Was a bare "Couldn't add that species" with the error object
      // not even captured — the exact same trap the walk-in save had
      // before this. No way to see why it actually failed.
      toast.error(err?.message || "Couldn't add that species.");
    } finally { setAdding(false); }
  };

  const startEdit = (s: SpeciesOption) => { setEditingId(s.id); setEditingName(s.name); };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) { toast.error("Name can't be empty."); return; }
    setSaving(true);
    try {
      await renameSpeciesOption(editingId, name);
      toast.success("Renamed.");
      setEditingId(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't rename that.");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSpeciesOption(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't delete that.");
    } finally { setDeleting(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent aria-describedby={undefined} className="!flex max-h-[80vh] max-w-[460px] flex-col gap-0 overflow-hidden rounded-[12px] border border-[hsl(var(--border))] bg-white p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-6">
            <div>
              <DialogTitle className="text-[28px] font-bold leading-[34px] tracking-[-.02em]">Manage species</DialogTitle>
              <p className="mt-1 text-[15px] text-[hsl(var(--muted-foreground))]">What the clinic treats</p>
            </div>
            <button
              onClick={close}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <div className="flex items-start gap-3">
              <FloatInput
                label="New species"
                value={newName}
                onChange={setNewName}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                className="min-w-0 flex-1"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
                className="flex h-14 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-[24px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                </div>
              ) : species.length === 0 ? (
                <p className="py-8 text-center text-[15px] text-[hsl(var(--muted-foreground))]">
                  No species yet. Add the first one above.
                </p>
              ) : (
                species.map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 py-3 ${i < species.length - 1 ? "border-b border-[hsl(var(--card-border))]" : ""}`}
                  >
                    {editingId === s.id ? (
                      <>
                        <FloatInput
                          label="Name"
                          value={editingName}
                          onChange={setEditingName}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                          autoFocus
                          className="min-w-0 flex-1"
                        />
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--muted-foreground))] hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{s.name}</span>
                        <button
                          onClick={() => startEdit(s)}
                          aria-label={`Rename ${s.name}`}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => setDeleteTarget(s)}
                          aria-label={`Delete ${s.name}`}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--destructive))] hover:underline"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-[hsl(var(--card-border))] px-6 pb-5 pt-3">
            <button
              onClick={close}
              className="flex h-12 w-full items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)]"
            >
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-[12px] border border-[hsl(var(--border))] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold tracking-[-.02em] text-lg">Delete this species?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> won&apos;t
              be offered for new walk-ins anymore. Anything already using it keeps it — nothing existing changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary))]">Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AppointmentActions({
  appointment, busy, chartLoading, onOpenChart, onStartVisit, onCompleteAndBill, onAssignStaff,
}: {
  appointment: Appointment;
  busy: boolean;
  chartLoading: boolean;
  onOpenChart: () => void;
  onStartVisit: () => void;
  onCompleteAndBill: () => void;
  onAssignStaff: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const actions: { label: string; onClick: () => void; disabled: boolean; loading: boolean; primary?: boolean }[] = [];
  if (appointment.status === "incoming") {
    actions.push({ label: "Start visit", onClick: onStartVisit, disabled: busy, loading: busy, primary: true });
  } else if (appointment.status === "confirmed") {
    actions.push(
      { label: "Open chart", onClick: onOpenChart, disabled: chartLoading, loading: chartLoading },
      { label: "Complete & bill", onClick: onCompleteAndBill, disabled: busy, loading: busy, primary: true },
    );
  } else if (appointment.status === "completed") {
    actions.push({ label: "Open chart", onClick: onOpenChart, disabled: chartLoading, loading: chartLoading });
  }

  // Staff can be assigned (or changed) while a visit is still open. A completed
  // visit only offers it when nobody was ever recorded, so history isn't rewritten.
  const hasStaff = Boolean(appointment.assigned_staff_id || appointment.assigned_staff_name);
  if (
    appointment.status === "incoming" ||
    appointment.status === "confirmed" ||
    (appointment.status === "completed" && !hasStaff)
  ) {
    actions.push({
      label: hasStaff ? "Change staff" : "Assign staff",
      onClick: onAssignStaff,
      disabled: busy,
      loading: false,
    });
  }

  if (actions.length === 0) return null;

  return (
    <div ref={menuRef} className="relative flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Actions for ${appointment.pet_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-9 w-9 items-center justify-center rounded-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] ${FOCUS_RING}`}
      >
        <MoreVertical size={19} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[176px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-white p-1 shadow-[0_12px_28px_-14px_rgb(5_31_66/.45)]"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => { setOpen(false); action.onClick(); }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition disabled:opacity-50 ${
                action.primary
                  ? "text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                  : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              }`}
            >
              {action.loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Appointments() {
  const queryClient = useQueryClient();
  const stored = useMemo(() => loadStoredRange(), []);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState(stored.range);
  const [customFrom, setCustomFrom] = useState(stored.customFrom);
  const [customTo, setCustomTo] = useState(stored.customTo);
  const [filter, setFilter] = useState<typeof FILTERS[number]>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [billTarget, setBillTarget] = useState<Appointment | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Appointment | null>(null);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Appointment | null>(null);
  const [chartPet, setChartPet] = useState<any | null>(null);
  const [chartLoadingId, setChartLoadingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  /* Reached from the dashboard's "Add walk-in" button as /appointments?new=1:
     open the walk-in form once, then clear the parameter so a refresh or the
     back button doesn't open it again. */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowWalkIn(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /* Reached from "Book visit" on the Patients screen: that screen passes the
     pet's id in the navigation state. Open the walk-in form with that pet
     already chosen, then clear the state so a refresh or the back button
     doesn't open it again. */
  const location = useLocation();
  const navigate = useNavigate();
  const [walkInPetId, setWalkInPetId] = useState<string | null>(null);
  useEffect(() => {
    const petId = (location.state as { walkInPetId?: unknown } | null)?.walkInPetId;
    if (typeof petId === "string" && petId) {
      setWalkInPetId(petId);
      setShowWalkIn(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  const [exporting, setExporting] = useState<null | "pdf" | "excel">(null);
  const exportName = useAdminStore((s) => [s.title, s.fullName].filter(Boolean).join(" "));
  const { data: clinicInfo } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });
  const { from, to } = useMemo(() => {
    if (range === "Custom") return { from: customFrom, to: customTo };
    const r = RANGES[range]();
    return { from: toLocalISO(r.from), to: toLocalISO(r.to) };
  }, [range, customFrom, customTo]);
  const shiftRange = (direction: number) => {
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    if (range === "This month") {
      start.setDate(1);
      start.setMonth(start.getMonth() + direction);
      end.setTime(new Date(start.getFullYear(), start.getMonth() + 1, 0, 12).getTime());
    } else {
      const step = range === "This week" ? 7 : range === "Custom" ? Math.max(1, daysBetween(from, to) + 1) : 1;
      start.setDate(start.getDate() + direction * step);
      end.setDate(end.getDate() + direction * step);
    }
    setCustomFrom(toLocalISO(start));
    setCustomTo(toLocalISO(end));
    setRange("Custom");
    setPage(1);
  };
  const isDay = from === to;

  useEffect(() => {
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify({ range, customFrom, customTo }));
    } catch {
      // Storage unavailable — the choice just won't survive navigating
      // away this time, same as before this fix existed.
    }
  }, [range, customFrom, customTo]);

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments-range", from, to],
    queryFn: () => fetchAppointmentsInRange(from, to),
  });

  const ownerIds = useMemo(
    () => Array.from(new Set(appointments.flatMap((appointment) => appointment.client_id ? [appointment.client_id] : []))),
    [appointments]
  );
  const { data: ownerPhones = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["appointment-owner-phones", ownerIds],
    enabled: ownerIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const phoneByOwner: Record<string, string | null> = {};
      for (let i = 0; i < ownerIds.length; i += 100) {
        const { data, error } = await (supabase as any)
          .from("clients")
          .select("id, phone")
          .in("id", ownerIds.slice(i, i + 100))
          .is("deleted_at", null);
        if (error) throw error;
        (data || []).forEach((owner: { id: string; phone: string | null }) => {
          phoneByOwner[owner.id] = owner.phone;
        });
      }
      return phoneByOwner;
    },
  });

  const appointmentIds = useMemo(() => appointments.map((a: any) => a.id as string).sort(), [appointments]);
  const { data: invoiceSummary = {} } = useQuery<Record<string, InvoiceSummaryRow>>({
    queryKey: ["invoice-summary", appointmentIds],
    enabled: appointmentIds.length > 0,
    queryFn: () => fetchInvoiceSummary(appointmentIds),
  });

  /* Fill in profile details not copied onto the appointment row. */
  const petIds = useMemo(
    () => Array.from(new Set(appointments.map((a: any) => a.pet_id).filter(Boolean))).sort() as string[],
    [appointments]
  );
  const { data: petProfiles = {} } = useQuery<Record<string, { age: number | null; gender: string | null }>>({
    queryKey: ["appointment-pet-profiles", petIds],
    enabled: petIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, { age: number | null; gender: string | null }> = {};
      for (let i = 0; i < petIds.length; i += 100) {
        const { data, error } = await (supabase as any)
          .from("pets").select("id, age, gender").in("id", petIds.slice(i, i + 100));
        if (error) throw error;
        (data || []).forEach((p: any) => {
          map[p.id] = { age: p.age ?? null, gender: p.gender ?? null };
        });
      }
      return map;
    },
  });

  const { data: staffOptions = [] } = useQuery({
    queryKey: ["staff-options"],
    queryFn: fetchStaffOptions,
  });
  /* Every staff account, suspended ones too, only to NAME people
     already on a booking. The Assign dropdown still lists active
     accounts only. */
  const { data: staffDirectory = [] } = useQuery({
    queryKey: ["staff-directory"],
    queryFn: fetchStaffDirectory,
  });
  const staffMap = useMemo(
    () => Object.fromEntries(staffDirectory.map((s) => [s.id, staffDisplayName(s)])),
    [staffDirectory]
  );
  const jobMap = useMemo(
    () => Object.fromEntries(
      staffDirectory.map((s) => [s.id, [s.secondary_title, s.job_title].filter(Boolean)])
    ),
    [staffDirectory]
  );

  const { data: pendingDates = [] } = useQuery({
    queryKey: ["pending-dates"],
    queryFn: fetchPendingDates,
  });

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => {
      // Newest first: latest date, then latest time within the day.
      const dir = -1;
      const byDate = (a.requested_date || "").localeCompare(b.requested_date || "");
      return byDate !== 0 ? dir * byDate : dir * (timeToMinutes(a.scheduled_time) - timeToMinutes(b.scheduled_time));
    }),
    [appointments]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((a) => {
      // "All" shows every status in the period, so the table always matches the "In this period" card.
      const matchesStatus = filter === "All" || STATUS_LABEL[a.status] === filter;
      const matchesQuery = !q ||
        a.pet_name?.toLowerCase().includes(q) ||
        a.client_name?.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [sorted, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const hasFilters = !!query || filter !== "All";
  const clearFilters = () => { setQuery(""); setFilter("All"); setPage(1); };

  const counts = useMemo(() => ({
    total: appointments.length,
    pending: appointments.filter((a) => a.status === "incoming").length,
    confirmed: appointments.filter((a) => a.status === "confirmed").length,
    completed: appointments.filter((a) => a.status === "completed").length,
    cancelled: appointments.filter((a) => a.status === "cancelled").length,
  }), [appointments]);

  /* Pending requests that sit outside the date range on screen. */
  const pendingOutside = pendingDates.filter((d) => d < from || d > to);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments-range"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
    queryClient.invalidateQueries({ queryKey: ["day-bookings"] });
    queryClient.invalidateQueries({ queryKey: ["pending-dates"] });
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    queryClient.invalidateQueries({ queryKey: ["completed-visits"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    queryClient.invalidateQueries({ queryKey: ["report-headline"] });
    queryClient.invalidateQueries({ queryKey: ["report-category"] });
    queryClient.invalidateQueries({ queryKey: ["report-top-products"] });
  };

  const openPatientChart = async (appointment: Appointment) => {
    if (!appointment.pet_id) {
      toast.error("This appointment is not linked to a patient chart.");
      return;
    }
    setChartLoadingId(appointment.id);
    try {
      const { data: pet, error: petError } = await (supabase as any)
        .from("pets")
        .select("id, name, species, breed, gender, age, neutered, photo_url, owner_id")
        .eq("id", appointment.pet_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (petError) throw petError;
      if (!pet) throw new Error("The patient record could not be found.");

      const { data: owner, error: ownerError } = await (supabase as any)
        .from("clients")
        .select("id, name, phone, email, address, fb_messenger")
        .eq("id", pet.owner_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (ownerError) throw ownerError;
      setChartPet({
        ...pet,
        owner: owner
          ? {
              name: owner.name,
              phone: owner.phone,
              email: owner.email,
              address: owner.address,
              fb_messenger: owner.fb_messenger,
            }
          : { name: appointment.client_name, phone: appointment.client_phone },
        lastVisit: appointment.requested_date,
        visit: {
          service: appointment.service,
          when: [
            safeDate(appointment.requested_date, { month: "short", day: "numeric" }),
            fmtSlot(appointment.scheduled_time),
          ].filter(Boolean).join(", "),
          status: STATUS_LABEL[appointment.status] || appointment.status,
        },
      });
    } catch (error) {
      console.error("Couldn't open patient chart:", error);
      toast.error(error instanceof Error ? error.message : "Couldn't open the patient chart.");
    } finally {
      setChartLoadingId(null);
    }
  };

  const run = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try { await fn(); toast.success(message); refresh(); }
    catch (err: any) { toast.error(err?.message || "That didn't work. Please try again."); }
    finally { setBusy(null); }
  };

  const openReschedule = (a: Appointment) => {
    setSelected(a);
    setNewDate(a.requested_date);
    // Canonical slot text ("03:30 PM") so the dropdown shows the current
    // time selected; blank if the old time isn't one of the real slots.
    const cur = TIME_SLOTS.find((t) => timeToMinutes(t) === timeToMinutes(a.scheduled_time));
    setNewTime(cur || "");
    setShowReschedule(true);
  };

  const rescheduleUnchanged =
    !!selected &&
    newDate === selected.requested_date &&
    timeToMinutes(newTime) === timeToMinutes(selected.scheduled_time);

  const handleReschedule = async () => {
    if (!selected) return;
    if (!newDate || !newTime) { toast.error("Set a date and a time."); return; }
    if (rescheduleUnchanged) { toast.error("That's the same date and time. Pick a different one."); return; }
    setRescheduling(true);
    try {
      // Fresh check right before saving: a walk-in or another booking
      // may have taken the slot, or the time may have just passed.
      const problem = await slotProblem(newDate, newTime, selected.id, { service: selected.service, checkHours: true });
      if (problem) { toast.error(problem); return; }
      await rescheduleAppointmentAdmin(selected.id, newDate, newTime);
      toast.success(
        `Moved to ${safeDate(newDate, { weekday: "short", month: "short", day: "numeric" })} · ${fmtSlot(newTime)}. The client has been notified.`
      );
      setShowReschedule(false);
      refresh();
    } catch (err: any) {
      toast.error(
        err?.code === "23505"
          ? "That slot was just taken. Pick another time."
          : err?.message || "Couldn't reschedule that booking."
      );
    } finally {
      setRescheduling(false);
    }
  };

  const handleCancelAppointment = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      if (invoiceSummary[cancelTarget.id]) {
        toast.error("This visit has already been billed, so it can't be cancelled.");
        return;
      }
      // Only touches a booking that is still active, and tells the
      // client. Returns false if someone else already changed it.
      const done = await cancelAppointmentAdmin(cancelTarget.id);
      if (!done) {
        toast.error("That appointment was already changed by someone else. The list has been refreshed.");
      } else {
        toast.success("Appointment cancelled. The client has been notified.");
      }
      setCancelTarget(null);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't cancel that appointment.");
    } finally {
      setCancelling(false);
    }
  };

  const dateLabel = safeDate(from, { weekday: "long", month: "long", day: "numeric" });
  const periodLabel = isDay
    ? dateLabel
    : range === "Custom"
      ? `${safeDate(from, { month: "short", day: "numeric" })} – ${safeDate(to, { month: "short", day: "numeric", year: "numeric" })}`
      : range;

  /* ── Export: exactly the rows the filters leave, not just this page ── */
  const exportStaff = (a: Appointment) =>
    a.assigned_staff_id ? (staffMap[a.assigned_staff_id] || "Unknown staff") : (a.assigned_staff_name || "");
  const exportBilling = (a: Appointment) => {
    const inv = invoiceSummary[a.id];
    if (inv) return invoiceLabel(inv);
    return a.status === "cancelled" ? "-" : "Not billed";
  };
  /* The table's default "All" view hides completed and cancelled visits, but
     the stat cards count them. The export follows the cards: every status in
     the chosen date range, narrowed by the status chip and search. */
  const exportList = () => {
    const q = query.trim().toLowerCase();
    return sorted.filter((a) => {
      const matchesStatus = filter === "All" || STATUS_LABEL[a.status] === filter;
      const matchesQuery = !q ||
        a.pet_name?.toLowerCase().includes(q) ||
        a.client_name?.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  };
  const exportPrepare = () => {
    const rows = exportList();
    const isActive = (a: Appointment) => a.status === "incoming" || a.status === "confirmed";
    return {
      rows,
      pending: rows.filter((a) => a.status === "incoming").length,
      // Pending, confirmed or completed with nobody assigned. A completed visit can slip
      // through (older data, or an assignment cleared later), so it is counted too.
      unassigned: rows.filter((a) => (isActive(a) || a.status === "completed") && !exportStaff(a)).length,
      // Completed with no invoice, or with an invoice of ₱0 (price never entered).
      unbilled: rows.filter((a) => a.status === "completed" && !(invoiceSummary[a.id]?.total > 0)).length,
      passed: rows.filter((a) => isActive(a) && !!a.requested_date && !!a.scheduled_time && slotPassed(a.requested_date, a.scheduled_time)).length,
    };
  };
  const exportDay = () => toLocalISO(new Date());
  const exportClinic = () => clinicInfo?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services";
  const exportGenerated = () =>
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const exportScope = () => {
    const parts = [filter !== "All" ? filter : "All statuses", query.trim() ? `"${query.trim()}"` : ""].filter(Boolean);
    return parts.join(", ");
  };

  const exportSchedulePDF = () => {
    if (exporting) return;
    setExporting("pdf");
    try {
      const d = exportPrepare();
      const name = exportClinic();
      const contact = [clinicInfo?.address, clinicInfo?.phone_number, clinicInfo?.email].filter(Boolean).join("  |  ");
      type RGB = [number, number, number];
      const TEAL: RGB = [14, 79, 69];
      const INK: RGB = [26, 26, 26];
      const GREY: RGB = [107, 107, 107];
      const RULE: RGB = [220, 220, 214];
      const STATUS_COLOR: Record<string, RGB> = {
        Waiting: [107, 71, 16], "In progress": [30, 70, 130], Completed: [14, 79, 69], Cancelled: [138, 36, 36],
      };
      const doc = new jsPDF({ orientation: "landscape", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 15;
      const CW = W - M * 2;

      doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(...INK);
      doc.text(name, W / 2, 16, { align: "center" });
      if (contact) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
        doc.text(contact, W / 2, 22, { align: "center", maxWidth: CW });
      }
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, 26, W - M, 26);

      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
      doc.text("SCHEDULE", M, 34);
      doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...TEAL);
      doc.text("Appointment schedule", M, 42);
      const kv = (label: string, value: string, y: number) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
        doc.text(value, W - M, y, { align: "right" });
        const vw = doc.getTextWidth(value);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
        doc.text(label, W - M - vw - 3, y, { align: "right" });
      };
      kv("Period", periodLabel, 33);
      kv("Showing", exportScope(), 38.5);
      kv("Generated", exportGenerated(), 44);
      if (exportName) kv("Prepared by", exportName, 49.5);

      const y0 = 54;
      const figures: [string, string, string, RGB][] = [
        ["APPOINTMENTS", String(d.rows.length), "In this list", INK],
        ["AWAITING CONFIRMATION", String(d.pending), "Needs a decision", [107, 71, 16]],
        ["UNASSIGNED", String(d.unassigned), "No staff assigned", [107, 71, 16]],
        ["COMPLETED, NOT BILLED", String(d.unbilled), "Visit done, no amount", [138, 36, 36]],
      ];
      doc.setDrawColor(...TEAL); doc.setLineWidth(0.8); doc.line(M, y0, W - M, y0);
      const colW = CW / 4;
      figures.forEach(([label, value, caption, color], i) => {
        const x = M + i * colW + (i > 0 ? 4 : 0);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(label, x, y0 + 6);
        doc.setFontSize(13); doc.setTextColor(...color);
        doc.text(value, x, y0 + 14);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(caption, x, y0 + 19);
        if (i > 0) { doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M + i * colW, y0 + 3, M + i * colW, y0 + 21); }
      });
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, y0 + 24, W - M, y0 + 24);

      autoTable(doc, {
        theme: "plain",
        startY: y0 + 32,
        styles: {
          font: "helvetica", fontSize: 8.5, textColor: INK, lineColor: RULE,
          lineWidth: { bottom: 0.2 }, cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
        },
        headStyles: { textColor: GREY, fontStyle: "bold", fontSize: 7.5, lineColor: RULE },
        margin: { left: M, right: M, bottom: 18 },
        head: [["DATE", "TIME", "PATIENT", "OWNER", "SERVICE", "STAFF", "STATUS", "BILLING"]],
        body: d.rows.length > 0
          ? d.rows.map((a) => [
              safeDate(a.requested_date, { month: "short", day: "numeric", year: "numeric" }),
              a.scheduled_time ? fmtSlot(a.scheduled_time) : "-",
              `${a.pet_name || "-"}${a.pet_species ? ` (${a.pet_species})` : ""}`,
              a.client_name || "-",
              a.service || "-",
              exportStaff(a) || "Unassigned",
              STATUS_LABEL[a.status] || a.status,
              exportBilling(a),
            ])
          : [["No appointments match these filters", "", "", "", "", "", "", ""]],
        columnStyles: {
          0: { cellWidth: 26 }, 1: { cellWidth: 20 }, 2: { cellWidth: 50 }, 3: { cellWidth: 42 },
          4: { cellWidth: 38 }, 6: { cellWidth: 24 }, 7: { cellWidth: 22 },
        },
        didParseCell: (data: any) => {
          if (data.section !== "body" || d.rows.length === 0) return;
          const col = data.column.index;
          if (col === 6) {
            data.cell.styles.textColor = STATUS_COLOR[data.cell.raw as string] || INK;
            data.cell.styles.fontStyle = "bold";
          }
          if (col === 5 && data.cell.raw === "Unassigned") data.cell.styles.textColor = [107, 71, 16];
          if (col === 7 && (data.cell.raw === "Not billed" || data.cell.raw === "No amount" || data.cell.raw === "Partial")) data.cell.styles.textColor = [107, 71, 16];
          if (col === 7 && data.cell.raw === "Unpaid") data.cell.styles.textColor = [138, 36, 36];
          if (col === 7 && data.cell.raw === "Paid") data.cell.styles.textColor = [31, 95, 60];
        },
      });

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, H - 14, W - M, H - 14);
        doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont("helvetica", "normal");
        doc.text(name, M, H - 9);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 9, { align: "right" });
      }
      doc.save(`pet-royale-schedule_${from}_to_${to}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the PDF. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const exportScheduleExcel = () => {
    if (exporting) return;
    setExporting("excel");
    try {
      const d = exportPrepare();
      const MONEY = '"₱"#,##0.00';
      const TEAL = "0E4F45", INK = "1A1A1A", GRID = "D9D9D9";
      const book = XLSX.utils.book_new();
      const paint = (sheet: any, r: number, c: number, st: Record<string, unknown>) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
        sheet[ref].s = st;
      };
      const styleTable = (sheet: any, headRow: number, lastRow: number, cols: number, numCols: number[]) => {
        for (let c = 0; c < cols; c++) {
          paint(sheet, headRow, c, {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { patternType: "solid", fgColor: { rgb: TEAL } },
            alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
            border: { bottom: { style: "medium", color: { rgb: INK } } },
          });
        }
        for (let r = headRow + 1; r <= lastRow; r++) {
          for (let c = 0; c < cols; c++) {
            paint(sheet, r, c, {
              alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
              border: { bottom: { style: "thin", color: { rgb: GRID } } },
            });
          }
        }
        const rowsMeta: any[] = sheet["!rows"] || [];
        rowsMeta[headRow] = { hpt: 22 };
        sheet["!rows"] = rowsMeta;
      };

      const summaryRows: (string | number)[][] = [
        [exportClinic()],
        ["Appointment schedule"],
        ["Period", periodLabel],
        ["Showing", exportScope()],
        ["Generated", exportGenerated()],
        ...(exportName ? [["Prepared by", exportName]] : []),
        [],
        ["Figure", "Count"],
        ["Appointments in this list", d.rows.length],
        ["Awaiting confirmation", d.pending],
        ["Unassigned (no staff assigned)", d.unassigned],
        ["Completed, not billed", d.unbilled],
        ["Time passed, still open", d.passed],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 38 }, { wch: 30 }];
      const figStart = summaryRows.findIndex((r) => r[0] === "Figure");
      styleTable(summarySheet, figStart, figStart + 5, 2, [1]);
      paint(summarySheet, 0, 0, { font: { bold: true, sz: 14 } });
      paint(summarySheet, 1, 0, { font: { bold: true, sz: 12, color: { rgb: TEAL } } });
      XLSX.utils.book_append_sheet(book, summarySheet, "Summary");

      const header = [
        "Date", "Time", "Patient", "Species", "Owner", "Service", "Staff assigned",
        "Status", "Billing", "Invoice total", "Added / confirmed by",
      ];
      const body = d.rows.map((a) => {
        const inv = invoiceSummary[a.id];
        const byId = a.confirmed_by_staff_id || a.created_by_staff_id;
        return [
          a.requested_date || "",
          a.scheduled_time ? fmtSlot(a.scheduled_time) : "",
          a.pet_name || "",
          a.pet_species || "",
          a.client_name || "",
          a.service || "",
          exportStaff(a),
          STATUS_LABEL[a.status] || a.status,
          exportBilling(a),
          inv ? Number(inv.total.toFixed(2)) : "",
          byId ? (staffMap[byId] || "") : "",
        ];
      });
      const sheet = XLSX.utils.aoa_to_sheet([header, ...(body.length > 0 ? body : [["No appointments match these filters"]])]);
      sheet["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 24 }];
      for (let r = 1; r <= body.length; r++) {
        const ref = XLSX.utils.encode_cell({ r, c: 9 });
        if (sheet[ref] && typeof sheet[ref].v === "number") sheet[ref].z = MONEY;
      }
      styleTable(sheet, 0, Math.max(body.length, 1), header.length, [9]);
      if (body.length > 0) sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(header.length - 1)}${body.length + 1}` };
      sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
      XLSX.utils.book_append_sheet(book, sheet, "Appointments");

      XLSX.writeFile(book, `pet-royale-schedule_${from}_to_${to}.xlsx`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the spreadsheet. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  /* The table groups visits under a day heading when the period spans more
     than one day. Counts per day come from the whole filtered list, not just
     the page on screen. */
  const dayCounts: Record<string, number> = {};
  filtered.forEach((a) => { const d = a.requested_date || ""; dayCounts[d] = (dayCounts[d] || 0) + 1; });
  const today = clinicToday();

  const ROW_GRID = "lg:grid-cols-[88px_minmax(120px,1.25fr)_minmax(96px,.9fr)_minmax(120px,1.1fr)_minmax(110px,1fr)_64px_112px_44px]";
  const tab = (on: boolean) =>
    `flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[14px] font-semibold transition ${FOCUS_RING} ${
      on
        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
        : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
    }`;
  const statusTab = (on: boolean) =>
    `relative flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-[14px] font-semibold transition ${FOCUS_RING} ${
      on
        ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
    }`;
  const TRACK = "inline-flex h-10 max-w-full gap-0 overflow-x-auto rounded-xl bg-white p-0";
  const statusTabs: (typeof FILTERS[number])[] = ["All", "Waiting", "In progress", "Completed"];

  return (
    <AdminLayout
      title="Appointments"
      subtitle={isDay ? dateLabel : `Schedule · ${periodLabel}`}
    >
      <div className={`mx-auto w-full max-w-[1440px] space-y-4 px-5 pb-0 sm:px-8 lg:px-10 ${chartPet ? "hidden" : ""}`}>

        {/* Pending requests hidden by the current date range */}
        {pendingOutside.length > 0 && (
          <button
            onClick={() => {
              const dates = [...pendingOutside].sort();
              setCustomFrom(dates[0]);
              setCustomTo(dates[dates.length - 1]);
              setRange("Custom");
              setFilter("Waiting");
              setPage(1);
            }}
            className={`flex w-full items-center gap-3 rounded-[14px] border border-[hsl(40_55%_75%)] bg-[hsl(40_70%_93%)] px-4 py-3 text-left text-[hsl(40_70%_26%)] transition hover:bg-[hsl(40_70%_90%)] ${FOCUS_RING}`}
          >
            <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[14px] font-semibold">
              {pendingOutside.length} pending request{pendingOutside.length === 1 ? "" : "s"} outside this date range
              {pendingOutside.length === 1 ? " needs" : " need"} a decision
            </span>
            <span className="shrink-0 text-[14px] font-bold underline">Show them</span>
          </button>
        )}

        {/* ── Filters: period, status, search, service, export ── */}
        <section
          aria-label="Appointments"
          className="-mx-5 rounded-none border border-[hsl(var(--border))] bg-white sm:-mx-8 lg:-mx-10"
        >
        <div aria-label="Filters" className="flex flex-col gap-0">
          <div className="order-2 flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-[hsl(var(--border)/.8)] px-4 py-2.5">
            <div role="group" aria-label="Period" className={`${TRACK} order-2`}>
              {([
                ["Day", "Today"],
                ["Week", "This week"],
                ["Month", "This month"],
                ["Custom", "Custom"],
              ] as const).map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setRange(value); setPage(1); if (value === "Custom") setRangeOpen(true); }}
                  aria-pressed={range === value}
                  className={tab(range === value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {range === "Custom" && (
              <div className="order-2">
                <RangePicker
                  allowFuture
                  compact
                  from={customFrom} to={customTo}
                  open={rangeOpen} onOpenChange={setRangeOpen}
                  onChange={(a, b) => { setCustomFrom(a); setCustomTo(b); setPage(1); }}
                />
              </div>
            )}
            <div className="order-1 flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => shiftRange(-1)}
                aria-label="Previous date range"
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <p className="min-w-[104px] text-center text-[14px] font-bold text-[hsl(var(--foreground))]" aria-live="polite">
                {fmtDisplay(from)}{from !== to && ` – ${fmtDisplay(to)}`}
              </p>
              <button
                type="button"
                onClick={() => shiftRange(1)}
                aria-label="Next date range"
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => { setRange("Today"); setPage(1); }}
                className={`h-10 rounded-lg px-3 text-[13px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
              >
                Today
              </button>
            </div>

            <div className="order-3 ml-auto flex min-w-[250px] flex-[1_1_250px] flex-nowrap items-center justify-end gap-2.5">
              <label className="flex h-10 min-w-[130px] flex-[1_1_220px] items-center gap-2 rounded-xl border border-[hsl(var(--input))] bg-white px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)] sm:max-w-[340px]">
                <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                  placeholder="Search pet, owner or phone"
                  aria-label="Search pet, owner or phone"
                  className="min-w-0 flex-1 bg-transparent text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
                />
              </label>

              <button
                type="button"
                onClick={() => setShowWalkIn(true)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_4px_12px_rgb(5_31_66/.25)] transition hover:opacity-90 ${FOCUS_RING}`}
              >
                <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
                Walk-in
              </button>

            </div>
          </div>

          <div className="order-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[hsl(var(--border)/.8)] px-4 pb-0">
            <div role="group" aria-label="Status" className="flex min-w-0 max-w-full flex-1 items-center gap-1 overflow-x-auto">
              {statusTabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setFilter(key); setPage(1); }}
                  aria-pressed={filter === key}
                  className={statusTab(filter === key)}
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-1">
              <button
                type="button"
                onClick={exportScheduleExcel}
                disabled={!!exporting || appointments.length === 0}
                title="Download every appointment in this period, narrowed by the filters"
                className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[hsl(var(--border))] bg-white px-3 text-[12px] font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${FOCUS_RING}`}
              >
                {exporting === "excel" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={14} aria-hidden="true" />}
                Excel
              </button>
              <button
                type="button"
                onClick={exportSchedulePDF}
                disabled={!!exporting || appointments.length === 0}
                title="Download PDF schedule for this period, narrowed by the filters"
                className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[hsl(var(--border))] bg-white px-3 text-[12px] font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${FOCUS_RING}`}
              >
                {exporting === "pdf" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                PDF
              </button>
            </div>
          </div>

        </div>

        {/* ── Schedule rows ── */}
        <div aria-label="Schedule table">
          <div
            aria-hidden="true"
            className={`sticky top-16 z-10 hidden gap-x-3 border-b border-[hsl(var(--border)/.8)] bg-white px-4 py-[10px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] shadow-[0_2px_4px_rgb(15_36_71/.04)] lg:grid ${ROW_GRID}`}
          >
            <span>Date &amp; time</span>
            <span>Patient</span>
            <span>Owner</span>
            <span>Service</span>
            <span>Staff</span>
            <span>Source</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-14 text-center">
              <CalendarDays className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-bold">
                {appointments.length === 0
                  ? (isDay ? "Nothing booked for this day" : "Nothing booked in this period")
                  : "No appointments match these filters"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">
                {appointments.length === 0
                  ? "Bookings from the mobile app appear here."
                  : "Try a different name, service or status."}
              </p>
              {hasFilters && appointments.length > 0 && (
                <button
                  onClick={clearFilters}
                  className={`mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            pageRows.map((apt, idx) => {
              const inv = invoiceSummary[apt.id];
              const active = apt.status === "incoming" || apt.status === "confirmed";
              const passed =
                active && !!apt.requested_date && !!apt.scheduled_time &&
                slotPassed(apt.requested_date, apt.scheduled_time);
              const flag = passed
                ? apt.status === "incoming"
                  ? { label: "Time passed", cls: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" }
                  : { label: "Needs closing", cls: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" }
                : null;
              const staff = assignedStaffLabel(apt, staffMap);
              const unassigned = !staff;
              const jobs = apt.assigned_staff_id
                ? jobMap[apt.assigned_staff_id] || []
                : apt.assigned_staff_role ? [apt.assigned_staff_role] : [];
              const date = apt.requested_date || "";
              const startsDay = !isDay && (idx === 0 || pageRows[idx - 1].requested_date !== apt.requested_date);
              const byId = apt.confirmed_by_staff_id || apt.created_by_staff_id;
              const by = byId ? staffMap[byId] : "";
              return (
                <div key={apt.id}>
                  {startsDay && (
                    <div className="flex items-baseline gap-2 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--muted)/.35)] px-5 py-2 text-[13px]">
                      <span className="font-bold">{safeDate(date, { weekday: "long", month: "long", day: "numeric" })}</span>
                      {date === today && (
                        <span className="rounded-md bg-[hsl(var(--primary))] px-1.5 py-px text-[11px] font-bold text-[hsl(var(--primary-foreground))]">Today</span>
                      )}
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {dayCounts[date]} appointment{dayCounts[date] === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}
                  <div
                    className={`grid gap-x-3 gap-y-3 border-b border-[hsl(var(--border)/.7)] px-4 py-3 transition hover:bg-[hsl(var(--muted)/.35)] lg:items-center ${ROW_GRID}`}
                  >
                    <div className="flex items-start justify-between gap-3 lg:block">
                      <div>
                        <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
                          {safeDate(apt.requested_date, { month: "short", day: "numeric" })}
                        </p>
                        <p className="text-[14px] font-extrabold tabular-nums">{apt.scheduled_time ? fmtSlot(apt.scheduled_time) : "—"}</p>
                        {flag && (
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-bold ${flag.cls}`}>
                            {flag.label}
                          </span>
                        )}
                      </div>
                      <span className="lg:hidden"><Chip label={STATUS_LABEL[apt.status]} /></span>
                    </div>

                    <div className="min-w-0">
                      <div className="min-w-0">
                        <p className="break-words text-[14px] font-bold leading-snug" title={apt.pet_name}>{apt.pet_name}</p>
                        <p className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                          {[
                            apt.pet_species,
                            apt.pet_age ?? petProfiles[(apt as any).pet_id]?.age,
                            apt.pet_gender ?? petProfiles[(apt as any).pet_id]?.gender,
                          ]
                            .filter((v) => v !== null && v !== undefined && v !== "")
                            .map((v, i) => i === 1 && typeof v === "number" ? `${v} yrs` : v)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="break-words text-[14px] font-semibold leading-snug" title={titleCase(apt.client_name) || undefined}>{titleCase(apt.client_name)}</p>
                      <p
                        className="truncate whitespace-nowrap text-[12px] leading-snug text-[hsl(var(--muted-foreground))]"
                        title={fmtPhone(apt.client_phone || (apt.client_id ? ownerPhones[apt.client_id] : null))}
                      >
                        {fmtPhone(apt.client_phone || (apt.client_id ? ownerPhones[apt.client_id] : null))}
                      </p>
                    </div>

                    <p className="min-w-0 text-[14px] font-bold leading-snug">
                      {appointmentServiceLines(apt.service).map((line) => (
                        <span key={line} className="block">{line}</span>
                      ))}
                    </p>
                    <div className="min-w-0">
                      <p
                        title={[staff, ...jobs].filter(Boolean).join("\n") || "No staff assigned"}
                        className={`break-words text-[12.5px] leading-snug ${
                          unassigned && (active || apt.status === "completed")
                            ? "font-bold text-[hsl(40_70%_30%)]"
                            : "text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {staff || "Unassigned"}
                      </p>
                      {jobs.map((job) => (
                        <p key={job} className="break-words text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">{job}</p>
                      ))}
                    </div>
                    <p className="text-[14px] font-semibold text-[hsl(var(--muted-foreground))]">
                      {apt.created_by_staff_id ? "Walk-in" : "App"}
                    </p>

                    <div className="hidden min-w-0 lg:block">
                      <Chip label={STATUS_LABEL[apt.status]} />
                      {by ? (
                        <p
                          className="mt-1 text-[12px] leading-snug text-[hsl(var(--muted-foreground))]"
                          title={`${apt.confirmed_by_staff_id ? "Confirmed by" : "Added by"} ${by}`}
                        >
                          <span className="block">{apt.confirmed_by_staff_id ? "Confirmed by" : "Added by"}</span>
                          <span className="block break-words font-semibold text-[hsl(var(--foreground))]">{by}</span>
                        </p>
                      ) : null}
                    </div>

                    <AppointmentActions
                      appointment={apt}
                      busy={busy === apt.id}
                      chartLoading={chartLoadingId === apt.id}
                      onOpenChart={() => void openPatientChart(apt)}
                      onStartVisit={() => setConfirmTarget(apt)}
                      onAssignStaff={() => setAssignTarget(apt)}
                      onCompleteAndBill={() => {
                        if (!inv && !apt.assigned_staff_id && !apt.assigned_staff_name) {
                          toast.error("Assign who handled this visit before billing it.");
                          setAssignTarget(apt);
                          return;
                        }
                        setBillTarget(apt);
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}

          {!isLoading && filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}
                </strong> of {filtered.length}
                {hasFilters && appointments.length !== filtered.length && ` (${appointments.length} in this period)`}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                    className={`h-9 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`}
                  >
                    Previous
                  </button>
                  <span className="px-1 text-[14px] font-bold" aria-live="polite">{currentPage} / {totalPages}</span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className={`h-9 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </section>
      </div>
      {chartPet && (
        <PatientChartDialog pet={chartPet} onClose={() => setChartPet(null)} />
      )}
      {confirmTarget && (
        <ConfirmBookingDialog
          appointment={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onDone={() => { setConfirmTarget(null); refresh(); }}
          onReschedule={() => { const a = confirmTarget; setConfirmTarget(null); openReschedule(a); }}
        />
      )}
      {billTarget && (invoiceSummary[billTarget.id] && invoiceSummary[billTarget.id].total <= 0 ? (
        <EnterAmountDialog
          appointment={billTarget}
          invoice={invoiceSummary[billTarget.id]}
          onClose={() => setBillTarget(null)}
          onSaved={() => { setBillTarget(null); refresh(); }}
        />
      ) : (
        <BillCollectCompleteDialog
          appointment={billTarget}
          existing={billTarget.status === "completed" ? invoiceSummary[billTarget.id] : undefined}
          /* Title and name only ("Dr. Santos"), no job title. This is the
             invoice's own value: the table still uses assignedStaffLabel. */
          attendedBy={
            billTarget.assigned_staff_id
              ? (staffMap[billTarget.assigned_staff_id] || null)
              : (billTarget.assigned_staff_name || null)
          }
          onClose={() => setBillTarget(null)}
          onSaved={() => { setBillTarget(null); refresh(); }}
        />
      ))}
      {showWalkIn && (
        <WalkInDialog
          initialPetId={walkInPetId}
          onClose={() => { setShowWalkIn(false); setWalkInPetId(null); }}
          onDone={() => { setShowWalkIn(false); setWalkInPetId(null); refresh(); }}
        />
      )}
      {assignTarget && (
        <AssignStaffDialog
          appointment={assignTarget}
          staffOptions={staffDirectory}
          onClose={() => setAssignTarget(null)}
          onSaved={() => { setAssignTarget(null); refresh(); }}
        />
      )}
      {/* ── Reschedule ── */}
      <Dialog open={showReschedule} onOpenChange={(o) => { if (!o && !rescheduling) setShowReschedule(false); }}>
        <DialogContent aria-describedby={undefined} className={`max-w-[480px] ${DLG}`}>
          <div className={DLG_HEAD}>
            <div className="min-w-0">
              <p className={DLG_EYEBROW}>Move the visit</p>
              <DialogTitle className={DLG_TITLE}>Reschedule</DialogTitle>
              <p className={DLG_SUB}>{selected?.pet_name} · {selected?.service}</p>
            </div>
            <button onClick={() => setShowReschedule(false)} disabled={rescheduling} className={DLG_CLOSE}>
              Close
            </button>
          </div>
          <div className={DLG_BODY}>
            {selected && (
              <div className="mb-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-3.5 py-2.5 text-[14px]">
                <span className="text-[hsl(var(--muted-foreground))]">Currently </span>
                <strong>
                  {safeDate(selected.requested_date, { weekday: "short", month: "short", day: "numeric" })}
                  {selected.scheduled_time && ` · ${fmtSlot(selected.scheduled_time)}`}
                </strong>
              </div>
            )}
            <div className="space-y-3">
              <DayStrip
                value={newDate}
                service={selected?.service}
                onChange={(iso) => { setNewDate(iso); setNewTime(""); }}
              />
              <label className="block">
                <span className={DLG_LABEL}>New time</span>
                <div className="relative">
                  <TimeSlotSelect
                    date={newDate}
                    value={newTime}
                    onChange={setNewTime}
                    excludeId={selected?.id}
                    service={selected?.service}
                  />
                  <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                </div>
              </label>
            </div>
            <p className="mt-3 text-[13px] text-[hsl(var(--muted-foreground))]">
              The old slot is freed as soon as you save, and the client sees the new time in the app.
            </p>
          </div>
          <div className={DLG_FOOT}>
            <button onClick={() => setShowReschedule(false)} disabled={rescheduling} className={DLG_BTN}>
              Cancel
            </button>
            <button
              onClick={handleReschedule}
              disabled={rescheduling || !newDate || !newTime || rescheduleUnchanged}
              className={DLG_BTN_P}
            >
              {rescheduling
                ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                : <>Save changes</>}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cancel appointment ── */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o && !cancelling) setCancelTarget(null); }}>
        <DialogContent aria-describedby={undefined} className={`max-w-[440px] ${DLG}`}>
          <div className={DLG_HEAD}>
            <div className="min-w-0">
              <p className={`${DLG_EYEBROW} !text-[hsl(var(--destructive))]`}>Cancel appointment</p>
              <DialogTitle className={DLG_TITLE}>{cancelTarget?.pet_name}</DialogTitle>
              <p className={DLG_SUB}>{cancelTarget?.client_name} · {cancelTarget?.service}</p>
              <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">
                {cancelTarget && safeDate(cancelTarget.requested_date, { weekday: "long", month: "long", day: "numeric" })}
                {cancelTarget?.scheduled_time && ` · ${fmtSlot(cancelTarget.scheduled_time)}`}
              </p>
            </div>
            <button onClick={() => setCancelTarget(null)} disabled={cancelling} className={DLG_CLOSE}>
              Close
            </button>
          </div>
          <div className={DLG_BODY}>
            <div className="rounded-[10px] border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.06)] px-3.5 py-3 text-[13.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              The slot is freed for other bookings and the client sees this visit as cancelled. This can&apos;t be undone.
            </div>
          </div>
          <div className={DLG_FOOT}>
            <button onClick={() => setCancelTarget(null)} disabled={cancelling} className={DLG_BTN}>
              Keep it
            </button>
            <button onClick={handleCancelAppointment} disabled={cancelling} className={DLG_BTN_D}>
              {cancelling ? <><Loader2 size={15} className="animate-spin" /> Cancelling…</> : "Cancel appointment"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/* One look for every action dialog on this screen: white card, 12px corners,
   a ruled header and footer, 40px fields and buttons. */
const DLG = "grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden rounded-[12px] border border-[hsl(var(--border))] bg-white p-0 [&>button]:hidden";
const DLG_HEAD = "flex shrink-0 items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-6 pb-3 pt-4";
const DLG_EYEBROW = "mb-0.5 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]";
const DLG_TITLE = "text-[22px] font-bold leading-tight tracking-[-.01em]";
const DLG_SUB = "mt-1 truncate text-[13px] text-[hsl(var(--muted-foreground))]";
const DLG_CLOSE = `h-9 shrink-0 rounded-[10px] px-3 text-[14px] font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`;
const DLG_BODY = "px-6 py-4";
const DLG_FOOT = "flex shrink-0 items-center justify-end gap-2.5 border-t border-[hsl(var(--border))] px-6 pb-4 pt-3";
const DLG_LABEL = "mb-1 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]";
const DLG_BTN = `h-10 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-white px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`;
const DLG_BTN_P = `inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] ${FOCUS_RING}`;
const DLG_BTN_D = `inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[hsl(var(--destructive))] px-5 text-[14px] font-bold text-[hsl(var(--destructive-foreground))] transition hover:opacity-90 disabled:opacity-60 ${FOCUS_RING}`;

function ConfirmBookingDialog({
  appointment, onClose, onDone, onReschedule,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: () => void;
  onReschedule: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  // undefined = still checking, "" = slot is fine, otherwise the reason.
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    slotProblem(appointment.requested_date, appointment.scheduled_time || "", appointment.id, { service: appointment.service })
      .then((p) => { if (active) setProblem(p); })
      .catch(() => { if (active) setProblem(""); });
    return () => { active = false; };
  }, [appointment.id, appointment.requested_date, appointment.scheduled_time]);

  /* Re-read the status right before writing, so two staff members
     can't both act on the same request. */
  const stillIncoming = async () => {
    const { data } = await (supabase as any)
      .from("appointments").select("status").eq("id", appointment.id).maybeSingle();
    return data?.status === "incoming";
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      if (!(await stillIncoming())) {
        toast.error("This request was already handled. The list has been refreshed.");
        onDone();
        return;
      }
      const fresh = await slotProblem(
        appointment.requested_date, appointment.scheduled_time || "", appointment.id,
        { service: appointment.service }
      );
      if (fresh) { setProblem(fresh); toast.error(fresh); setBusy(false); return; }
      await confirmAppointment(appointment.id, useAdminStore.getState().staffId);
      toast.success("Appointment confirmed. The client has been notified.");
      onDone();
    } catch (err: any) {
      toast.error(
        err?.code === "23505"
          ? "That slot was just taken. Reschedule this request instead."
          : err?.message || "Couldn't confirm that booking."
      );
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    setBusy(true);
    try {
      const done = await declineAppointment(appointment.id);
      if (!done) {
        toast.error("This request was already handled. The list has been refreshed.");
      } else {
        toast.success("Booking declined. The client has been notified and the slot is free.");
      }
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't decline that booking.");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className={`max-w-[480px] ${DLG}`}>
        <div className={DLG_HEAD}>
          <div className="min-w-0">
            <p className={DLG_EYEBROW}>Confirm booking</p>
            <DialogTitle className={DLG_TITLE}>{appointment.pet_name}</DialogTitle>
            <p className={DLG_SUB}>{appointment.client_name} · {appointment.service}</p>
            <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">
              {safeDate(appointment.requested_date, { weekday: "long", month: "long", day: "numeric" })}
              {appointment.scheduled_time && ` · ${fmtSlot(appointment.scheduled_time)}`}
            </p>
          </div>
          <button onClick={onClose} className={DLG_CLOSE}>Close</button>
        </div>
        {(declining || problem) && (
          <div className={DLG_BODY}>
            {declining ? (
              <div className="rounded-[10px] border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.06)] px-3.5 py-3">
                <p className="text-[15px] font-bold text-[hsl(var(--destructive))]">Decline this booking?</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  The slot is freed and the client is notified.
                </p>
              </div>
            ) : (
              <div className="rounded-[10px] border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_92%)] px-3.5 py-3">
                <p className="text-[14px] font-bold leading-snug text-[hsl(40_55%_24%)]">{problem}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-[hsl(40_55%_24%)]">
                  Confirming is blocked. Reschedule this request or decline it.
                </p>
              </div>
            )}
          </div>
        )}
        <div className={DLG_FOOT}>
          {declining ? (
            <>
              <button onClick={() => setDeclining(false)} className={DLG_BTN}>Go back</button>
              <button onClick={handleDecline} disabled={busy} className={DLG_BTN_D}>
                {busy ? "Declining…" : "Decline booking"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setDeclining(true)} disabled={busy} className={DLG_BTN}>Decline</button>
              {problem ? (
                <button onClick={onReschedule} disabled={busy} className={DLG_BTN_P}>
                  Reschedule instead
                </button>
              ) : (
                <button onClick={handleConfirm} disabled={busy || problem === undefined} className={DLG_BTN_P}>
                  {busy
                    ? <><Loader2 size={15} className="animate-spin" /> Confirming…</>
                    : problem === undefined
                      ? <><Loader2 size={15} className="animate-spin" /> Checking slot…</>
                      : <>Confirm booking</>}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
interface LineItem {
  service_id: string;
  service_name: string;
  quantity: number;
  unit_price: number;
  /* The service's price is set on the day, so it starts at ₱0 and has to be entered. */
  variable?: boolean;
  /* Weight-priced services keep their ranges so staff can tap one. */
  tiers?: ServiceTier[];
}

const BILL_INPUT =
  "h-10 w-full min-w-0 rounded-[9px] border border-[hsl(var(--input))] bg-white px-3 text-[14px] transition hover:border-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none";

function BillCollectCompleteDialog({
  appointment, existing, attendedBy, onClose, onSaved,
}: {
  appointment: Appointment;
  existing?: { id: string; total: number; created_at: string };
  /* The staff member assigned to this visit, with their title, or null
     when nobody was assigned. Only shown on the receipt. */
  attendedBy?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fullName = useAdminStore((s) => s.fullName);
  const queryClient = useQueryClient();
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["services"], queryFn: fetchServices,
  });
  
  const { data: clinic } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const [items, setItems] = useState<LineItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [saving, setSaving] = useState(false);
  /* Asked once, when a price is still ₱0, before the visit is closed. */
  const [confirmZero, setConfirmZero] = useState(false);

  const readOnly = !!existing;

  const { data: existingItems = [] } = useQuery({
    queryKey: ["invoice-items", existing?.id],
    enabled: !!existing?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("invoice_items").select("*").eq("invoice_id", existing!.id);
      return data || [];
    },
  });

  const money = (n: number) => Math.round(n * 100) / 100;
  const total = readOnly
    ? existing!.total
    : money(items.reduce((s, i) => s + money(i.unit_price * i.quantity), 0));

  const addItem = (s: Service) => {
    if (items.some((i) => i.service_id === s.id)) {
      toast.error(`${s.name} is already on this invoice.`);
      return;
    }
    const price = s.pricing_type === "flat" && s.price != null ? Number(s.price) : 0;
    setItems([...items, {
      service_id: s.id,
      service_name: s.name,
      quantity: 1,
      unit_price: price,
      variable: s.pricing_type !== "flat",
      tiers: s.pricing_type === "weight_tiered" && s.tiers.length > 0 ? s.tiers : undefined,
    }]);
    setConfirmZero(false);
    setSearch("");
  };

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setConfirmZero(false);
    setItems(items.map((i) => (i.service_id === id ? { ...i, ...patch } : i)));
  };

  const removeItem = (id: string) => {
    setConfirmZero(false);
    setItems(items.filter((i) => i.service_id !== id));
  };

  const unpriced = items.filter((i) => i.unit_price <= 0);

  const visibleServices = services.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q && category === "all") return false;
    const matchesSearch = !q || s.name.toLowerCase().includes(q);
    const matchesCategory = category === "all" || s.category === category;
    return matchesSearch && matchesCategory && !items.some((i) => i.service_id === s.id);
  }).slice(0, 8);

  const handleBillCollectComplete = async (confirmed = false) => {
    if (items.length === 0) {
      toast.error("Add at least one service, or use \u201CComplete without billing\u201D instead.");
      return;
    }
    /* A price of ₱0 is almost always a price not entered yet (a service set
       on the day), or a charge that was forgotten. The visit can still be
       completed, but it is asked first. */
    if (!confirmed && unpriced.length > 0) {
      setConfirmZero(true);
      return;
    }
    setSaving(true);
    try {
      /* Every step can be repeated safely. If an earlier try got partway (the
         invoice was saved but completing the visit failed, say), this one
         picks up where it stopped instead of billing the visit twice. */
      const { data: found, error: findErr } = await (supabase as any)
        .from("invoices")
        .select("id, total_amount, paid_at")
        .eq("appointment_id", appointment.id)
        .order("created_at", { ascending: true })
        .limit(1);
      if (findErr) throw findErr;

      let invoice = found?.[0];
      const alreadyBilled = !!invoice;
      if (!invoice) {
        const { data, error: invoiceError } = await (supabase as any)
          .from("invoices")
          .insert([{
            appointment_id: appointment.id,
            total_amount: total,
            // Closed only after the payment is saved, further down.
            paid_at: null,
          }])
          .select("id, total_amount, paid_at")
          .single();
        if (invoiceError) throw invoiceError;
        invoice = data;
      }
      // What this invoice is for: the one just made, or the one already on file.
      const billedTotal = alreadyBilled ? Number(invoice.total_amount || 0) : total;

      // Line items, only if the invoice has none yet.
      let itemsError: { message: string } | null = null;
      const { count: itemCount, error: itemCountErr } = await (supabase as any)
        .from("invoice_items").select("id", { count: "exact", head: true }).eq("invoice_id", invoice.id);
      if (itemCountErr) {
        itemsError = itemCountErr;
      } else if ((itemCount ?? 0) === 0) {
        const res = await (supabase as any)
          .from("invoice_items")
          .insert(items.map((i) => ({
            invoice_id: invoice.id,
            service_id: i.service_id,
            service_name: i.service_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            subtotal: money(i.unit_price * i.quantity),
          })));
        itemsError = res.error;
      }

      // The payment, only if none is recorded on this invoice. No payment row for ₱0.
      if (billedTotal > 0) {
        const { count: payCount, error: payCountErr } = await (supabase as any)
          .from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoice.id);
        if (payCountErr) throw payCountErr;
        const paidAt = new Date().toISOString();
        if ((payCount ?? 0) === 0) {
          const { error: payErr } = await (supabase as any)
            .from("payments")
            .insert([{
              invoice_id: invoice.id,
              appointment_id: appointment.id,
              amount: billedTotal,
              method: "Cash",
              recorded_by: fullName || "Staff",
              paid_at: paidAt,
            }]);
          // Nothing is marked paid and the visit stays open, so it can be retried.
          if (payErr) throw payErr;
        }
        // Only now, with the payment on file, is the invoice closed.
        if (!invoice.paid_at) {
          const { error: closeErr } = await (supabase as any)
            .from("invoices").update({ paid_at: paidAt }).eq("id", invoice.id);
          if (closeErr) throw closeErr;
        }
      }

      // Safe to run again: a visit that is already completed is left as it is.
      await completeAppointment(appointment.id);

      if (itemsError) {
        toast.error("Visit completed and payment recorded, but the line items failed to save.");
      } else if (alreadyBilled) {
        toast.success("This visit had already been billed. It is now marked completed.");
      } else if (billedTotal <= 0) {
        toast.success("Visit completed with no amount. Enter it later from Manage \u2192 Enter amount.");
      } else {
        toast.success(`Billed ${peso(billedTotal)} and completed the visit.`);
      }
      onSaved();
    } catch (err: any) {
      // Refresh the list so a half-finished save shows up, and say that trying again is safe.
      queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-range"] });
      toast.error(`Couldn't finish that visit${err?.message ? `: ${err.message}` : ""}. Nothing is billed twice, so it is safe to try again.`);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteWithoutBilling = async () => {
    setSaving(true);
    try {
      await completeAppointment(appointment.id);
      toast.success("Visit completed. Nothing billed.");
      onSaved();
    } catch {
      toast.error("Couldn't complete that visit.");
    } finally {
      setSaving(false);
    }
  };

  const visitLabel = `${safeDate(appointment.requested_date, { month: "short", day: "numeric", year: "numeric" })}${
    appointment.scheduled_time ? ` · ${fmtSlot(appointment.scheduled_time)}` : ""
  }`;
  const issued = readOnly
    ? safeDate(existing!.created_at?.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })
    : "";
  const detailRows: [string, string][] = readOnly
    ? [
        ["Invoice no.", `INV-${existing!.id.slice(0, 6).toUpperCase()}`],
        ["Date issued", issued],
        ["Visit", visitLabel],
        ["Billed to", appointment.client_name],
        ["Pet", appointment.pet_name],
        ["Service", appointment.service],
        // Left out when nobody was assigned, rather than printing a blank.
        ...(attendedBy ? ([["Attended by", attendedBy]] as [string, string][]) : []),
      ]
    : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className={
        readOnly
          ? "max-w-[860px] grid-cols-[minmax(0,1fr)] gap-0 rounded-[12px] border border-[hsl(var(--border))] bg-white p-7 [&>button]:hidden"
          : "!flex max-h-[96vh] max-w-[620px] flex-col gap-0 overflow-hidden rounded-[12px] border border-[hsl(var(--border))] bg-white p-0 [&>button]:hidden"
      }>
        {readOnly ? (
          <>
            {/* Receipt, landscape: who and when on the left, the bill on the
                right, so the whole thing fits without scrolling. */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[22px] font-bold leading-7 tracking-[-.02em]">
                  {clinic?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services"}
                </p>
                {(clinic?.address || clinic?.phone_number || clinic?.email) && (
                  <p className="mt-1 text-[15px] leading-snug text-[hsl(var(--muted-foreground))]">
                    {[clinic?.address, clinic?.phone_number, clinic?.email].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className={`shrink-0 rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-x-10 border-t border-[hsl(var(--card-border))] pt-5">
              <div className="min-w-0">
                <p className="text-[40px] font-bold leading-none tracking-[-.03em]">{peso(total)}</p>
                <span className="mt-3 inline-flex h-[34px] w-fit items-center gap-1.5 rounded-full border-[1.5px] border-[hsl(145_42%_27%)] px-3.5 text-[15px] font-bold text-[hsl(145_42%_27%)]">
                  <Check size={16} strokeWidth={2.4} aria-hidden="true" /> Paid · {issued}
                </span>

                <div className="mt-4 border-t border-[hsl(var(--card-border))]">
                  {detailRows.map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="shrink-0 text-[15px] text-[hsl(var(--muted-foreground))]">{k}</span>
                      <span className="min-w-0 truncate text-right text-[15px] font-bold" title={v}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-w-0 flex-col border-l border-[hsl(var(--card-border))] pl-10">
                {/* Only the line items can scroll, and only past six or so. */}
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b-2 border-[hsl(var(--primary))]">
                        <th className="pb-2 text-left text-[13px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Service</th>
                        <th className="pb-2 text-right text-[13px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Qty</th>
                        <th className="pb-2 text-right text-[13px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {existingItems.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-5 text-center text-[15px] text-[hsl(var(--muted-foreground))]">
                            No line items on this invoice.
                          </td>
                        </tr>
                      ) : (
                        existingItems.map((it: any) => (
                          <tr key={it.id} className="border-b border-[hsl(var(--card-border))]">
                            <td className="py-3 pr-3 text-[16px]">{it.service_name}</td>
                            <td className="py-3 text-right text-[16px] tabular-nums">{it.quantity}</td>
                            <td className="py-3 text-right text-[16px] font-bold tabular-nums">{peso(Number(it.subtotal))}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-auto flex items-baseline justify-between border-t border-[hsl(var(--card-border))] pt-4">
                  <span className="text-[18px] font-bold">Total paid</span>
                  <span className="text-[24px] font-bold tabular-nums">{peso(total)}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Header and footer stay put; only the middle scrolls, so
                the action buttons are never pushed off the bottom. */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-6 pb-3 pt-4">
              <div className="min-w-0">
                <p className="mb-0.5 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                  Bill, collect &amp; complete
                </p>
                <DialogTitle className="text-[22px] font-bold leading-tight tracking-[-.01em]">{appointment.pet_name}</DialogTitle>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[hsl(var(--muted-foreground))]">
                  <span className="truncate">{appointment.client_name} · {appointment.service}</span>
                  <span className="rounded-full bg-[#DDEFE6] px-2.5 py-[2px] text-[12px] font-semibold text-[#17553B]">
                    {STATUS_LABEL[appointment.status] || appointment.status}
                  </span>
                </p>
              </div>
              <button
                onClick={onClose}
                className={`h-9 shrink-0 rounded-[10px] px-3 text-[14px] font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-3 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin]">
              <p className="mb-2 text-[15px] font-bold">What did the visit use?</p>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,180px)] gap-2.5">
                <label className="block min-w-0">
                  <span className="mb-1 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]">Search services</span>
                  <input
                    type="search" value={search} autoComplete="off" placeholder="e.g. Regular Cut"
                    onChange={(e) => setSearch(e.target.value)} className={BILL_INPUT}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]">Category</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={BILL_INPUT}>
                    <option value="all">All</option>
                    {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                </div>
              ) : visibleServices.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded-[12px] border border-[hsl(var(--border))] bg-white">
                  {visibleServices.map((sv, i) => (
                    <button
                      key={sv.id}
                      onClick={() => addItem(sv)}
                      className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition hover:bg-[hsl(var(--muted))] ${i > 0 ? "border-t border-[hsl(var(--border))]" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold">{sv.name}</p>
                        {(category === "all" || sv.pricing_type !== "flat") && (
                          <p className="truncate text-[13px] text-[hsl(var(--muted-foreground))]">
                            {category === "all" && sv.category}
                            {sv.pricing_type !== "flat" && `${category === "all" ? " · " : ""}${sv.pricing_type === "weight_tiered" ? "Price by pet weight" : "Price set on the day"}`}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-[15px] font-bold">
                          {sv.pricing_type === "flat" && sv.price != null ? peso(Number(sv.price)) : <span className="text-[14px] font-medium text-[hsl(var(--muted-foreground))]">Set price</span>}
                        </span>
                        <span className="rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-4 py-[7px] text-[14px] font-bold text-[hsl(var(--primary))]">Add</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 px-1 text-[13px] text-[hsl(var(--muted-foreground))]">
                  {search || category !== "all"
                    ? "Nothing matches that."
                    : "Search or pick a category to find services."}
                </p>
              )}

              <p className="mb-2 mt-3 text-[15px] font-bold">
                On this invoice
                {items.length > 0 && (
                  <span className="ml-1 font-normal text-[hsl(var(--muted-foreground))]">({items.length})</span>
                )}
              </p>
              {items.length === 0 ? (
                <p className="rounded-[12px] border-[1.5px] border-dashed border-[hsl(var(--border))] px-4 py-4 text-center text-[14px] text-[hsl(var(--muted-foreground))]">
                  Nothing added yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.service_id}
                      className="rounded-[12px] border border-[hsl(var(--border))] bg-white px-3.5 pb-3 pt-1"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 pt-2 text-[15px] font-bold leading-snug">{item.service_name}</p>
                        <button
                          onClick={() => removeItem(item.service_id)}
                          aria-label={`Remove ${item.service_name}`}
                          className="min-h-9 shrink-0 px-1 text-[13px] font-bold text-[hsl(var(--destructive))] hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div className="flex items-center gap-2 pb-0.5">
                          <button
                            onClick={() => updateItem(item.service_id, { quantity: Math.max(1, item.quantity - 1) })}
                            aria-label="Decrease quantity"
                            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] text-[20px] font-bold leading-none text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-[16px] font-bold tabular-nums">{item.quantity}</span>
                          <button
                            onClick={() => updateItem(item.service_id, { quantity: item.quantity + 1 })}
                            aria-label="Increase quantity"
                            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] text-[20px] font-bold leading-none text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]"
                          >
                            +
                          </button>
                        </div>
                        <label className="block w-36 shrink-0">
                          <span className="mb-1 block text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]">Price (₱)</span>
                          <input
                            type="number" step="0.01" min="0"
                            value={item.unit_price}
                            onChange={(e) => updateItem(item.service_id, { unit_price: parseFloat(e.target.value) || 0 })}
                            aria-label={`Unit price for ${item.service_name}`}
                            className={`${BILL_INPUT} text-right font-bold`}
                          />
                        </label>
                      </div>
                      {item.tiers && item.tiers.length > 0 && (
                        <div className="mt-2.5">
                          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Pet weight</p>
                          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                            {item.tiers.map((t) => {
                              const on = item.unit_price === Number(t.price);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => updateItem(item.service_id, { unit_price: Number(t.price) })}
                                  className={`flex h-[46px] flex-col items-center justify-center rounded-full border-[1.5px] px-1 text-[13px] font-bold leading-tight transition ${FOCUS_RING} ${
                                    on
                                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                                      : "border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] hover:bg-[hsl(var(--muted))]"
                                  }`}
                                >
                                  <span className="text-[11.5px] font-medium opacity-80">{Number(t.min_weight)}–{Number(t.max_weight)} kg</span>
                                  {peso(Number(t.price))}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {item.unit_price <= 0 && (
                        <p className="mt-1.5 text-[13px] font-medium text-[hsl(40_55%_30%)]">
                          {item.tiers?.length ? "Pick the pet's weight range, or enter the amount." : item.variable ? "Price set on the day. Enter the amount." : "No price set."}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>
            {confirmZero ? (
              <div
                role="alert"
                className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] bg-[hsl(40_55%_95%)] px-6 pb-4 pt-3"
              >
                <p className="basis-full text-[15px] font-semibold leading-snug text-[hsl(40_55%_30%)]">
                  {total <= 0
                    ? "Nothing to collect yet. The visit will be completed with no amount and flagged as \u201CNo amount\u201D until you enter the price from Manage."
                    : `${unpriced.map((i) => i.service_name).join(", ")} ${unpriced.length === 1 ? "is" : "are"} priced at \u20B10. Complete anyway? ${unpriced.length === 1 ? "That line" : "Those lines"} will be billed at \u20B10.`}
                </p>
                <div className="ml-auto flex gap-3">
                  <button
                    onClick={() => setConfirmZero(false)}
                    disabled={saving}
                    className="h-10 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                  >
                    Go back
                  </button>
                  <button
                    onClick={() => void handleBillCollectComplete(true)}
                    disabled={saving}
                    className="flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                  >
                    {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <>Complete anyway</>}
                  </button>
                </div>
              </div>
            ) : (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] bg-white px-6 pb-4 pt-3">
              <div className="flex basis-full items-center justify-between gap-4" aria-live="polite">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">Total to collect</p>
                  <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                    {items.length > 0
                      ? `${items.length} item${items.length === 1 ? "" : "s"}${unpriced.length > 0 ? " · pick a weight range or enter a price" : ""}`
                      : "Add a service to bill this visit."}
                  </p>
                </div>
                <span className="text-[26px] font-bold leading-none tracking-[-.01em] tabular-nums text-[hsl(145_42%_27%)]">
                  {peso(total)}
                </span>
              </div>
              <button
                onClick={handleCompleteWithoutBilling}
                disabled={saving || items.length > 0}
                title={items.length > 0 ? "Remove the added services first" : undefined}
                className="h-10 rounded-[10px] px-2 text-[14px] font-bold text-[hsl(var(--primary))] underline-offset-4 transition hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Complete without billing
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="h-10 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleBillCollectComplete()}
                  disabled={saving || items.length === 0}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
                >
                  {saving
                    ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                    : <>Bill, collect &amp; complete</>}
                </button>
              </div>
            </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Enter the price for a visit that was completed without one: a service whose
   price is set on the day, left at ₱0 when the visit was closed. Saving sets
   the prices, closes the invoice and records the payment as collected in cash,
   the same as "Bill, collect & complete". */
function EnterAmountDialog({
  appointment, invoice, onClose, onSaved,
}: {
  appointment: Appointment;
  invoice: { id: string; total: number; created_at: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const fullName = useAdminStore((s) => s.fullName);
  const { data: rows = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ["invoice-items", invoice.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoice_items").select("*").eq("invoice_id", invoice.id);
      if (error) throw error;
      return data || [];
    },
  });
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const money = (n: number) => Math.round(n * 100) / 100;
  const lines = rows.map((r) => {
    const raw = prices[r.id] ?? (Number(r.unit_price) > 0 ? String(r.unit_price) : "");
    const parsed = parseFloat(raw);
    const unit = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const qty = Number(r.quantity) || 1;
    return { id: r.id as string, name: r.service_name as string, qty, raw, unit, subtotal: money(unit * qty) };
  });
  const total = money(lines.reduce((s, l) => s + l.subtotal, 0));

  const save = async () => {
    if (total <= 0) {
      toast.error("Enter a price for at least one service.");
      return;
    }
    setSaving(true);
    try {
      for (const l of lines) {
        const { error } = await (supabase as any)
          .from("invoice_items").update({ unit_price: l.unit, subtotal: l.subtotal }).eq("id", l.id);
        if (error) throw error;
      }
      const now = new Date().toISOString();
      const { error: invoiceError } = await (supabase as any)
        .from("invoices").update({ total_amount: total, paid_at: now }).eq("id", invoice.id);
      if (invoiceError) throw invoiceError;

      const { error: paymentError } = await (supabase as any)
        .from("payments")
        .insert([{
          invoice_id: invoice.id,
          appointment_id: appointment.id,
          amount: total,
          method: "Cash",
          recorded_by: fullName || "Staff",
          paid_at: now,
        }]);
      if (paymentError) {
        toast.error(`Amount saved, but the payment wasn't recorded: ${paymentError.message}`);
      } else {
        toast.success(`Saved ${peso(total)} for ${appointment.pet_name}.`);
      }
      onSaved();
    } catch {
      toast.error("Couldn't save that amount. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className={`!flex max-h-[96vh] max-w-[560px] flex-col ${DLG}`}
      >
        <div className={DLG_HEAD}>
          <div className="min-w-0">
            <p className={DLG_EYEBROW}>Enter amount</p>
            <DialogTitle className={DLG_TITLE}>{appointment.pet_name}</DialogTitle>
            <p className={DLG_SUB}>{appointment.client_name} · {appointment.service}</p>
          </div>
          <button onClick={onClose} disabled={saving} className={DLG_CLOSE}>Close</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-[13.5px] text-[hsl(var(--muted-foreground))]">
            This visit was completed without a price. Enter what was charged to finish billing it.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-6" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : isError || lines.length === 0 ? (
            <p role="alert" className="rounded-[12px] border-[1.5px] border-dashed border-[hsl(var(--border))] px-4 py-4 text-center text-[14px] text-[hsl(var(--muted-foreground))]">
              {isError ? "Couldn't load this invoice. Close and try again." : "This invoice has no services on it, so there is nothing to price."}
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-end justify-between gap-3 rounded-[12px] border border-[hsl(var(--border))] bg-white px-3.5 py-2.5"
                >
                  <div className="min-w-0 pb-2">
                    <p className="truncate text-[15px] font-bold">{l.name}</p>
                    <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Quantity {l.qty}</p>
                  </div>
                  <label className="block w-36 shrink-0">
                    <span className={DLG_LABEL}>Price (₱)</span>
                    <input
                      type="number" step="0.01" min="0" inputMode="decimal"
                      value={l.raw}
                      placeholder="0.00"
                      onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })}
                      aria-label={`Unit price for ${l.name}`}
                      className={`${BILL_INPUT} text-right font-bold`}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[hsl(var(--border))] px-6 pb-4 pt-3">
          <div className="mb-3 flex items-center justify-between gap-4" aria-live="polite">
            <div className="min-w-0">
              <p className="text-[15px] font-bold">Total to collect</p>
              <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Saving records this as collected in full, in cash.</p>
            </div>
            <span className={`text-[26px] font-bold leading-none tracking-[-.01em] tabular-nums ${
              total > 0 ? "text-[hsl(145_42%_27%)]" : "text-[hsl(var(--muted-foreground))]"
            }`}>
              {peso(total)}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2.5">
            <button onClick={onClose} disabled={saving} className={DLG_BTN}>Cancel</button>
            <button
              onClick={() => void save()}
              disabled={saving || isLoading || isError || total <= 0}
              className={DLG_BTN_P}
            >
              {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save amount"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* Pet photo in the round profile ring. Falls back to the initial when the
   pet has no photo (or the photo fails to load). */
function PetAvatar({ letter, size, photo }: { letter: string; size: number; photo?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photo]);
  return (
    <div
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full border-[3px] border-[hsl(var(--primary))] p-[3px]"
    >
      {photo && !failed ? (
        <img src={photo} alt="" onError={() => setFailed(true)} className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          style={{ fontSize: size * 0.3 }}
          className="flex h-full w-full items-center justify-center rounded-full bg-[hsl(var(--primary))] font-bold text-[hsl(var(--accent))]"
        >
          {letter}
        </div>
      )}
    </div>
  );
}

/* Display only: +639155034433 -> +63 915 503 4433. Anything else is shown as stored. */
function fmtPhone(p?: string | null) {
  if (!p) return "\u2014";
  const m = p.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : p;
}

function appointmentServiceLines(service?: string | null) {
  const label = (service || "").replace(/\s+/g, " ").trim();
  const normalized = label.toLowerCase();
  const lineBreaks: Record<string, string[]> = {
    "confinement & emergency care": ["Confinement &", "Emergency Care"],
    "veterinary check-ups": ["Veterinary", "Check-ups"],
    "veterinary check-ups and consultations": ["Veterinary", "Check-ups"],
    "minor & major surgeries": ["Minor & Major", "Surgeries"],
    "vaccination & deworming": ["Vaccination &", "Deworming"],
  };
  return lineBreaks[normalized] ?? [label];
}

/* ── Walk-in form pieces: every field has a visible label above it ── */
const WI_SECTION = "mb-3 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]";
const WI_LABEL = "text-[13px] font-semibold text-[hsl(var(--foreground))]";
const WI_INPUT = `h-11 w-full min-w-0 rounded-[10px] border border-[hsl(var(--input))] bg-white px-3.5 text-[15px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] ${FOCUS_RING}`;
const WI_ERR = "mt-1 text-[13px] text-[hsl(var(--destructive))]";

function WiField({ id, label, required = false, children }: {
  id: string; label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={WI_LABEL}>
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-[hsl(var(--destructive))]">*</span>}
      </label>
      {children}
    </div>
  );
}

/* Two or three options shown as buttons, with a visible name above them. Tapping the chosen one clears it. */
function WiChoice({ label, options, value, onChange }: {
  label: string; options: readonly string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={`mb-1.5 ${WI_LABEL}`}>{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const on = value === o;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? "" : o)}
              className={`h-11 rounded-[10px] border text-[14px] font-semibold transition ${FOCUS_RING} ${
                on
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "border-[hsl(var(--input))] bg-white text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function WalkInDialog({
  onClose, onDone, initialPetId = null,
}: {
  onClose: () => void;
  onDone: () => void;
  /* Set when the form is opened from "Book visit" on the Patients screen. */
  initialPetId?: string | null;
}) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPet, setSelectedPet] = useState<any | null>(null);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newMessenger, setNewMessenger] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newPhoneCountry, setNewPhoneCountry] = useState("PH");
  const [newPetName, setNewPetName] = useState("");
  const [newPetSpecies, setNewPetSpecies] = useState("");
  const [newPetBreed, setNewPetBreed] = useState("");
  const [newPetAge, setNewPetAge] = useState("");
  const [newPetGender, setNewPetGender] = useState("");
  const [newPetNeutered, setNewPetNeutered] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState(toLocalISO(new Date()));
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [showManageSpecies, setShowManageSpecies] = useState(false);
  const [staffId, setStaffId] = useState("");
  const { data: walkInStaff = [] } = useQuery({
    queryKey: ["staff-options"],
    queryFn: fetchStaffOptions,
  });
  const assignableStaff = walkInStaff.filter((s) => !HIDDEN_STAFF_IDS.includes(s.id));

  const { data: species = [] } = useQuery({
    queryKey: ["species-options"],
    queryFn: fetchSpeciesOptions,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["booking-categories-walkin"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("booking_categories")
        .select("name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      return (data || []) as { name: string }[];
    },
  });

  /* Opened for a specific pet: load it and its owner in the same shape the
     search results use, select it, and put its name in the search box so it
     also shows as the checked result. */
  useEffect(() => {
    if (!initialPetId) return;
    let active = true;
    (async () => {
      const { data: pet, error } = await (supabase as any)
        .from("pets")
        .select("id, name, species, owner_id, photo_url, age, gender")
        .eq("id", initialPetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!active) return;
      if (error || !pet || !pet.owner_id) {
        toast.error("Couldn't load that patient. Search for them instead.");
        return;
      }
      const { data: owner } = await (supabase as any)
        .from("clients")
        .select("id, name, phone")
        .eq("id", pet.owner_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!active) return;
      if (!owner) {
        toast.error("This pet's owner record is missing, so a visit can't be booked.");
        return;
      }
      setSelectedPet({ ...pet, client_name: owner.name, client_phone: owner.phone });
      setQuery(pet.name || "");
    })();
    return () => { active = false; };
  }, [initialPetId]);

  useEffect(() => {
    const q = searchTerm(query);
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    let active = true;
    // The loading skeleton shows the moment typing starts, and the previous
    // query's results are cleared, so nothing stale sits on screen while
    // someone is still typing. The search itself runs once typing pauses.
    setSearching(true);
    setResults([]);
    const t = setTimeout(async () => {
      const [petsRes, clientsRes] = await Promise.all([
        (supabase as any).from("pets").select("id, name, species, owner_id, photo_url, age, gender").or(`name.ilike."${q}%",name.ilike."% ${q}%"`).is("deleted_at", null).limit(12),
        (supabase as any).from("clients").select("id, name").or(`name.ilike."${q}%",name.ilike."% ${q}%"`).is("deleted_at", null).limit(6),
      ]);
      if (!active) return;
      // A failed search used to look like "no pets found". Say what went wrong.
      const searchErr = petsRes.error || clientsRes.error;
      if (searchErr) {
        toast.error(`Couldn't search patients: ${searchErr.message}`);
        setResults([]);
        setSearching(false);
        return;
      }
      const directPets = petsRes.data || [];
      const matchedClients = clientsRes.data || [];
      let petsFromClients: any[] = [];
      if (matchedClients.length > 0) {
        const clientIds = matchedClients.map((c: any) => c.id);
        const { data } = await (supabase as any)
          .from("pets").select("id, name, species, owner_id, photo_url, age, gender").in("owner_id", clientIds).is("deleted_at", null).limit(10);
        petsFromClients = data || [];
      }
      const allPets = [...directPets, ...petsFromClients];
      const uniquePets = Array.from(new Map(allPets.map((p: any) => [p.id, p])).values());
      const ownerIds = [...new Set(uniquePets.map((p: any) => p.owner_id).filter(Boolean))];
      let ownerMap: Record<string, { name: string; phone?: string | null }> = {};
      if (ownerIds.length > 0) {
        const { data } = await (supabase as any).from("clients").select("id, name, phone").in("id", ownerIds).is("deleted_at", null);
        (data || []).forEach((c: any) => { ownerMap[c.id] = { name: c.name, phone: c.phone }; });
      }
      if (!active) return;
      // A pet whose owner was deleted can't be booked (the owner link is
      // required), so it stays out of the list instead of showing "Unknown owner".
      setResults(
        uniquePets
          .filter((p: any) => p.owner_id && ownerMap[p.owner_id])
          .map((p: any) => ({ ...p, client_name: ownerMap[p.owner_id].name, client_phone: ownerMap[p.owner_id].phone }))
      );
      setSearching(false);
    }, 450);
    return () => { active = false; clearTimeout(t); };
  }, [query]);

  const phoneErr = newClientPhone.trim() ? phoneProblem(newPhoneCountry, newClientPhone) : "";
  const emailErr = newClientEmail.trim() && !EMAIL_RE.test(newClientEmail.trim())
    ? "Enter a valid email address."
    : "";

  const canSave = mode === "new"
    ? !!(
        newOwnerName.trim() &&
        !emailErr &&
        newClientPhone.trim() && !phoneErr &&
        newPetName.trim() && newPetSpecies.trim() &&
        (!newPetAge.trim() || /^\d{1,2}$/.test(newPetAge.trim())) &&
        service && date && time
      )
    : !!(selectedPet && service && date && time);

  const handleSave = async () => {
    const client_name = mode === "new"
      ? newOwnerName.trim()
      : selectedPet?.client_name;
    const pet_name = mode === "new" ? newPetName.trim() : selectedPet?.name;
    const pet_species = mode === "new" ? newPetSpecies.trim() : selectedPet?.species;

    if (!client_name || !pet_name || !pet_species) {
      toast.error("Owner name, pet name and species are all required.");
      return;
    }
    if (!service) { toast.error("Pick a service."); return; }
    if (!date || !time) { toast.error("Set a date and time."); return; }
    if (date < toLocalISO(new Date())) { toast.error("Walk-ins can't be added to a past date."); return; }

    setSaving(true);
    // Which step we're in decides what a failure means: a unique-violation
    // on the owner's email is not a taken time slot.
    let phase: "check" | "owner" | "pet" | "booking" = "check";
    try {
      // Check the slot BEFORE creating any owner or pet rows, so a clash
      // never leaves orphaned records behind.
      const problem = await slotProblem(date, time, undefined, { service, checkHours: true });
      if (problem) { toast.error(problem); return; }
      phase = "owner";
      let clientId: string | undefined = mode === "new" ? undefined : selectedPet?.owner_id;
      let petId: string | undefined = mode === "new" ? undefined : selectedPet?.id;

      // The owner may have been deleted since the search found this pet.
      if (mode !== "new" && clientId) {
        const { data: owner } = await (supabase as any).from("clients").select("id").eq("id", clientId).is("deleted_at", null).maybeSingle();
        if (!owner) {
          toast.error("This pet's owner has been deleted, so it can't be booked. Add them as a new patient instead.");
          return;
        }
      }

      if (mode === "new") {

        const email = newClientEmail.trim().toLowerCase();
        const phone = normalizePhone(newPhoneCountry, newClientPhone);
        const clientLookup = (supabase as any)
          .from("clients").select("id, deleted_at, email").limit(1);
        const { data: existingClient } = email
          ? await clientLookup.ilike("email", likeExact(email)).maybeSingle()
          : await clientLookup.ilike("name", likeExact(client_name)).eq("phone", phone).maybeSingle();
        if (existingClient) {
          clientId = existingClient.id;
          const ownerUpdate = {
            ...(existingClient.deleted_at
              ? { deleted_at: null, name: client_name, phone, email: email || existingClient.email }
              : {}),
            ...(newAddress.trim() ? { address: newAddress.trim() } : {}),
            ...(newMessenger.trim() ? { fb_messenger: newMessenger.trim() } : {}),
          };
          if (Object.keys(ownerUpdate).length > 0) {
            const { error: restoreErr } = await (supabase as any)
              .from("clients").update(ownerUpdate)
              .eq("id", existingClient.id);
            if (restoreErr) throw restoreErr;
          }
        } else {
          const { data: newClient, error: clientErr } = await supabase
            .from("clients")
            .insert([{
              name: client_name,
              email: email || null,
              phone,
              address: newAddress.trim() || null,
              fb_messenger: newMessenger.trim() || null,
            }])
            .select()
            .single();
          if (clientErr) throw clientErr;
          clientId = newClient.id;
        }

        phase = "pet";
        // Same for the pet: this owner already has one by that name.
        const { data: existingPet } = await (supabase as any)
          .from("pets").select("id, deleted_at").eq("owner_id", clientId!).ilike("name", likeExact(pet_name)).limit(1).maybeSingle();
        if (existingPet) {
          petId = existingPet.id;
          if (existingPet.deleted_at) {
            const { error: restoreErr } = await (supabase as any)
              .from("pets")
              .update({
                deleted_at: null, species: pet_species,
                age: newPetAge.trim() ? parseInt(newPetAge, 10) : null,
                gender: newPetGender || null,
                breed: newPetBreed.trim() || null,
                neutered: newPetNeutered || null,
              })
              .eq("id", existingPet.id);
            if (restoreErr) throw restoreErr;
          }
        } else {
          const { data: newPet, error: petErr } = await supabase
            .from("pets")
            .insert([{
              name: pet_name,
              species: pet_species,
              age: newPetAge.trim() ? parseInt(newPetAge, 10) : null,
              gender: newPetGender || null,
              breed: newPetBreed.trim() || null,
              neutered: newPetNeutered || null,
              owner_id: clientId!,
            }])
            .select()
            .single();
          if (petErr) throw petErr;
          petId = newPet.id;
        }
      }
      phase = "booking";

      const booking = {
        client_id: mode === "new" ? undefined : clientId,
        client_name,
        // Stored on the visit itself, so a walk-in without an app account still shows its phone.
        client_phone: mode === "new" ? normalizePhone(newPhoneCountry, newClientPhone) : (selectedPet?.client_phone ?? null),
        pet_id: petId,
        pet_name,
        pet_species,
        service,
        requested_date: date,
        scheduled_time: time,
        status: "confirmed" as const,
        assigned_staff_id: staffId || null,
        created_by_staff_id: useAdminStore.getState().staffId,
        confirmed_by_staff_id: useAdminStore.getState().staffId,
      };
      // appointments.client_id points at the owner's app account (auth.users).
      // An owner added at the desk has none, so the database refuses the link.
      // Keep the visit and leave the link empty; they just get no app alerts.
      let linked = true;
      try {
        await createAppointment(booking);
      } catch (e: any) {
        if (booking.client_id && e?.code === "23503" && /fk_client_id/.test(e?.message || "")) {
          await createAppointment({ ...booking, client_id: undefined });
          linked = false;
        } else {
          throw e;
        }
      }
      toast.success(
        linked
          ? `${pet_name} added as a walk-in.`
          : `${pet_name} added as a walk-in. This owner has no app account, so they won't get app notifications.`
      );
      onDone();
    } catch (err: any) {

      if (err?.code === "23505" && phase === "booking") {
        toast.error("That slot was just taken. Pick a different time.");
      } else if (err?.code === "23505") {
        toast.error("That owner or pet is already on file. Try the Existing patient tab.");
      } else {
        
        toast.error(err?.message || "Couldn't add that walk-in.");
      }
    } finally {
      setSaving(false);
    }
  };

  const whoLabel = mode === "new" ? newPetName.trim() : selectedPet?.name;
  const whenLabel = date
    ? safeDate(date, { weekday: "short", month: "short", day: "numeric" }) + (time ? ` · ${fmtSlot(time)}` : "")
    : "";

  /* Each step is only as complete as the fields it owns; the final save
     still uses canSave exactly as before. */
  const patientOk = mode === "new"
    ? !!(
        newOwnerName.trim() &&
        !emailErr &&
        newClientPhone.trim() && !phoneErr &&
        newPetName.trim() && newPetSpecies.trim() &&
        (!newPetAge.trim() || /^\d{1,2}$/.test(newPetAge.trim()))
      )
    : !!selectedPet;
  const stepOk = step === 1 ? patientOk : step === 2 ? !!service : step === 3 ? !!(date && time) : canSave;
  const staffLabel = (() => {
    const s = assignableStaff.find((x) => x.id === staffId);
    return s ? staffDisplayName(s) : "Assign later";
  })();
  const patientSpecies = mode === "new" ? newPetSpecies : selectedPet?.species;
  const patientOwner = mode === "new" ? newOwnerName.trim() : selectedPet?.client_name;
  const missingNew = [
    !newOwnerName.trim() && "owner name",
    (!newClientPhone.trim() || !!phoneErr) && "phone",
    !!emailErr && "valid email",
    !newPetName.trim() && "pet name",
    !newPetSpecies.trim() && "species",
    !!newPetAge.trim() && !/^\d{1,2}$/.test(newPetAge.trim()) && "age",
  ].filter(Boolean) as string[];
  const patientPhoto: string | undefined = mode === "new" ? undefined : selectedPet?.photo_url || undefined;
  const footerTitle =
    step === 1
      ? (mode === "new"
          ? ["New patient", [newPetName.trim(), newPetSpecies].filter(Boolean).join(", ")].filter(Boolean).join(" \u00b7 ")
          : selectedPet ? `${selectedPet.name} \u00b7 ${selectedPet.species}` : "Pick a patient")
    : step === 2 ? (service || "Pick a service")
    : step === 3 ? (whenLabel || "Pick a date and time")
    : "Ready to book";
  const footerSub =
    step === 1
      ? (mode === "new"
          ? (missingNew.length ? `Still needed: ${missingNew.join(", ")}` : "Next: choose a service")
          : selectedPet ? `Owner: ${selectedPet.client_name} \u00b7 Next: choose a service` : "Next: choose a service")
    : step === 2 ? "Next: date and time"
    : step === 3 ? "Next: review and confirm"
    : [whoLabel, service, whenLabel].filter(Boolean).join(" · ");
  const goBack = () => { if (step > 1 && !saving) setStep(step - 1); else if (step === 1) onClose(); };
  const goNext = () => { if (!stepOk) return; if (step < 4) setStep(step + 1); else handleSave(); };
  const initialOf = (n?: string) => (n || "?").slice(0, 1).toUpperCase();
  const ring = (letter: string, size: number, _on?: boolean, photo?: string | null) => (
    <PetAvatar letter={letter} size={size} photo={photo} />
  );

  return (
    <>
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="!fixed !inset-y-0 !right-0 !left-auto !top-0 !h-dvh !max-h-dvh !w-full sm:!w-[min(430px,34vw)] !max-w-[100vw] !translate-x-0 !translate-y-0 !flex flex-col gap-0 overflow-hidden !rounded-none border-l border-[hsl(var(--border))] bg-white p-0 shadow-[-12px_0_36px_rgb(15_36_71/.12)] [&>button]:hidden">

        <div className="shrink-0 px-5 pb-0 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[18px] font-bold leading-6">Walk-in</DialogTitle>
              <p className="mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]">Find the patient to check in.</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close walk-in"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {/* Step progress: four segments, filled up to the current step. */}
          <div className="mt-4 grid grid-cols-4 gap-1.5" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`h-1 rounded-full ${n <= step ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--border))]"}`} />
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-[hsl(var(--muted-foreground))]">
            <strong className="text-[hsl(var(--foreground))]">Step {step} of 4</strong> · {["Patient", "Service", "Date and time", "Review"][step - 1]}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">

          {step === 1 && (
            <>
              {mode === "search" ? (
                <div className="min-w-0">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="wi-search" className={WI_LABEL}>Pet or owner name</label>
                      <div className="relative">
                        <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                        <input
                          id="wi-search"
                          type="search"
                          className={`${WI_INPUT} h-12 pl-10`}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          autoFocus
                          autoComplete="off"
                          placeholder="Search by pet or owner name"
                        />
                      </div>
                      <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Type at least 2 letters.</p>
                    </div>
                    {/* Always visible: a pet that is not registered yet goes straight to the new-patient form. */}
                    <button
                      type="button"
                      onClick={() => setMode("new")}
                      className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[hsl(var(--primary))] bg-white text-[14px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                    >
                      <Plus size={16} aria-hidden="true" />
                      Add new owner and pet
                    </button>
                    {/* Narrow screens: the chosen patient sits right under the search box */}
                    {selectedPet && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--primary))] bg-white px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          {ring(initialOf(selectedPet.name), 40, true, selectedPet.photo_url)}
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-bold">{selectedPet.name}</p>
                            <p className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                              {selectedPet.species} · {selectedPet.client_name}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedPet(null)}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline"
                        >
                          Change
                        </button>
                      </div>
                    )}
                    {searching ? (
                      /* Skeleton rows, same shape as the results, while typing
                         and while the search runs. */
                      <div className="mt-4 space-y-2.5" role="status" aria-live="polite" aria-busy="true">
                        <span className="sr-only">Searching patients</span>
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-3"
                          >
                            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted))] motion-reduce:animate-none" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="h-4 w-1/3 animate-pulse rounded-full bg-[hsl(var(--muted))] motion-reduce:animate-none" />
                              <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-[hsl(var(--muted))] motion-reduce:animate-none" />
                            </div>
                            <div className="h-[26px] w-[26px] shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted))] motion-reduce:animate-none" />
                          </div>
                        ))}
                      </div>
                    ) : results.length > 0 ? (
                      <div className="mt-5">
                        <p className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--muted-foreground))]" aria-live="polite">
                          {results.length} match{results.length === 1 ? "" : "es"}
                        </p>
                        <ul className="flex flex-col gap-2.5">
                          {results.map((p) => (
                            <li
                              key={p.id}
                              className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[12px] border border-[hsl(var(--border))] bg-white px-4 py-3.5"
                            >
                              {ring(initialOf(p.name), 44, false, p.photo_url)}
                              <div className="min-w-0">
                                <p className="truncate text-[15px] font-bold">{p.name}</p>
                                <p className="truncate text-[13px] text-[hsl(var(--muted-foreground))]">
                                  {[p.species, p.age ? `${p.age} yrs` : null, p.gender].filter(Boolean).join(" · ")}
                                </p>
                                <p className="truncate text-[13px] text-[hsl(var(--muted-foreground))]">
                                  <span className="font-semibold text-[hsl(var(--foreground))]">{p.client_name}</span>
                                  {p.client_phone ? ` · ${fmtPhone(p.client_phone)}` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => { setSelectedPet(p); setStep(2); }}
                                className={`h-10 rounded-[10px] bg-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary-foreground))] ${FOCUS_RING}`}
                              >
                                Check in
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : query.trim().length >= 2 ? (
                      <div className="mt-4 rounded-[20px] border-[1.5px] border-dashed border-[hsl(var(--border))] px-4 py-6 text-center">
                        <p className="text-[15px] text-[hsl(var(--muted-foreground))]">Nothing found.</p>
                      </div>
                    ) : null}
                </div>
              ) : (
                <div className="mt-2 space-y-8">
                  {/* Owner */}
                  <section aria-labelledby="wi-owner-h">
                    <h3 id="wi-owner-h" className={WI_SECTION}>Owner</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <WiField id="wi-owner-name" label="Owner name" required>
                        <input id="wi-owner-name" className={WI_INPUT} value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} autoComplete="name" placeholder="Full name" />
                      </WiField>
                      <WiField id="wi-address" label="Address">
                        <input id="wi-address" className={WI_INPUT} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} autoComplete="street-address" placeholder="Street, barangay, city" />
                      </WiField>
                      <WiField id="wi-phone" label="Contact number" required>
                        <div className="flex gap-2">
                          <div className="shrink-0 [&>div>button]:h-11 [&>div>button]:rounded-[10px] [&>div>button]:border-[hsl(var(--input))] [&>div>button]:bg-white">
                            <PhoneCountrySelect value={newPhoneCountry} onChange={setNewPhoneCountry} />
                          </div>
                          <input
                            id="wi-phone"
                            type="tel"
                            inputMode="tel"
                            className={`${WI_INPUT} flex-1`}
                            value={newClientPhone}
                            onChange={(e) => setNewClientPhone(e.target.value)}
                            autoComplete="off"
                            placeholder="917 123 4567"
                          />
                        </div>
                        {phoneErr && <p className={WI_ERR}>{phoneErr}</p>}
                      </WiField>
                      <WiField id="wi-messenger" label="Facebook Messenger">
                        <input id="wi-messenger" className={WI_INPUT} value={newMessenger} onChange={(e) => setNewMessenger(e.target.value)} autoComplete="off" placeholder="Profile name or link" />
                      </WiField>
                      <details className="rounded-[10px] border border-[hsl(var(--border))] px-3.5 py-3">
                        <summary className={`cursor-pointer text-[14px] font-semibold text-[hsl(var(--primary))] ${FOCUS_RING}`}>Add email (optional)</summary>
                        <div className="mt-3 flex flex-col gap-1.5">
                          <WiField id="wi-email" label="Email">
                            <input id="wi-email" type="email" className={WI_INPUT} value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} autoComplete="off" placeholder="name@example.com" />
                          </WiField>
                          {emailErr && <p className={WI_ERR}>{emailErr}</p>}
                          <p className="text-[13px] leading-[18px] text-[hsl(var(--muted-foreground))]">
                            If this email is already on file, the pet is added to that owner instead of creating a duplicate.
                          </p>
                        </div>
                      </details>
                    </div>
                  </section>

                  {/* Pet */}
                  <section aria-labelledby="wi-pet-h">
                    <h3 id="wi-pet-h" className={WI_SECTION}>Pet</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <WiField id="wi-pet-name" label="Pet name" required>
                        <input id="wi-pet-name" className={WI_INPUT} value={newPetName} onChange={(e) => setNewPetName(e.target.value)} autoComplete="off" placeholder="Pet's name" />
                      </WiField>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor="wi-species" className={WI_LABEL}>
                            Species<span aria-hidden="true" className="ml-0.5 text-[hsl(var(--destructive))]">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowManageSpecies(true)}
                            className={`rounded text-[13px] font-semibold text-[hsl(var(--primary))] hover:underline ${FOCUS_RING}`}
                          >
                            Not listed? Manage
                          </button>
                        </div>
                        <select
                          id="wi-species"
                          className={WI_INPUT}
                          value={newPetSpecies}
                          onChange={(e) => setNewPetSpecies(e.target.value)}
                        >
                          <option value="">Choose species</option>
                          {species.map((sp) => <option key={sp.id} value={sp.name}>{sp.name}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <WiField id="wi-breed" label="Breed">
                          <input id="wi-breed" className={WI_INPUT} value={newPetBreed} onChange={(e) => setNewPetBreed(e.target.value)} autoComplete="off" placeholder="Optional" />
                        </WiField>
                        <WiField id="wi-age" label="Age (years)">
                          <input id="wi-age" type="number" min="0" max="99" inputMode="numeric" className={WI_INPUT} value={newPetAge} onChange={(e) => setNewPetAge(e.target.value)} placeholder="Optional" />
                        </WiField>
                      </div>
                      <WiChoice label="Sex" options={["Male", "Female"]} value={newPetGender} onChange={setNewPetGender} />
                      <WiChoice label="Neutered or spayed" options={["Yes", "No"]} value={newPetNeutered} onChange={setNewPetNeutered} />
                    </div>
                  </section>
                </div>
              )}
            </>
          )}

          {/* Steps 2 to 4 keep their content, centred in the wider dialog */}
          <div className="mx-auto w-full max-w-full">
          {step === 2 && (
            <>
              <div className="mb-5 inline-flex h-11 items-center gap-2.5 rounded-full border-[1.5px] border-[hsl(var(--card-border))] bg-[hsl(var(--card))] pl-1.5 pr-4">
                {ring(initialOf(whoLabel), 32, true, patientPhoto)}
                <span className="text-[15px] font-bold">{whoLabel}</span>
                {patientSpecies && <span className="text-[14px] text-[hsl(var(--muted-foreground))]">{patientSpecies}</span>}
              </div>
              <h3 className="text-[22px] font-bold leading-7">Which service?</h3>
              <p className="mt-1 text-[15px] leading-[22px] text-[hsl(var(--muted-foreground))]">
                Pick one. Date and time come next.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                {categories.map((c) => {
                  const on = service === c.name;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => { setService(on ? "" : c.name); setTime(""); }}
                      aria-pressed={on}
                      className={`flex min-h-[64px] items-center gap-3.5 rounded-[20px] border-2 bg-[hsl(var(--card))] px-4 py-3 text-left transition ${FOCUS_RING} ${
                        on ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--card-border))]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 text-[16px] font-bold leading-snug">{c.name}</span>
                      <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[hsl(var(--primary))]" : "border-[#C9C5B4]"}`}>
                        {on && <span className="h-3.5 w-3.5 rounded-full bg-[hsl(var(--primary))]" />}
                      </span>
                    </button>
                  );
                })}
                {categories.length === 0 && (
                  <p className="text-[15px] text-[hsl(var(--muted-foreground))]">No services are set up yet.</p>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="text-[22px] font-bold leading-7">When should it be?</h3>
              <p className="mt-1 text-[15px] leading-[22px] text-[hsl(var(--muted-foreground))]">
                {whoLabel} · {service}
              </p>
              <div className="mt-5 space-y-3">
                <FloatSelect label="Staff attending" value={staffId} onChange={(ev) => setStaffId(ev.target.value)}>
                  <option value="">Assign later</option>
                  {assignableStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {staffDisplayName(s)}
                      {[s.job_title, s.secondary_title].filter(Boolean).map((t) => ` · ${t}`).join("")}
                    </option>
                  ))}
                </FloatSelect>
                <div className="pt-1">
                  <DayStrip
                    value={date}
                    service={service}
                    onChange={(iso) => { setDate(iso); setTime(""); }}
                  />
                </div>
              </div>
              <div className="mb-3 mt-5 flex items-baseline justify-between gap-3">
                <span className="text-[16px] font-bold">Time</span>
                <span className="text-[14px] text-[hsl(var(--muted-foreground))]">Crossed-out times are not available</span>
              </div>
              <TimeSlotGrid date={date} value={time} onChange={setTime} service={service} />
            </>
          )}

          {step === 4 && (
            <>
              <h3 className="text-[22px] font-bold leading-7">Review the visit</h3>
              <p className="mt-1 text-[15px] leading-[22px] text-[hsl(var(--muted-foreground))]">
                Check the details, then add the walk-in.
              </p>
              <div className="mt-4 rounded-[24px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-0.5">
                {([
                  { k: "Patient", v: whoLabel || "—", sub: [patientSpecies, patientOwner].filter(Boolean).join(" · "), to: 1, lead: ring(initialOf(whoLabel), 48, true, patientPhoto) },
                  { k: "Service", v: service || "—", sub: "", to: 2, lead: null },
                  { k: "Date and time", v: whenLabel || "—", sub: "", to: 3, lead: null },
                  { k: "Staff attending", v: staffLabel, sub: "", to: 3, lead: null },
                ]).map((r, i, arr) => (
                  <div key={r.k} className={`flex items-center gap-3.5 py-2.5 ${i < arr.length - 1 ? "border-b border-[hsl(var(--card-border))]" : ""}`}>
                    {r.lead}
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] text-[hsl(var(--muted-foreground))]">{r.k}</p>
                      <p className="truncate text-[16px] font-bold leading-snug">{r.v}</p>
                      {r.sub && <p className="truncate text-[14px] text-[hsl(var(--muted-foreground))]">{r.sub}</p>}
                    </div>
                    <button
                      onClick={() => setStep(r.to)}
                      className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          </div>
        </div>

        {/* Footer: summary on the left, main button on the right */}
        {(step > 1 || mode === "new") && (
        <div className="shrink-0 border-t border-[hsl(var(--border))] bg-white px-5 pb-4 pt-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            {step < 4 && (
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-5">{footerTitle}</p>
                {footerSub && <p className="truncate text-[14px] leading-[18px] text-[hsl(var(--muted-foreground))]">{footerSub}</p>}
              </div>
            )}
            <div className="flex w-full gap-2 sm:w-auto">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={saving}
                  className={`h-11 rounded-lg border border-[hsl(var(--border))] px-4 text-[13px] font-semibold ${FOCUS_RING}`}
                >
                  Back
                </button>
              )}
              <button
                onClick={goNext}
                disabled={saving || !stepOk}
                className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 text-[13px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50 sm:flex-none ${FOCUS_RING}`}
              >
                {saving
                  ? <><Loader2 size={15} className="animate-spin" /> Adding…</>
                  : step === 4 ? (mode === "new" ? "Register and check in" : "Check in") : "Continue"}
              </button>
            </div>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
    <ManageSpeciesDialog open={showManageSpecies} onClose={() => setShowManageSpecies(false)} />
    </>
  );
}

const TITLES = ["Dr.", "Mr.", "Mrs.", "Ms."];
function splitTitle(name: string) {
  const m = name.match(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+(.*)$/);
  return m ? { title: m[1], rest: m[2] } : { title: "", rest: name };
}

function AssignStaffDialog({
  appointment, staffOptions, onClose, onSaved,
}: {
  appointment: Appointment;
  staffOptions: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {

  const [mode, setMode] = useState<"select" | "manual">(
    !appointment.assigned_staff_id && appointment.assigned_staff_name ? "manual" : "select"
  );
  const [staffId, setStaffId] = useState(appointment.assigned_staff_id || "");
  const initialManual = splitTitle(appointment.assigned_staff_name || "");
  const [manualTitle, setManualTitle] = useState(initialManual.title);
  const [manualName, setManualName] = useState(initialManual.rest);
  const [manualRole, setManualRole] = useState(appointment.assigned_staff_role || "");
  const [saving, setSaving] = useState(false);

  const visibleStaff = staffOptions.filter(
    (s) =>
      (s.status ? s.status === "active" || s.id === appointment.assigned_staff_id : true) &&
      (!HIDDEN_STAFF_IDS.includes(s.id) || s.id === appointment.assigned_staff_id)
  );
  const fullManualName = [manualTitle, manualName.trim()].filter(Boolean).join(" ");
  const unchanged =
    mode === "select"
      ? staffId === (appointment.assigned_staff_id || "")
      : !appointment.assigned_staff_id &&
        fullManualName === (appointment.assigned_staff_name || "") &&
        (manualRole.trim() || "") === (appointment.assigned_staff_role || "");

  const handleSave = async () => {
    if (mode === "manual" && !manualName.trim()) {
      toast.error("Enter a name, or switch back to selecting from the staff list.");
      return;
    }
    setSaving(true);
    try {
      await assignStaffToAppointment(
        appointment.id,
        mode === "select"
          ? { staffId: staffId || null }
          : { staffName: fullManualName, staffRole: manualRole.trim() || null }
      );
      const name = mode === "select"
        ? (() => { const f = visibleStaff.find((x) => x.id === staffId); return f ? staffDisplayName(f) : undefined; })()
        : fullManualName;
      toast.success(
        mode === "select" && !staffId
          ? "Assignment cleared."
          : `${name || "Staff"} assigned to ${appointment.pet_name}.`
      );
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't update the assignment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className={`max-w-[440px] ${DLG}`}>
        <div className={DLG_HEAD}>
          <div className="min-w-0">
            <p className={DLG_EYEBROW}>Assign staff</p>
            <DialogTitle className={DLG_TITLE}>{appointment.pet_name}</DialogTitle>
            <p className={DLG_SUB}>{appointment.client_name} · {appointment.service}</p>
          </div>
          <button onClick={onClose} className={DLG_CLOSE}>Close</button>
        </div>
        <div className={DLG_BODY}>
          {mode === "select" ? (
            <div>
              <label className="block">
                <span className={DLG_LABEL}>Staff member</span>
                <div className="relative">
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    className={`${BILL_INPUT} appearance-none pr-10`}
                  >
                    <option value="">Unassigned</option>
                    {visibleStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {staffDisplayName(s)}
                        {[s.job_title, s.secondary_title].filter(Boolean).map((t) => ` · ${t}`).join("")}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                </div>
              </label>
              {visibleStaff.length === 0 && (
                <p className="mt-2 text-[13px] text-[hsl(var(--muted-foreground))]">
                  No active staff found. Add staff accounts in Staff Management, or enter someone manually below.
                </p>
              )}
              <button
                onClick={() => setMode("manual")}
                className="mt-3 min-h-9 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline"
              >
                Not in the system? Enter manually
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2.5">
                <label className="block">
                  <span className={DLG_LABEL}>Title</span>
                  <div className="relative">
                    <select
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      className={`${BILL_INPUT} appearance-none pr-9`}
                    >
                      <option value="">None</option>
                      {TITLES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                  </div>
                </label>
                <label className="block min-w-0">
                  <span className={DLG_LABEL}>Name</span>
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} autoFocus className={BILL_INPUT} />
                </label>
              </div>
              <label className="block">
                <span className={DLG_LABEL}>Role (e.g. Groomer)</span>
                <input value={manualRole} onChange={(e) => setManualRole(e.target.value)} className={BILL_INPUT} />
              </label>
              <button
                onClick={() => setMode("select")}
                className="min-h-9 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline"
              >
                Select from staff list instead
              </button>
            </div>
          )}
        </div>
        <div className={DLG_FOOT}>
          <button onClick={onClose} className={DLG_BTN}>Cancel</button>
          <button onClick={handleSave} disabled={saving || unchanged} className={DLG_BTN_P}>
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <>Save</>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
