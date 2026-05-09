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
  const { data: clients, error: cErr } = await supabase
    .from("clients")
    .select("*")
    .order("name");
  if (cErr) throw cErr;

  const { data: pets, error: pErr } = await (supabase as any)
    .from("pets")
    .select("*");
  if (pErr) throw pErr;

  return clients.map((c: Client) => ({
    ...c,
    pets: pets.filter((p: any) => p.owner_id === c.id),
  }));
}