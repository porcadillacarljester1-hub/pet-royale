import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchStaffDirectory, staffDisplayName, type StaffOption } from "@/api/appointments";
import { RangePicker, clinicDay, clinicNow, clinicToday, daysBetween, fmtDisplay, toISO } from "@/components/RangePicker";
// xlsx-js-style is SheetJS with cell styles (fills, bold, borders) and frozen
// panes switched on. Same API as "xlsx". Install: npm i xlsx-js-style
import * as XLSX from "xlsx-js-style";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Check, ChevronDown, FileSpreadsheet, Loader2, Search, TriangleAlert, WalletCards, X } from "lucide-react";

/* The stat cards, toolbar fields, table, status pill and pager below are the
   same ones the Appointments screen uses, so the two screens look identical.
   If either changes, move them into a shared file. */

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString()}`;

/* Capitalizes the first letter of each word without touching the rest ("dos" -> "Dos"). */
const titleCase = (s?: string | null) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/* A date-only value (or a timestamp) as "Thu, Oct 8", read as a local day. */
function safeDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) {
  if (!iso) return "No date";
  const clean = iso.length > 10 ? iso.slice(0, 10) : iso;
  const d = new Date(clean + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", opts);
}

/* Times are stored as text. "03:30 PM", "3:30 pm" and "15:30" all show the
   same way. */
function timeToMinutes(t?: string | null) {
  if (!t) return 9999;
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

function fmtSlot(t?: string | null) {
  if (!t) return "";
  const mins = timeToMinutes(t);
  if (mins === 9999) return t;
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}

/* A UTC timestamp from the database, as the clinic's (Philippines) calendar
   day. This is the same rule Reports uses, so a payment made at 11 PM lands
   on the same day in both screens. */
const isoToLocalDate = clinicDay;

/* The period tabs. They follow Reports, minus the long ranges that are for
   trends. Today is the default: the front desk mostly handles today's
   payments. Ranges are computed fresh on each call, not once at module load,
   so a tab left open overnight doesn't still think "Today" is yesterday. */
const RANGES: Record<string, () => { from: string; to: string } | null> = {
  Today: () => {
    const t = clinicToday();
    return { from: t, to: t };
  },
  "This week": () => {
    const n = clinicNow();
    const from = new Date(n);
    // Week starts Monday: getDay() is 0 on Sunday, which is day 7 here.
    from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
    return { from: toISO(from), to: toISO(n) };
  },
  "This month": () => {
    const n = clinicNow();
    return { from: toISO(new Date(n.getFullYear(), n.getMonth(), 1)), to: toISO(n) };
  },
  "Last month": () => {
    const n = clinicNow();
    return {
      from: toISO(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
      to: toISO(new Date(n.getFullYear(), n.getMonth(), 0)),
    };
  },
  Custom: () => null,
};

const ALL_SERVICES = "All services";

type Bounds = { from: string; to: string } | null;

/* Keeps a filter's value for the rest of the browser tab, so leaving the
   screen and coming back finds it as it was left. It resets when the tab
   is closed. A stored value that is no longer valid (for example the old
   "All time") falls back to the default, and a browser that blocks storage
   just loses the memory. */
function usePersistedState(
  key: string,
  initial: string,
  isValid: (v: string) => boolean,
): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null && isValid(stored)) return stored;
    } catch {
      // Storage blocked: use the default.
    }
    return initial;
  });
  const update = (v: string) => {
    setValue(v);
    try {
      sessionStorage.setItem(key, v);
    } catch {
      // Storage blocked: the filter still works, it just isn't remembered.
    }
  };
  return [value, update];
}

const isDateString = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

interface InvoiceRow {
  id: string;
  appointment_id: string | null;
  total: number;
  created_at: string;
  paid_at: string | null;
  pet_name: string;
  pet_id: string | null;
  pet_species: string;
  client_name: string;
  service: string;
  requested_date: string | null;
  scheduled_time: string | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  assigned_staff_role: string | null;
  items: { id: string; service_name: string; quantity: number; unit_price: number; subtotal: number }[];
  payments: { id: string; amount: number; method: string | null; paid_at: string; recorded_by: string | null }[];
  totalPaid: number;
}

/* ── Payment status ──
   An invoice with a total of ₱0 is "No amount": a visit was completed without
   charging, for example a service whose price is set at billing and hasn't
   been entered yet. Otherwise it is Paid once it is closed (paid_at is set) or
   its payments cover the total, Partial when some money has come in, and
   Unpaid otherwise. Compared in centavos so rounding can't leave a ₱0.00
   balance. */
type PayStatus = "paid" | "partial" | "unpaid" | "noamount";

const hasAmount = (inv: InvoiceRow) => Math.round(inv.total * 100) > 0;

function payStatus(inv: InvoiceRow): PayStatus {
  const total = Math.round(inv.total * 100);
  const paid = Math.round(inv.totalPaid * 100);
  if (total === 0 && paid === 0) return "noamount";
  if (inv.paid_at || (total > 0 && paid >= total)) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

/* What has actually been collected. An invoice that is closed but has no
   payment rows (older data) counts as fully paid. */
function paidAmount(inv: InvoiceRow): number {
  if (inv.payments.length > 0) return inv.totalPaid;
  return payStatus(inv) === "paid" ? inv.total : 0;
}

/* A timestamp's local day falls inside the chosen period. */
function dayInBounds(iso: string | null | undefined, bounds: Bounds) {
  const day = isoToLocalDate(iso);
  if (!day) return false;
  return !bounds || (day >= bounds.from && day <= bounds.to);
}

/* An invoice belongs to a period when it was raised in it or paid in it. */
function invoiceInPeriod(inv: InvoiceRow, bounds: Bounds) {
  if (!bounds) return true;
  return dayInBounds(inv.created_at, bounds) || inv.payments.some((p) => dayInBounds(p.paid_at, bounds));
}

/* ── Staff names, with their title (Dr., Mr., Mrs., ...) ──
   A staff member's name is shown with their title wherever it appears: the
   "Attended by" line, the Staff column, the Excel export and the "Received by ..." under
   the Paid status. The title comes from the staff record's `title` field. If
   the display name already starts with it, it isn't added twice. */
function formatStaffName(s: StaffOption): string {
  const name = staffDisplayName(s);
  const title = String((s as any).title ?? "").trim();
  if (!title) return name;
  const bare = title.replace(/\.$/, "").toLowerCase();
  return name.toLowerCase().replace(/\./g, "").startsWith(bare) ? name : `${title} ${name}`;
}

/* Titles that may already be typed into a stored name, so "Dr. Maria Santos"
   and "Maria Santos" are recognised as the same person. */
const TITLE_PREFIX = /^(dr|mr|mrs|ms|miss|mx|engr|atty|prof)\.?\s+/i;
const nameKey = (s: string) => {
  let out = s.trim();
  while (TITLE_PREFIX.test(out)) out = out.replace(TITLE_PREFIX, "");
  return out.toLowerCase().replace(/[^a-z0-9]/g, "");
};

/* Who collected the payment. The payment stores this as text, which may be a
   staff id or a name (with or without a title). Match it to a staff member and
   show their name with their title; if nobody matches, show it as it was
   stored, so nothing is lost. */
function collectorName(raw: string | null | undefined, staffById: Record<string, StaffOption>): string {
  const value = (raw || "").trim();
  if (!value) return "";
  const byId = staffById[value];
  if (byId) return formatStaffName(byId);
  const key = nameKey(value);
  const match = Object.values(staffById).find((s) => nameKey(staffDisplayName(s)) === key);
  return match ? formatStaffName(match) : value;
}

function assignedStaffLines(
  inv: InvoiceRow, staffById: Record<string, StaffOption>,
): { name: string; role: string | null } | null {
  if (inv.assigned_staff_id) {
    const s = staffById[inv.assigned_staff_id];
    if (!s) return { name: "Unknown staff", role: null };
    return {
      name: formatStaffName(s),
      role: [s.job_title, s.secondary_title].filter(Boolean).join(" · ") || null,
    };
  }
  if (inv.assigned_staff_name) return { name: inv.assigned_staff_name, role: inv.assigned_staff_role || null };
  return null;
}

/* Supabase returns at most 1,000 rows per request, and a long `.in(...)` list
   makes the request address too long. So rows are read a page at a time, and
   id lists are split into chunks of 100. */
const PAGE = 1000;
const CHUNK = 100;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function fetchAll<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function groupBy<T extends Record<string, any>>(rows: T[], key: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r[key]);
    if (list) list.push(r);
    else map.set(r[key], [r]);
  }
  return map;
}

/* Any query that fails throws, so the screen can say so instead of showing
   an empty list. */
async function fetchBilling(): Promise<InvoiceRow[]> {
  const invoices = await fetchAll<any>((a, b) =>
    (supabase as any)
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id")
      .range(a, b),
  );
  if (!invoices.length) return [];

  const invoiceIdChunks = chunks(invoices.map((i: any) => i.id as string));
  const appointmentIds = [...new Set(invoices.map((i: any) => i.appointment_id).filter(Boolean))] as string[];

  const [itemRows, paymentRows, apptRows] = await Promise.all([
    Promise.all(
      invoiceIdChunks.map((ids) =>
        fetchAll<any>((a, b) =>
          (supabase as any).from("invoice_items").select("*").in("invoice_id", ids).order("id").range(a, b),
        ),
      ),
    ).then((r) => r.flat()),
    Promise.all(
      invoiceIdChunks.map((ids) =>
        fetchAll<any>((a, b) =>
          (supabase as any)
            .from("payments")
            .select("*")
            .in("invoice_id", ids)
            .order("paid_at", { ascending: true })
            .order("id")
            .range(a, b),
        ),
      ),
    ).then((r) => r.flat()),
    Promise.all(
      chunks(appointmentIds).map((ids) =>
        fetchAll<any>((a, b) =>
          (supabase as any)
            .from("appointments")
            .select("id, pet_id, pet_name, pet_species, client_name, service, requested_date, scheduled_time, assigned_staff_id, assigned_staff_name, assigned_staff_role")
            .in("id", ids)
            .order("id")
            .range(a, b),
        ),
      ),
    ).then((r) => r.flat()),
  ]);

  const apptMap = new Map(apptRows.map((a: any) => [a.id, a]));
  const itemsByInvoice = groupBy(itemRows, "invoice_id");
  const paymentsByInvoice = groupBy(paymentRows, "invoice_id");

  return invoices.map((inv: any) => {
    const appt: any = apptMap.get(inv.appointment_id);
    const payments = (paymentsByInvoice.get(inv.id) ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) }));
    const total = Number(inv.total_amount || 0);
    const totalPaid = payments.reduce((s: number, p: any) => s + p.amount, 0);
    return {
      id: inv.id,
      appointment_id: inv.appointment_id || null,
      total,
      created_at: inv.created_at,
      paid_at: inv.paid_at,
      pet_name: appt?.pet_name || "—",
      pet_id: appt?.pet_id || null,
      pet_species: appt?.pet_species || "",
      client_name: appt?.client_name || "—",
      service: appt?.service || "—",
      scheduled_time: appt?.scheduled_time || null,
      requested_date: appt?.requested_date || null,
      assigned_staff_id: appt?.assigned_staff_id || null,
      assigned_staff_name: appt?.assigned_staff_name || null,
      assigned_staff_role: appt?.assigned_staff_role || null,
      items: (itemsByInvoice.get(inv.id) ?? []).map((it: any) => ({
        id: it.id, service_name: it.service_name, quantity: it.quantity,
        unit_price: Number(it.unit_price), subtotal: Number(it.subtotal),
      })),
      payments,
      totalPaid,
    };
  });
}

interface CompletedVisit {
  id: string;
  service: string | null;
  requested_date: string | null;
  scheduled_time: string | null;
  pet_name: string | null;
  client_name: string | null;
}

/* Every completed visit, whatever its date. The "Not billed" card is a
   backlog, not a period figure: a visit nobody charged is still unbilled
   next week, so it must not drop off when the period moves on. The card
   removes the visits that have an invoice (already loaded above), then
   applies the Service filter. Rows come back a page at a time. */
async function fetchCompletedVisits(): Promise<CompletedVisit[]> {
  return fetchAll<CompletedVisit>((a, b) =>
    (supabase as any)
      .from("appointments")
      .select("id, service, requested_date, scheduled_time, pet_name, client_name")
      .eq("status", "completed")
      .order("id")
      .range(a, b),
  );
}

/* Excel export. Header row on row 1 (teal, bold, white, frozen, with filter
   arrows), money as real numbers formatted in pesos, one blank row, then a
   bold TOTAL row. */
const SHEET_TEAL = "0E4F45";
const SHEET_INK = "1A1A1A";
const SHEET_GRID = "D9D9D9";
const PESO_FORMAT = '"₱"#,##0.00';
const STATUS_LABEL: Record<PayStatus, string> = { paid: "Paid", partial: "Partial", unpaid: "Unpaid", noamount: "No amount" };

function exportSpreadsheet(
  rows: InvoiceRow[], rangeLabel: string, staffById: Record<string, StaffOption>,
) {
  const header = [
    "Invoice", "Patient", "Owner", "Service", "Visit date", "Visit time",
    "Staff assigned", "Date raised", "Total", "Status", "Date settled",
  ];

  const body = rows.map((i) => [
    `INV-${i.id.slice(0, 6).toUpperCase()}`,
    i.pet_name,
    i.client_name,
    i.service,
    i.requested_date ? i.requested_date.slice(0, 10) : "",
    i.scheduled_time ?? "",
    assignedStaffLines(i, staffById)?.name ?? "",
    isoToLocalDate(i.created_at),
    // Numbers, not strings — an accountant needs to sum the column, and
    // "₱1,250.00" doesn't add up.
    Number(i.total.toFixed(2)),
    STATUS_LABEL[payStatus(i)],
    isoToLocalDate(i.paid_at),
  ]);
  const sum = (f: (i: InvoiceRow) => number) => Number(rows.reduce((s, i) => s + f(i), 0).toFixed(2));
  const totals = [
    "", "", "", "", "", "", "", "TOTAL",
    sum((i) => i.total),
    "", "",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body, [], totals]);

  // Column widths, so nothing needs dragging open.
  sheet["!cols"] = [
    { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 24 }, { wch: 12 }, { wch: 10 },
    { wch: 20 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 12 },
  ];

  const lastCol = header.length - 1;
  const totalsRow = body.length + 2; // header, body rows, one blank row, then totals
  const moneyCols = [8];
  const totalLabelCol = 7;

  // Creates the cell if it is missing, so empty cells in the header and
  // totals rows still get their fill and borders.
  const paint = (r: number, c: number, s: Record<string, unknown>) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
    sheet[ref].s = s;
    return sheet[ref];
  };

  for (let c = 0; c <= lastCol; c++) {
    paint(0, c, {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: SHEET_TEAL } },
      alignment: { vertical: "center", horizontal: moneyCols.includes(c) ? "right" : "left" },
      border: { bottom: { style: "medium", color: { rgb: SHEET_INK } } },
    });
  }

  for (let r = 1; r <= body.length; r++) {
    for (let c = 0; c <= lastCol; c++) {
      const cell = paint(r, c, {
        alignment: { vertical: "center", horizontal: moneyCols.includes(c) ? "right" : "left" },
        border: { bottom: { style: "thin", color: { rgb: SHEET_GRID } } },
      });
      // Peso format on the money columns, so they read as currency and
      // still sum correctly.
      if (moneyCols.includes(c) && typeof cell.v === "number") cell.z = PESO_FORMAT;
    }
  }

  for (let c = 0; c <= lastCol; c++) {
    const cell = paint(totalsRow, c, {
      font: { bold: true },
      alignment: {
        vertical: "center",
        horizontal: moneyCols.includes(c) || c === totalLabelCol ? "right" : "left",
      },
      border: { top: { style: "medium", color: { rgb: SHEET_INK } } },
    });
    if (moneyCols.includes(c) && typeof cell.v === "number") cell.z = PESO_FORMAT;
  }

  sheet["!rows"] = [{ hpt: 22 }];
  // Filter arrows on the header row, covering the invoices but not the totals.
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastCol)}${body.length + 1}` };
  // Freeze the header so it stays put when scrolling a long list.
  sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Invoices");
  XLSX.writeFile(book, `pet-royale-invoices_${rangeLabel}.xlsx`);
}

const PAGE_SIZE = 10;

/* Visit date & time, Patient, Owner, Service & staff, Total (with the invoice
   number under it), Status, Action. The fixed columns are kept narrow so the
   Service column gets the space and the whole table fits a normal desktop
   window without scrolling sideways. Status is wide enough for "Received by
   ..." to wrap onto a second line rather than being cut off. The table's
   minimum width is TABLE_MIN: below that it scrolls as one piece. */
const ROW_COLS = "lg:grid-cols-[104px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_112px_168px_72px]";
const TABLE_MIN = "lg:min-w-[1040px]";

/* Same look as the Dashboard and Appointments screens: flush full-width
   panels separated by 1px lines, small sentence-case table headings,
   10px-radius controls and a 40px toolbar row. */
const PAGE_WRAP = "w-full pb-8";
const CARD =
  "rounded-[10px] border border-[hsl(var(--border))] bg-white shadow-[0_1px_2px_rgb(15_36_71/.04)]";
const FILTER_PANEL =
  "flex flex-col gap-4 border-b border-[hsl(var(--border))] bg-white px-6 py-4";
/* PANEL clips row content; the filter panel does not, so it can hold pickers. */
const PANEL =
  "overflow-hidden border-b border-[hsl(var(--border))] bg-white";
const TABLE_HEAD =
  "hidden gap-x-6 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--muted))] px-6 py-[11px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] lg:grid";
/* Segmented tabs: one soft track with a navy tab for the chosen view. */
const SEG_TRACK =
  "inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[hsl(var(--muted))] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const segTab = (active: boolean) =>
  `flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-4 text-[14px] font-semibold transition ${FOCUS_RING} ${
    active
      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
  }`;
/* Toolbar buttons: 40px high, 10px radius. */
const CTL_BASE =
  `inline-flex h-10 items-center justify-center rounded-[10px] text-[14px] font-bold ${FOCUS_RING}`;
const CTL_FIELD = "border-[1.5px] border-[hsl(var(--primary))] bg-white text-[hsl(var(--primary))]";
/* Previous / Next, as on the Dashboard. */
const PAGER_BTN =
  `h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`;

/* Species, age and sex on one line, as on the Appointments screen. */
type PetProfile = { age: number | string | null; gender: string | null; owner_id: string | null };
const patientMeta = (i: InvoiceRow, p?: PetProfile) =>
  [i.pet_species, typeof p?.age === "number" ? `${p.age} yrs` : p?.age, p?.gender]
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(" · ");

/* Display only: +639155034433 -> +63 915 503 4433. Anything else is shown as stored. */
function fmtPhone(p?: string | null) {
  if (!p) return "\u2014";
  const m = p.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : p;
}

/* Long service names break onto two lines, the same as in Appointments. */
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

function SearchField({
  label, value, onChange, className = "",
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`flex h-10 items-center gap-2 rounded-[10px] border border-[hsl(var(--card-border))] bg-white px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)] ${className}`}>
      <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
      />
    </label>
  );
}

function SelectField({
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
        className={`h-10 w-full appearance-none rounded-[10px] border border-[hsl(var(--card-border))] bg-white pl-3 pr-9 text-[14px] font-semibold transition focus:border-[hsl(var(--accent))] ${FOCUS_RING}`}
      >
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

function StatCard({
  label, value, caption, valueClass, className = "", onClick,
}: {
  label: string; value: string | number; caption: string; valueClass?: string; className?: string;
  onClick?: () => void;
}) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`block bg-white px-6 py-5 text-left ${
        onClick ? `cursor-pointer transition hover:bg-[hsl(var(--muted)/.5)] ${FOCUS_RING}` : ""
      } ${className}`}
    >
      <span className="block break-words text-[13px] font-semibold leading-snug text-[hsl(var(--muted-foreground))]">{label}</span>
      <span
        className={`mt-1.5 block break-words text-[32px] font-extrabold leading-[1.1] tracking-[-.02em] tabular-nums ${
          valueClass ?? "text-[hsl(var(--foreground))]"
        }`}
      >
        {value}
      </span>
      <span className="mt-0.5 block break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{caption || "\u00A0"}</span>
    </Tag>
  );
}

/* Soft filled status pill, as in the Appointments table: Paid, Partial or
   Unpaid. `detail` adds a short note after the label, like the paid date. */
const STATUS_STYLE: Record<PayStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]" },
  partial: { label: "Partial", cls: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]" },
  unpaid: { label: "Unpaid", cls: "bg-[hsl(12_70%_93%)] text-[hsl(12_58%_36%)]" },
  noamount: { label: "No amount", cls: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]" },
};

function StatusPill({
  status, detail, className = "",
}: { status: PayStatus; detail?: string; className?: string }) {
  const st = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold ${st.cls} ${className}`}
    >
      {status === "paid" && <Check size={13} strokeWidth={3} aria-hidden="true" />}
      {st.label}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}

export default function Billing() {
  const queryClient = useQueryClient();
  const { data: invoices = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["billing"],
    queryFn: fetchBilling,
    // A safety net in case live updates aren't switched on for these tables.
    refetchInterval: 2 * 60 * 1000,
  });

  /* Pet photos for the patient column. Looked up by the visit's pet, so a
     patient with no photo (or an invoice with no linked pet) keeps the
     initials. Same lookup as the Appointments screen. */
  const petIds = useMemo(
    () => Array.from(new Set(invoices.map((i) => i.pet_id).filter(Boolean))).sort() as string[],
    [invoices]
  );
  const { data: petPhotos = {} } = useQuery<Record<string, string>>({
    queryKey: ["billing-pet-photos", petIds],
    enabled: petIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, string> = {};
      for (let i = 0; i < petIds.length; i += 100) {
        const { data, error } = await (supabase as any)
          .from("pets").select("id, photo_url").in("id", petIds.slice(i, i + 100));
        if (error) throw error;
        (data || []).forEach((p: any) => { if (p.photo_url) map[p.id] = p.photo_url; });
      }
      return map;
    },
  });
  /* Age, sex and the owner's phone, looked up the same way the Appointments
     screen does it: pets (age, gender, owner_id), then clients (phone). */
  const { data: petProfiles = {} } = useQuery<Record<string, PetProfile>>({
    queryKey: ["billing-pet-profiles", petIds],
    enabled: petIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, PetProfile> = {};
      for (let i = 0; i < petIds.length; i += 100) {
        const { data, error } = await (supabase as any)
          .from("pets").select("id, age, gender, owner_id").in("id", petIds.slice(i, i + 100));
        if (error) throw error;
        (data || []).forEach((p: any) => {
          map[p.id] = { age: p.age ?? null, gender: p.gender ?? null, owner_id: p.owner_id ?? null };
        });
      }
      return map;
    },
  });
  const ownerIds = useMemo(
    () => Array.from(new Set(Object.values(petProfiles).map((p) => p.owner_id).filter(Boolean))).sort() as string[],
    [petProfiles]
  );
  const { data: ownerPhones = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["billing-owner-phones", ownerIds],
    enabled: ownerIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, string | null> = {};
      for (let i = 0; i < ownerIds.length; i += 100) {
        const { data, error } = await (supabase as any)
          .from("clients").select("id, phone").in("id", ownerIds.slice(i, i + 100)).is("deleted_at", null);
        if (error) throw error;
        (data || []).forEach((o: any) => { map[o.id] = o.phone ?? null; });
      }
      return map;
    },
  });
  const { data: clinic } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });
  const { data: staffOptions = [] } = useQuery({
    queryKey: ["staff-directory"],
    queryFn: fetchStaffDirectory,
  });

  // Full staff records by id, for the name + role lines in the table.
  const staffById = useMemo(
    () => Object.fromEntries(staffOptions.map((s) => [s.id, s])) as Record<string, StaffOption>,
    [staffOptions]
  );

  const [query, setQuery] = useState("");
  /* Period and Service are remembered for the browser tab, so going to
     another screen and coming back finds them as they were left. */
  const [range, setRange] = usePersistedState("pet-royale.billing.range", "Today", (v) => v in RANGES);
  const [service, setService] = usePersistedState("pet-royale.billing.service", ALL_SERVICES, () => true);
  const [customFrom, setCustomFrom] = usePersistedState("pet-royale.billing.from", clinicToday(), isDateString);
  const [customTo, setCustomTo] = usePersistedState("pet-royale.billing.to", clinicToday(), isDateString);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [page, setPage] = useState(1);

  /* Today, in the clinic's time zone, checked every minute and when the tab
     comes back into view. When the day changes, "Today", "This week" and
     "This month" move with it, even on a tab left open overnight. */
  const [today, setToday] = useState(clinicToday);
  useEffect(() => {
    const check = () => setToday((prev) => {
      const t = clinicToday();
      return t === prev ? prev : t;
    });
    const id = window.setInterval(check, 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  /* Live updates: when an invoice, line item, payment or visit changes
     anywhere, this screen reloads by itself. Needs Realtime switched on for
     those four tables in Supabase. Bursts of changes reload once. */
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["billing"] });
        queryClient.invalidateQueries({ queryKey: ["completed-visits"] });
      }, 400);
    };
    const channel = (supabase as any).channel("billing-live");
    for (const table of ["invoices", "invoice_items", "payments", "appointments"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      (supabase as any).removeChannel(channel);
    };
  }, [queryClient]);

  // `today` is a dependency so the ranges are worked out again when the day changes.
  const bounds = useMemo<Bounds>(() => {
    if (range === "Custom") return { from: customFrom, to: customTo };
    return RANGES[range]?.() ?? null;
  }, [range, customFrom, customTo, today]);

  const { data: completedVisits = [], isLoading: visitsLoading, isError: visitsError } = useQuery({
    queryKey: ["completed-visits"],
    queryFn: () => fetchCompletedVisits(),
    refetchInterval: 2 * 60 * 1000,
  });

  const startDate = bounds?.from ?? clinicToday();
  const endDate = bounds?.to ?? clinicToday();
  const dayCount = daysBetween(startDate, endDate) + 1;
  // Still open: the period includes today, so the numbers aren't final yet.
  const stillOpen = endDate >= today;

  const periodLabel = range === "Custom"
    ? `${safeDate(customFrom, { month: "short", day: "numeric" })} – ${safeDate(customTo, { month: "short", day: "numeric", year: "numeric" })}`
    : range;

  const serviceOptions = useMemo(
    () => [...new Set(invoices.map((i) => i.service).filter((s) => s && s !== "—"))].sort(),
    [invoices]
  );

  /* A remembered service that no longer has any invoices would filter
     everything out of a list the dropdown can't show. Once the invoices
     have loaded, fall back to all services. */
  const activeService =
    isLoading || service === ALL_SERVICES || serviceOptions.includes(service) ? service : ALL_SERVICES;
  const serviceFiltered = activeService !== ALL_SERVICES;

  /* Invoices in the chosen period and service: what the table lists (before
     search) and what the first card counts. */
  const inPeriod = useMemo(
    () => invoices.filter((i) => invoiceInPeriod(i, bounds)),
    [invoices, bounds]
  );
  const inScope = useMemo(
    () => (serviceFiltered ? inPeriod.filter((i) => i.service === activeService) : inPeriod),
    [inPeriod, serviceFiltered, activeService]
  );

  /* A visit is billed once it has an invoice with an amount. An invoice of
     ₱0 (completed without charging, price still to be set) doesn't count, so
     those visits stay in "Not billed" until an amount is entered. */
  const billedAppointmentIds = useMemo(
    () => new Set(invoices.filter(hasAmount).map((i) => i.appointment_id).filter(Boolean)),
    [invoices]
  );

  /* Every card follows the Period and Service filters (search only narrows
     the table). */
  const stats = useMemo(() => {
    const inService = (s: string | null) => !serviceFiltered || s === activeService;
    const scoped = invoices.filter((i) => inService(i.service));
    const payments = scoped.flatMap((i) => i.payments.filter((p) => p.amount > 0 && dayInBounds(p.paid_at, bounds)));
    const settled = scoped.filter((i) => payStatus(i) !== "noamount" && dayInBounds(i.paid_at, bounds));
    return {
      received: payments.reduce((s, p) => s + p.amount, 0),
      paymentCount: payments.length,
      settledCount: settled.length,
    };
  }, [invoices, bounds, serviceFiltered, activeService]);

  /* The "Not billed" backlog, oldest first. Two kinds, any date:
     - a completed visit with no invoice at all (nobody billed it)
     - a visit completed at ₱0 (the invoice exists but has no amount)
     The Service filter applies; the Period and the search box don't. */
  const notBilledList = useMemo<NotBilledItem[]>(() => {
    const inService = (s: string | null) => !serviceFiltered || s === activeService;
    const invoicedIds = new Set(invoices.map((i) => i.appointment_id).filter(Boolean));
    const rows: NotBilledItem[] = [];
    for (const v of completedVisits) {
      if (invoicedIds.has(v.id) || !inService(v.service)) continue;
      rows.push({
        key: `v-${v.id}`,
        date: v.requested_date ? v.requested_date.slice(0, 10) : "",
        time: v.scheduled_time,
        pet: v.pet_name || "—",
        owner: v.client_name || "—",
        service: v.service || "—",
        invoice: null,
      });
    }
    for (const i of invoices) {
      if (payStatus(i) !== "noamount" || !inService(i.service)) continue;
      if (i.appointment_id && billedAppointmentIds.has(i.appointment_id)) continue;
      rows.push({
        key: `i-${i.id}`,
        date: i.requested_date ? i.requested_date.slice(0, 10) : isoToLocalDate(i.created_at) || "",
        time: i.scheduled_time,
        pet: i.pet_name,
        owner: i.client_name,
        service: i.service,
        invoice: i,
      });
    }
    return rows.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || timeToMinutes(a.time) - timeToMinutes(b.time));
  }, [invoices, completedVisits, billedAppointmentIds, serviceFiltered, activeService]);

  const [notBilledOpen, setNotBilledOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inScope;
    // The invoice number is shown as "#ABC123" and exported as "INV-ABC123".
    const code = q.replace(/^#/, "").replace(/^inv-?/, "");
    return inScope.filter((i) =>
      i.pet_name.toLowerCase().includes(q) ||
      i.client_name.toLowerCase().includes(q) ||
      (code !== "" && i.id.slice(0, 6).toLowerCase().includes(code))
    );
  }, [inScope, query]);

  const hasFilters = !!query || serviceFiltered;
  const clearFilters = () => { setQuery(""); setService(ALL_SERVICES); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Until the invoices have loaded (or if they failed), the figures show a dash, not a wrong zero.
  const noData = isLoading || isError;

  return (
    <AdminLayout title="Billing" eyebrow="Invoices and payments">
      <div className={PAGE_WRAP}>

        {/* ── Figures: what came in, what is closed, and what is still unbilled ── */}
        <div className="grid grid-cols-1 gap-px border-b border-[hsl(var(--border))] bg-[hsl(var(--border))] sm:grid-cols-3">
          <StatCard
            label="Received"
            valueClass="text-[hsl(145_42%_27%)]"
            value={noData ? "—" : pesoShort(stats.received)}
            caption={noData ? "" : `${stats.paymentCount} payment${stats.paymentCount === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Paid invoices"
            valueClass="text-[hsl(205_48%_32%)]"
            value={noData ? "—" : stats.settledCount}
            caption="Fully paid and closed"
          />
          <StatCard
            label="Not billed"
            value={visitsLoading || noData || visitsError ? "—" : notBilledList.length}
            caption={
              visitsError
                ? "Couldn\u2019t load"
                : notBilledList.length > 0
                  ? "Completed visits · tap to review"
                  : "Completed visits · all caught up"
            }
            valueClass={!visitsError && notBilledList.length > 0 ? "text-[hsl(40_55%_30%)]" : undefined}
            className={!visitsError && notBilledList.length > 0 ? "!bg-[hsl(40_80%_93%)] hover:!bg-[hsl(40_80%_90%)]" : ""}
            onClick={visitsLoading || noData || visitsError ? undefined : () => setNotBilledOpen(true)}
          />
        </div>

        {/* ── Period, dates and filters in one panel ── */}
        <div className={FILTER_PANEL}>
        {/* The same tabs, dates and calendar as Reports */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Period"
            className={SEG_TRACK}
          >
            {Object.keys(RANGES).map((r) => {
              const active = range === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRange(r); setPage(1); if (r === "Custom") setRangeOpen(true); }}
                  aria-pressed={active}
                  className={segTab(active)}
                >
                  {r}
                </button>
              );
            })}
          </div>
          {range === "Custom" && (
            <RangePicker
              from={customFrom}
              to={customTo}
              open={rangeOpen}
              onOpenChange={setRangeOpen}
              onChange={(a, b) => { setCustomFrom(a); setCustomTo(b); setPage(1); }}
            />
          )}
          {/* The exact dates behind the chosen tab. The Excel file uses these
              same dates, and its file name includes them. */}
          <p className="text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]" aria-live="polite">
            <span className="font-semibold text-[hsl(var(--foreground))]">
              {fmtDisplay(startDate)}{startDate !== endDate && ` – ${fmtDisplay(endDate)}`}
            </span>
            {" · "}{dayCount} day{dayCount === 1 ? "" : "s"}
            {stillOpen && " · includes today, so it isn't final yet"}
          </p>
        </div>

        {/* ── Toolbar: same fields and button shape as Appointments ── */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            label="Search invoice, patient or owner"
            value={query}
            onChange={(v) => { setQuery(v); setPage(1); }}
            className="min-w-[170px] flex-1 basis-[170px]"
          />
          <SelectField
            label="Service"
            value={activeService}
            onChange={(e) => { setService(e.target.value); setPage(1); }}
            className="min-w-[160px] shrink-0"
          >
            <option>{ALL_SERVICES}</option>
            {serviceOptions.map((s) => <option key={s}>{s}</option>)}
          </SelectField>
          <button
            onClick={() => exportSpreadsheet(visible, `${startDate}_to_${endDate}`, staffById)}
            disabled={isError || visible.length === 0}
            title="Download the invoices currently shown as an Excel file"
            className={`${CTL_BASE} ${CTL_FIELD} shrink-0 gap-2 px-5 transition hover:bg-[hsl(var(--muted))] disabled:opacity-50`}
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Export Excel
          </button>
        </div>
        </div>

        {/* ── Table ── */}
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border)/.72)] bg-[hsl(var(--muted)/.35)] px-6 py-3">
            <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
              {hasFilters
                ? `${visible.length} of ${inPeriod.length} shown`
                : `${visible.length} invoice${visible.length === 1 ? "" : "s"} raised or paid · ${periodLabel}`}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className={`text-[14px] font-bold text-[hsl(var(--primary))] underline ${FOCUS_RING}`}
              >
                Clear filters
              </button>
            )}
          </div>
          {/* The header and rows scroll sideways together on a narrow desktop
              window, so the columns never squeeze into each other. */}
          <div className="overflow-x-auto">
          <div className={`${TABLE_HEAD} ${TABLE_MIN} ${ROW_COLS}`}>
            <span title="The date and time of the visit">Visit</span>
            <span>Patient</span>
            <span>Owner</span>
            <span>Service &amp; staff</span>
            <span className="text-right lg:pr-3">Total</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : isError ? (
            <div className="p-14 text-center" role="alert">
              <TriangleAlert className="mx-auto text-[hsl(var(--destructive))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">Couldn&apos;t load invoices</p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                Check your connection and try again. Nothing has been changed.
              </p>
              <button
                onClick={() => void refetch()}
                disabled={isFetching}
                className={`mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${FOCUS_RING}`}
              >
                {isFetching ? "Trying…" : "Try again"}
              </button>
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-14 text-center">
              <WalletCards className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">
                {invoices.length === 0 ? "No invoices yet" : "No invoices match these filters"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                {invoices.length === 0
                  ? "Bill a confirmed appointment to create the first one."
                  : "Try a different name, service or period."}
              </p>
              {hasFilters && inPeriod.length > 0 && (
                <button
                  onClick={clearFilters}
                  className={`mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                >
                  <X size={15} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          ) : (
            pageRows.map((inv) => {
              const staff = assignedStaffLines(inv, staffById);
              const status = payStatus(inv);
              const profile = inv.pet_id ? petProfiles[inv.pet_id] : undefined;
              const ownerPhone = profile?.owner_id ? ownerPhones[profile.owner_id] : null;
              // Everyone who collected a payment, with their title (Dr., Mr., Mrs., ...).
              const by = [...new Set(inv.payments.map((p) => collectorName(p.recorded_by, staffById)).filter(Boolean))].join(", ");
              return (
                <div
                  key={inv.id}
                  className={`grid gap-3 lg:gap-x-6 border-b border-[hsl(var(--border)/.55)] px-6 py-4 transition last:border-0 hover:bg-[hsl(var(--muted)/.35)] ${TABLE_MIN} lg:items-center ${ROW_COLS}`}
                >
                  <div className="flex items-center justify-between lg:block">
                    <div>
                      <p className="text-[12px] font-bold leading-4 text-[hsl(var(--muted-foreground))]">
                        {safeDate(inv.requested_date, { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                      <p className="text-[15px] font-bold leading-5 tabular-nums">{inv.scheduled_time ? fmtSlot(inv.scheduled_time) : "—"}</p>
                    </div>
                    <span className="lg:hidden"><StatusPill status={status} /></span>
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-[hsl(var(--primary))]">
                      {inv.pet_id && petPhotos[inv.pet_id] ? (
                        <img src={petPhotos[inv.pet_id]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[hsl(43_85%_93%)] text-[14px] font-extrabold text-[hsl(var(--primary))]">
                          {inv.pet_name === "—" ? "—" : inv.pet_name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-[14px] font-bold leading-snug">{inv.pet_name}</p>
                      <p className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{patientMeta(inv, profile)}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-bold leading-snug" title={titleCase(inv.client_name)}>{titleCase(inv.client_name)}</p>
                    <p className="truncate whitespace-nowrap text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]" title={fmtPhone(ownerPhone)}>{fmtPhone(ownerPhone)}</p>
                  </div>
                  <div className="min-w-0">
                    {/* The service name may use two lines; the full text shows on hover. */}
                    <p className="break-words text-[14px] font-bold leading-snug" title={inv.service}>
                      {serviceLines(inv.service).map((line) => (
                        <span key={line} className="block">{line}</span>
                      ))}
                    </p>
                    {staff ? (
                      <>
                        <p title={staff.name} className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{staff.name}</p>
                        {staff.role && (
                          <p title={staff.role} className="break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">{staff.role}</p>
                        )}
                      </>
                    ) : (
                      <p title="No staff assigned" className="text-[12.5px] font-bold leading-snug text-[hsl(40_55%_30%)]">Unassigned</p>
                    )}
                  </div>
                  <div className="lg:pr-3 lg:text-right">
                    <p className="text-[14px] font-bold tabular-nums">{peso(inv.total)}</p>
                    <p className="mt-0.5 text-[12px] font-medium leading-4 tracking-[.02em] text-[hsl(var(--muted-foreground))] tabular-nums">
                      #{inv.id.slice(0, 6).toUpperCase()}
                    </p>
                  </div>
                  <div className="hidden min-w-0 lg:block">
                    <StatusPill status={status} />
                    {status === "noamount" ? (
                      <p className="mt-1 break-words text-[12.5px] font-medium leading-snug text-[hsl(40_55%_30%)]">
                        Amount not entered
                      </p>
                    ) : status !== "paid" && (
                      <p className="mt-1 break-words text-[12.5px] font-medium leading-snug text-[hsl(40_55%_30%)]">
                        Balance {peso(Math.max(0, inv.total - paidAmount(inv)))}
                      </p>
                    )}
                    {by && (
                      <p className="mt-1 break-words text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]" title={`Received by ${by}`}>
                        Received by<br /><strong className="font-semibold text-[hsl(var(--foreground))]">{by}</strong>
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setSelected(inv)}
                      aria-label={`View invoice for ${inv.pet_name}`}
                      className={`flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                    >
                      View
                    </button>
                  </div>
                </div>
              );
            })
          )}
          </div>

          {visible.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
              <p className="text-[14px] text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)}
                </strong> of {visible.length} invoice{visible.length === 1 ? "" : "s"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  className={PAGER_BTN}
                >
                  Previous
                </button>
                <span className="px-1 text-[14px] font-bold" aria-live="polite">{currentPage} / {totalPages}</span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className={PAGER_BTN}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {notBilledOpen && (
        <NotBilledDialog
          items={notBilledList}
          today={today}
          onClose={() => setNotBilledOpen(false)}
          onOpenInvoice={(inv) => { setNotBilledOpen(false); setSelected(inv); }}
        />
      )}
      {selected && (
        <InvoiceDetail
          invoice={selected}
          clinic={clinic}
          staffById={staffById}
          onClose={() => setSelected(null)}
        />
      )}
    </AdminLayout>
  );
}
interface NotBilledItem {
  key: string;
  date: string;
  time: string | null;
  pet: string;
  owner: string;
  service: string;
  invoice: InvoiceRow | null;
}

/* Completed visits nobody has charged yet, oldest first, so a forgotten one
   can't sit unnoticed. The amount itself is entered in Appointments
   (Manage → Enter amount); a ₱0 invoice can be opened here. */
function NotBilledDialog({
  items, today, onClose, onOpenInvoice,
}: {
  items: NotBilledItem[];
  today: string;
  onClose: () => void;
  onOpenInvoice: (inv: InvoiceRow) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] w-[min(720px,calc(100vw-2rem))] max-w-none overflow-y-auto">
        <DialogTitle className="text-[22px] font-bold">Not billed</DialogTitle>
        <p className="text-[15px] text-[hsl(var(--muted-foreground))]">
          Completed visits with no invoice or no amount, from any date. To add the amount, open the
          visit in Appointments and choose Manage, then Enter amount.
        </p>
        {items.length === 0 ? (
          <p className="py-8 text-center text-[16px] text-[hsl(var(--muted-foreground))]">
            All caught up. Every completed visit has an amount.
          </p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--card-border))]">
            {items.map((it) => {
              const waiting = it.date && it.date <= today ? daysBetween(it.date, today) : 0;
              return (
                <li key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="w-[120px] shrink-0">
                    <div className="text-[16px] font-bold">
                      {safeDate(it.date, { month: "short", day: "numeric" })}
                    </div>
                    <div className="text-[14px] text-[hsl(var(--muted-foreground))]">
                      {it.time ? fmtSlot(it.time) : ""}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-bold">{it.pet}</div>
                    <div className="truncate text-[14px] text-[hsl(var(--muted-foreground))]">
                      {titleCase(it.owner)} · {it.service}
                    </div>
                  </div>
                  <div className="text-[14px] text-[hsl(var(--muted-foreground))]">
                    {waiting > 0 ? `${waiting} day${waiting === 1 ? "" : "s"} ago` : it.date === today ? "Today" : ""}
                  </div>
                  {it.invoice ? (
                    <button
                      type="button"
                      onClick={() => onOpenInvoice(it.invoice!)}
                      className={`h-10 rounded-full border-2 border-[hsl(var(--primary))] px-5 text-[15px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                    >
                      View
                    </button>
                  ) : (
                    <span className="rounded-full border-[1.5px] border-[hsl(var(--destructive))] px-3 py-1 text-[14px] font-bold text-[hsl(var(--destructive))]">
                      No invoice
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ClinicInfo {
  clinic_name?: string | null;
  address?: string | null;
  phone_number?: string | null;
  email?: string | null;
}

function InvoiceDetail({
  invoice, clinic, staffById, onClose,
}: {
  invoice: InvoiceRow;
  clinic?: ClinicInfo | null;
  staffById: Record<string, StaffOption>;
  onClose: () => void;
}) {
  /* The same receipt as the Appointments screen (its "View invoice"),
     laid out landscape: who and when on the left, the bill on the right.
     If one changes, change the other, or move it into a shared file. */
  const staff = assignedStaffLines(invoice, staffById);
  const issued = safeDate(isoToLocalDate(invoice.created_at), { month: "short", day: "numeric", year: "numeric" });
  const status = payStatus(invoice);
  const paidAmt = paidAmount(invoice);
  const balance = Math.max(0, invoice.total - paidAmt);
  const lastPaidAt = invoice.paid_at || invoice.payments[invoice.payments.length - 1]?.paid_at || null;
  const paidOn = lastPaidAt
    ? safeDate(isoToLocalDate(lastPaidAt), { month: "short", day: "numeric", year: "numeric" })
    : issued;
  const visitLabel = `${safeDate(invoice.requested_date, { month: "short", day: "numeric", year: "numeric" })}${
    invoice.scheduled_time ? ` · ${fmtSlot(invoice.scheduled_time)}` : ""
  }`;
  const detailRows: [string, string][] = [
    ["Invoice no.", `INV-${invoice.id.slice(0, 6).toUpperCase()}`],
    ["Date issued", issued],
    ["Visit", visitLabel],
    ["Billed to", titleCase(invoice.client_name)],
    ["Pet", invoice.pet_name],
    ["Service", invoice.service],
    // Left out when nobody was assigned, rather than printing a blank.
    ...(staff ? ([["Attended by", staff.name]] as [string, string][]) : []),
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[92vh] max-w-[860px] grid-cols-[minmax(0,1fr)] gap-0 overflow-y-auto rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-5 sm:p-7 [&>button]:hidden"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogTitle className="text-[22px] font-bold leading-7 tracking-[-.02em]">
              {clinic?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services"}
            </DialogTitle>
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

        <div className="mt-5 grid grid-cols-1 gap-y-6 border-t border-[hsl(var(--card-border))] pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-x-10">
          <div className="min-w-0">
            <p className="text-[40px] font-bold leading-none tracking-[-.03em]">{peso(invoice.total)}</p>
            <StatusPill
              status={status}
              detail={status === "paid" ? paidOn : status === "partial" ? `${peso(paidAmt)} paid` : undefined}
              className="mt-3 w-fit"
            />

            <div className="mt-4 border-t border-[hsl(var(--card-border))]">
              {detailRows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="shrink-0 text-[15px] text-[hsl(var(--muted-foreground))]">{k}</span>
                  <span className="min-w-0 truncate text-right text-[15px] font-bold" title={v}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col md:border-l md:border-[hsl(var(--card-border))] md:pl-10">
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
                  {invoice.items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-5 text-center text-[15px] text-[hsl(var(--muted-foreground))]">
                        No line items on this invoice.
                      </td>
                    </tr>
                  ) : (
                    invoice.items.map((it) => (
                      <tr key={it.id} className="border-b border-[hsl(var(--card-border))]">
                        <td className="py-3 pr-3 text-[16px]">{it.service_name}</td>
                        <td className="py-3 text-right text-[16px] tabular-nums">{it.quantity}</td>
                        <td className="py-3 text-right text-[16px] font-bold tabular-nums">{peso(it.subtotal)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-auto border-t border-[hsl(var(--card-border))] pt-4">
              {status === "noamount" && (
                <p className="mb-3 rounded-2xl bg-[hsl(40_55%_30%/.1)] px-3.5 py-3 text-[14px] font-medium leading-snug text-[hsl(40_55%_30%)]">
                  No amount has been entered for this visit yet. Set the price at billing.
                </p>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[18px] font-bold">Total paid</span>
                <span className="text-[24px] font-bold tabular-nums">{peso(paidAmt)}</span>
              </div>
              {balance > 0 && (
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[16px] font-bold text-[hsl(40_55%_30%)]">Balance due</span>
                  <span className="text-[18px] font-bold tabular-nums text-[hsl(40_55%_30%)]">{peso(balance)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
