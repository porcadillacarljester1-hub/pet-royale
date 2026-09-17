import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { fetchHistoryFeed, type HistoryRow, type HistoryType } from "@/api/history";
import {
  FileText, Calendar as CalendarIcon, ShoppingCart, Users, X,
  Download, Eye, Package, CalendarCheck, Loader2, RotateCcw,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

/* ── Palette ──────────────────────────────────────────────────────────
   Record type is a category, not a state — so it gets navy and greys.
   Green, amber and red are reserved for the Outcome column. */
const TEAL = "#0F766E";
const TEAL_WASH = "#F0FDFA";
const NAVY = "#1E3A5F";

const TYPE_ICONS: Record<HistoryType, React.ElementType> = {
  Appointment: CalendarCheck,
  Sale: ShoppingCart,
  Client: Users,
  Inventory: Package,
};

const TYPE_LABELS: Record<HistoryType, string> = {
  Appointment: "Appointment",
  Sale: "Product Sale",
  Client: "New Client",
  Inventory: "Stock Change",
};

const OUTCOME_STYLE: Record<string, { bg: string; fg: string }> = {
  Completed: { bg: "#ECFDF5", fg: "#047857" },
  Scheduled: { bg: "#FEF3C7", fg: "#B45309" },
  Cancelled: { bg: "#FEF2F2", fg: "#B91C1C" },
  Updated: { bg: "#EEF2F7", fg: NAVY },
};

const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity";
const BTN_GHOST = "inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors";
const BTN_QUIET = "inline-flex items-center justify-center h-9 px-4 rounded-lg text-sm font-semibold text-[#64748B] hover:bg-[#F1F5F9] transition-colors";

function toISO(d: Date) {
  // Local date parts — toISOString() converts to UTC, which shifts the
  // range start a day earlier at UTC+8.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDisplay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

function StatCard({
  icon: Icon, tint, label, value, sub,
}: { icon: React.ElementType; tint: { bg: string; fg: string }; label: string; value: number; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: tint.bg }}>
          <Icon className="w-4 h-4" style={{ color: tint.fg }} />
        </div>
        <p className="text-sm font-medium text-[#64748B] truncate">{label}</p>
      </div>
      <p className="font-sidebar font-bold text-[26px] leading-none" style={{ color: NAVY }}>{value.toLocaleString()}</p>
      <p className="text-xs text-[#94A3B8] mt-2">{sub}</p>
    </div>
  );
}

function exportCSV(rows: HistoryRow[]) {
  const header = ["Date", "Time", "Record Type", "Details", "Reference", "Outcome"];
  const lines = rows.map((r) => {
    const { date, time } = formatDateTime(r.date);
    return [date, time, TYPE_LABELS[r.type], `"${r.description.replace(/"/g, '""')}"`, r.reference, r.status].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pet-royale-history_${toISO(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function History() {
  const today = new Date();
  const monthAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);

  const [startDate, setStartDate] = useState(toISO(monthAgo));
  const [endDate, setEndDate] = useState(toISO(today));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get("type") as HistoryType) || "all";
  const [typeFilter, setTypeFilter] = useState<"all" | HistoryType>(initialType);
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<HistoryRow | null>(null);
  const PAGE_SIZE = 10;

  // The popover previously stayed open until you pressed Done — clicking
  // anywhere else left it hanging over the table.
  useEffect(() => {
    if (!showDatePicker) return;
    const onClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showDatePicker]);

  const { data: feed = [], isLoading } = useQuery({
    queryKey: ["history-feed", startDate, endDate],
    queryFn: () => fetchHistoryFeed(startDate, endDate),
  });

  const stats = {
    total: feed.length,
    appointments: feed.filter((r) => r.type === "Appointment").length,
    completed: feed.filter((r) => r.type === "Appointment" && r.status === "Completed").length,
    sales: feed.filter((r) => r.type === "Sale").length,
    clients: feed.filter((r) => r.type === "Client").length,
  };

  const filtered = typeFilter === "all" ? feed : feed.filter((r) => r.type === typeFilter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const isDefaultRange = startDate === toISO(monthAgo) && endDate === toISO(today);
  const hasFilters = typeFilter !== "all" || !isDefaultRange;

  const resetDateRange = () => {
    setStartDate(toISO(monthAgo));
    setEndDate(toISO(today));
    setPage(1);
  };
  const clearFilters = () => { setTypeFilter("all"); resetDateRange(); };

  const TYPE_TABS: { key: "all" | HistoryType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "Appointment", label: "Appointments" },
    { key: "Sale", label: "Sales" },
    { key: "Client", label: "Clients" },
    { key: "Inventory", label: "Stock" },
  ];

  return (
    <AdminLayout title="History" subtitle="A record of everything that has happened in the clinic.">
      <div className="bg-[#F8FAFC] min-h-full -m-6 p-6 sm:p-8">

        {/* Every card counts something within the selected range, so each
            subtitle says so rather than implying an all-time figure. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard icon={FileText} tint={{ bg: TEAL_WASH, fg: TEAL }} label="All Records" value={stats.total} sub="In the selected range" />
          <StatCard icon={CalendarCheck} tint={{ bg: "#EEF2F7", fg: NAVY }} label="Appointments" value={stats.appointments} sub="Booked, moved or cancelled" />
          <StatCard icon={CalendarCheck} tint={{ bg: "#ECFDF5", fg: "#047857" }} label="Services Done" value={stats.completed} sub="Appointments completed" />
          <StatCard icon={ShoppingCart} tint={{ bg: TEAL_WASH, fg: TEAL }} label="Product Sales" value={stats.sales} sub="Items sold to clients" />
          <StatCard icon={Users} tint={{ bg: "#EEF2F7", fg: NAVY }} label="New Clients" value={stats.clients} sub="Pet owners registered" />
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">

          {/* Toolbar: date range, type tabs, export */}
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-[#E2E8F0]">
            <div className="relative" ref={datePickerRef}>
              {/* Reset lives inside the date control now — it used to be a
                  separate button beside it, reading as two controls for
                  one thing. */}
              <div className="flex items-center h-9 rounded-lg border border-[#CBD5E1] bg-white overflow-hidden">
                <button
                  onClick={() => setShowDatePicker((v) => !v)}
                  className="inline-flex items-center gap-2 h-full px-3 text-sm hover:bg-[#F8FAFC] transition-colors whitespace-nowrap"
                  style={{ color: NAVY }}
                >
                  <CalendarIcon className="h-4 w-4 text-[#94A3B8]" />
                  {formatDisplay(startDate)} – {formatDisplay(endDate)}
                </button>
                {!isDefaultRange && (
                  <button
                    onClick={resetDateRange}
                    title="Reset to the last 30 days"
                    aria-label="Reset date range"
                    className="h-full px-2.5 border-l border-[#E2E8F0] text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#1E293B] transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {showDatePicker && (
                <div className="absolute z-30 top-11 left-0 bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-4 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-[#64748B] block mb-1.5">From</label>
                    <input
                      type="date" value={startDate} max={endDate}
                      onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                      className="h-9 text-sm border border-[#CBD5E1] rounded-lg px-2.5 outline-none focus:ring-2 focus:ring-[#0F766E]/20 focus:border-[#0F766E]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-[#64748B] block mb-1.5">To</label>
                    <input
                      type="date" value={endDate} min={startDate}
                      onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                      className="h-9 text-sm border border-[#CBD5E1] rounded-lg px-2.5 outline-none focus:ring-2 focus:ring-[#0F766E]/20 focus:border-[#0F766E]"
                    />
                  </div>
                  <button onClick={() => setShowDatePicker(false)} className={BTN_PRIMARY} style={{ backgroundColor: TEAL }}>Done</button>
                </div>
              )}
            </div>

            {/* Tabs rather than a dropdown: five options, and the counts
                make it obvious what's in the range before you filter. */}
            <div className="flex items-center gap-1 bg-[#F1F5F9] rounded-lg p-1 overflow-x-auto">
              {TYPE_TABS.map((t) => {
                const active = typeFilter === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setTypeFilter(t.key); setPage(1); }}
                    className="px-3 py-1.5 text-[13px] font-semibold rounded-md whitespace-nowrap transition-colors"
                    style={active
                      ? { backgroundColor: "#fff", color: NAVY, boxShadow: "0 1px 2px rgba(30,58,95,.1)" }
                      : { color: "#64748B" }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {hasFilters && <button onClick={clearFilters} className={BTN_QUIET}>Clear</button>}

            <button
              onClick={() => exportCSV(filtered)}
              disabled={filtered.length === 0}
              className={`${BTN_GHOST} ml-auto disabled:opacity-40`}
              style={{ color: NAVY }}
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: TEAL }} /></div>
          ) : pageRows.length === 0 ? (
            <div className="text-center py-20 px-6">
              <div className="w-12 h-12 rounded-full bg-[#F1F5F9] flex items-center justify-center mx-auto mb-3">
                <FileText className="w-5 h-5 text-[#94A3B8]" />
              </div>
              <p className="text-sm font-semibold" style={{ color: NAVY }}>
                {hasFilters ? "No records match these filters" : "Nothing recorded in this period"}
              </p>
              <p className="text-xs text-[#94A3B8] mt-1.5 max-w-[300px] mx-auto leading-relaxed">
                {hasFilters
                  ? "Try a different record type, or widen the date range."
                  : "Activity appears here as appointments, sales and stock changes happen."}
              </p>
              {hasFilters && (
                <button onClick={clearFilters} className={`${BTN_GHOST} mt-4`} style={{ color: NAVY }}>Clear filters</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse table-fixed min-w-[860px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                    <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] pl-5 pr-3 py-3 w-[130px]">When</th>
                    <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] px-3 py-3 w-[150px]">Record type</th>
                    <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] px-3 py-3">What happened</th>
                    <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] px-3 py-3 w-[125px]">Reference</th>
                    <th scope="col" className="text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] px-3 py-3 w-[115px]">Outcome</th>
                    <th scope="col" className="text-right text-[11px] font-bold uppercase tracking-wider text-[#64748B] pl-3 pr-5 py-3 w-[70px]">View</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const { date, time } = formatDateTime(r.date);
                    const Icon = TYPE_ICONS[r.type];
                    const outcome = OUTCOME_STYLE[r.status] || OUTCOME_STYLE.Updated;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedRow(r)}
                        className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                      >
                        <td className="pl-5 pr-3 py-3.5 whitespace-nowrap">
                          <p className="font-medium" style={{ color: NAVY }}>{date}</p>
                          <p className="text-xs text-[#94A3B8] mt-0.5">{time}</p>
                        </td>

                        <td className="px-3 py-3.5">
                          {/* One neutral treatment. Record type is a
                              category, not a state — it had five hues,
                              including the old primary purple. */}
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] whitespace-nowrap">
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            {TYPE_LABELS[r.type]}
                          </span>
                        </td>

                        <td className="px-3 py-3.5 text-[#1E293B]">{r.description}</td>

                        <td className="px-3 py-3.5 text-[#94A3B8] font-mono text-xs truncate">{r.reference}</td>

                        <td className="px-3 py-3.5">
                          <span
                            className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: outcome.bg, color: outcome.fg }}
                          >
                            {r.status}
                          </span>
                        </td>

                        <td className="pl-3 pr-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedRow(r)}
                            title="View full details"
                            aria-label={`View details for ${r.reference}`}
                            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[#94A3B8] hover:bg-[#F0FDFA] hover:text-[#0F766E] transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pageRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-[#E2E8F0]">
              <p className="text-xs text-[#64748B]">
                Showing <span className="font-semibold" style={{ color: NAVY }}>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}
                </span> of {filtered.length} record{filtered.length === 1 ? "" : "s"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="h-8 px-3 rounded-lg border border-[#E2E8F0] text-xs font-semibold disabled:opacity-30 hover:bg-[#F8FAFC] transition-colors"
                  style={{ color: NAVY }}
                >
                  Previous
                </button>
                <span className="text-xs font-semibold px-1" style={{ color: NAVY }}>Page {page} of {totalPages}</span>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 px-3 rounded-lg border border-[#E2E8F0] text-xs font-semibold disabled:opacity-30 hover:bg-[#F8FAFC] transition-colors"
                  style={{ color: NAVY }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedRow && <HistoryDetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </AdminLayout>
  );
}

function HistoryDetailPanel({ row, onClose }: { row: HistoryRow; onClose: () => void }) {
  const { date, time } = formatDateTime(row.date);
  const raw = row.raw || {};
  const Icon = TYPE_ICONS[row.type];
  const outcome = OUTCOME_STYLE[row.status] || OUTCOME_STYLE.Updated;

  // Close on Escape — the panel could only be dismissed by clicking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fields: { label: string; value: string }[] = [];

  if (row.type === "Client") {
    fields.push(
      { label: "Full name", value: raw.name || "—" },
      { label: "Email", value: raw.email || "—" },
      { label: "Phone", value: raw.phone || "—" },
    );
  } else if (row.type === "Appointment") {
    // requested_date is the real appointment date — it's what the calendar
    // reads and what rescheduling writes. scheduled_date is NOT a
    // schedule: completeAppointment() sets it to the moment the visit was
    // marked done, so it appears as "Completed on" and only when it applies.
    fields.push(
      { label: "Pet", value: `${raw.pet_name || "—"} (${raw.pet_species || "—"})` },
      { label: "Pet owner", value: raw.client_name || "—" },
      { label: "Service", value: raw.service || "—" },
      {
        label: "Appointment date",
        value: raw.requested_date
          ? `${formatDisplay(raw.requested_date)}${raw.scheduled_time ? ` · ${raw.scheduled_time}` : ""}`
          : "—",
      },
    );
    if (raw.status === "completed" && raw.scheduled_date) {
      fields.push({ label: "Completed on", value: formatDisplay(raw.scheduled_date.slice(0, 10)) });
    }
  } else if (row.type === "Sale") {
    fields.push(
      { label: "Product", value: raw.product_name || "—" },
      { label: "Quantity sold", value: String(raw.quantity ?? "—") },
      { label: "Total amount", value: raw.total_amount != null ? `₱${Number(raw.total_amount).toLocaleString()}` : "—" },
      { label: "Sold on", value: `${date} · ${time}` },
    );
  } else if (row.type === "Inventory") {
    fields.push(
      { label: "Item", value: raw.item_name || "—" },
      { label: "Stock change", value: raw.change_amount > 0 ? `+${raw.change_amount}` : String(raw.change_amount) },
      { label: "Comes from", value: raw.source_table === "products" ? "Pet Essentials" : "Clinic Stocks" },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-[#1E3A5F]/20"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${TYPE_LABELS[row.type]} details`}
    >
      {/* A panel sized to its content rather than a full-height drawer for
          four fields. Still anchored right, with margin so it reads as a
          card rather than an edge-to-edge sheet. */}
      <div
        className="bg-white w-full sm:max-w-md sm:m-4 sm:rounded-xl shadow-xl max-h-full sm:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-5 border-b border-[#E2E8F0] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569]">
                <Icon className="w-3.5 h-3.5" /> {TYPE_LABELS[row.type]}
              </span>
              <span
                className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: outcome.bg, color: outcome.fg }}
              >
                {row.status}
              </span>
            </div>
            <p className="text-[15px] font-semibold leading-snug" style={{ color: NAVY }}>{row.description}</p>
            <p className="text-xs text-[#94A3B8] mt-1.5">{date} · {time}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-[#F1F5F9] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          <dl>
            {fields.map((f) => (
              <div key={f.label} className="flex items-start justify-between gap-4 text-sm py-3 border-b border-[#F1F5F9] last:border-0">
                <dt className="text-[#64748B] shrink-0">{f.label}</dt>
                <dd className="font-medium text-right" style={{ color: NAVY }}>{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] mb-1.5">Reference number</p>
            <p className="text-sm text-[#475569] font-mono">{row.reference}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
