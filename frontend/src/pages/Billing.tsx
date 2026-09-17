import { useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Search, ListFilter, X, Check, Loader2, WalletCards, ReceiptText,
  CircleDollarSign, CheckCircle2, ChevronRight,
  Banknote, Wallet, CalendarDays, Download,
} from "lucide-react";

/* ── Status ───────────────────────────────────────────────────────── */
const PILL: Record<string, string> = {
  "Fully Paid": "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]",
  "Partially Paid": "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  "Awaiting Payment": "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]",
};

const STATUSES = ["Awaiting Payment", "Partially Paid", "Fully Paid"] as const;

/* Every payment is taken at the clinic — there's no online deposit, so
   `method` is always null and there's nothing to filter or display. */

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill ${PILL[status] ?? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString()}`;

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}



/* Ranges computed fresh on each call, not once at module load — a tab
   left open overnight would otherwise still think "Today" is yesterday. */
const RANGES: Record<string, () => { from: string; to: string } | null> = {
  "All time": () => null,
  Today: () => {
    const n = new Date();
    return { from: toLocalISO(n), to: toLocalISO(n) };
  },
  "This week": () => {
    const n = new Date();
    const from = new Date(n);
    // Week starts Monday: getDay() is 0 on Sunday, which is day 7 here.
    from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
    return { from: toLocalISO(from), to: toLocalISO(n) };
  },
  "This month": () => {
    const n = new Date();
    return { from: toLocalISO(new Date(n.getFullYear(), n.getMonth(), 1)), to: toLocalISO(n) };
  },
  "This year": () => {
    const n = new Date();
    return { from: toLocalISO(new Date(n.getFullYear(), 0, 1)), to: toLocalISO(n) };
  },
  Custom: () => null,
};

interface InvoiceRow {
  id: string;
  total: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  pet_name: string;
  client_name: string;
  service: string;
  items: { id: string; service_name: string; quantity: number; unit_price: number; subtotal: number }[];
  payments: { id: string; amount: number; kind: string; method: string | null; paid_at: string; recorded_by: string | null }[];
  totalPaid: number;
  balance: number;
}

async function fetchBilling(): Promise<InvoiceRow[]> {
  const { data: invoices, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!invoices?.length) return [];

  const invoiceIds = invoices.map((i: any) => i.id);
  const appointmentIds = [...new Set(invoices.map((i: any) => i.appointment_id).filter(Boolean))];

  const [itemsRes, paymentsRes, apptRes] = await Promise.all([
    (supabase as any).from("invoice_items").select("*").in("invoice_id", invoiceIds),
    (supabase as any).from("payments").select("*").in("invoice_id", invoiceIds).order("paid_at", { ascending: true }),
    appointmentIds.length
      ? (supabase as any).from("appointments").select("id, pet_name, client_name, service").in("id", appointmentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const apptMap = new Map((apptRes.data || []).map((a: any) => [a.id, a]));

  return invoices.map((inv: any) => {
    const appt: any = apptMap.get(inv.appointment_id);
    const payments = (paymentsRes.data || [])
      .filter((p: any) => p.invoice_id === inv.id)
      .map((p: any) => ({ ...p, amount: Number(p.amount) }));

    const total = Number(inv.total_amount || 0);
    const totalPaid = payments.reduce((s: number, p: any) => s + p.amount, 0);
    return {
      id: inv.id,
      total,
      status: inv.status,
      created_at: inv.created_at,
      paid_at: inv.paid_at,
      pet_name: appt?.pet_name || "—",
      client_name: appt?.client_name || "—",
      service: appt?.service || "—",
      items: (itemsRes.data || [])
        .filter((it: any) => it.invoice_id === inv.id)
        .map((it: any) => ({
          id: it.id, service_name: it.service_name, quantity: it.quantity,
          unit_price: Number(it.unit_price), subtotal: Number(it.subtotal),
        })),
      payments,
      totalPaid,
      balance: Math.max(0, total - totalPaid),
    };
  });
}


/* Excel rather than CSV.

   CSV is plain text — it carries no column widths and no bold, so every
   export opened with squeezed columns that had to be dragged out by
   hand. An .xlsx file carries both, so it opens ready to read.

   Requires: npm install xlsx

   Exports what's on screen, so filters carry through. */
function exportSpreadsheet(rows: InvoiceRow[], rangeLabel: string) {
  const header = [
    "Invoice", "Patient", "Owner", "Service", "Date raised",
    "Total", "Total paid", "Balance", "Status", "Date settled",
  ];

  const body = rows.map((i) => [
    `INV-${i.id.slice(0, 6).toUpperCase()}`,
    i.pet_name,
    i.client_name,
    i.service,
    i.created_at.slice(0, 10),
    // Numbers, not strings — an accountant needs to sum the column, and
    // "₱1,250.00" doesn't add up.
    Number(i.total.toFixed(2)),
    Number(i.totalPaid.toFixed(2)),
    Number(i.balance.toFixed(2)),
    i.status,
    i.paid_at ? i.paid_at.slice(0, 10) : "",
  ]);

  const totals = [
    "", "", "", "", "TOTAL",
    Number(rows.reduce((s, i) => s + i.total, 0).toFixed(2)),
    Number(rows.reduce((s, i) => s + i.totalPaid, 0).toFixed(2)),
    Number(rows.reduce((s, i) => s + i.balance, 0).toFixed(2)),
    "", "",
  ];

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body, [], totals]);

  // Column widths, so nothing needs dragging open.
  sheet["!cols"] = [
    { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 24 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 },
  ];

  // Bold the header row and the totals line.
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  const totalsRow = body.length + 2;
  for (let c = range.s.c; c <= range.e.c; c++) {
    for (const r of [0, totalsRow]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!sheet[ref]) continue;
      sheet[ref].s = {
        font: { bold: true },
        fill: r === 0 ? { fgColor: { rgb: "0E4F45" } } : undefined,
        alignment: { vertical: "center" },
      };
      if (r === 0) sheet[ref].s.font = { bold: true, color: { rgb: "FFFFFF" } };
    }
  }

  // Peso format on the money columns, so they read as currency and
  // still sum correctly.
  const moneyCols = [5, 6, 7];
  for (let r = 1; r <= totalsRow; r++) {
    for (const c of moneyCols) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (sheet[ref] && typeof sheet[ref].v === "number") {
        sheet[ref].z = '"₱"#,##0.00';
      }
    }
  }

  // Freeze the header so it stays put when scrolling a long list.
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Invoices");
  XLSX.writeFile(book, `pet-royale-invoices_${rangeLabel}_${toLocalISO(new Date())}.xlsx`);
}

const PAGE_SIZE = 12;

function StatCard({
  label, value, caption, icon: Icon, accent, delay, active, onClick,
}: {
  label: string; value: string; caption: string; icon: React.ElementType;
  accent: string; delay?: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`workspace-card workspace-rise ${delay ?? ""} rounded-[24px] p-5 text-left transition ${
        onClick ? "hover:-translate-y-0.5" : ""
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
      <p className="mt-5 text-[26px] font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{caption}</p>
    </button>
  );
}

export default function Billing() {
  const queryClient = useQueryClient();
  const { data: invoices = [], isLoading } = useQuery({ queryKey: ["billing"], queryFn: fetchBilling });

  const [query, setQuery] = useState("");
  const [range, setRange] = useState("All time");
  const [customFrom, setCustomFrom] = useState(toLocalISO(new Date()));
  const [customTo, setCustomTo] = useState(toLocalISO(new Date()));
  const [status, setStatus] = useState("All payment statuses");
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [page, setPage] = useState(1);

  const todayStr = toLocalISO(new Date());

  const bounds = useMemo(() => {
    if (range === "Custom") return { from: customFrom, to: customTo };
    return RANGES[range]?.() ?? null;
  }, [range, customFrom, customTo]);

  /* Operational figures, scoped to today and to what's outstanding.
     Period totals live on Reports — having both screens report a
     "Total revenue" over different ranges meant two numbers with the
     same name that never agreed. */
  const stats = useMemo(() => {
    const todayPayments = invoices.flatMap((i) =>
      i.payments.filter((p) => p.paid_at?.startsWith(todayStr))
    );
    const awaiting = invoices.filter((i) => i.status === "Awaiting Payment");
    const partial = invoices.filter((i) => i.status === "Partially Paid");
    const paidToday = invoices.filter((i) => i.paid_at?.startsWith(todayStr));

    return {
      todayRevenue: todayPayments.reduce((s, p) => s + p.amount, 0),
      todayCount: todayPayments.length,
      awaitingCount: awaiting.length,
      awaitingTotal: awaiting.reduce((s, i) => s + i.balance, 0),
      partialCount: partial.length,
      partialTotal: partial.reduce((s, i) => s + i.balance, 0),
      settledToday: paidToday.length,
    };
  }, [invoices, todayStr]);

  const visible = invoices.filter((i) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q ||
      i.pet_name.toLowerCase().includes(q) ||
      i.client_name.toLowerCase().includes(q) ||
      i.id.slice(0, 6).toLowerCase().includes(q);
    // An invoice counts if it was raised in the range or paid in it —
    // a balance settled this week on last month's invoice is this
    // week's business.
    const matchesDate = !bounds || (() => {
      const inRange = (iso?: string | null) =>
        !!iso && iso.slice(0, 10) >= bounds.from && iso.slice(0, 10) <= bounds.to;
      return inRange(i.created_at) || i.payments.some((p) => inRange(p.paid_at));
    })();
    const matchesStatus = status === "All payment statuses" || i.status === status;
    return matchesQuery && matchesDate && matchesStatus;
  });

  const hasFilters = !!query || range !== "All time" || status !== "All payment statuses";

  const clearFilters = () => {
    setQuery(""); setRange("All time"); setStatus("All payment statuses");
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Clamp rather than reset: narrowing a filter while on page 4 would
  // otherwise leave an empty table with no obvious way back.
  const currentPage = Math.min(page, totalPages);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
  };

  return (
    <AdminLayout
      title="Billing"
      eyebrow="Invoices, payments and remaining balances"
      actions={
        <button
          onClick={() => exportSpreadsheet(visible, range.replace(/\s+/g, "-").toLowerCase())}
          disabled={visible.length === 0}
          title="Exports the invoices currently shown, as an Excel file"
          className="flex h-9 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          <Download size={15} /> Export
        </button>
      }
    >
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* ── Today, and what needs chasing ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Received today" value={isLoading ? "—" : pesoShort(stats.todayRevenue)}
            caption={isLoading ? "" : `${stats.todayCount} payment${stats.todayCount === 1 ? "" : "s"}`}
            icon={WalletCards} accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
          />
          <StatCard
            label="Awaiting payment" value={isLoading ? "—" : String(stats.awaitingCount)}
            caption={isLoading ? "" : `${pesoShort(stats.awaitingTotal)} not yet received`}
            icon={ReceiptText} accent="bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]"
            delay="workspace-rise-1"
            active={status === "Awaiting Payment"}
            onClick={() => setStatus(status === "Awaiting Payment" ? "All payment statuses" : "Awaiting Payment")}
          />
          <StatCard
            label="Part paid" value={isLoading ? "—" : String(stats.partialCount)}
            caption={isLoading ? "" : `${pesoShort(stats.partialTotal)} still owed`}
            icon={CircleDollarSign} accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
            delay="workspace-rise-2"
            active={status === "Partially Paid"}
            onClick={() => setStatus(status === "Partially Paid" ? "All payment statuses" : "Partially Paid")}
          />
          <StatCard
            label="Settled today" value={isLoading ? "—" : String(stats.settledToday)}
            caption="Invoices closed today"
            icon={CheckCircle2} accent="bg-[hsl(200_30%_88%)] text-[hsl(200_40%_31%)]"
            delay="workspace-rise-3"
          />
        </div>

        {/* ── Search and filters ── */}
        <div className="workspace-card flex flex-col gap-3 rounded-[24px] p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search invoice, patient or owner…"
              className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-3 text-sm"
            />
          </div>

          {/* Named ranges rather than a single date — invoices are
              reviewed by period, and picking one day at a time meant
              stepping through a month to see it. */}
          <select
            value={range}
            onChange={(e) => { setRange(e.target.value); setPage(1); }}
            aria-label="Filter by period"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            {Object.keys(RANGES).map((r) => <option key={r}>{r}</option>)}
          </select>

          <select
            value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by payment status"
            className="h-11 shrink-0 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-xs font-semibold"
          >
            <option>All payment statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>

          <span className="flex shrink-0 items-center gap-2 px-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <ListFilter size={15} />
            {visible.length} shown
          </span>
        </div>

        {range === "Custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                From
              </label>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => { if (e.target.value) { setCustomFrom(e.target.value); setPage(1); } }}
                aria-label="Period start"
                className="h-10 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-xs font-semibold"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                To
              </label>
              {/* min and max reference each other, so the range can't be
                  inverted and there's no error state to handle. */}
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => { if (e.target.value) { setCustomTo(e.target.value); setPage(1); } }}
                aria-label="Period end"
                className="h-10 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-xs font-semibold"
              />
            </div>
          </div>
        )}

        {/* ── Table ──
            Six columns. Patient and owner share a cell rather than
            taking two columns of names, which was most of the
            horizontal overflow. */}
        <div className="workspace-card overflow-hidden rounded-[26px]">
          <div className="hidden grid-cols-[100px_minmax(0,1.6fr)_110px_110px_110px_130px_36px] gap-4 border-b border-[hsl(var(--border)/.7)] px-6 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] lg:grid">
            <span>Invoice</span>
            <span>Patient</span>
            <span className="text-right">Total</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Balance</span>
            <span>Status</span>
            <span />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-14 text-center">
              <WalletCards className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">
                {invoices.length === 0 ? "No invoices yet" : "Nothing matches these filters"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">
                {invoices.length === 0
                  ? "Bill a confirmed appointment to create the first one."
                  : "Try a different search, date, method or status."}
              </p>
              {hasFilters && invoices.length > 0 && (
                <button
                  onClick={clearFilters}
                  className="mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
                >
                  <X size={14} /> Clear filters
                </button>
              )}
            </div>
          ) : (
            pageRows.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setSelected(inv)}
                className="grid w-full gap-2 border-b border-[hsl(var(--border)/.55)] px-5 py-4 text-left transition last:border-0 hover:bg-[hsl(var(--muted)/.35)] lg:grid-cols-[100px_minmax(0,1.6fr)_110px_110px_110px_130px_36px] lg:items-center lg:gap-4 lg:px-6"
              >
                <p className="font-mono text-[11px] font-bold tracking-tight">
                  {inv.id.slice(0, 6).toUpperCase()}
                </p>

                {/* Patient and owner stacked — two columns of names was
                    most of the horizontal overflow. */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{inv.pet_name}</p>
                  <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                    {inv.client_name} · {inv.service}
                  </p>
                </div>

                <p className="text-xs font-semibold lg:text-right">{peso(inv.total)}</p>

                <p className="text-xs lg:text-right">
                  {inv.totalPaid > 0
                    ? peso(inv.totalPaid)
                    : <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                </p>

                <p className={`text-xs font-bold lg:text-right ${
                  inv.balance > 0 ? "text-[hsl(15_60%_38%)]" : "text-[hsl(145_42%_27%)]"
                }`}>
                  {peso(inv.balance)}
                </p>

                <div><StatusPill status={inv.status} /></div>

                <ChevronRight size={16} className="hidden text-[hsl(var(--muted-foreground))] lg:block" />
              </button>
            ))
          )}

          {visible.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)}
                </strong> of {visible.length}
                {visible.length !== invoices.length && ` filtered from ${invoices.length}`}
              </p>

              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                    className="h-8 rounded-xl border border-[hsl(var(--border))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))] disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <span className="px-1 text-xs font-bold">{currentPage} / {totalPages}</span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className="h-8 rounded-xl border border-[hsl(var(--border))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))] disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <InvoiceDetail
          invoice={selected}
          onClose={() => setSelected(null)}
          onRecordPayment={() => { setPayFor(selected); setSelected(null); }}
        />
      )}

      {payFor && (
        <PaymentForm
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); refresh(); }}
        />
      )}
    </AdminLayout>
  );
}

/* ══════════════════ Invoice detail ══════════════════ */

function InvoiceDetail({
  invoice, onClose, onRecordPayment,
}: { invoice: InvoiceRow; onClose: () => void; onRecordPayment: () => void }) {
  const settled = invoice.balance <= 0.01;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="workspace-card workspace-scroll h-full w-full max-w-[520px] overflow-y-auto p-6 sm:p-8">

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              Invoice
            </p>
            <h2 className="display-face mt-1 text-[32px] leading-none">
              INV-{invoice.id.slice(0, 6).toUpperCase()}
            </h2>
            <p className="mt-2 truncate text-sm text-[hsl(var(--muted-foreground))]">
              {invoice.pet_name} · {invoice.client_name}
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

        <section className="mt-8 border-t border-[hsl(var(--border)/.7)] pt-6">
          <h3 className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">
            Services
          </h3>
          {invoice.items.length === 0 ? (
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              No line items on this invoice.
            </p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {invoice.items.map((item) => (
                <div key={item.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate">
                    {item.service_name}
                    {item.quantity > 1 && (
                      <span className="text-[hsl(var(--muted-foreground))]"> × {item.quantity}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold">{peso(item.subtotal)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between border-t border-[hsl(var(--border)/.7)] pt-4">
            <span className="text-sm font-bold">Total</span>
            <span className="text-lg font-bold tracking-[-.03em]">{peso(invoice.total)}</span>
          </div>
        </section>

        <section className="mt-7 border-t border-[hsl(var(--border)/.7)] pt-6">
          <h3 className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">
            Payment
          </h3>

          {invoice.payments.length === 0 ? (
            <p className="mt-3 rounded-xl bg-[hsl(var(--muted)/.6)] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
              Nothing received yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {invoice.payments.map((p) => {
                return (
                  <div key={p.id} className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted)/.8)] text-[hsl(var(--primary))]">
                        {p.kind === "reservation"
                          ? <Wallet size={14} />
                          : <Banknote size={14} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold">
                          {p.kind === "reservation" ? "Reservation deposit" : "Paid at the clinic"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                          {p.kind === "reservation" && p.method ? `${p.method} · ` : ""}
                          {fmtDate(p.paid_at)}
                          {p.recorded_by && ` · ${p.recorded_by}`}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">{peso(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 space-y-2 border-t border-[hsl(var(--border)/.7)] pt-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">Total paid</span>
              <span className="font-semibold">{peso(invoice.totalPaid)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">Remaining balance</span>
              <span className={`text-lg font-bold tracking-[-.03em] ${
                settled ? "text-[hsl(145_42%_27%)]" : "text-[hsl(15_60%_38%)]"
              }`}>
                {peso(invoice.balance)}
              </span>
            </div>
          </div>
        </section>

        <div className={`mt-7 flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold ${
          settled
            ? "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
            : invoice.totalPaid > 0
              ? "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
              : "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]"
        }`}>
          {settled && <Check size={17} />}
          {settled ? "Paid in full" : invoice.totalPaid > 0 ? "Partly paid" : "Unpaid"}
        </div>

        {!settled && (
          <button
            onClick={onRecordPayment}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]"
          >
            <Banknote size={17} /> Record payment
          </button>
        )}

      </div>
    </div>
  );
}

/* ══════════════════ Record a payment ══════════════════ */

const FIELD = "h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm";
const LABEL = "mb-2 block text-[13px] font-bold";

function PaymentForm({
  invoice, onClose, onSaved,
}: { invoice: InvoiceRow; onClose: () => void; onSaved: () => void }) {
  const fullName = useAdminStore((s) => s.fullName);

  const [amount, setAmount] = useState(invoice.balance.toFixed(2));
  const [date, setDate] = useState(toLocalISO(new Date()));
  const [saving, setSaving] = useState(false);

  const value = parseFloat(amount) || 0;
  const overpaying = value > invoice.balance + 0.01;
  const remaining = Math.max(0, invoice.balance - value);

  const save = async () => {
    if (value <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (overpaying) { toast.error(`That's more than the ${peso(invoice.balance)} outstanding.`); return; }

    setSaving(true);
    try {
      const { error } = await (supabase as any).from("payments").insert([{
        invoice_id: invoice.id,
        amount: value,
        kind: "balance",
        // Null by constraint — a balance is settled at the clinic, and
        // how isn't recorded. Sending "Cash" here violates the check.
        method: null,
        paid_at: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        recorded_by: fullName || null,
      }]);
      if (error) throw error;
      // Invoice status and paid_at are set by a trigger.
      toast.success(remaining <= 0.01 ? "Invoice paid in full." : `${peso(value)} recorded.`);
      onSaved();
    } catch {
      toast.error("Couldn't save that payment.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="workspace-card max-w-[440px] rounded-[28px] border-0 p-7 [&>button]:hidden">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              In-clinic payment
            </p>
            <h2 className="display-face text-[30px] leading-none">
              INV-{invoice.id.slice(0, 6).toUpperCase()}
            </h2>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {invoice.pet_name} · {invoice.client_name}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-5 flex items-baseline justify-between rounded-2xl bg-[hsl(var(--muted)/.65)] px-4 py-3.5">
          <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Balance owing</span>
          <span className="text-lg font-bold tracking-[-.03em]">{peso(invoice.balance)}</span>
        </div>

        <div className="space-y-4">
          <div>
            <label className={LABEL}>Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-[hsl(var(--muted-foreground))]">₱</span>
              <input
                type="number" step="0.01" min="0" max={invoice.balance}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className={`${FIELD} pl-7 ${overpaying ? "border-[hsl(var(--destructive))]" : ""}`}
                autoFocus
              />
            </div>
            {/* Fixed-height slot, so the line appearing doesn't shift
                the button under a cursor already moving to it. */}
            <div className="min-h-[20px] pt-1.5">
              {overpaying ? (
                <p className="text-[11px] text-[hsl(var(--destructive))]">
                  More than the {peso(invoice.balance)} owing.
                </p>
              ) : value > 0 && remaining > 0.01 ? (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {peso(remaining)} left after this.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label className={LABEL}>Date</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={15} />
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className={`${FIELD} pl-9`}
              />
            </div>
          </div>
        </div>

        <div className="mt-7 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || overpaying || value <= 0}
            className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save payment"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
