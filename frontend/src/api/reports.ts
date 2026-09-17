import { supabase } from "@/integrations/supabase/client";

export interface PaidInvoiceRecord {
  id: string;
  appointment_id: string;
  total_amount: number;
  paid_at: string | null;
  client_name: string;
  pet_name: string;
  pet_species: string;
  items: {
    service_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
}

export async function fetchPaidInvoices(): Promise<PaidInvoiceRecord[]> {
  const { data: invoices, error: invErr } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("status", "paid")
    .order("paid_at", { ascending: false });
  if (invErr) throw invErr;
  if (!invoices || invoices.length === 0) return [];

  const appointmentIds = invoices.map((i: any) => i.appointment_id);
  const { data: appointments, error: apptErr } = await (supabase as any)
    .from("appointments")
    .select("id, client_name, pet_name, pet_species")
    .in("id", appointmentIds);
  if (apptErr) throw apptErr;

  const invoiceIds = invoices.map((i: any) => i.id);
  const { data: items, error: itemsErr } = await (supabase as any)
    .from("invoice_items")
    .select("*")
    .in("invoice_id", invoiceIds);
  if (itemsErr) throw itemsErr;

  const apptMap = new Map((appointments || []).map((a: any) => [a.id, a]));

  return invoices.map((inv: any) => {
    const appt = apptMap.get(inv.appointment_id) as any;
    return {
      id: inv.id,
      appointment_id: inv.appointment_id,
      total_amount: Number(inv.total_amount),
      paid_at: inv.paid_at,
      client_name: appt?.client_name || "Unknown",
      pet_name: appt?.pet_name || "Unknown",
      pet_species: appt?.pet_species || "",
      items: (items || [])
        .filter((it: any) => it.invoice_id === inv.id)
        .map((it: any) => ({
          service_name: it.service_name,
          quantity: it.quantity,
          unit_price: Number(it.unit_price),
          subtotal: Number(it.subtotal),
        })),
    };
  });
}

export interface InvoiceStatusByAppointment {
  status: "draft" | "pending_payment" | "paid" | "cancelled";
  total_amount: number;
}

export async function fetchInvoiceStatusByAppointment(): Promise<Record<string, InvoiceStatusByAppointment>> {
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("appointment_id, status, total_amount")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const map: Record<string, InvoiceStatusByAppointment> = {};
  (data || []).forEach((inv: any) => {
    if (!map[inv.appointment_id]) {
      map[inv.appointment_id] = { status: inv.status, total_amount: Number(inv.total_amount) };
    }
  });
  return map;
}

export interface TransactionRow {
  id: string;
  date: string;
  type: "Appointment Payment" | "Product Sale" | "New Client";
  description: string;
  reference: string;
  amount: number;
}

export async function fetchReportStats(startDate: string, endDate: string) {
  const [revenueRes, apptRes, itemsRes, clientsRes] = await Promise.all([
    supabase.from("invoices").select("total_amount, paid_at").eq("status", "paid").gte("paid_at", startDate).lte("paid_at", endDate + "T23:59:59"),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("status", "completed").gte("requested_date", startDate).lte("requested_date", endDate),
    supabase.from("invoice_items").select("id, invoices!inner(status, paid_at)").eq("invoices.status", "paid").gte("invoices.paid_at", startDate).lte("invoices.paid_at", endDate + "T23:59:59"),
    supabase.from("clients").select("id", { count: "exact", head: true }).gte("created_at", startDate).lte("created_at", endDate + "T23:59:59"),
  ]);

  const totalRevenue = (revenueRes.data || []).reduce((s, i: any) => s + Number(i.total_amount || 0), 0);

  return {
    totalRevenue,
    totalAppointments: apptRes.count || 0,
    totalServices: (itemsRes.data || []).length,
    newClients: clientsRes.count || 0,
  };
}

export async function fetchRevenueOverview(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("total_amount, paid_at")
    .eq("status", "paid")
    .gte("paid_at", startDate)
    .lte("paid_at", endDate + "T23:59:59");
  if (error) throw error;

  // Local date parts, never toISOString(). toISOString() converts to UTC,
  // and at UTC+8 a local Sunday midnight becomes the previous Saturday —
  // so invoices from the SAME week produced two different keys and the
  // chart drew one week as two separate bars carrying the same label.
  const localKey = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const fmt = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const weeks: Record<string, { revenue: number; transactions: number; label: string }> = {};
  (data || []).forEach((inv: any) => {
    const d = new Date(inv.paid_at);
    const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
    const key = localKey(weekStart);
    if (!weeks[key]) {
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      // Label includes the month: two different weeks can share the same
      // day numbers (Aug 30–Sep 5 and Nov 30–Dec 5 both read as "30-5").
      weeks[key] = { revenue: 0, transactions: 0, label: `${fmt(weekStart)} – ${fmt(weekEnd)}` };
    }
    weeks[key].revenue += Number(inv.total_amount || 0);
    weeks[key].transactions += 1;
  });

  return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

export async function fetchRevenueByCategory(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("subtotal, service_id, invoices!inner(status, paid_at)")
    .eq("invoices.status", "paid")
    .gte("invoices.paid_at", startDate)
    .lte("invoices.paid_at", endDate + "T23:59:59");
  if (error) throw error;

  const serviceIds = [...new Set((data || []).map((d: any) => d.service_id).filter(Boolean))];
  const { data: servicesData } = await supabase.from("services").select("id, category").in("id", serviceIds);
  const categoryMap: Record<string, string> = {};
  (servicesData || []).forEach((s: any) => { categoryMap[s.id] = s.category; });

  const byCategory: Record<string, number> = {};
  (data || []).forEach((item: any) => {
    const cat = categoryMap[item.service_id] || "Uncategorized";
    byCategory[cat] = (byCategory[cat] || 0) + Number(item.subtotal || 0);
  });
  return byCategory;
}

export async function fetchTopServices(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("service_name, subtotal, invoices!inner(status, paid_at)")
    .eq("invoices.status", "paid")
    .gte("invoices.paid_at", startDate)
    .lte("invoices.paid_at", endDate + "T23:59:59");
  if (error) throw error;

  const grouped: Record<string, { count: number; revenue: number }> = {};
  (data || []).forEach((item: any) => {
    if (!grouped[item.service_name]) grouped[item.service_name] = { count: 0, revenue: 0 };
    grouped[item.service_name].count++;
    grouped[item.service_name].revenue += Number(item.subtotal || 0);
  });

  return Object.entries(grouped)
    .map(([service, v]) => ({ service, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}

export async function fetchRecentTransactions(limit = 8): Promise<TransactionRow[]> {
  const [invRes, salesRes] = await Promise.all([
    supabase.from("invoices").select("id, total_amount, paid_at, appointment_id").eq("status", "paid").order("paid_at", { ascending: false }).limit(limit),
    supabase.from("product_sales").select("id, product_name, quantity, total_amount, sold_at").order("sold_at", { ascending: false }).limit(limit),
  ]);

  const apptIds = (invRes.data || []).map((i: any) => i.appointment_id).filter(Boolean);
  const { data: appts } = apptIds.length > 0
    ? await supabase.from("appointments").select("id, pet_name, service").in("id", apptIds)
    : { data: [] };
  const apptMap: Record<string, any> = {};
  (appts || []).forEach((a: any) => { apptMap[a.id] = a; });

  const rows: TransactionRow[] = [];

  (invRes.data || []).forEach((apt: any) => {
    const appt = apptMap[apt.appointment_id];
    rows.push({
      id: `inv-${apt.id}`, date: apt.paid_at, type: "Appointment Payment",
      description: appt ? `${appt.service} for ${appt.pet_name}` : "Appointment payment",
      reference: `APT-${apt.id.slice(0, 8).toUpperCase()}`, amount: Number(apt.total_amount || 0),
    });
  });

  (salesRes.data || []).forEach((sale: any) => {
    rows.push({
      id: `sale-${sale.id}`, date: sale.sold_at, type: "Product Sale",
      description: `${sale.quantity} × ${sale.product_name}`,
      reference: `SALE-${sale.id.slice(0, 8).toUpperCase()}`, amount: Number(sale.total_amount || 0),
    });
  });

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, limit);
}

export async function fetchTotalSales(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("product_sales")
    .select("total_amount")
    .gte("sold_at", startDate)
    .lte("sold_at", endDate + "T23:59:59");
  if (error) throw error;
  return {
    totalSalesAmount: (data || []).reduce((s, r: any) => s + Number(r.total_amount || 0), 0),
    totalSalesCount: (data || []).length,
  };
}

export async function fetchRevenueByCategoryFull(startDate: string, endDate: string) {
  const [serviceItems, productSales] = await Promise.all([
    supabase.from("invoice_items").select("subtotal, service_id, invoices!inner(status, paid_at)").eq("invoices.status", "paid").gte("invoices.paid_at", startDate).lte("invoices.paid_at", endDate + "T23:59:59"),
    supabase.from("product_sales").select("total_amount, product_id").gte("sold_at", startDate).lte("sold_at", endDate + "T23:59:59"),
  ]);

  const serviceIds = [...new Set((serviceItems.data || []).map((d: any) => d.service_id).filter(Boolean))];
  const productIds = [...new Set((productSales.data || []).map((d: any) => d.product_id).filter(Boolean))];

  const [servicesData, productsData] = await Promise.all([
    serviceIds.length > 0 ? supabase.from("services").select("id, category").in("id", serviceIds) : Promise.resolve({ data: [] }),
    productIds.length > 0 ? supabase.from("products").select("id, category").in("id", productIds) : Promise.resolve({ data: [] }),
  ]);

  const serviceCategoryMap: Record<string, string> = {};
  (servicesData.data || []).forEach((s: any) => { serviceCategoryMap[s.id] = s.category; });
  const productCategoryMap: Record<string, string> = {};
  (productsData.data || []).forEach((p: any) => { productCategoryMap[p.id] = p.category; });

  const byCategory: Record<string, number> = {};
  (serviceItems.data || []).forEach((item: any) => {
    const cat = serviceCategoryMap[item.service_id] || "Uncategorized Services";
    byCategory[cat] = (byCategory[cat] || 0) + Number(item.subtotal || 0);
  });
  (productSales.data || []).forEach((sale: any) => {
    const cat = productCategoryMap[sale.product_id] || "Uncategorized Products";
    byCategory[cat] = (byCategory[cat] || 0) + Number(sale.total_amount || 0);
  });

  return byCategory;
}

export async function fetchFinancialSummary(startDate: string, endDate: string) {
  const [serviceItems, productSales] = await Promise.all([
    supabase.from("invoice_items").select("subtotal, service_id, quantity, invoices!inner(status, paid_at)").eq("invoices.status", "paid").gte("invoices.paid_at", startDate).lte("invoices.paid_at", endDate + "T23:59:59"),
    supabase.from("product_sales").select("total_amount, product_id, quantity").gte("sold_at", startDate).lte("sold_at", endDate + "T23:59:59"),
  ]);

  const serviceIds = [...new Set((serviceItems.data || []).map((d: any) => d.service_id).filter(Boolean))];
  const productIds = [...new Set((productSales.data || []).map((d: any) => d.product_id).filter(Boolean))];

  const [servicesData, productsData] = await Promise.all([
    serviceIds.length > 0 ? supabase.from("services").select("id, cost_price").in("id", serviceIds) : Promise.resolve({ data: [] }),
    productIds.length > 0 ? supabase.from("products").select("id, cost_price").in("id", productIds) : Promise.resolve({ data: [] }),
  ]);

  const serviceCostMap: Record<string, number> = {};
  (servicesData.data || []).forEach((s: any) => { serviceCostMap[s.id] = Number(s.cost_price || 0); });
  const productCostMap: Record<string, number> = {};
  (productsData.data || []).forEach((p: any) => { productCostMap[p.id] = Number(p.cost_price || 0); });

  const serviceRevenue = (serviceItems.data || []).reduce((s, i: any) => s + Number(i.subtotal || 0), 0);
  const productRevenue = (productSales.data || []).reduce((s, i: any) => s + Number(i.total_amount || 0), 0);
  const totalRevenue = serviceRevenue + productRevenue;

  const serviceCOGS = (serviceItems.data || []).reduce((s, i: any) => s + (serviceCostMap[i.service_id] || 0) * (i.quantity || 1), 0);
  const productCOGS = (productSales.data || []).reduce((s, i: any) => s + (productCostMap[i.product_id] || 0) * (i.quantity || 1), 0);
  const totalCOGS = serviceCOGS + productCOGS;

  const grossProfit = totalRevenue - totalCOGS;

  return {
    totalRevenue, totalCOGS, grossProfit,
    netProfitAfterCOGS: grossProfit, // no operating-expense tracking exists — this is explicitly NOT full business net profit
    profitMargin: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0,
  };
}

export async function fetchAppointmentStatusBreakdown(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select("status")
    .gte("requested_date", startDate)
    .lte("requested_date", endDate);
  if (error) throw error;

  const counts: Record<string, number> = { completed: 0, confirmed: 0, incoming: 0, cancelled: 0 };
  (data || []).forEach((a: any) => {
    if (counts[a.status] !== undefined) counts[a.status]++;
  });
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return { counts, total };
}