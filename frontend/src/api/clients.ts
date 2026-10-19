import { supabase } from "@/integrations/supabase/client";
import type { Client, Pet, ClientWithPets } from "@/types";

/* The database returns at most 1000 rows per request, and says nothing when
   it cuts a list off. This reads a list one page at a time until it is all
   there. Give it a query that takes a row range, and order that query by a
   unique column so no row is skipped or repeated between pages. */
const PAGE = 1000;
async function fetchAllRows(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function fetchPetsByClient(clientId: string): Promise<Pet[]> {
  const { data, error } = await (supabase as any)
    .from("pets")
    .select("*")
    .eq("owner_id", clientId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return data;
}

export async function fetchClientsWithPets(): Promise<ClientWithPets[]> {
  // Get every email that belongs to staff/admin, so we can exclude them below.
  const { data: staffRows, error: sErr } = await (supabase as any)
    .from("staff")
    .select("email");
  if (sErr) throw sErr;

  // Compared without caring about capital letters: "Dos@Mail.com" and
  // "dos@mail.com" are the same person.
  const staffEmails = new Set(
    (staffRows || []).map((s: any) => String(s.email ?? "").trim().toLowerCase())
  );

  const clients = await fetchAllRows((from, to) =>
    (supabase as any)
      .from("clients")
      .select("*")
      .is("deleted_at", null)
      .order("name")
      .order("id")
      .range(from, to)
  );

  const pets = await fetchAllRows((from, to) =>
    (supabase as any)
      .from("pets")
      .select("*")
      .is("deleted_at", null)
      .order("id")
      .range(from, to)
  );

  // Mobile owner photos are stored in avatar history because auth metadata
  // is not directly readable from the clinic dashboard client.
  // The owner ids go in a few at a time: hundreds of ids in one request make
  // the web address too long, the request fails, and every photo goes missing.
  const clientIds = clients.map((client: any) => client.id);
  const avatarRows: any[] = [];
  for (let i = 0; i < clientIds.length; i += 100) {
    const chunk = clientIds.slice(i, i + 100);
    try {
      const rows = await fetchAllRows((from, to) =>
        (supabase as any)
          .from("user_avatar_history")
          .select("user_id, photo_url, created_at")
          .in("user_id", chunk)
          .order("created_at", { ascending: false })
          .range(from, to)
      );
      avatarRows.push(...rows);
    } catch (err) {
      // Photos are a nicety. A failure here must not hide the owners.
      console.warn("Couldn't load owner photos:", err);
    }
  }

  const avatarByUser = new Map<string, string>();
  avatarRows.forEach((avatar: any) => {
    if (!avatarByUser.has(avatar.user_id) && avatar.photo_url) {
      const url: string = avatar.photo_url;
      // Add the upload time to our own storage links so the browser
      // never shows an older copy of the same file name.
      const busted = url.includes("supabase.co")
        ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(avatar.created_at)}`
        : url;
      avatarByUser.set(avatar.user_id, busted);
    }
  });

  // Group the pets by owner once, instead of searching the whole pet list
  // again for every owner.
  const petsByOwner = new Map<string, any[]>();
  pets.forEach((p: any) => {
    const list = petsByOwner.get(p.owner_id);
    if (list) list.push(p);
    else petsByOwner.set(p.owner_id, [p]);
  });

  return clients
    .filter((c: Client) => !staffEmails.has(String(c.email ?? "").trim().toLowerCase()))
    .map((c: Client) => ({
      ...c,
      avatar_url: avatarByUser.get(c.id) || null,
      pets: petsByOwner.get(c.id) || [],
    }));
}

export async function updateClient(
  clientId: string,
  updates: { name: string; email: string; phone?: string }
): Promise<void> {
  const { error } = await (supabase as any)
    .from("clients")
    .update(updates)
    .eq("id", clientId);
  if (error) throw error;
}

/* "Deleting" an owner hides them and all their pets from the system but keeps
   every row in the database, so past visits, invoices and reports still have
   their patient. Needs a deleted_at column on clients and pets (see the SQL
   that came with this change). The owner goes first: pets are only reached
   through their owner, so they are hidden the moment the owner is. */
export async function deleteClient(clientId: string): Promise<void> {
  const stamp = new Date().toISOString();
  const { data: hidden, error: clientErr } = await (supabase as any)
    .from("clients")
    .update({ deleted_at: stamp })
    .eq("id", clientId)
    .select("id");
  if (clientErr) throw clientErr;
  if (!hidden || hidden.length === 0) {
    throw new Error("The owner couldn't be deleted. Check the database permissions on clients.");
  }

  const { error: petsErr } = await (supabase as any)
    .from("pets")
    .update({ deleted_at: stamp })
    .eq("owner_id", clientId)
    .is("deleted_at", null);
  if (petsErr) throw petsErr;
}

export interface ClientVisitStats {
  totalVisits: number;
  lastVisit: string | null;
}

export async function fetchClientVisitStats(): Promise<Record<string, ClientVisitStats>> {
  const data = await fetchAllRows((from, to) =>
    (supabase as any)
      .from("appointments")
      .select("client_id, requested_date, status")
      .eq("status", "completed")
      .order("id")
      .range(from, to)
  );

  const stats: Record<string, ClientVisitStats> = {};
  data.forEach((a: any) => {
    const id = a.client_id;
    if (!id) return;
    if (!stats[id]) stats[id] = { totalVisits: 0, lastVisit: null };
    stats[id].totalVisits++;
    if (!stats[id].lastVisit || a.requested_date > stats[id].lastVisit!) {
      stats[id].lastVisit = a.requested_date;
    }
  });
  return stats;
}

export async function addContactClient(input: { name: string; email: string; phone?: string }): Promise<void> {
  const { error } = await (supabase as any)
    .from("clients")
    .insert([{ id: crypto.randomUUID(), name: input.name, email: input.email, phone: input.phone || null }]);
  if (error) throw error;
}

function monthRange(offset: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function fetchClientPetTrends(): Promise<{
  clientsThisMonth: number; clientsLastMonth: number;
  petsThisMonth: number; petsLastMonth: number;
}> {
  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);
  const [c1, c2, p1, p2] = await Promise.all([
    (supabase as any).from("clients").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    (supabase as any).from("clients").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", lastMonth.start).lt("created_at", lastMonth.end),
    (supabase as any).from("pets").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    (supabase as any).from("pets").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", lastMonth.start).lt("created_at", lastMonth.end),
  ]);
  return {
    clientsThisMonth: c1.count || 0, clientsLastMonth: c2.count || 0,
    petsThisMonth: p1.count || 0, petsLastMonth: p2.count || 0,
  };
}