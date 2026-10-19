import { useEffect, useMemo, useRef, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchStaffDirectory, staffDisplayName } from "@/api/appointments";
import jsPDF from "jspdf";
// jspdf-autotable v4+ no longer patches autoTable onto the jsPDF
// instance — it must be imported and called as a function.
import autoTable from "jspdf-autotable";
// xlsx-js-style is SheetJS with cell styles (fills, bold, borders) and frozen
// panes switched on. Same API as "xlsx". Install: npm i xlsx-js-style
import * as XLSX from "xlsx-js-style";
import { toast } from "sonner";
import { useAdminStore } from "@/store/adminStore";
import {
  Download, CreditCard, ChevronLeft, ChevronRight,
  Package, FileSpreadsheet, FileText, ChevronDown, Loader2,
} from "lucide-react";

/* ₱610, ₱387.78, ₱1,465 — two decimals only when there is a fractional part.
   Used for every amount on screen (cards and lists), same as Inventory.
   The exports keep their own fixed two-decimal format (phpMoney / MONEY). */
const peso = (n: number) => {
  const r = Math.round(Number(n) * 100) / 100;
  return "₱" + r.toLocaleString("en-PH", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

/* Local date parts — toISOString() converts to UTC, which shifts the
   range start a day earlier at UTC+8. */
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* "Today" is the clinic's today (Philippines), not whatever the browser's
   clock says, so the presets and the queries always agree on what day it is.
   clinicNow() is that day at local midnight, ready for date maths. */
const clinicToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const clinicNow = () => new Date(`${clinicToday()}T00:00:00`);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/* The longest range the calendar allows (about 12 months). Keeps the page
   fast and the exports a sensible size. */
const MAX_RANGE_DAYS = 366;

/* A database timestamp as the clinic's day and time (Philippines), whatever
   timezone the computer doing the export is set to. */
const localDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const localTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

function fmtDisplay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const CLINIC_TZ_OFFSET = "+08:00";

const rangeFrom = (d: string) => `${d}T00:00:00${CLINIC_TZ_OFFSET}`;
/* Exclusive end: midnight at the start of the day AFTER the last day, so a
   sale at 11:59:59.9 PM on the last day is still counted. */
const rangeBefore = (d: string) => {
  const n = new Date(`${d}T00:00:00`);
  n.setDate(n.getDate() + 1);
  return `${toISO(n)}T00:00:00${CLINIC_TZ_OFFSET}`;
};

/* Supabase returns at most 1,000 rows per request, so a long period used to
   drop everything after the first 1,000 sales or payments and the totals came
   out too low. This reads every page. */
async function fetchAllRows(build: () => any): Promise<any[]> {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build().order("id", { ascending: true }).range(start, start + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchProductRows(ids: string[], columns: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await (supabase as any).from("products").select(columns).in("id", ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

async function fetchHeadline(startDate: string, endDate: string) {
  const from = rangeFrom(startDate);
  const to = rangeBefore(endDate);
  const [payments, sales] = await Promise.all([
    fetchAllRows(() => (supabase as any).from("payments").select("id, amount").gte("paid_at", from).lt("paid_at", to)),
    fetchAllRows(() => (supabase as any).from("product_sales").select("id, total_amount, product_id, quantity").gte("sold_at", from).lt("sold_at", to)),
  ]);
  const serviceRevenue = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const productSales = sales.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
  // Cost of the products actually sold in the period.
  const productIds = [...new Set(sales.map((r: any) => r.product_id).filter(Boolean))] as string[];
  const costMap: Record<string, number> = {};
  (await fetchProductRows(productIds, "id, cost_price")).forEach((p: any) => { costMap[p.id] = Number(p.cost_price || 0); });
  const productCost = sales.reduce(
    (s: number, r: any) => s + (costMap[r.product_id] || 0) * (r.quantity || 1), 0
  );
  // Sold products with no cost price count as zero cost, which overstates profit.
  const missingCost =
    productIds.filter((id) => !(costMap[id] > 0)).length + (sales.some((r: any) => !r.product_id) ? 1 : 0);
  return {
    serviceRevenue,
    productSales,
    productCost,
    grossProfit: productSales - productCost,
    margin: productSales > 0 ? Math.round(((productSales - productCost) / productSales) * 1000) / 10 : 0,
    salesCount: sales.length,
    hasCostData: productCost > 0,
    missingCost,
  };
}

async function fetchTopProducts(startDate: string, endDate: string) {
  const rows = await fetchAllRows(() =>
    (supabase as any)
      .from("product_sales")
      .select("id, product_id, product_name, quantity, total_amount")
      .gte("sold_at", rangeFrom(startDate))
      .lt("sold_at", rangeBefore(endDate))
  );
  const ids = [...new Set(rows.map((r: any) => r.product_id).filter(Boolean))] as string[];
  const catMap: Record<string, string> = {};
  (await fetchProductRows(ids, "id, category")).forEach((p: any) => { catMap[p.id] = p.category || ""; });
  const grouped: Record<string, { key: string; name: string; category: string; units: number; revenue: number; sales: number }> = {};
  rows.forEach((row: any) => {
    const key = row.product_id || row.product_name;
    const g = grouped[key] ||= { key, name: row.product_name, category: catMap[row.product_id] || "", units: 0, revenue: 0, sales: 0 };
    g.units += Number(row.quantity || 0);
    g.revenue += Number(row.total_amount || 0);
    g.sales += 1;
  });
  return Object.values(grouped).sort((a, b) => b.units - a.units || b.revenue - a.revenue);
}

/* Services performed, from invoices paid in the period. Same source as the
   Services table in the PDF and Excel, so the screen and the exports agree. */
async function fetchServiceRevenue(startDate: string, endDate: string) {
  const invoices = await fetchAllRows(() =>
    (supabase as any).from("invoices").select("id")
      .gte("paid_at", rangeFrom(startDate)).lt("paid_at", rangeBefore(endDate))
  );
  const ids = invoices.map((i: any) => i.id);
  const groups: Record<string, { name: string; count: number; revenue: number }> = {};
  for (let i = 0; i < ids.length; i += 150) {
    const items = await fetchAllRows(() =>
      (supabase as any).from("invoice_items").select("id, service_name, quantity, subtotal")
        .in("invoice_id", ids.slice(i, i + 150))
    );
    items.forEach((it: any) => {
      const g = groups[it.service_name] ||= { name: it.service_name, count: 0, revenue: 0 };
      g.count += Number(it.quantity || 0);
      g.revenue += Number(it.subtotal || 0);
    });
  }
  return Object.values(groups).sort((a, b) => b.revenue - a.revenue);
}

/* Revenue by category is product sales only, grouped by each product's own
   category, so its total always equals the Product sales card. A sale whose
   product has since been deleted still counts, under "Uncategorised". */
async function fetchCategorySales(startDate: string, endDate: string): Promise<[string, number][]> {
  const rows = await fetchAllRows(() =>
    (supabase as any)
      .from("product_sales")
      .select("id, product_id, total_amount")
      .gte("sold_at", rangeFrom(startDate))
      .lt("sold_at", rangeBefore(endDate))
  );
  const ids = [...new Set(rows.map((r: any) => r.product_id).filter(Boolean))] as string[];
  const catMap: Record<string, string> = {};
  (await fetchProductRows(ids, "id, category")).forEach((p: any) => { catMap[p.id] = p.category || ""; });
  const totals: Record<string, number> = {};
  rows.forEach((r: any) => {
    const cat = (r.product_id && catMap[r.product_id]) || UNCATEGORISED;
    totals[cat] = (totals[cat] || 0) + Number(r.total_amount || 0);
  });
  return Object.entries(totals).sort(([an, a], [bn, b]) =>
    an === UNCATEGORISED ? 1 : bn === UNCATEGORISED ? -1 : b - a
  );
}

/* The period tabs. "This month" is the default: billing and closing the
   books are monthly. Every range ends today, so the comparison with the
   previous period of the same length is always like for like. */
const RANGES: Record<string, () => { from: string; to: string }> = {
  Today: () => {
    const t = clinicToday();
    return { from: t, to: t };
  },
  "Last 7 days": () => {
    const t = clinicToday();
    return { from: addDays(t, -6), to: t };
  },
  "This month": () => {
    const n = clinicNow();
    return { from: toISO(new Date(n.getFullYear(), n.getMonth(), 1)), to: toISO(n) };
  },
  "Last 30 days": () => {
    const t = clinicToday();
    return { from: addDays(t, -29), to: t };
  },
  // This month and the two before it, whole calendar months.
  "Last 3 months": () => {
    const n = clinicNow();
    return { from: toISO(new Date(n.getFullYear(), n.getMonth() - 2, 1)), to: toISO(n) };
  },
  "This year": () => {
    const n = clinicNow();
    return { from: toISO(new Date(n.getFullYear(), 0, 1)), to: toISO(n) };
  },
};

/* Each category keeps its own colour everywhere: its row in the category
   table and the bar of every product in Most purchased, so staff learn them once. */
const UNCATEGORISED = "Uncategorised";
const CATEGORY_COLORS: Record<string, string> = {
  "Grooming & Hygiene": "#0F766E",
  "Vitamins & Supplements": "#D99A1E",
  "Flea, Tick & Deworming": "#D1583B",
  "Pet Food": "#1F3A6B",
  "Dental Care": "#4C9ED9",
  "Treats & Enrichment": "#8A4F9E",
  "Accessories & Essentials": "#6B7A90",
  [UNCATEGORISED]: "#B9B7AA",
};
// Categories the clinic adds later get a steady colour of their own.
const EXTRA_COLORS = ["#2E8B57", "#B5476B", "#8C6D31", "#3F5F9E"];
function categoryColor(name: string) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}
const hexToRgb = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/* Whole-number shares that always add up to exactly 100 (largest remainder). */
function sharePercents(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - out[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) out[order[k % order.length][1]]++;
  return out;
}

/* How this period compares with the one before it. Returns null when there
   is nothing to compare against, so the card simply shows no change line. */
type Delta = { text: string; short: string; dir: "up" | "down" | "flat" };
function compare(current: number, previous: number | undefined): Delta | null {
  if (previous === undefined) return null;
  if (previous === 0 && current === 0) return { text: "Nothing in either period", short: "No change", dir: "flat" };
  if (previous === 0) return { text: "Nothing in the previous period, so there is nothing to compare with", short: "New", dir: "up" };
  // Divide by the size of the previous value so a negative previous
  // (a loss) still points the right way.
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return { text: "Same as the previous period", short: "0%", dir: "flat" };
  return { text: `${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than the previous period`, short: `${Math.abs(pct)}%`, dir: pct > 0 ? "up" : "down" };
}

const LEGEND_GRID = "grid grid-cols-[12px_minmax(0,1fr)_48px_100px] items-center gap-x-3";

const SERVICES_NOTE =
  "Services performed is based on invoices. Service revenue is based on payments received, so they can differ when an invoice is partly paid.";

async function fetchExportData(startDate: string, endDate: string, detail = false) {
  const from = `${startDate}T00:00:00${CLINIC_TZ_OFFSET}`;
  const to = rangeBefore(endDate);
  const [salesData, invoicesData, clinicRes] = await Promise.all([
    fetchAllRows(() =>
      (supabase as any)
        .from("product_sales")
        .select(detail
          ? "id, product_id, product_name, quantity, total_amount, unit_price, sold_at, sold_by_staff_id"
          : "id, product_id, product_name, quantity, total_amount")
        .gte("sold_at", from).lt("sold_at", to)
    ),
    fetchAllRows(() =>
      (supabase as any).from("invoices")
        .select(detail ? "id, appointment_id, total_amount, paid_at" : "id")
        .gte("paid_at", from).lt("paid_at", to)
    ),
    (supabase as any).from("clinic_settings").select("*").limit(1).maybeSingle(),
  ]);
  const salesRes = { data: salesData };
  const invoicesRes = { data: invoicesData };

  const groups: Record<string, { name: string; productId: string | null; units: number; sales: number; revenue: number }> = {};
  (salesRes.data || []).forEach((row: any) => {
    const key = row.product_id || row.product_name;
    const g = groups[key] ||= { name: row.product_name, productId: row.product_id || null, units: 0, sales: 0, revenue: 0 };
    g.units += Number(row.quantity || 0);
    g.sales += 1;
    g.revenue += Number(row.total_amount || 0);
  });
  const productIds = [...new Set(Object.values(groups).map((g) => g.productId).filter(Boolean))] as string[];
  const costMap: Record<string, number> = {};
  (await fetchProductRows(productIds, "id, cost_price")).forEach((p: any) => {
    costMap[p.id] = Number(p.cost_price || 0);
  });
  const products = Object.values(groups).map((g) => {
    const unitCost = g.productId ? costMap[g.productId] || 0 : 0;
    const cost = unitCost * g.units;
    const profit = g.revenue - cost;
    return {
      name: g.name, units: g.units, sales: g.sales, revenue: g.revenue, cost, profit,
      margin: g.revenue > 0 ? Math.round((profit / g.revenue) * 1000) / 10 : 0,
      hasCost: unitCost > 0,
    };
  });

  const invoiceIds = (invoicesRes.data || []).map((i: any) => i.id);
  const serviceGroups: Record<string, { name: string; count: number; revenue: number }> = {};
  for (let i = 0; i < invoiceIds.length; i += 150) {
    // Read every page: 150 invoices can have more than 1,000 line items.
    const items = await fetchAllRows(() =>
      (supabase as any)
        .from("invoice_items")
        .select("id, service_name, quantity, subtotal")
        .in("invoice_id", invoiceIds.slice(i, i + 150))
    );
    items.forEach((it: any) => {
      const g = serviceGroups[it.service_name] ||= { name: it.service_name, count: 0, revenue: 0 };
      g.count += Number(it.quantity || 0);
      g.revenue += Number(it.subtotal || 0);
    });
  }

  // Row-level detail, only for the Excel export (the PDF stays a summary).
  type InvoiceDetail = { id: string; paidAt: string; patient: string; owner: string; service: string; staff: string; total: number };
  type SaleDetail = { soldAt: string; product: string; qty: number; unitPrice: number; total: number; staff: string };
  let invoiceRows: InvoiceDetail[] = [];
  let saleRows: SaleDetail[] = [];
  if (detail) {
    const staff = await fetchStaffDirectory();
    const staffName = (id?: string | null) => {
      const m = staff.find((x) => x.id === id);
      return m ? staffDisplayName(m) : "";
    };
    const apptIds = [...new Set((invoicesRes.data || []).map((i: any) => i.appointment_id).filter(Boolean))] as string[];
    const apptMap: Record<string, any> = {};
    for (let i = 0; i < apptIds.length; i += 150) {
      const { data, error } = await (supabase as any)
        .from("appointments")
        .select("id, pet_name, client_name, service, assigned_staff_id, assigned_staff_name")
        .in("id", apptIds.slice(i, i + 150));
      if (error) throw error;
      (data || []).forEach((a: any) => { apptMap[a.id] = a; });
    }
    invoiceRows = (invoicesRes.data || [])
      .map((i: any): InvoiceDetail => {
        const a = apptMap[i.appointment_id];
        return {
          id: i.id,
          paidAt: i.paid_at,
          patient: a?.pet_name || "-",
          owner: a?.client_name || "-",
          service: a?.service || "-",
          staff: a
            ? (a.assigned_staff_id ? staffName(a.assigned_staff_id) || "Unknown staff" : a.assigned_staff_name || "")
            : "",
          total: Number(i.total_amount || 0),
        };
      })
      .sort((x: InvoiceDetail, y: InvoiceDetail) => x.paidAt.localeCompare(y.paidAt));
    saleRows = (salesRes.data || [])
      .map((r: any): SaleDetail => ({
        soldAt: r.sold_at,
        product: r.product_name,
        qty: Number(r.quantity || 0),
        unitPrice: Number(r.unit_price || 0),
        total: Number(r.total_amount || 0),
        staff: staffName(r.sold_by_staff_id),
      }))
      .sort((x: SaleDetail, y: SaleDetail) => x.soldAt.localeCompare(y.soldAt));
  }
  return { products, services: Object.values(serviceGroups), clinic: clinicRes.data ?? null, invoiceRows, saleRows };
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* Full-bleed layout: no side margins and no max width. Every panel is a
   flat, full-width band separated by 1px lines (no floating rounded cards),
   with small sentence-case headings and a 40px toolbar row. */
const PAGE_WRAP = "w-full";
const CARD = "border-b border-[hsl(var(--border))] bg-white";
/* Segmented tabs, same as the Appointments status tabs. */
const SEG_TRACK =
  "flex h-10 max-w-full items-end gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const segTab = (active: boolean) =>
  `-mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-[14px] transition ${FOCUS_RING} ${
    active
      ? "border-[hsl(var(--primary))] font-bold text-[hsl(var(--foreground))]"
      : "border-transparent font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
  }`;
/* Previous / Next, as on the Dashboard. */
const PAGER_BTN =
  `h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30 ${FOCUS_RING}`;

/* The Export menu, the same as Appointments and Inventory: one button, with
   Excel and PDF inside. */
const MENU_PANEL = "absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-1.5 shadow-[0_12px_32px_rgb(5_31_66/.18)]";
const MENU_ITEM = `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${FOCUS_RING}`;

/* Closes a dropdown on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null >) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

function ExportMenu({
  onExcel, onPdf, disabled, busy,
}: {
  onExcel: () => void; onPdf: () => void; disabled: boolean; busy: null | "pdf" | "excel";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Download this report"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-white px-4 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        Export
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className={MENU_PANEL}>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); onExcel(); }} className={MENU_ITEM}>
            <FileSpreadsheet size={18} aria-hidden="true" />
            Excel spreadsheet
          </button>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); onPdf(); }} className={MENU_ITEM}>
            <FileText size={18} aria-hidden="true" />
            PDF report
          </button>
        </div>
      )}
    </div>
  );
}

const toLocalISO = toISO;
function safeDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) {
  if (!iso) return "No date";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", opts);
}

/* One calendar for a date range: tap the first day, then the last day.
   Rules: the last day can't be before the first (tapping an earlier day
   simply restarts the range there), a range is at most about 12 months, and
   days after today are unavailable, since reports only look backwards.
   Quick picks sit on top for ranges the tabs don't already cover. */
function RangePicker({
  from, to, onChange, open, onOpenChange,
}: {
  from: string; to: string; onChange: (from: string, to: string) => void;
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const todayIso = clinicToday();
  const start = new Date(`${from || todayIso}T00:00:00`);
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const monthName = new Date(view.y, view.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => toLocalISO(new Date(view.y, view.m, i + 1))),
  ];
  const shift = (n: number) =>
    setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const close = () => { setAnchor(null); setHover(null); onOpenChange(false); };

  /* A day can't be picked if it is in the future, or if it would make the
     range longer than the limit. */
  const unavailable = (iso: string) => {
    if (iso > todayIso) return true;
    if (anchor && iso > anchor && daysBetween(anchor, iso) + 1 > MAX_RANGE_DAYS) return true;
    return false;
  };
  const pick = (iso: string) => {
    if (unavailable(iso)) return;
    // First tap, or a tap before the first day: start the range here.
    if (!anchor || iso < anchor) { setAnchor(iso); setHover(null); return; }
    onChange(anchor, iso);
    close();
  };

  const now = clinicNow();
  // The tabs already cover Today, 7 and 30 days, 3 months and this year, so
  // the calendar offers the ranges they don't.
  const presets: { label: string; a: Date; b: Date }[] = [
    { label: "Last month", a: new Date(now.getFullYear(), now.getMonth() - 1, 1), b: new Date(now.getFullYear(), now.getMonth(), 0) },
    { label: "Last 90 days", a: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89), b: now },
    { label: "Last year", a: new Date(now.getFullYear() - 1, 0, 1), b: new Date(now.getFullYear() - 1, 11, 31) },
  ];
  const a0 = anchor ?? from;
  const b0 = anchor ? (hover && hover >= anchor && !unavailable(hover) ? hover : anchor) : to;
  const lo = a0 < b0 ? a0 : b0;
  const hi = a0 < b0 ? b0 : a0;
  const label = `${safeDate(from, { month: "short", day: "numeric" })} – ${safeDate(to, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label="Date range"
        className={`relative flex h-10 min-w-[225px] items-center rounded-[10px] border border-[hsl(var(--input))] bg-white pl-3 pr-9 text-left text-[14px] font-semibold transition hover:border-[hsl(var(--accent))] ${FOCUS_RING}`}
      >
        {label}
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div
            onClick={(ev) => ev.stopPropagation()}
            className="max-h-[94vh] w-[400px] max-w-full overflow-y-auto rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-5 shadow-[0_24px_60px_-20px_rgb(5_31_66/.55)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[22px] font-bold leading-7 tracking-[-.02em]">Select dates</h3>
              <button type="button" onClick={close} className={`flex h-12 items-center rounded-full px-3 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}>Close</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { onChange(toLocalISO(p.a), toLocalISO(p.b)); close(); }}
                  className={`h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-[20px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-2 py-2">
              <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className={`flex h-10 w-10 items-center justify-center rounded-[10px] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}>
                <ChevronLeft size={22} />
              </button>
              <p className="text-[16px] font-bold">{monthName}</p>
              <button type="button" onClick={() => shift(1)} aria-label="Next month" className={`flex h-10 w-10 items-center justify-center rounded-[10px] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}>
                <ChevronRight size={22} />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 text-center text-[13px] font-bold text-[hsl(var(--muted-foreground))]">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="py-1.5">{d}</span>)}
            </div>
            <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
              {cells.map((iso, i) => {
                if (!iso) return <span key={`b${i}`} />;
                const edge = iso === lo || iso === hi;
                const inside = iso > lo && iso < hi;
                const blocked = unavailable(iso);
                return (
                  <div
                    key={iso}
                    className={`flex h-9 items-center justify-center ${inside ? "bg-[hsl(var(--muted))]" : ""} ${inside && i % 7 === 0 ? "rounded-l-full" : ""} ${inside && i % 7 === 6 ? "rounded-r-full" : ""} ${iso === lo && hi !== lo ? "rounded-l-full bg-[hsl(var(--muted))]" : ""} ${iso === hi && hi !== lo ? "rounded-r-full bg-[hsl(var(--muted))]" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => pick(iso)}
                      onMouseEnter={() => anchor && setHover(iso)}
                      aria-pressed={edge}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING} ${
                        edge
                          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                          : `hover:bg-[hsl(var(--muted))] ${iso === todayIso ? "ring-[1.5px] ring-inset ring-[hsl(var(--primary))]" : ""}`
                      }`}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[14px] text-[hsl(var(--muted-foreground))]">
              {anchor
                ? "Now pick the last day. It can't be before the first day."
                : "Pick the first day, then the last day. Up to 12 months, and not after today."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* One cell of the summary strip. `warn` turns the number and caption amber
   (cost prices missing, so the figure isn't a true profit yet). `delta` is
   the change line against the previous period. The strip supplies the
   hairline dividers between cells. */
function StatCard({
  label, value, caption, warn, delta,
}: {
  label: string; value: string; caption: string; warn?: boolean; delta?: Delta | null;
}) {
  const chip =
    delta?.dir === "up" ? "bg-[hsl(152_45%_92%)] text-[hsl(152_55%_26%)]"
      : delta?.dir === "down" ? "bg-[hsl(15_72%_92%)] text-[hsl(15_60%_36%)]"
      : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
  const arrow = delta?.dir === "up" ? "▲" : delta?.dir === "down" ? "▼" : "";
  return (
    <div className="block min-w-0 bg-white px-5 py-5 text-left sm:px-6">
      <span className="block break-words text-[13px] font-semibold leading-snug text-[hsl(var(--muted-foreground))]">{label}</span>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`block min-w-0 break-words text-[28px] font-extrabold leading-[1.1] tracking-[-.02em] tabular-nums ${
          warn ? "text-[hsl(40_55%_30%)]" : "text-[hsl(var(--foreground))]"
        }`}>
          {value}
        </span>
        {delta && (
          <span
            title={`${delta.text}. The dates are under the period tabs.`}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${chip}`}
          >
            {arrow && <span aria-hidden="true">{arrow}</span>}
            {delta.short}
            <span className="sr-only"> {delta.text}</span>
          </span>
        )}
      </div>
      <span className={`mt-0.5 block break-words text-[12.5px] leading-snug ${
        warn ? "text-[hsl(40_55%_30%)]" : "text-[hsl(var(--muted-foreground))]"
      }`}>
        {caption || "\u00A0"}
      </span>
    </div>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[17px] font-extrabold leading-6">{title}</h2>
      <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{subtitle}</p>
    </div>
  );
}

/* Shown inside a card while its data loads, or when loading failed. A failed
   load must never look like an empty period. */
function CardLoading() {
  return (
    <div className="flex justify-center py-14" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
function CardError({ what }: { what: string }) {
  return (
    <p role="alert" className="py-14 text-center text-sm text-[hsl(var(--destructive))]">
      Couldn&apos;t load {what}. This is a loading problem, not an empty period. Try again in a moment.
    </p>
  );
}

const TOP_PRODUCTS_PAGE_SIZE = 5;
const SERVICES_PAGE_SIZE = 5;

export default function Reports() {
  const today = clinicNow();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [range, setRange] = useState("This month");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(toISO(monthStart));
  const [customTo, setCustomTo] = useState(toISO(today));
  const [productPage, setProductPage] = useState(1);
  const [servicePage, setServicePage] = useState(1);
  const [exporting, setExporting] = useState<null | "pdf" | "excel">(null);
  const fullName = useAdminStore((s) => [s.title, s.fullName].filter(Boolean).join(" "));

  const { startDate, endDate } = useMemo(() => {
    if (range === "Custom") return { startDate: customFrom, endDate: customTo };
    const r = RANGES[range]();
    return { startDate: r.from, endDate: r.to };
  }, [range, customFrom, customTo]);

  /* The period just before this one, the same number of days long, for the
     "vs previous period" line on each card. */
  const dayCount = daysBetween(startDate, endDate) + 1;
  const prevEnd = addDays(startDate, -1);
  const prevStart = addDays(prevEnd, -(dayCount - 1));
  // Still open: the range includes today, so the numbers aren't final yet.
  const stillOpen = endDate >= clinicToday();

  const { data: headline, isLoading, isError: headlineError } = useQuery({
    queryKey: ["report-headline", startDate, endDate],
    queryFn: () => fetchHeadline(startDate, endDate),
  });
  const { data: previous } = useQuery({
    queryKey: ["report-headline", prevStart, prevEnd],
    queryFn: () => fetchHeadline(prevStart, prevEnd),
  });
  const { data: categoryEntries = [], isLoading: categoryLoading, isError: categoryError } = useQuery({
    queryKey: ["report-category", startDate, endDate],
    queryFn: () => fetchCategorySales(startDate, endDate),
  });
  const { data: topProducts = [], isLoading: topLoading, isError: topError } = useQuery({
    queryKey: ["report-top-products", startDate, endDate],
    queryFn: () => fetchTopProducts(startDate, endDate),
  });

  const { data: serviceRows = [], isLoading: serviceLoading, isError: serviceError } = useQuery({
    queryKey: ["report-services", startDate, endDate],
    queryFn: () => fetchServiceRevenue(startDate, endDate),
  });
  const serviceTotal = serviceRows.reduce((s, r) => s + r.revenue, 0);
  const serviceShares = sharePercents(serviceRows.map((r) => r.revenue));

  /* Revenue by service is paged like Most purchased. The shares and the
     Total above are worked out from every service, so they stay correct
     on every page. */
  const serviceTotalPages = Math.max(1, Math.ceil(serviceRows.length / SERVICES_PAGE_SIZE));
  const serviceCurrentPage = Math.min(servicePage, serviceTotalPages);
  const serviceRowsPage = serviceRows.slice(
    (serviceCurrentPage - 1) * SERVICES_PAGE_SIZE,
    serviceCurrentPage * SERVICES_PAGE_SIZE
  );

  const productTotalPages = Math.max(1, Math.ceil(topProducts.length / TOP_PRODUCTS_PAGE_SIZE));
  const productCurrentPage = Math.min(productPage, productTotalPages);
  const topProductsPage = topProducts.slice(
    (productCurrentPage - 1) * TOP_PRODUCTS_PAGE_SIZE,
    productCurrentPage * TOP_PRODUCTS_PAGE_SIZE
  );

  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0);
  const shares = sharePercents(categoryEntries.map(([, v]) => v));

  /* Change chips only for periods long enough to compare. On a single day or
     one week a slow morning reads as a crash, so they stay hidden there. */
  const canCompare = dayCount >= 14;
  const dataReady = !isLoading && !headlineError && !!headline && canCompare;
  const totalIncomeNow = (headline?.serviceRevenue ?? 0) + (headline?.productSales ?? 0);
  const totalDelta =
    dataReady && previous
      ? compare(totalIncomeNow, previous.serviceRevenue + previous.productSales)
      : null;
  const revenueDelta = dataReady && previous ? compare(headline!.serviceRevenue, previous.serviceRevenue) : null;
  const salesDelta = dataReady && previous ? compare(headline!.productSales, previous.productSales) : null;
  // Profit is only comparable when both periods have cost prices entered.
  const profitDelta =
    dataReady && previous && headline!.hasCostData && previous.hasCostData
      ? compare(headline!.grossProfit, previous.grossProfit)
      : null;

  /* Shared helpers for the two exports. */
  const phpMoney = (n: number) =>
    `PHP ${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const noCostNote = (headline?.productSales ?? 0) > 0 && !headline?.hasCostData;

  // The exports also use the category breakdown, so wait for it too.
  const exportBlocked =
    isLoading || headlineError || !headline ||
    categoryLoading || categoryError || exporting !== null;
  const generatedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const exportPDF = async () => {
    if (!headline || exporting) return;
    setExporting("pdf");
    try {
      const { products, services, clinic } = await fetchExportData(startDate, endDate);
      const clinicName = clinic?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services";
      const contact = [clinic?.address, clinic?.phone_number, clinic?.email].filter(Boolean).join("  |  ");

      type RGB = [number, number, number];
      const TEAL: RGB = [14, 79, 69];
      const INK: RGB = [26, 26, 26];
      const GREY: RGB = [107, 107, 107];
      const RULE: RGB = [220, 220, 214];
      const doc = new jsPDF({ orientation: "portrait", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 15;
      const CW = W - M * 2;

      // Letterhead
      doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(...INK);
      doc.text(clinicName, W / 2, 20, { align: "center" });
      if (contact) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
        doc.text(contact, W / 2, 26, { align: "center", maxWidth: CW });
      }
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, 31, W - M, 31);

      // Title and report details
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
      doc.text("REPORT", M, 41);
      doc.setFont("times", "bold"); doc.setFontSize(22); doc.setTextColor(...TEAL);
      doc.text("Clinic report", M, 50);
      const kv = (label: string, value: string, y: number) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
        doc.text(value, W - M, y, { align: "right" });
        const vw = doc.getTextWidth(value);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
        doc.text(label, W - M - vw - 3, y, { align: "right" });
      };
      kv("Period", `${fmtDisplay(startDate)} to ${fmtDisplay(endDate)}`, 41);
      kv("Generated", generatedOn, 46.5);
      if (fullName) kv("Prepared by", fullName, 52);

      // Four headline figures
      const y0 = 58;
      const totalIncome = headline.serviceRevenue + headline.productSales;
      const stats: [string, string, string][] = [
        ["SERVICES REVENUE", phpMoney(headline.serviceRevenue), "Payments received"],
        ["PRODUCT SALES", phpMoney(headline.productSales), `Pet Essentials - ${headline.salesCount} sale${headline.salesCount === 1 ? "" : "s"}`],
        [
          "GROSS PROFIT",
          headline.hasCostData ? phpMoney(headline.grossProfit) : "Not entered",
          headline.hasCostData ? `${headline.margin}% margin on retail` : "Cost prices missing",
        ],
        ["TOTAL INCOME", phpMoney(totalIncome), "Services + products"],
      ];
      doc.setDrawColor(...TEAL); doc.setLineWidth(0.8); doc.line(M, y0, W - M, y0);
      const colW = CW / 4;
      stats.forEach(([label, value, caption], i) => {
        const x = M + i * colW + (i > 0 ? 4 : 0);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(label, x, y0 + 6);
        doc.setFontSize(12.5); doc.setTextColor(...(i === 3 ? TEAL : INK));
        doc.text(value, x, y0 + 14);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(caption, x, y0 + 19);
        if (i > 0) { doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M + i * colW, y0 + 3, M + i * colW, y0 + 21); }
      });
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, y0 + 24, W - M, y0 + 24);

      let y = y0 + 34;
      if (noCostNote) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(122, 84, 16);
        doc.text("Cost prices haven't been entered for these products, so gross profit can't be worked out yet.", M, y0 + 29);
        y += 3;
      }

      const base = {
        theme: "plain" as const,
        styles: {
          font: "helvetica", fontSize: 9.5, textColor: INK, lineColor: RULE,
          lineWidth: { bottom: 0.2 }, cellPadding: { top: 2.4, bottom: 2.4, left: 1.5, right: 1.5 },
        },
        headStyles: { textColor: GREY, fontStyle: "bold" as const, fontSize: 7.5, lineColor: RULE },
        margin: { left: M, right: M },
      };
      const totalRow = (hasTotal: boolean) => (data: any) => {
        if (!hasTotal || data.section !== "body") return;
        if (data.row.index === data.table.body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.lineColor = INK;
          data.cell.styles.lineWidth = { top: 0.6, bottom: 0 };
        }
      };
      const label = (text: string) => {
        if (y > H - 70) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(text.toUpperCase(), M, y);
        y += 2.5;
      };
      // A short grey note under a section heading.
      const note = (text: string) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
        const lines = doc.splitTextToSize(text, CW) as string[];
        doc.text(lines, M, y + 2);
        y += lines.length * 3.4 + 2;
      };
      const after = () => { y = (doc as any).lastAutoTable.finalY + 9; };

      // Services performed
      const serviceRows = [...services].sort((a, b) => b.revenue - a.revenue);
      const serviceTotal = serviceRows.reduce((t, r) => ({ count: t.count + r.count, revenue: t.revenue + r.revenue }), { count: 0, revenue: 0 });
      label("Services performed");
      note(SERVICES_NOTE);
      autoTable(doc, {
        ...base,
        startY: y,
        head: [["SERVICE", "TIMES", "REVENUE"]],
        body: serviceRows.length > 0
          ? [...serviceRows.map((r) => [r.name, String(r.count), phpMoney(r.revenue)]),
             ["Total", String(serviceTotal.count), phpMoney(serviceTotal.revenue)]]
          : [["No services billed in this period", "", ""]],
        columnStyles: { 1: { cellWidth: 30, halign: "right" }, 2: { cellWidth: 50, halign: "right" } },
        didParseCell: (d: any) => {
          if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
          totalRow(serviceRows.length > 0)(d);
        },
      });
      after();

      // Income by category, with a share bar
      label("Pet Essentials sales by category");
      const catCount = categoryEntries.length;
      autoTable(doc, {
        ...base,
        startY: y,
        head: [["CATEGORY", "AMOUNT", "SHARE", ""]],
        body: catCount > 0
          ? [...categoryEntries.map(([cat, amt], i) => [cat, phpMoney(amt), `${shares[i]}%`, ""]),
             ["Total", phpMoney(categoryTotal), "100%", ""]]
          : [["No revenue recorded in this period", "", "", ""]],
        columnStyles: {
          1: { cellWidth: 40, halign: "right" }, 2: { cellWidth: 22, halign: "right" }, 3: { cellWidth: 45 },
        },
        didParseCell: (d: any) => {
          if (d.section === "head" && (d.column.index === 1 || d.column.index === 2)) d.cell.styles.halign = "right";
          totalRow(catCount > 0)(d);
        },
        didDrawCell: (d: any) => {
          if (d.section !== "body" || d.column.index !== 3 || d.row.index >= catCount) return;
          const frac = categoryTotal > 0 ? categoryEntries[d.row.index][1] / categoryTotal : 0;
          const bx = d.cell.x + 3, bw = d.cell.width - 6, by = d.cell.y + d.cell.height / 2 - 1;
          doc.setFillColor(236, 234, 227); doc.rect(bx, by, bw, 2, "F");
          doc.setFillColor(...hexToRgb(categoryColor(categoryEntries[d.row.index][0]))); doc.rect(bx, by, Math.max(bw * frac, 0.6), 2, "F");
        },
      });
      after();

      // Most purchased products, by units sold
      const productRows = [...products].sort((a, b) => b.units - a.units || b.revenue - a.revenue);
      const productTotal = productRows.reduce(
        (t, p) => ({ units: t.units + p.units, sales: t.sales + p.sales, revenue: t.revenue + p.revenue }),
        { units: 0, sales: 0, revenue: 0 }
      );
      label("Most purchased - Pet Essentials, by units sold");
      autoTable(doc, {
        ...base,
        startY: y,
        head: [["PRODUCT", "UNITS", "SALES", "REVENUE"]],
        body: productRows.length > 0
          ? [...productRows.map((p) => [p.name, String(p.units), String(p.sales), phpMoney(p.revenue)]),
             ["Total", String(productTotal.units), String(productTotal.sales), phpMoney(productTotal.revenue)]]
          : [["No product sales in this period", "", "", ""]],
        columnStyles: {
          1: { cellWidth: 24, halign: "right" }, 2: { cellWidth: 24, halign: "right" }, 3: { cellWidth: 45, halign: "right" },
        },
        didParseCell: (d: any) => {
          if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
          totalRow(productRows.length > 0)(d);
        },
      });
      const endY = (doc as any).lastAutoTable.finalY;

      // Signature lines on the last page, then page footers on every page
      const sigY = H - 28;
      if (endY > sigY - 10) doc.addPage();
      doc.setPage(doc.getNumberOfPages());
      doc.setDrawColor(...INK); doc.setLineWidth(0.3);
      doc.line(M, sigY, M + 55, sigY); doc.line(M + 70, sigY, M + 125, sigY);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
      doc.text("Prepared by", M, sigY + 5); doc.text("Checked by", M + 70, sigY + 5);

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, H - 14, W - M, H - 14);
        doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont("helvetica", "normal");
        doc.text(clinicName, M, H - 9);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 9, { align: "right" });
      }
      doc.save(`pet-royale-report_${startDate}_to_${endDate}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the PDF. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const exportExcel = async () => {
    if (!headline || exporting) return;
    setExporting("excel");
    try {
      const { products, services, clinic, invoiceRows, saleRows } = await fetchExportData(startDate, endDate, true);
      const clinicName = clinic?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services";
      const MONEY = '"₱"#,##0.00';
      const PCT = '0.0"%"';
      const book = XLSX.utils.book_new();
      const setFmt = (sheet: any, r: number, c: number, z: string) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (sheet[ref] && typeof sheet[ref].v === "number") sheet[ref].z = z;
      };

      const TEAL = "0E4F45", INK = "1A1A1A", GRID = "D9D9D9";
      // Creates the cell if missing, so empty cells still get fill and borders.
      const paint = (sheet: any, r: number, c: number, st: Record<string, unknown>) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
        sheet[ref].s = st;
      };
      const styleTable = (sheet: any, headRow: number, lastRow: number, cols: number, numCols: number[], hasTotal: boolean) => {
        for (let c = 0; c < cols; c++) {
          paint(sheet, headRow, c, {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { patternType: "solid", fgColor: { rgb: TEAL } },
            alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
            border: { bottom: { style: "medium", color: { rgb: INK } } },
          });
        }
        for (let r = headRow + 1; r <= lastRow; r++) {
          const isTotal = hasTotal && r === lastRow;
          for (let c = 0; c < cols; c++) {
            paint(sheet, r, c, {
              font: { bold: isTotal },
              alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
              border: isTotal
                ? { top: { style: "medium", color: { rgb: INK } } }
                : { bottom: { style: "thin", color: { rgb: GRID } } },
            });
          }
        }
        const rows: any[] = sheet["!rows"] || [];
        rows[headRow] = { hpt: 22 };
        sheet["!rows"] = rows;
      };
      const freezeTop = (sheet: any) => {
        sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
      };

      // ── Summary ──
      // Row order after the "Figure" header: 0 service revenue, 1 product sales,
      // 2 total income, 3 number of sales, 4 cost of goods, 5 gross profit, 6 margin.
      const summaryRows: (string | number)[][] = [
        [clinicName],
        ["Clinic report"],
        ["Period", `${fmtDisplay(startDate)} to ${fmtDisplay(endDate)}`],
        ["Generated", generatedOn],
        ...(fullName ? [["Prepared by", fullName]] : []),
        [],
        ["Figure", "Amount"],
        ["Service revenue (payments received)", Number(headline.serviceRevenue.toFixed(2))],
        ["Product sales (Pet Essentials)", Number(headline.productSales.toFixed(2))],
        ["Total income (services + products)", Number((headline.serviceRevenue + headline.productSales).toFixed(2))],
        ["Number of product sales", headline.salesCount],
        ["Cost of goods sold", headline.hasCostData ? Number(headline.productCost.toFixed(2)) : "Not entered"],
        ["Gross profit on retail", headline.hasCostData ? Number(headline.grossProfit.toFixed(2)) : "Not available"],
        ["Gross margin on retail (%)", headline.hasCostData ? headline.margin : "Not available"],
        ...(noCostNote ? [[], ["Note", "Cost prices haven't been entered for these products, so gross profit can't be worked out yet."]] : []),
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 44 }, { wch: 26 }];
      const figureStart = summaryRows.findIndex((r) => r[0] === "Figure") + 1;
      [0, 1, 2, 4, 5].forEach((o) => setFmt(summarySheet, figureStart + o, 1, MONEY));
      setFmt(summarySheet, figureStart + 6, 1, PCT);
      styleTable(summarySheet, figureStart - 1, figureStart + 6, 2, [1], false);
      paint(summarySheet, 0, 0, { font: { bold: true, sz: 14 } });
      paint(summarySheet, 1, 0, { font: { bold: true, sz: 12, color: { rgb: TEAL } } });
      XLSX.utils.book_append_sheet(book, summarySheet, "Summary");

      // ── Pet Essentials: itemised, with a totals row ──
      const productList = [...products].sort((a, b) => b.revenue - a.revenue);
      const productTotals = productList.reduce(
        (a, p) => ({ units: a.units + p.units, sales: a.sales + p.sales, revenue: a.revenue + p.revenue, cost: a.cost + p.cost, profit: a.profit + p.profit }),
        { units: 0, sales: 0, revenue: 0, cost: 0, profit: 0 }
      );
      const anyProductCost = productList.some((p) => p.hasCost);
      const productRows: (string | number)[][] = [
        ["Product", "Units sold", "Sales", "Revenue", "Cost of goods sold", "Gross profit", "Gross margin (%)"],
        ...(productList.length > 0
          ? productList.map((p) => [
              p.name, p.units, p.sales, Number(p.revenue.toFixed(2)),
              p.hasCost ? Number(p.cost.toFixed(2)) : "No cost entered",
              p.hasCost ? Number(p.profit.toFixed(2)) : "—",
              p.hasCost ? p.margin : "—",
            ])
          : [["No product sales in this period", "", "", "", "", "", ""]]),
        ...(productList.length > 0 ? [[
          "TOTAL", productTotals.units, productTotals.sales, Number(productTotals.revenue.toFixed(2)),
          anyProductCost ? Number(productTotals.cost.toFixed(2)) : "—",
          anyProductCost ? Number(productTotals.profit.toFixed(2)) : "—",
          anyProductCost && productTotals.revenue > 0 ? Math.round((productTotals.profit / productTotals.revenue) * 1000) / 10 : "—",
        ]] : []),
      ];
      const productSheet = XLSX.utils.aoa_to_sheet(productRows);
      productSheet["!cols"] = [{ wch: 32 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
      for (let r = 1; r < productRows.length; r++) {
        [3, 4, 5].forEach((c) => setFmt(productSheet, r, c, MONEY));
        setFmt(productSheet, r, 6, PCT);
      }
      styleTable(productSheet, 0, productRows.length - 1, 7, [1, 2, 3, 4, 5, 6], productList.length > 0);
      freezeTop(productSheet);
      XLSX.utils.book_append_sheet(book, productSheet, "Pet Essentials");

      // ── Services: revenue only, no invented margin ──
      const serviceList = [...services].sort((a, b) => b.revenue - a.revenue);
      const serviceTotals = serviceList.reduce((a, s) => ({ count: a.count + s.count, revenue: a.revenue + s.revenue }), { count: 0, revenue: 0 });
      const serviceRows: (string | number)[][] = [
        ["Service", "Times performed", "Revenue"],
        ...(serviceList.length > 0
          ? [
              ...serviceList.map((s) => [s.name, s.count, Number(s.revenue.toFixed(2))]),
              ["TOTAL", serviceTotals.count, Number(serviceTotals.revenue.toFixed(2))],
            ]
          : [["No services billed in this period", "", ""]]),
      ];
      const serviceSheet = XLSX.utils.aoa_to_sheet(serviceRows);
      serviceSheet["!cols"] = [{ wch: 32 }, { wch: 16 }, { wch: 14 }];
      for (let r = 1; r < serviceRows.length; r++) setFmt(serviceSheet, r, 2, MONEY);
      styleTable(serviceSheet, 0, serviceRows.length - 1, 3, [1, 2], serviceList.length > 0);
      // Explain why this total can differ from Service revenue on the Summary.
      XLSX.utils.sheet_add_aoa(serviceSheet, [[SERVICES_NOTE]], { origin: { r: serviceRows.length + 1, c: 0 } });
      freezeTop(serviceSheet);
      XLSX.utils.book_append_sheet(book, serviceSheet, "Services");

      // ── Revenue by category: the on-screen category table as real rows ──
      const categoryRows: (string | number)[][] = [
        ["Category", "Revenue", "Share (%)"],
        ...(categoryEntries.length > 0
          ? [
              ...categoryEntries.map(([cat, amt], i) => [cat, Number(amt.toFixed(2)), shares[i]]),
              ["TOTAL", Number(categoryTotal.toFixed(2)), 100],
            ]
          : [["No revenue recorded in this period", "", ""]]),
      ];
      const categorySheet = XLSX.utils.aoa_to_sheet(categoryRows);
      categorySheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 11 }];
      for (let r = 1; r < categoryRows.length; r++) {
        setFmt(categorySheet, r, 1, MONEY);
        setFmt(categorySheet, r, 2, '0"%"');
      }
      styleTable(categorySheet, 0, categoryRows.length - 1, 3, [1, 2], categoryEntries.length > 0);
      freezeTop(categorySheet);
      XLSX.utils.book_append_sheet(book, categorySheet, "Revenue by category");

      // ── Invoices: one row per invoice paid in the period ──
      const hasInvoices = invoiceRows.length > 0;
      const invoiceTotal = invoiceRows.reduce((t, r) => t + r.total, 0);
      const invoiceSheetRows: (string | number)[][] = [
        ["Invoice", "Date paid", "Time paid", "Patient", "Owner", "Service", "Staff", "Total paid"],
        ...(hasInvoices
          ? [
              ...invoiceRows.map((r) => [
                `INV-${r.id.slice(0, 6).toUpperCase()}`, localDay(r.paidAt), localTime(r.paidAt),
                r.patient, r.owner, r.service, r.staff, Number(r.total.toFixed(2)),
              ]),
              ["TOTAL", "", "", "", "", "", "", Number(invoiceTotal.toFixed(2))],
            ]
          : [["No invoices paid in this period", "", "", "", "", "", "", ""]]),
      ];
      const invoiceSheet = XLSX.utils.aoa_to_sheet(invoiceSheetRows);
      invoiceSheet["!cols"] = [{ wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 14 }];
      for (let r = 1; r < invoiceSheetRows.length; r++) setFmt(invoiceSheet, r, 7, MONEY);
      styleTable(invoiceSheet, 0, invoiceSheetRows.length - 1, 8, [7], hasInvoices);
      freezeTop(invoiceSheet);
      XLSX.utils.book_append_sheet(book, invoiceSheet, "Invoices");

      // ── Product sales: one row per sale ──
      const hasSales = saleRows.length > 0;
      const saleQty = saleRows.reduce((t, r) => t + r.qty, 0);
      const saleTotal = saleRows.reduce((t, r) => t + r.total, 0);
      const saleSheetRows: (string | number)[][] = [
        ["Date", "Time", "Product", "Qty", "Unit price", "Total", "Sold by"],
        ...(hasSales
          ? [
              ...saleRows.map((r) => [
                localDay(r.soldAt), localTime(r.soldAt), r.product, r.qty,
                Number(r.unitPrice.toFixed(2)), Number(r.total.toFixed(2)), r.staff,
              ]),
              ["TOTAL", "", "", saleQty, "", Number(saleTotal.toFixed(2)), ""],
            ]
          : [["No product sales in this period", "", "", "", "", "", ""]]),
      ];
      const saleSheet = XLSX.utils.aoa_to_sheet(saleSheetRows);
      saleSheet["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
      for (let r = 1; r < saleSheetRows.length; r++) { setFmt(saleSheet, r, 4, MONEY); setFmt(saleSheet, r, 5, MONEY); }
      styleTable(saleSheet, 0, saleSheetRows.length - 1, 7, [3, 4, 5], hasSales);
      freezeTop(saleSheet);
      XLSX.utils.book_append_sheet(book, saleSheet, "Product sales");

      XLSX.writeFile(book, `pet-royale-report_${startDate}_to_${endDate}.xlsx`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the spreadsheet. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const cardsLoading = isLoading || headlineError;
  const subtitle = `${fmtDisplay(startDate)}${startDate !== endDate ? ` – ${fmtDisplay(endDate)}` : ""}`;

  return (
    <AdminLayout title="Reports" subtitle={subtitle}>
      <div className={PAGE_WRAP}>
        {/* ── Four figures in one strip. Services and Pet Essentials are kept
            apart, and Total income adds them, so no cell reads as the whole
            clinic when it isn't. Matches the PDF and Excel Summary. The 1px
            gap on the border-coloured background draws the dividers. ── */}
        <div className="grid gap-px border-b border-[hsl(var(--border))] bg-[hsl(var(--border))] sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total income"
            value={cardsLoading ? "—" : peso(totalIncomeNow)}
            caption="Services + Pet Essentials"
            delta={totalDelta}
          />
          <StatCard
            label="Service revenue"
            value={cardsLoading ? "—" : peso(headline?.serviceRevenue ?? 0)}
            caption="Payments received for services"
            delta={revenueDelta}
          />
          <StatCard
            label="Product sales"
            value={cardsLoading ? "—" : peso(headline?.productSales ?? 0)}
            caption={cardsLoading ? "" : `Pet Essentials · ${headline?.salesCount ?? 0} sale${headline?.salesCount === 1 ? "" : "s"}`}
            delta={salesDelta}
          />
          <StatCard
            label="Gross profit"
            value={cardsLoading ? "—" : peso(headline?.grossProfit ?? 0)}
            caption={
              cardsLoading ? ""
                : !headline?.productSales ? "No product sales in range"
                : headline?.hasCostData && !headline.missingCost ? `${headline.margin}% margin on retail`
                : headline?.hasCostData ? `${headline.missingCost} sold product${headline.missingCost === 1 ? "" : "s"} missing a cost price`
                : "Cost prices not entered yet — figure equals sales"
            }
            warn={!cardsLoading && (headline?.productSales ?? 0) > 0 && (!headline?.hasCostData || (headline?.missingCost ?? 0) > 0)}
            delta={profitDelta}
          />
        </div>

        {/* ── Date range, period tabs and Export, in one full-width row ── */}
        <div className={`${CARD} space-y-2 px-5 py-3 sm:px-6`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* The dates behind the chosen tab, first in the row, before Today. */}
            <span className="shrink-0 whitespace-nowrap text-[15px] font-bold text-[hsl(var(--foreground))]">
              {subtitle}
            </span>
            <div
              role="group"
              aria-label="Report period"
              className={SEG_TRACK}
            >
              {[...Object.keys(RANGES), "Custom"].map((r) => {
                const active = range === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRange(r);
                      setProductPage(1);
                      setServicePage(1);
                      if (r === "Custom") setRangeOpen(true);
                    }}
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
                onChange={(a, b) => { setCustomFrom(a); setCustomTo(b); setProductPage(1); setServicePage(1); }}
              />
            )}
            <div className="ml-auto shrink-0">
              <ExportMenu onExcel={exportExcel} onPdf={exportPDF} disabled={exportBlocked} busy={exporting} />
            </div>
          </div>

          {/* How long the period is, what it is compared with, and whether it
              is still open. The exports use the same dates, and their file
              names include them. */}
          <p className="text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]" aria-live="polite">
            {dayCount} day{dayCount === 1 ? "" : "s"}
            {stillOpen && " · includes today, so it isn't final yet"}
            {canCompare && <>{" · compared with "}{fmtDisplay(prevStart)} – {fmtDisplay(prevEnd)}</>}
          </p>
        </div>

        {headlineError && (
          <div className="flex items-start gap-3 border-b border-[hsl(15_72%_75%)] bg-[hsl(15_72%_95%)] px-5 py-3.5 sm:px-6">
            <CreditCard size={16} className="mt-0.5 shrink-0 text-[hsl(15_60%_38%)]" />
            <p className="text-xs leading-relaxed text-[hsl(15_60%_30%)]">
              Couldn&apos;t load revenue and sales figures for this period — the dashes above mean the
              data failed to load, not that nothing came in. Try again, or check the Supabase logs if
              this keeps happening.
            </p>
          </div>
        )}

        {/* Two columns from 1024px up: Revenue by service on the left, Most
            purchased and Revenue by category stacked on the right. No gap and
            no items-start, so the columns stretch and the divider lines up. */}
        <div className="grid lg:grid-cols-2">
          {/* ── Revenue by service: what the clinic's work earned ── */}
          <section className={`flex flex-col ${CARD} px-5 py-5 sm:px-6 lg:row-span-2 lg:border-r`}>
            <CardHeader title="Revenue by service" subtitle="Which services bring in the most" />
            {serviceError ? (
              <CardError what="service revenue" />
            ) : serviceLoading ? (
              <CardLoading />
            ) : serviceRows.length === 0 ? (
              <p className="py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No services billed in this period.
              </p>
            ) : (
              <div>
                <ul>
                  {serviceRowsPage.map((r, i) => {
                    // Shares were worked out over every service, so offset by the page.
                    const share = serviceShares[(serviceCurrentPage - 1) * SERVICES_PAGE_SIZE + i];
                    return (
                      <li key={r.name} className="border-t border-[hsl(var(--border)/.7)] py-3">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 line-clamp-2 break-words text-[14px] font-bold leading-snug" title={r.name}>{r.name}</span>
                          <span className="shrink-0 text-[14px] font-bold tabular-nums">{peso(r.revenue)}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                          <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${share}%` }} />
                        </div>
                        <p className="mt-1 text-[12.5px] tabular-nums text-[hsl(var(--muted-foreground))]">
                          Performed {r.count} time{r.count === 1 ? "" : "s"} · {share}% of services
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {serviceTotalPages > 1 && (
                  <div className="mb-3 flex items-center justify-between border-t border-[hsl(var(--border)/.7)] pt-4">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {serviceCurrentPage} / {serviceTotalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={serviceCurrentPage === 1}
                        onClick={() => setServicePage(serviceCurrentPage - 1)}
                        className={PAGER_BTN}
                      >
                        Previous
                      </button>
                      <button
                        disabled={serviceCurrentPage === serviceTotalPages}
                        onClick={() => setServicePage(serviceCurrentPage + 1)}
                        className={PAGER_BTN}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t-2 border-[hsl(var(--foreground))] pt-3.5 text-[14px] font-bold">
                  <span>Total</span>
                  <span className="tabular-nums">{peso(serviceTotal)}</span>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">{SERVICES_NOTE}</p>
              </div>
            )}
          </section>

          {/* ── Most purchased: top of the right column ── */}
          <section className={`${CARD} px-5 py-5 sm:px-6`}>
            <CardHeader title="Most purchased" subtitle="What to keep on the shelf, by units sold" />
            {topError ? (
              <CardError what="the most purchased products" />
            ) : topLoading ? (
              <CardLoading />
            ) : topProducts.length === 0 ? (
              <div className="py-14 text-center">
                <Package className="mx-auto text-[hsl(var(--muted-foreground))]" />
                <p className="mt-3 text-sm font-bold">No product sales in this range</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                  Sales recorded in Pet Essentials appear here.
                </p>
              </div>
            ) : (
              <>
                <ol className="divide-y divide-[hsl(var(--border)/.7)]">
                  {topProductsPage.map((p: any, i: number) => {
                    const max = topProducts[0].units || 1;
                    const rank = (productCurrentPage - 1) * TOP_PRODUCTS_PAGE_SIZE + i + 1;
                    const color = categoryColor(p.category || UNCATEGORISED);
                    return (
                      <li key={p.key} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#E8E8E4] text-[15px] font-bold text-[hsl(var(--foreground))]">
                          {rank}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="line-clamp-2 break-words text-[14px] font-bold leading-snug" title={p.name}>{p.name}</p>
                            <span className="shrink-0 text-sm font-bold tabular-nums">
                              {p.units}
                              <span className="ml-1 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                                {p.units === 1 ? "unit" : "units"}
                              </span>
                            </span>
                          </div>
                          <div className="mb-1.5 mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(p.units / max) * 100}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                          <p className="flex flex-wrap items-center gap-2 break-words text-[12.5px] leading-snug tabular-nums text-[hsl(var(--muted-foreground))]">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />
                            {p.category ? `${p.category} · ` : ""}{p.sales} sale{p.sales === 1 ? "" : "s"} · {peso(p.revenue)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {productTotalPages > 1 && (
                  <div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border)/.7)] pt-4">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {productCurrentPage} / {productTotalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={productCurrentPage === 1}
                        onClick={() => setProductPage(productCurrentPage - 1)}
                        className={PAGER_BTN}
                      >
                        Previous
                      </button>
                      <button
                        disabled={productCurrentPage === productTotalPages}
                        onClick={() => setProductPage(productCurrentPage + 1)}
                        className={PAGER_BTN}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── Revenue by category: product sales only ── */}
          <section className={`flex flex-col ${CARD} px-5 py-5 sm:px-6`}>
            <CardHeader title="Revenue by category" subtitle="Pet Essentials sales, by category" />
            {categoryError ? (
              <CardError what="category sales" />
            ) : categoryLoading ? (
              <CardLoading />
            ) : categoryTotal === 0 ? (
              <p className="py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No product sales recorded in this period.
              </p>
            ) : (
              <div>
                <div className="min-w-0">
                  <div className={`${LEGEND_GRID} pb-2.5 text-[12px] font-bold text-[hsl(var(--muted-foreground))]`}>
                    <span />
                    <span>Category</span>
                    <span className="text-right">Share</span>
                    <span className="text-right">Sales</span>
                  </div>
                  <ul>
                    {categoryEntries.map(([cat, amt], i) => (
                      <li key={cat} className={`${LEGEND_GRID} border-t border-[hsl(var(--border)/.7)] py-2.5`}>
                        <span className="h-3 w-3 rounded-[4px]" style={{ backgroundColor: categoryColor(cat) }} aria-hidden="true" />
                        <span className="min-w-0 break-words text-[14px] font-semibold leading-5">{cat}</span>
                        <span className="text-right text-[14px] font-bold tabular-nums">{shares[i]}%</span>
                        <span className="text-right text-[14px] tabular-nums">{peso(amt)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className={`${LEGEND_GRID} border-t-2 border-[hsl(var(--foreground))] pt-3.5 text-[14px] font-bold`}>
                    <span />
                    <span>Total</span>
                    <span className="text-right">100%</span>
                    <span className="text-right tabular-nums">{peso(categoryTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

        </div>
      </div>
    </AdminLayout>
  );
}
