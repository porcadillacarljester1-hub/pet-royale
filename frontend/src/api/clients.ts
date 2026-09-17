import { supabase } from "@/integrations/supabase/client";
import type { Client, Pet, ClientWithPets } from "@/types";

export async function fetchPetsByClient(clientId: string): Promise<Pet[]> {
  const { data, error } = await (supabase as any)
    .from("pets")
    .select("*")
    .eq("owner_id", clientId)
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

  const staffEmails = new Set((staffRows || []).map((s: any) => s.email));

  const { data: clients, error: cErr } = await (supabase as any)
    .from("clients")
    .select("*")
    .order("name");
  if (cErr) throw cErr;

  const { data: pets, error: pErr } = await (supabase as any)
    .from("pets")
    .select("*");
  if (pErr) throw pErr;

  // Mobile owner photos are stored in avatar history because auth metadata
  // is not directly readable from the clinic dashboard client.
  const clientIds = (clients || []).map((client: any) => client.id);
  let avatarRows: any[] = [];
  if (clientIds.length > 0) {
    const { data: avatars } = await (supabase as any)
      .from("user_avatar_history")
      .select("user_id, photo_url, created_at")
      .in("user_id", clientIds)
      .order("created_at", { ascending: false });
    avatarRows = avatars || [];
  }

  const avatarByUser = new Map<string, string>();
  avatarRows.forEach((avatar: any) => {
    if (!avatarByUser.has(avatar.user_id) && avatar.photo_url) {
      avatarByUser.set(avatar.user_id, avatar.photo_url);
    }
  });

  return clients
    .filter((c: Client) => !staffEmails.has(c.email))
    .map((c: Client) => ({
      ...c,
      avatar_url: avatarByUser.get(c.id) || null,
      pets: pets.filter((p: any) => p.owner_id === c.id),
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

export async function deleteClient(clientId: string): Promise<void> {
  const { error: petsErr } = await (supabase as any)
    .from("pets")
    .delete()
    .eq("owner_id", clientId);
  if (petsErr) throw petsErr;

  const { error: clientErr } = await (supabase as any)
    .from("clients")
    .delete()
    .eq("id", clientId);
  if (clientErr) throw clientErr;
}

export interface ClientVisitStats {
  totalVisits: number;
  lastVisit: string | null;
}

export async function fetchClientVisitStats(): Promise<Record<string, ClientVisitStats>> {
  const { data, error } = await (supabase as any)
    .from("appointments")
    .select("client_id, requested_date, status")
    .eq("status", "completed");
  if (error) throw error;

  const stats: Record<string, ClientVisitStats> = {};
  (data || []).forEach((a: any) => {
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
    (supabase as any).from("clients").select("id", { count: "exact", head: true }).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    (supabase as any).from("clients").select("id", { count: "exact", head: true }).gte("created_at", lastMonth.start).lt("created_at", lastMonth.end),
    (supabase as any).from("pets").select("id", { count: "exact", head: true }).gte("created_at", thisMonth.start).lt("created_at", thisMonth.end),
    (supabase as any).from("pets").select("id", { count: "exact", head: true }).gte("created_at", lastMonth.start).lt("created_at", lastMonth.end),
  ]);
  return {
    clientsThisMonth: c1.count || 0, clientsLastMonth: c2.count || 0,
    petsThisMonth: p1.count || 0, petsLastMonth: p2.count || 0,
  };
}