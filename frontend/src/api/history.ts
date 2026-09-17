import { supabase } from "@/integrations/supabase/client";

export type HistoryType = "Appointment" | "Sale" | "Client" | "Inventory";
export type HistoryEventStatus = "Completed" | "Scheduled" | "Updated" | "Cancelled";

export interface HistoryRow {
  id: string;
  date: string;
  type: HistoryType;
  description: string;
  reference: string;
  user: string;
  status: HistoryEventStatus;
  raw: any; // full source record for the detail panel
}

function shortRef(prefix: string, id: string) {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}

export async function fetchHistoryFeed(startDate: string, endDate: string): Promise<HistoryRow[]> {
  const endOfDay = endDate + "T23:59:59";

  const [apptsRes, salesRes, clientsRes, invLogsRes, staffRes, productsRes, inventoryRes] = await Promise.all([
    supabase.from("appointments").select("*")
      .gte("created_at", startDate).lte("created_at", endOfDay),
    supabase.from("product_sales").select("*")
      .gte("sold_at", startDate).lte("sold_at", endOfDay),
    supabase.from("clients").select("*")
      .gte("created_at", startDate).lte("created_at", endOfDay),
    (supabase as any).from("inventory_logs").select("*")
      .eq("reason", "adjustment")
      .gte("created_at", startDate).lte("created_at", endOfDay),
    (supabase as any).from("staff").select("id, user_id, full_name, email"),
    supabase.from("products").select("id, name"),
    supabase.from("inventory").select("id, name"),
  ]);

  const staffMap: Record<string, string> = {};
  const staffEmails = new Set<string>();
  const staffUserIds = new Set<string>();
  (staffRes.data || []).forEach((s: any) => {
    staffMap[s.id] = s.full_name;
    if (s.email) staffEmails.add(s.email.toLowerCase().trim());
    if (s.user_id) staffUserIds.add(s.user_id);
  });
  const productMap: Record<string, string> = {};
  (productsRes.data || []).forEach((p: any) => { productMap[p.id] = p.name; });
  const inventoryMap: Record<string, string> = {};
  (inventoryRes.data || []).forEach((i: any) => { inventoryMap[i.id] = i.name; });

  const rows: HistoryRow[] = [];

  // ONE row per appointment, describing where it ended up — not a separate
  // entry for created / completed / cancelled / rescheduled. The old
  // version emitted up to four rows for a single appointment, so the same
  // pet appeared repeatedly and it read like duplicated data.
  (apptsRes.data || []).forEach((a: any) => {
    let status: HistoryEventStatus;
    let description: string;

    switch (a.status) {
      case "completed":
        status = "Completed";
        description = `${a.service} completed for ${a.pet_name}`;
        break;
      case "cancelled":
        status = "Cancelled";
        description = `${a.service} for ${a.pet_name} was cancelled`;
        break;
      case "confirmed":
        status = "Scheduled";
        description = `${a.service} for ${a.pet_name} is confirmed`;
        break;
      default:
        status = "Scheduled";
        description = `${a.service} for ${a.pet_name} is awaiting confirmation`;
    }

    // Was it moved after booking? Worth noting on the same row rather
    // than as a separate entry.
    const created = new Date(a.created_at).getTime();
    const updated = a.updated_at ? new Date(a.updated_at).getTime() : created;
    const wasRescheduled = updated - created > 60_000 && (a.status === "confirmed" || a.status === "incoming");
    if (wasRescheduled) {
      status = "Updated";
      description = `${a.service} for ${a.pet_name} was rescheduled`;
    }

    rows.push({
      id: `apt-${a.id}`,
      // Show when it last changed, so the feed reflects recent activity.
      date: a.updated_at || a.created_at,
      type: "Appointment",
      description,
      reference: shortRef("APT", a.id),
      user: staffMap[a.assigned_staff_id] || "—",
      status,
      raw: a,
    });
  });

  (salesRes.data || []).forEach((s: any) => {
    rows.push({
      id: `sale-${s.id}`,
      date: s.sold_at,
      type: "Sale",
      description: `Sold ${s.quantity} × ${s.product_name} — ₱${Number(s.total_amount || 0).toLocaleString()}`,
      reference: shortRef("SALE", s.id),
      user: staffMap[s.sold_by_staff_id] || "—",
      status: "Completed",
      raw: s,
    });
  });

  // Staff accounts are not clients. They're excluded by auth id (the
  // reliable check — see 005_fix_staff_client_trigger.sql) and by email
  // as a fallback for any records created before that fix.
  (clientsRes.data || [])
    .filter((c: any) => {
      if (staffUserIds.has(c.id)) return false;
      if (c.email && staffEmails.has(c.email.toLowerCase().trim())) return false;
      return true;
    })
    .forEach((c: any) => {
      rows.push({
        id: `client-${c.id}`,
        date: c.created_at,
        type: "Client",
        description: `${c.name} registered as a new client`,
        reference: shortRef("CLT", c.id),
        user: "—",
        status: "Completed",
        raw: c,
      });
    });

  (invLogsRes.data || []).forEach((log: any) => {
    const name = log.source_table === "products" ? productMap[log.source_id] : inventoryMap[log.source_id];
    const label = name || "item";
    const isAdd = log.change_amount > 0;
    rows.push({
      id: `inv-${log.id}`,
      date: log.created_at,
      type: "Inventory",
      description: isAdd
        ? `Added ${log.change_amount} unit(s) of ${label} to stock`
        : `Removed ${Math.abs(log.change_amount)} unit(s) of ${label} from stock`,
      reference: shortRef("INV", log.id),
      user: staffMap[log.changed_by] || "—",
      status: "Updated",
      raw: { ...log, item_name: label },
    });
  });

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}