import { supabase } from "@/integrations/supabase/client";

export interface Vaccination {
  id: string;
  pet_id: string;
  vaccine_name: string;
  date_administered: string;
  next_due_date: string | null;
  administered_by: string | null;
  created_at: string;
}

export interface HealthNote {
  id: string;
  pet_id: string;
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface Medication {
  id: string;
  pet_id: string;
  name: string;
  dosage: string | null;
  scheduled_time: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  prescribed_by: string | null;
  created_at: string;
}

export async function fetchVaccinations(petId: string): Promise<Vaccination[]> {
  const { data, error } = await (supabase as any)
    .from("pet_vaccinations")
    .select("*")
    .eq("pet_id", petId)
    .order("date_administered", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addVaccination(input: {
  pet_id: string;
  vaccine_name: string;
  date_administered: string;
  next_due_date: string | null;
  administered_by: string | null;
}) {
  const { error } = await (supabase as any).from("pet_vaccinations").insert([input]);
  if (error) throw error;
}

export async function deleteVaccination(id: string) {
  const { error } = await (supabase as any).from("pet_vaccinations").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchHealthNotes(petId: string): Promise<HealthNote[]> {
  const { data, error } = await (supabase as any)
    .from("pet_health_notes")
    .select("*")
    .eq("pet_id", petId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addHealthNote(input: { pet_id: string; note: string; created_by: string | null }) {
  const { error } = await (supabase as any).from("pet_health_notes").insert([input]);
  if (error) throw error;
}

export async function deleteHealthNote(id: string) {
  const { error } = await (supabase as any).from("pet_health_notes").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchMedications(petId: string): Promise<Medication[]> {
  const { data, error } = await (supabase as any)
    .from("pet_medications")
    .select("*")
    .eq("pet_id", petId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addMedication(input: {
  pet_id: string;
  name: string;
  dosage: string | null;
  scheduled_time: string | null;
  start_date: string;
  end_date: string | null;
  prescribed_by: string | null;
}) {
  const { error } = await (supabase as any).from("pet_medications").insert([{ ...input, is_active: true }]);
  if (error) throw error;
}

export async function toggleMedicationActive(id: string, isActive: boolean) {
  const { error } = await (supabase as any).from("pet_medications").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

export async function deleteMedication(id: string) {
  const { error } = await (supabase as any).from("pet_medications").delete().eq("id", id);
  if (error) throw error;
}