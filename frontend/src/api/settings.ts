import { supabase } from "@/integrations/supabase/client";

export interface ClinicSettings {
  id: string;
  clinic_name: string;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  logo_url: string | null;
  updated_at: string;
}

export async function fetchClinicSettings(): Promise<ClinicSettings> {
  const { data, error } = await (supabase as any)
    .from("clinic_settings")
    .select("*")
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

export async function updateClinicSettings(id: string, updates: {
  clinic_name: string;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  logo_url?: string | null;
}): Promise<void> {
  const { error } = await (supabase as any)
    .from("clinic_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function uploadClinicLogo(file: File): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("clinic-assets").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("clinic-assets").getPublicUrl(path);
  return data.publicUrl;
}