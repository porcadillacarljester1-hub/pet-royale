import { useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchRevenueByCategoryFull } from "@/api/reports";
import jsPDF from "jspdf";
// jspdf-autotable v4+ no longer patches autoTable onto the jsPDF
// instance — it must be imported and called as a function.
import autoTable from "jspdf-autotable";
import {
  CalendarDays, Download, Loader2, WalletCards, CreditCard,
  ShoppingBag, TrendingUp, Package,
} from "lucide-react";

const peso = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString()}`;

/* Local date parts — toISOString() converts to UTC, which shifts the
   range start a day earlier at UTC+8. */
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDisplay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* One query for the headline figures.

   Service revenue counts payments received, not invoices marked paid —
   a balance settled today on last month's invoice is this period's
   money. With the clinic's full in-person payment model, there is no
   separate reservation-fee line to report.

   Gross profit is retail only. Services all have cost_price = 0 because
   the clinic hasn't supplied cost figures, so including them would
   report a 100% margin on everything. */
async function fetchHeadline(startDate: string, endDate: string) {
  const from = `${startDate}T00:00:00`;
  const to = `${endDate}T23:59:59`;

  const [paymentsRes, salesRes] = await Promise.all([
    (supabase as any).from("payments").select("amount").gte("paid_at", from).lte("paid_at", to),
    (supabase as any).from("product_sales").select("total_amount, product_id, quantity").gte("sold_at", from).lte("sold_at", to),
  ]);

  const payments = paymentsRes.data || [];
  const sales = salesRes.data || [];

  const serviceRevenue = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  const productSales = sales.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);

  // Cost of the products actually sold in the period.
  const productIds = [...new Set(sales.map((r: any) => r.product_id).filter(Boolean))];
  const costMap: Record<string, number> = {};
  if (productIds.length > 0) {
    const { data } = await (supabase as any).from("products").select("id, cost_price").in("id", productIds);
    (data || []).forEach((p: any) => { costMap[p.id] = Number(p.cost_price || 0); });
  }
  const productCost = sales.reduce(
    (s: number, r: any) => s + (costMap[r.product_id] || 0) * (r.quantity || 1), 0
  );

  return {
    serviceRevenue,
    productSales,
    productCost,
    grossProfit: productSales - productCost,
    margin: productSales > 0 ? Math.round(((productSales - productCost) / productSales) * 1000) / 10 : 0,
    salesCount: sales.length,
    hasCostData: productCost > 0,
  };
}



/* Which products moved, and how many — so the clinic knows what to keep
   on the shelf. Replaces Top Services, which repeated what Revenue by
   Category already showed. */
async function fetchTopProducts(startDate: string, endDate: string) {
  const { data, error } = await (supabase as any)
    .from("product_sales")
    .select("product_id, product_name, quantity, total_amount")
    .gte("sold_at", `${startDate}T00:00:00`)
    .lte("sold_at", `${endDate}T23:59:59`);
  if (error) throw error;

  const grouped: Record<string, { name: string; units: number; revenue: number; sales: number }> = {};
  (data || []).forEach((row: any) => {
    const key = row.product_id || row.product_name;
    const g = grouped[key] ||= { name: row.product_name, units: 0, revenue: 0, sales: 0 };
    g.units += Number(row.quantity || 0);
    g.revenue += Number(row.total_amount || 0);
    g.sales += 1;
  });

  // Sorted by units, not revenue — restocking is about how many leave
  // the shelf, not what they were worth.
  return Object.values(grouped).sort((a, b) => b.units - a.units).slice(0, 6);
}


/* Ranges people actually ask for. Each returns fresh dates rather than
   being computed once at module load, so the app doesn't get stuck on
   yesterday's "This month" if a tab is left open overnight. */
const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  {
    label: "This month",
    range: () => {
      const n = new Date();
      return { from: toISO(new Date(n.getFullYear(), n.getMonth(), 1)), to: toISO(n) };
    },
  },
  {
    label: "Last month",
    range: () => {
      const n = new Date();
      return {
        from: toISO(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        to: toISO(new Date(n.getFullYear(), n.getMonth(), 0)),
      };
    },
  },
  {
    label: "Last 7 days",
    range: () => {
      const n = new Date();
      const from = new Date(n);
      from.setDate(from.getDate() - 6);
      return { from: toISO(from), to: toISO(n) };
    },
  },
  {
    label: "This year",
    range: () => {
      const n = new Date();
      return { from: toISO(new Date(n.getFullYear(), 0, 1)), to: toISO(n) };
    },
  },
];

const CATEGORY_RAMP = ["#0E4F45", "#14958A", "#2C7A8C", "#3D6B8E", "#2E4A7D", "#1E3A5F", "#94A3B8"];

function StatCard({
  label, value, caption, icon: Icon, accent, delay,
}: {
  label: string; value: string; caption: string;
  icon: React.ElementType; accent: string; delay?: string;
}) {
  return (
    <article className={`workspace-card workspace-rise ${delay ?? ""} rounded-[24px] p-5`}>
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
    </article>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p>
    </div>
  );
}

export default function Reports() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [startDate, setStartDate] = useState(toISO(monthStart));
  const [endDate, setEndDate] = useState(toISO(today));
  const [custom, setCustom] = useState(false);

  const { data: headline, isLoading } = useQuery({
    queryKey: ["report-headline", startDate, endDate],
    queryFn: () => fetchHeadline(startDate, endDate),
  });
  const { data: byCategory = {} } = useQuery({
    queryKey: ["report-category", startDate, endDate],
    queryFn: () => fetchRevenueByCategoryFull(startDate, endDate),
  });
  const { data: topProducts = [] } = useQuery({
    queryKey: ["report-top-products", startDate, endDate],
    queryFn: () => fetchTopProducts(startDate, endDate),
  });

  const categoryEntries = useMemo(
    () => Object.entries(byCategory).sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][],
    [byCategory]
  );
  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0);

  const exportPDF = () => {
    // Landscape: the product table has four columns and portrait was
    // wrapping the names onto two lines.
    const doc = new jsPDF({ orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const M = 14;

    doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.setTextColor(14, 79, 69);
    doc.text("Pet Royale — Clinic Report", M, 18);

    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(90);
    doc.text(`${fmtDisplay(startDate)} to ${fmtDisplay(endDate)}`, M, 25);
    doc.text(
      `Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      pageWidth - M, 25, { align: "right" }
    );

    doc.setDrawColor(220); doc.line(M, 29, pageWidth - M, 29);

    /* Shared table styling. Bold white-on-teal headers, explicit column
       widths so nothing wraps, and generous cell padding. autotable's
       defaults squeeze wide columns and left everything cramped. */
    const base = {
      theme: "grid" as const,
      headStyles: {
        fillColor: [14, 79, 69] as [number, number, number],
        textColor: 255,
        fontStyle: "bold" as const,
        fontSize: 10,
        cellPadding: 3,
      },
      bodyStyles: { fontSize: 10, cellPadding: 2.8, textColor: 40 },
      alternateRowStyles: { fillColor: [248, 246, 242] as [number, number, number] },
      margin: { left: M, right: M },
    };

    autoTable(doc, {
      ...base,
      startY: 35,
      head: [["Figure", "Amount"]],
      body: [
        ["Total revenue (services)", `PHP ${(headline?.serviceRevenue || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`],
        ["Total sales (Pet Essentials)", `PHP ${(headline?.productSales || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`],
        ["   cost of goods sold", `PHP ${(headline?.productCost || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`],
        ["Gross profit on retail", `PHP ${(headline?.grossProfit || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`],
      ],
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 50, halign: "right", fontStyle: "bold" },
      },
      // The last row is the profit line, so it earns emphasis.
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === 3) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [231, 240, 235];
        }
      },
    });

    autoTable(doc, {
      ...base,
      startY: (doc as any).lastAutoTable.finalY + 9,
      head: [["Revenue by category", "Amount", "Share"]],
      body: categoryEntries.map(([cat, amt]) => [
        cat,
        `PHP ${amt.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
        categoryTotal > 0 ? `${Math.round((amt / categoryTotal) * 100)}%` : "0%",
      ]),
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 50, halign: "right" },
        2: { cellWidth: 25, halign: "right" },
      },
    });

    autoTable(doc, {
      ...base,
      startY: (doc as any).lastAutoTable.finalY + 9,
      head: [["Most purchased", "Units", "Sales", "Revenue"]],
      body: topProducts.length > 0
        ? topProducts.map((p: any) => [
            p.name, String(p.units), String(p.sales),
            `PHP ${p.revenue.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
          ])
        : [["No product sales in this period", "", "", ""]],
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 25, halign: "right" },
        2: { cellWidth: 25, halign: "right" },
        3: { cellWidth: 45, halign: "right" },
      },
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(150); doc.setFont("helvetica", "normal");
      doc.text("Pet Royale Clinic and Veterinary Services", M, doc.internal.pageSize.getHeight() - 8);
      doc.text(
        `Page ${i} of ${pages}`,
        pageWidth - M, doc.internal.pageSize.getHeight() - 8, { align: "right" }
      );
    }

    doc.save(`pet-royale-report_${startDate}_to_${endDate}.pdf`);
  };

  return (
    <AdminLayout
      title="Reports"
      eyebrow="How the clinic performed over a chosen period"
    >
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* ── The four figures ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Total revenue"
            value={isLoading ? "—" : pesoShort(headline?.serviceRevenue ?? 0)}
            caption="Payments received for services"
            icon={WalletCards}
            accent="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
          />
          <StatCard
            label="Total sales"
            value={isLoading ? "—" : pesoShort(headline?.productSales ?? 0)}
            caption={isLoading ? "" : `Pet Essentials · ${headline?.salesCount ?? 0} sale${headline?.salesCount === 1 ? "" : "s"}`}
            icon={ShoppingBag}
            accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
            delay="workspace-rise-1"
          />
          <StatCard
            label="Gross profit"
            value={isLoading ? "—" : pesoShort(headline?.grossProfit ?? 0)}
            caption={
              isLoading ? ""
                : !headline?.productSales ? "No product sales in range"
                : headline?.hasCostData ? `${headline.margin}% margin on retail`
                : "Cost prices not entered yet"
            }
            icon={TrendingUp}
            accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
            delay="workspace-rise-3"
          />
        </div>

        {/* ── Period ──
               Presets for the ranges anyone actually asks for, with the
               two date fields appearing only when none of them fits.
               No card wrapper: two controls and a button don't fill one,
               which is why it read as an empty panel. */}
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => {
            const range = p.range();
            const active = startDate === range.from && endDate === range.to;
            return (
              <button
                key={p.label}
                onClick={() => { setStartDate(range.from); setEndDate(range.to); setCustom(false); }}
                className={`h-10 rounded-xl px-4 text-xs font-bold transition ${
                  active && !custom
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                {p.label}
              </button>
            );
          })}

          <button
            onClick={() => setCustom((v) => !v)}
            className={`flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition ${
              custom
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"
            }`}
          >
            <CalendarDays size={14} /> Custom
          </button>

          <span className="ml-auto text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            {fmtDisplay(startDate)} – {fmtDisplay(endDate)}
          </span>

          <button
            onClick={exportPDF}
            className="flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5"
          >
            <Download size={15} /> Download PDF
          </button>
        </div>

        {custom && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                From
              </label>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => { if (e.target.value) setStartDate(e.target.value); }}
                aria-label="Report period start"
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
                value={endDate}
                min={startDate}
                onChange={(e) => { if (e.target.value) setEndDate(e.target.value); }}
                aria-label="Report period end"
                className="h-10 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-xs font-semibold"
              />
            </div>
          </div>
        )}

        {/* Gross profit equals sales when no cost is recorded, which
            reads as a 100% margin. Say so rather than let the number
            stand unqualified. */}
        {!isLoading && (headline?.productSales ?? 0) > 0 && !headline?.hasCostData && (
          <div className="flex items-start gap-3 rounded-2xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_95%)] px-4 py-3.5">
            <TrendingUp size={16} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
            <p className="text-xs leading-relaxed text-[hsl(40_55%_25%)]">
              Gross profit currently equals sales because no cost prices have been entered for
              products. Add them in Pet Essentials and this figure becomes a real margin.
            </p>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">

          {/* ── Revenue by category ── */}
          <section className="workspace-card rounded-[26px] p-6 sm:p-7">
            <CardHeader title="Revenue by category" subtitle="Services and products, where the money came from" />
            {categoryTotal === 0 ? (
              <p className="py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No revenue recorded in this range.
              </p>
            ) : (
              <div className="flex flex-col gap-7 sm:flex-row sm:items-center">
                <CategoryDonut entries={categoryEntries} total={categoryTotal} />
                <div className="min-w-0 flex-1 space-y-3">
                  {categoryEntries.map(([cat, amt], i) => (
                    <div key={cat} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: CATEGORY_RAMP[i % CATEGORY_RAMP.length] }}
                        />
                        <span className="truncate">{cat}</span>
                      </div>
                      <span className="shrink-0 font-semibold">{peso(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Most purchased ──
                 Sorted by units sold, not revenue: restocking is about
                 how many leave the shelf. ── */}
          <section className="workspace-card rounded-[26px] p-6 sm:p-7">
            <CardHeader title="Most purchased" subtitle="What to keep on the shelf, by units sold" />
            {topProducts.length === 0 ? (
              <div className="py-14 text-center">
                <Package className="mx-auto text-[hsl(var(--muted-foreground))]" />
                <p className="mt-3 text-sm font-bold">No product sales in this range</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                  Sales recorded in Pet Essentials appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p: any, i: number) => {
                  const max = topProducts[0].units || 1;
                  return (
                    <div key={p.name} className="flex items-center gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--secondary-foreground))]">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-baseline justify-between gap-3">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <span className="shrink-0 text-sm font-bold">
                            {p.units}
                            <span className="ml-1 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                              {p.units === 1 ? "unit" : "units"}
                            </span>
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(p.units / max) * 100}%`,
                              backgroundColor: i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary) / .5)",
                            }}
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                          {p.sales} sale{p.sales === 1 ? "" : "s"} · {peso(p.revenue)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

      </div>
    </AdminLayout>
  );
}

function CategoryDonut({ entries, total }: { entries: [string, number][]; total: number }) {
  const R = 58, CX = 78, CY = 78, STROKE = 20;
  const circumference = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="relative mx-auto h-[156px] w-[156px] shrink-0">
      <svg viewBox="0 0 156 156" className="h-full w-full -rotate-90">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth={STROKE} />
        {entries.map(([cat, amt], i) => {
          const dash = (amt / total) * circumference;
          const el = (
            <circle
              key={cat} cx={CX} cy={CY} r={R} fill="none"
              stroke={CATEGORY_RAMP[i % CATEGORY_RAMP.length]}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      {/* The total is the one figure the geometry can't convey. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
        <p className="text-[17px] font-bold tracking-[-.04em]">{pesoShort(total)}</p>
        <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">total</p>
      </div>
    </div>
  );
}
