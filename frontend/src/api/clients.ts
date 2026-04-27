import { supabase } from "@/integrations/supabase/client";
import type { Client, Pet, ClientWithPets } from "@/types";

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}

export async function fetchPetsByClient(clientId: string): Promise<Pet[]> {
  const { data, error } = await supabase
    .from("pets")
    .select("*")
    .eq("client_id", clientId)
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

  const { data: pets, error: pErr } = await supabase
    .from("pets")
    .select("*");
  if (pErr) throw pErr;

  return clients.map((c: Client) => ({
    ...c,
    pets: pets.filter((p: Pet) => p.client_id === c.id),
  }));
}
